import type OpenAI from 'openai';
import type { LLMClient, ModelTier } from '../llm/client.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { Session, SessionStore } from '../session/store.js';
import type { MemoryStore } from '../session/memory-store.js';
import type { Logger, Metrics } from '../observability.js';
import type { StopReason, TurnEvent } from './types.js';
import { compactionPair, type Compactor } from '../session/compactor.js';

const SYSTEM_PROMPT = `You are TripMate, a careful travel-planning assistant.

How you work:
1. First, understand the user's hard constraints (budget, dates, travelers, origin/destination) and soft preferences (pace, cuisine, hotel tier, interests). Ask short clarifying questions when something critical is missing — do not invent values.
2. Then, call tools to gather concrete information (weather, points of interest, prices). You may call multiple read-only tools in parallel.
3. Finally, propose a structured day-by-day itinerary. Show estimated costs in CNY. Flag any constraint conflicts plainly.

Long-term memory:
- A "Known about user" block may appear at the start of the conversation. Treat it as established preferences — do not ask again about facts already listed there.
- When the user shares a *stable* preference or constraint (diet, transport preference, allergy, recurring schedule), call \`memory__remember\` once with one atomic fact. Do NOT save ephemeral details (this trip's dates, today's weather).
- Use \`memory__recall\` when you need more detail than the injected block, or when the user asks "what do you remember about me".
- Use \`memory__forget\` only when the user explicitly asks to forget something.

Style: concise, structured, no filler. Prefer bullet lists and headings over prose. When uncertain about a fact, say so rather than guessing.`;

export interface AgentOptions {
  llm: LLMClient;
  tools: ToolRegistry;
  sessions: SessionStore;
  memories?: MemoryStore;
  compactor?: Compactor;
  logger?: Logger;
  metrics?: Metrics;
  maxIterations?: number;
  system?: string;
  modelTier?: ModelTier;
  maxTokens?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  memoryInjectLimit?: number;
}

export class Agent {
  private readonly llm: LLMClient;
  private readonly tools: ToolRegistry;
  private readonly sessions: SessionStore;
  private readonly memories?: MemoryStore;
  private readonly compactor?: Compactor;
  private readonly logger?: Logger;
  private readonly metrics?: Metrics;
  private readonly maxIterations: number;
  private readonly system: string;
  private readonly modelTier: ModelTier;
  private readonly maxTokens: number;
  private readonly reasoningEffort: 'low' | 'medium' | 'high';
  private readonly memoryInjectLimit: number;

  constructor(opts: AgentOptions) {
    this.llm = opts.llm;
    this.tools = opts.tools;
    this.sessions = opts.sessions;
    this.memories = opts.memories;
    this.compactor = opts.compactor;
    this.logger = opts.logger?.child('agent');
    this.metrics = opts.metrics;
    this.maxIterations = opts.maxIterations ?? 10;
    this.system = opts.system ?? SYSTEM_PROMPT;
    this.modelTier = opts.modelTier ?? 'main';
    this.maxTokens = opts.maxTokens ?? 16000;
    this.reasoningEffort = opts.reasoningEffort ?? 'high';
    this.memoryInjectLimit = opts.memoryInjectLimit ?? 12;
  }

