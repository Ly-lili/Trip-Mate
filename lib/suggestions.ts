export const DEFAULT_SUGGESTIONS = [
  '帮我规划一个 3 天上海周末游，预算 3000 元',
  '我想带父母去成都，节奏轻松一点',
  '做一个北京到杭州的高铁加美食行程',
  '帮我比较三亚和厦门哪个更适合亲子游',
];

export async function getSuggestions(_opts?: unknown): Promise<string[]> {
  return [...DEFAULT_SUGGESTIONS];
}
