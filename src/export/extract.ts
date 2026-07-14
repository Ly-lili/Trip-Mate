import type OpenAI from 'openai';
import type { LLMClient } from '../llm/client.js';
import type { Logger } from '../observability.js';
import type { Itinerary } from '../domain.js';
import type { Session } from '../session/store.js';

export interface ExtractOptions {
  llm: LLMClient;
  logger?: Logger;
}

// Looks at the conversation and tries to produce a structured Itinerary.
// Returns null if the conversation doesn't yet contain a clear itinerary
// (caller should fall back to markdown rendering of the latest assistant
// message in that case).
export async function extractItinerary(
  session: Session,
  opts: ExtractOptions,
): Promise<Itinerary | null> {
  const transcript = renderTranscript(session.messages);
  if (!transcript) return null;

  const systemPrompt = `You extract a structured travel itinerary from a Chinese travel-planning conversation between a user and an AI agent.

Output JSON ONLY (no markdown fences). Schema:
{
  "version": 1,
  "days": [
    {
      "date": "YYYY-MM-DD",
      "city": "城市名",
      "items": [
        { "time": "09:00", "title": "项目标题", "location": "地点", "estCostCNY": 100, "notes": "备注" }
      ],
      "estCostCNY": 500
    }
  ],
  "totalCost": {
    "flightsCNY": 0, "hotelsCNY": 0, "transitCNY": 0, "foodCNY": 0, "activitiesCNY": 0,
    "totalCNY": 0
  },
  "notes": "整体备注"
}

Rules:
- Only emit days/items the agent has actually proposed and the user has not rejected. Drop alternatives that were ruled out.
- All optional fields can be omitted; do not invent costs the agent did not state.
- If the conversation has NOT yet produced a clear day-by-day plan, output: {"version": 1, "days": []}
- All text fields stay in the original language (mostly Chinese).`;

  const model = opts.llm.modelFor('fast');
  let raw: string | undefined;
  try {
    const completion = await opts.llm.openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Conversation:\n${transcript}` },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 3000,
    });
    raw = completion.choices[0]?.message?.content ?? undefined;
  } catch (err) {
    opts.logger?.warn('itinerary_extract_failed', {
      sessionId: session.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    opts.logger?.warn('itinerary_extract_bad_json', {
      sessionId: session.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  const itinerary = coerceItinerary(parsed);
  if (!itinerary || itinerary.days.length === 0) return null;
  return itinerary;
}

// Returns the most recent assistant message text — used as the fallback
// when structured extraction yields nothing.
export function latestAssistantMarkdown(session: Session): string | null {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const m = session.messages[i];
    if (m.role === 'assistant' && typeof m.content === 'string' && m.content.trim()) {
      return m.content;
    }
  }
  return null;
}

function renderTranscript(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
): string {
  const out: string[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      const c = typeof m.content === 'string' ? m.content : '';
      if (c) out.push(`[user] ${c}`);
    } else if (m.role === 'assistant') {
      const c = typeof m.content === 'string' ? m.content : '';
      if (c) out.push(`[assistant] ${c}`);
    }
    // Skip tool turns — too noisy for itinerary extraction.
  }
  // Truncate aggressively from the front; latest content matters most.
  const joined = out.join('\n\n');
  if (joined.length > 16000) return joined.slice(-16000);
  return joined;
}

// Best-effort runtime validation. We don't reject on missing optional
// fields — we just normalize whatever the model returned.
function coerceItinerary(value: unknown): Itinerary | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const daysRaw = Array.isArray(v.days) ? v.days : [];
  const days = daysRaw
    .map((d): Itinerary['days'][number] | null => {
      if (!d || typeof d !== 'object') return null;
      const dr = d as Record<string, unknown>;
      const date = typeof dr.date === 'string' ? dr.date : '';
      const city = typeof dr.city === 'string' ? dr.city : '';
      if (!date && !city) return null;
      const itemsRaw = Array.isArray(dr.items) ? dr.items : [];
      const items = itemsRaw
        .map((it): Itinerary['days'][number]['items'][number] | null => {
          if (!it || typeof it !== 'object') return null;
          const ir = it as Record<string, unknown>;
          const title = typeof ir.title === 'string' ? ir.title : '';
          if (!title) return null;
          return {
            title,
            ...(typeof ir.time === 'string' ? { time: ir.time } : {}),
            ...(typeof ir.location === 'string' ? { location: ir.location } : {}),
            ...(typeof ir.estCostCNY === 'number' ? { estCostCNY: ir.estCostCNY } : {}),
            ...(typeof ir.notes === 'string' ? { notes: ir.notes } : {}),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      return {
        date,
        city,
        items,
        ...(typeof dr.estCostCNY === 'number' ? { estCostCNY: dr.estCostCNY } : {}),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const totalRaw = v.totalCost && typeof v.totalCost === 'object' ? (v.totalCost as Record<string, unknown>) : null;
  const totalCost = totalRaw && typeof totalRaw.totalCNY === 'number'
    ? {
        totalCNY: totalRaw.totalCNY,
        ...(typeof totalRaw.flightsCNY === 'number' ? { flightsCNY: totalRaw.flightsCNY } : {}),
        ...(typeof totalRaw.hotelsCNY === 'number' ? { hotelsCNY: totalRaw.hotelsCNY } : {}),
        ...(typeof totalRaw.transitCNY === 'number' ? { transitCNY: totalRaw.transitCNY } : {}),
        ...(typeof totalRaw.foodCNY === 'number' ? { foodCNY: totalRaw.foodCNY } : {}),
        ...(typeof totalRaw.activitiesCNY === 'number' ? { activitiesCNY: totalRaw.activitiesCNY } : {}),
      }
    : undefined;

  return {
    version: typeof v.version === 'number' ? v.version : 1,
    days,
    ...(totalCost ? { totalCost } : {}),
    ...(typeof v.notes === 'string' ? { notes: v.notes } : {}),
  };
}