  async *turn(
    sessionId: string,
    userMessage: string,
    opts: {
      userId?: string;
      preferencesContext?: string | null;
      workspaceContext?: string | null;
      modelTier?: ModelTier;
    } = {},
  ): AsyncGenerator<TurnEvent> {
    const session = await this.sessions.getOrCreate(sessionId, opts.userId);
    if (opts.userId && !session.userId) {
      session.userId = opts.userId;
    }

    // Snapshot long-term memory once per session. Frozen for the rest of the
    // session so the request prefix is byte-stable across turns and DeepSeek
    // can hit prompt cache. Mid-session `memory__remember` writes still land
    // in the DB but are picked up on the *next* session.
    if (session.userId && session.memorySnapshot === undefined) {
      session.memorySnapshot = (await this.buildMemoryBlock(session.userId)) ?? '';
    }

    session.messages.push({ role: 'user', content: userMessage });
    session.updatedAt = new Date();

    const tools = this.tools.openaiTools();
    const model = this.llm.modelFor(opts.modelTier ?? this.modelTier);
    const supportsReasoning = /pro|reasoner/i.test(model);
    let lastInputTokens = 0;

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      const startedAt = Date.now();

      const compactedThrough = session.compaction?.compactedThrough ?? 0;
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: this.system },
        ...this.contextPair(session.memorySnapshot),
        ...this.contextPair(opts.preferencesContext ?? undefined),
        ...this.contextPair(opts.workspaceContext ?? undefined),
        ...compactionPair(session.compaction),
        ...session.messages.slice(compactedThrough),
      ];

      const stream = this.llm.openai.chat.completions.stream({
        model,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        max_tokens: this.maxTokens,
        ...(supportsReasoning ? { reasoning_effort: this.reasoningEffort } : {}),
      });

      let streamedReasoning = '';
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta as
          | { content?: string | null; reasoning_content?: string | null }
          | undefined;
        if (delta?.content) {
          yield { type: 'text', text: delta.content };
        }
        if (typeof delta?.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
          streamedReasoning += delta.reasoning_content;
        }
      }

      const final = await stream.finalChatCompletion();
      const latencyMs = Date.now() - startedAt;
      const usage = final.usage;
      const inputTokens = usage?.prompt_tokens ?? 0;
      const outputTokens = usage?.completion_tokens ?? 0;
      lastInputTokens = inputTokens;
      const cacheReadTokens =
        ((usage as unknown as { prompt_cache_hit_tokens?: number })?.prompt_cache_hit_tokens) ?? 0;
      const cacheCreateTokens = 0;

      this.metrics?.recordRequest({
        model,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreateTokens,
        latencyMs,
      });
      this.logger?.debug('llm_request', {
        sessionId,
        iteration,
        model,
        latencyMs,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        finishReason: final.choices[0]?.finish_reason,
      });

      yield {
        type: 'usage',
        model,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreateTokens,
        latencyMs,
      };

      const choice = final.choices[0];
      const message = choice?.message;
      if (!message) {
        yield { type: 'done', reason: 'other' };
        return;
      }

      const toolCalls = message.tool_calls ?? [];
      const functionToolCalls = toolCalls.filter(
        (tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
          tc.type === 'function',
      );

      // DeepSeek thinking-mode quirk: the OpenAI SDK stream helper doesn't
      // accumulate `delta.reasoning_content` into `finalChatCompletion()`, so
      // we read it from the message if present, else from our own accumulator.
      // The next request 400s if we don't pass it back on the assistant turn.
      const messageReasoning = (message as { reasoning_content?: string | null })
        .reasoning_content;
      const reasoningContent =
        (typeof messageReasoning === 'string' && messageReasoning.length > 0
          ? messageReasoning
          : streamedReasoning) || null;

      type AssistantWithReasoning =
        OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam & {
          reasoning_content?: string | null;
        };

      const assistantParam: AssistantWithReasoning = {
        role: 'assistant',
        content: message.content ?? null,
        ...(functionToolCalls.length > 0
          ? {
              tool_calls: functionToolCalls.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.function.name, arguments: tc.function.arguments },
              })),
            }
          : {}),
        ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
      };
      session.messages.push(assistantParam);
      session.updatedAt = new Date();

      for (const tc of functionToolCalls) {
        yield {
          type: 'tool_call',
          name: tc.function.name,
          input: tryParse(tc.function.arguments),
        };
      }

      const finishReason = choice.finish_reason;
      if (finishReason !== 'tool_calls' || functionToolCalls.length === 0) {
        await this.sessions.save(sessionId);
        this.fireCompaction(session, lastInputTokens);
        yield { type: 'done', reason: mapFinishReason(finishReason) };
        return;
      }

      const executed = await Promise.all(
        functionToolCalls.map(async (tc) => {
          const input = parseAsRecord(tc.function.arguments);
          const result = await this.tools.execute(tc.function.name, input, {
            userId: session.userId,
            sessionId,
          });
          return { tc, result };
        }),
      );

      for (const { tc, result } of executed) {
        yield {
          type: 'tool_result',
          name: tc.function.name,
          content: result.content,
          isError: result.isError,
          latencyMs: result.latencyMs,
        };
        session.messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: result.content,
        });
      }

      session.updatedAt = new Date();
      await this.sessions.save(sessionId);
    }

    this.fireCompaction(session, lastInputTokens);
    yield { type: 'done', reason: 'max_iterations' };
  }

  // Fire-and-forget: compaction shouldn't block the user response. Errors are
  // swallowed inside maybeCompact() (logged, return false) — the .catch() here
  // is only a belt-and-braces guard against unexpected throws.
  private fireCompaction(session: Session, lastInputTokens: number): void {
    if (!this.compactor || lastInputTokens === 0) return;
    this.compactor.maybeCompact(session, lastInputTokens).catch((err) => {
      this.logger?.warn('compaction_unhandled_error', {
        sessionId: session.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  // Renders the memory snapshot as a synthetic user/assistant pair injected
  // right after the system message. Decouples easy-to-change content (memory)
  // from the frozen system prompt so prompt cache prefixes stay stable.
  private contextPair(
    snapshot: string | undefined,
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    if (!snapshot) return [];
    return [
      { role: 'user', content: snapshot },
      { role: 'assistant', content: '好的,我会基于以上偏好继续对话。' },
    ];
  }

  private async buildMemoryBlock(userId: string | undefined): Promise<string | null> {
    if (!userId || !this.memories) return null;
    try {
      const entries = await this.memories.list(userId, this.memoryInjectLimit);
      if (entries.length === 0) return null;
      const lines = entries.map((m) => {
        const tagPart = m.tags.length > 0 ? ` [${m.tags.join(', ')}]` : '';
        return `- #${m.id}${tagPart}: ${m.content}`;
      });
      return `Known about user (long-term memory; do not re-ask):\n${lines.join('\n')}`;
    } catch (err) {
      this.logger?.warn('memory_inject_failed', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function parseAsRecord(s: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function mapFinishReason(reason: string | null | undefined): StopReason {
  switch (reason) {
    case 'stop':
      return 'end_turn';
    case 'length':
      return 'other';
    case 'content_filter':
      return 'refusal';
    case 'tool_calls':
      return 'other';
    default:
      return 'other';
  }
}
