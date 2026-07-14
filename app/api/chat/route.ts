import { NextRequest } from 'next/server';
import { getRuntime } from '@/lib/agent-singleton';
import { preferencesContextBlock, workspaceContextBlock } from '@agent/workspace.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ChatRequestBody {
  sessionId: string;
  message: string;
  userId?: string;
  mode?: 'main' | 'fast';
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!body.sessionId || !body.message?.trim()) {
    return new Response(JSON.stringify({ error: 'sessionId and message required' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const userId = body.userId?.trim() || 'web-default';

  const { agent, sessions, llm, logger } = await getRuntime();
  const session = await sessions.getOrCreate(body.sessionId, userId);
  const preferences = await sessions.loadPreferences(userId);
  const preferencesContext = preferencesContextBlock(preferences);
  const workspaceContext = workspaceContextBlock(session.workspace);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>): void => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        for await (const ev of agent.turn(body.sessionId, body.message, {
          userId,
          preferencesContext,
          workspaceContext,
          modelTier: body.mode === 'fast' ? 'fast' : 'main',
        })) {
          send(ev);
        }
        await ensureSessionTitle(body.sessionId, { sessions, llm, logger });
        send({ type: 'end' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: 'error', message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
    },
  });
}

async function ensureSessionTitle(
  sessionId: string,
  runtime: { sessions: any; llm: any; logger: any },
): Promise<void> {
  const session = await runtime.sessions.getOrCreate(sessionId);
  if (session.title || session.messages.filter((m: any) => m.role === 'user').length !== 1) return;
  const firstUser = session.messages.find((m: any) => m.role === 'user' && typeof m.content === 'string')?.content ?? '';
  const fallback = fallbackTitle(firstUser);
  let title = fallback;
  let titleSource: 'auto' | 'fallback' = 'fallback';
  try {
    const completion = await runtime.llm.openai.chat.completions.create({
      model: runtime.llm.modelFor('fast'),
      messages: [
        {
          role: 'system',
          content: '你是旅行规划应用的会话标题生成器。请根据用户第一条消息生成 8-16 个中文字符的短标题。只输出标题，不要标点解释。',
        },
        { role: 'user', content: firstUser },
      ],
      max_tokens: 40,
    });
    const raw = completion.choices[0]?.message?.content?.trim();
    if (raw) {
      title = raw.replace(/^["“”'《》]+|["“”'《》]+$/g, '').slice(0, 24);
      titleSource = 'auto';
    }
  } catch (err) {
    runtime.logger?.warn('session_title_failed', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  await runtime.sessions.patchMeta(sessionId, { title, titleSource });
}

function fallbackTitle(input: string): string {
  const compact = input.replace(/\s+/g, '').replace(/[，。！？,.!?]/g, '');
  return compact.slice(0, 16) || '新的旅行计划';
}
