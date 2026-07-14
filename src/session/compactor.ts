import type OpenAI from 'openai';
import type { LLMClient } from '../llm/client.js';
import type { Logger } from '../observability.js';
import type { CompactionState, Session } from './store.js';

export interface CompactorOptions {
  llm: LLMClient;
  logger?: Logger;
  // Trigger when last LLM request's prompt_tokens exceeds this.
  triggerTokens?: number;        // default 75_000
  // Number of most-recent messages kept verbatim (not summarized).
  recentTurnsKept?: number;      // default 6
  // Don't bother compacting if fewer than this many messages would be folded.
  minCompactSize?: number;       // default 10
  // Caller supplies a persistence hook so the compactor doesn't need to know
  // about SessionStore / SqliteBackend coupling.
  onPersist?: (session: Session) => Promise<void>;
}

export class Compactor {
  private readonly llm: LLMClient;
  private readonly logger?: Logger;
  private readonly triggerTokens: number;
  private readonly recentTurnsKept: number;
  private readonly minCompactSize: number;
  private readonly onPersist?: (session: Session) => Promise<void>;
  // Per-session in-flight guard — prevents redundant overlapping compactions
  // when multiple turns trigger before the first one finishes.
  private readonly inFlight = new Set<string>();

  constructor(opts: CompactorOptions) {
    this.llm = opts.llm;
    this.logger = opts.logger?.child('compactor');
    this.triggerTokens = opts.triggerTokens ?? 75_000;
    this.recentTurnsKept = opts.recentTurnsKept ?? 6;
    this.minCompactSize = opts.minCompactSize ?? 10;
    this.onPersist = opts.onPersist;
  }

  shouldTrigger(lastInputTokens: number): boolean {
    return lastInputTokens >= this.triggerTokens;
  }

  // Returns true if compaction successfully ran and updated session state.
  async maybeCompact(session: Session, lastInputTokens: number): Promise<boolean> {
    if (this.inFlight.has(session.id)) {
      this.logger?.debug('compaction_skipped_in_flight', { sessionId: session.id });
      return false;
    }
    if (!this.shouldTrigger(lastInputTokens)) return false;

    // Snapshot the indices we plan to compact. The session may grow during
    // the LLM summarization call (user can fire next turn meanwhile); that's
    // fine — we only mutate session.compaction at the end, and use the
    // snapshot's `keepFrom` as the new compactedThrough.
    const totalLen = session.messages.length;
    const keepFrom = Math.max(0, totalLen - this.recentTurnsKept);
    const compactFrom = session.compaction?.compactedThrough ?? 0;
    if (keepFrom - compactFrom < this.minCompactSize) {
      this.logger?.debug('compaction_skipped_too_small', {
        sessionId: session.id,
        compactFrom,
        keepFrom,
        gap: keepFrom - compactFrom,
      });
      return false;
    }

    this.inFlight.add(session.id);
    const startedAt = Date.now();
    try {
      const messagesToSummarize = session.messages.slice(compactFrom, keepFrom);
      const existingSummary = session.compaction?.summary;
      const summary = await this.summarize(messagesToSummarize, existingSummary);

      session.compaction = {
        summary,
        compactedThrough: keepFrom,
        compactedAt: Date.now(),
        originalTokenCount: lastInputTokens,
      };
      session.updatedAt = new Date();
      await this.onPersist?.(session);

      this.logger?.info('compaction_done', {
        sessionId: session.id,
        compactedMessages: keepFrom - compactFrom,
        durationMs: Date.now() - startedAt,
        originalTokens: lastInputTokens,
        summaryLength: summary.length,
      });
      return true;
    } catch (err) {
      this.logger?.warn('compaction_failed', {
        sessionId: session.id,
        durationMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    } finally {
      this.inFlight.delete(session.id);
    }
  }

  private async summarize(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    existingSummary?: string,
  ): Promise<string> {
    const messagesText = messages
      .map((m) => this.renderMessageForSummary(m))
      .filter((s): s is string => s !== null)
      .join('\n');

    const systemPrompt = `You are summarizing earlier turns of a travel-planning conversation between a user and an AI agent. Output VALID JSON only — no markdown fences, no commentary.

Schema:
{
  "user_constraints": [],   // hard requirements stated by user (budget, dates, group size, origin/destination)
  "user_preferences": [],   // soft preferences expressed (pace, cuisine, hotel tier, transport)
  "decisions_locked": [],   // specific choices the user has confirmed (selected flights/hotels/itinerary items)
  "tool_findings": [],      // notable facts surfaced by tool calls (prices, weather, distances, availability)
  "open_questions": []      // topics being discussed but not yet resolved
}

Rules:
- Each list contains short, single-fact strings. Be terse — this replaces the conversation in future context.
- Drop redundancies and small talk. Keep what matters for continuing the trip-planning task.
- If an earlier summary is provided, merge new information into it; do NOT lose previously-summarized facts.`;

    const userPrompt = existingSummary
      ? `Earlier summary (incorporate, do not lose):\n${existingSummary}\n\nNew conversation since earlier summary:\n${messagesText}`
      : `Conversation to summarize:\n${messagesText}`;

    const model = this.llm.modelFor('fast');
    const completion = await this.llm.openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 2000,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('Empty summary response from LLM');
    // Parse to validate, but store the original string (preserves field order).
    JSON.parse(content);
    return content;
  }

  private renderMessageForSummary(
    m: OpenAI.Chat.Completions.ChatCompletionMessageParam,
  ): string | null {
    if (m.role === 'tool') {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      // Tool results are the heaviest content — truncate aggressively for
      // summarization. Anything past 500 chars is rarely the load-bearing fact.
      const trimmed = content.length > 500 ? content.slice(0, 500) + '…' : content;
      return `[tool result] ${trimmed}`;
    }
    if (m.role === 'assistant') {
      const text = typeof m.content === 'string' ? m.content : '';
      const tc = (m as { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> }).tool_calls;
      if (tc && tc.length > 0) {
        const calls = tc
          .map((c) => {
            const name = c.function?.name ?? '?';
            const args = c.function?.arguments ?? '';
            const argsTrim = args.length > 100 ? args.slice(0, 100) + '…' : args;
            return `${name}(${argsTrim})`;
          })
          .join(', ');
        return `[assistant] ${text}\n  → tool calls: ${calls}`;
      }
      return text ? `[assistant] ${text}` : null;
    }
    if (m.role === 'user') {
      const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return `[user] ${c}`;
    }
    // 'system' or 'function' — should not appear in session.messages
    return null;
  }
}

// Renders a CompactionState as a synthetic user/assistant pair, slotted
// after the memory pair and before live conversation. Stable until the next
// compaction event, so DeepSeek can cache this prefix block.
export function compactionPair(
  state: CompactionState | undefined,
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  if (!state) return [];
  return [
    {
      role: 'user',
      content:
        `[EARLIER CONVERSATION SUMMARY — ${state.compactedThrough} prior messages compacted]\n` +
        state.summary,
    },
    {
      role: 'assistant',
      content: '理解,我会基于以上摘要继续对话。',
    },
  ];
}
