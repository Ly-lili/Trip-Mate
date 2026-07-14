import type { Itinerary, TripWorkspace, TripWorkspaceProfile } from './domain.js';
import type { UserPreferences } from './session/store.js';

export function emptyWorkspace(): TripWorkspace {
  return {
    version: 1,
    profile: {},
    itinerary: { version: 1, days: [] },
    pendingQuestions: [],
    manualFields: [],
    updatedAt: new Date().toISOString(),
  };
}

export function workspaceFromItinerary(
  itinerary: Itinerary | null | undefined,
  profile: TripWorkspaceProfile = {},
): TripWorkspace {
  return {
    version: 1,
    profile,
    itinerary: itinerary ?? { version: 1, days: [] },
    pendingQuestions: [],
    manualFields: [],
    updatedAt: new Date().toISOString(),
  };
}

export function mergeWorkspaceSuggestion(
  current: TripWorkspace | undefined,
  suggestion: TripWorkspace,
): TripWorkspace {
  const base = current ?? emptyWorkspace();
  const manual = new Set(base.manualFields ?? []);
  const profile: TripWorkspaceProfile = { ...base.profile };

  for (const [key, value] of Object.entries(suggestion.profile) as Array<
    [keyof TripWorkspaceProfile, TripWorkspaceProfile[keyof TripWorkspaceProfile]]
  >) {
    if (value === undefined) continue;
    if (profile[key] === undefined || !manual.has(`profile.${key}`)) {
      (profile as Record<string, unknown>)[key] = value;
    }
  }

  const itinerary = base.itinerary.days.length > 0 && manual.has('itinerary')
    ? base.itinerary
    : suggestion.itinerary.days.length > 0
      ? suggestion.itinerary
      : base.itinerary;

  return {
    ...base,
    profile,
    itinerary,
    pendingQuestions: suggestion.pendingQuestions ?? base.pendingQuestions ?? [],
    updatedAt: new Date().toISOString(),
  };
}

export function preferencesContextBlock(prefs: UserPreferences | undefined): string | null {
  if (!prefs) return null;
  const lines: string[] = [];
  if (prefs.defaultDepartureCity) lines.push(`- 默认出发城市: ${prefs.defaultDepartureCity}`);
  if (prefs.currency) lines.push(`- 默认预算币种: ${prefs.currency}`);
  if (prefs.language) lines.push(`- 偏好语言: ${prefs.language === 'en' ? '英文' : '中文'}`);
  if (prefs.pace) lines.push(`- 默认旅行节奏: ${labelPace(prefs.pace)}`);
  if (prefs.hotelTier) lines.push(`- 默认住宿偏好: ${labelHotelTier(prefs.hotelTier)}`);
  if (prefs.cuisinePrefs?.length) lines.push(`- 餐饮偏好: ${prefs.cuisinePrefs.join('、')}`);
  if (prefs.avoidChains !== undefined) lines.push(`- 连锁店偏好: ${prefs.avoidChains ? '尽量避开' : '可以接受'}`);
  if (prefs.notes?.length) lines.push(`- 其他偏好: ${prefs.notes.join('；')}`);
  if (lines.length === 0) return null;
  return [
    '用户默认偏好（低优先级，仅当用户本轮没有明确说明时作为默认值使用；不得覆盖用户当前消息）：',
    ...lines,
  ].join('\n');
}

export function workspaceContextBlock(workspace: TripWorkspace | undefined): string | null {
  if (!workspace) return null;
  const lines: string[] = [];
  const p = workspace.profile;
  if (p.departure) lines.push(`- 出发地: ${p.departure}`);
  if (p.destination) lines.push(`- 目的地: ${p.destination}`);
  if (p.dateRange?.start || p.dateRange?.end) lines.push(`- 日期: ${p.dateRange?.start ?? ''} 至 ${p.dateRange?.end ?? ''}`);
  if (p.budgetCNY) lines.push(`- 预算: ${p.budgetCNY} CNY`);
  if (p.travelers) lines.push(`- 人数: ${p.travelers}`);
  if (p.pace) lines.push(`- 节奏: ${labelPace(p.pace)}`);
  if (p.hotelTier) lines.push(`- 住宿: ${labelHotelTier(p.hotelTier)}`);
  if (workspace.itinerary.days.length) {
    lines.push(`- 已有行程天数: ${workspace.itinerary.days.length}`);
  }
  if (lines.length === 0) return null;
  return [
    '本次行程草稿（中优先级；除非用户本轮明确覆盖，否则尽量沿用；用户手动编辑字段更高优先级）：',
    ...lines,
  ].join('\n');
}

export function workspaceToMarkdown(workspace: TripWorkspace, title = 'TripMate 行程草稿'): string {
  const out: string[] = [`# ${title}`, ''];
  const p = workspace.profile;
  out.push('## 行程摘要');
  out.push(`- 出发地：${p.departure || '待确认'}`);
  out.push(`- 目的地：${p.destination || '待确认'}`);
  out.push(`- 日期：${p.dateRange?.start || '待确认'} 至 ${p.dateRange?.end || '待确认'}`);
  out.push(`- 预算：${p.budgetCNY ? `${p.budgetCNY} CNY` : '待确认'}`);
  out.push(`- 人数：${p.travelers || '待确认'}`);
  out.push(`- 节奏：${p.pace ? labelPace(p.pace) : '待确认'}`);
  out.push(`- 住宿偏好：${p.hotelTier ? labelHotelTier(p.hotelTier) : '待确认'}`);
  out.push('');

  for (const [index, day] of workspace.itinerary.days.entries()) {
    out.push(`## Day ${index + 1} ${day.date || ''} ${day.city || ''}`.trim());
    if (day.estCostCNY !== undefined) out.push(`- 当日预算：${day.estCostCNY} CNY`);
    for (const item of day.items) {
      const parts = [item.time, item.title, item.location].filter(Boolean).join(' · ');
      out.push(`- ${parts || item.title}`);
      if (item.estCostCNY !== undefined || item.notes) {
        out.push(`  - ${[item.estCostCNY !== undefined ? `预算 ${item.estCostCNY} CNY` : '', item.notes ?? ''].filter(Boolean).join('；')}`);
      }
    }
    out.push('');
  }

  if (workspace.itinerary.totalCost) {
    out.push('## 预算汇总');
    out.push(`- 合计：${workspace.itinerary.totalCost.totalCNY} CNY`);
    out.push('');
  }
  if (workspace.itinerary.notes) {
    out.push('## 注意事项');
    out.push(workspace.itinerary.notes);
    out.push('');
  }
  if (workspace.pendingQuestions?.length) {
    out.push('## 待确认');
    for (const q of workspace.pendingQuestions) out.push(`- ${q}`);
  }
  return out.join('\n').trimEnd() + '\n';
}

function labelPace(value: NonNullable<UserPreferences['pace']>): string {
  return value === 'relaxed' ? '轻松' : value === 'packed' ? '紧凑' : '均衡';
}

function labelHotelTier(value: NonNullable<UserPreferences['hotelTier']>): string {
  return value === 'budget' ? '经济' : value === 'luxury' ? '高端' : '舒适';
}
