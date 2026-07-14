import type { LLMClient } from './llm/client.js';
import type { Logger } from './observability.js';
import type { MemoryStore } from './session/memory-store.js';

// Static fallback. Used when LLM generation fails or before the first call
// finishes — these are travel-planning starters that exercise the typical
// MCP tools (12306 高铁, 飞常准 航班, 高德 地图/天气, 酒店).
export const DEFAULT_SUGGESTIONS: readonly string[] = [
  '明天上海到北京最早3趟高铁，外加北京南站附近2家4星酒店推荐',
  '杭州到上海，10点左右出发，规划高铁和到达后第一站',
  '帮我查上海明天的天气，再推荐3个适合阴天逛的地方',
  '南宁到上海4-26的航班，按价格排序',
];

export interface SuggestionsOptions {
  llm: LLMClient;
  memoryStore?: MemoryStore;
  userId?: string;
  logger?: Logger;
}

interface CacheEntry {
  prompts: string[];
  expiresAt: number;
}

const TTL_MS = 30 * 60 * 1000;
// Process-local cache. Key is the userId (or 'anon' for unidentified visitors).
// One LLM call per user every 30min — the homepage hit rate doesn't justify
// regenerating per request, but per-user keeps memories-driven personalization.
const cache = new Map<string, CacheEntry>();

export async function getSuggestions(opts: SuggestionsOptions): Promise<string[]> {
  const key = opts.userId ?? 'anon';
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.prompts;

  try {
    const memories =
      opts.userId && opts.memoryStore ? await opts.memoryStore.list(opts.userId, 8) : [];
    const memoryLines = memories.map((m) => `- ${m.content}`).join('\n');

    const systemPrompt = `你为一个中文旅行规划聊天助手生成 4 条入口推荐词条,作为用户首次进入页面时可点击的快捷示例。

要求:
- 输出 4 条,每条是一句完整、可直接发送的中文请求(不是话题标签),长度 12~30 字
- 多样化覆盖:高铁/航班/酒店/天气+景点推荐/市内交通,至少 3 个不同主题
- 提到具体城市与近期日期(避免"明天"以外的相对时间;允许"明天"/"周末")
- 风格自然,像真实用户会问的问题
- 如有用户偏好上下文,可少量融入(如吃素/带娃/预算 X 元),不要全部都用偏好

仅输出 JSON,无前后文字:
{ "suggestions": ["...", "...", "...", "..."] }`;

    const userPrompt = memoryLines
      ? `用户已知偏好:\n${memoryLines}\n\n生成 4 条推荐词条。`
      : `生成 4 条推荐词条。`;

    const model = opts.llm.modelFor('fast');
    const completion = await opts.llm.openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 600,
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error('empty response');
    const parsed = JSON.parse(raw) as { suggestions?: unknown };
    const list = Array.isArray(parsed.suggestions)
      ? parsed.suggestions.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      : [];
    if (list.length < 2) throw new Error(`too few suggestions (${list.length})`);
    const prompts = list.slice(0, 4);
    cache.set(key, { prompts, expiresAt: now + TTL_MS });
    return prompts;
  } catch (err) {
    opts.logger?.warn('suggestions_failed', {
      userId: opts.userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [...DEFAULT_SUGGESTIONS];
  }
}

// Allow tests / admin endpoints to bust the cache.
export function clearSuggestionsCache(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}
