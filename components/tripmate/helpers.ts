import type { ActivityItem, TripWorkspace, WorkspaceDay, WorkspaceItem } from './types';

export const PROMPT_CARDS = [
  {
    title: '周末短途',
    text: '帮我规划一个从上海出发的 2 天轻松短途旅行，要有好吃的、交通方便，并安排一个难忘的风景点。',
  },
  {
    title: '亲子旅行',
    text: '设计一个 5 天亲子友好的行程，转场不要太累，安排适合孩子的景点，并给出住宿建议。',
  },
  {
    title: '预算优化',
    text: '帮我比较两个目的地，把整趟旅行控制在 5000 元以内，同时不要把行程排得太赶。',
  },
  {
    title: '自然慢旅行',
    text: '帮我规划一次云南自然慢旅行，包含风景徒步、当地住宿和人少一些的路线。',
  },
];

export const QUICK_PROMPTS = [
  { label: '帮我规划东京 5 日游', text: '帮我规划东京 5 日游，预算适中，想要美食、城市漫步和一两个经典景点。', icon: 'route' },
  { label: '5000 元周末去哪好', text: '我有 5000 元预算，想安排一次轻松周末旅行，帮我推荐目的地并给出路线。', icon: 'wallet' },
  { label: '带娃的亲子路线', text: '帮我规划一条适合带娃的亲子路线，节奏轻松，交通方便，住宿舒适。', icon: 'smile' },
];

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

export function formatStatus(value: string): string {
  if (value === 'Ready') return '就绪';
  if (value === 'Loading') return '加载中';
  if (value === 'Thinking') return '生成中';
  if (value === 'Error') return '连接失败';
  if (value === 'Exporting PDF') return '正在导出 PDF';
  if (value.startsWith('Using ')) return `调用 ${value.slice(6)}`;
  if (value.endsWith(' failed')) return `${value.slice(0, -7)} 失败`;
  if (value.endsWith(' done')) return `${value.slice(0, -5)} 完成`;
  if (value.startsWith('Used ')) return value.replace('Used ', '已使用 ');
  return value;
}

export function shorten(value: string, maxLength = 120): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

export function toneDotClass(tone: ActivityItem['tone']): string {
  if (tone === 'ok') return 'bg-[#2E9E6A]';
  if (tone === 'warn') return 'bg-[#D65A4E]';
  if (tone === 'active') return 'bg-[#E39A3B]';
  return 'bg-[#9A9A9A]';
}

export function labelPace(value?: string): string {
  if (value === 'relaxed') return '轻松';
  if (value === 'packed') return '紧凑';
  return '均衡';
}

export function labelHotelTier(value?: string): string {
  if (value === 'budget') return '经济';
  if (value === 'luxury') return '高端';
  return '舒适';
}

export function updateWorkspaceProfile(
  workspace: TripWorkspace,
  key: keyof TripWorkspace['profile'],
  rawValue: string,
): TripWorkspace {
  const value = key === 'budgetCNY' || key === 'travelers' ? numberOrUndefined(rawValue) : rawValue.trim() || undefined;
  return {
    ...workspace,
    profile: { ...workspace.profile, [key]: value },
    manualFields: Array.from(new Set([...(workspace.manualFields ?? []), `profile.${key}`])),
    updatedAt: new Date().toISOString(),
  };
}

export function updateWorkspaceDate(workspace: TripWorkspace, key: 'start' | 'end', value: string): TripWorkspace {
  return {
    ...workspace,
    profile: {
      ...workspace.profile,
      dateRange: {
        start: workspace.profile.dateRange?.start ?? '',
        end: workspace.profile.dateRange?.end ?? '',
        [key]: value,
      },
    },
    manualFields: Array.from(new Set([...(workspace.manualFields ?? []), 'profile.dateRange'])),
    updatedAt: new Date().toISOString(),
  };
}

export function addDay(workspace: TripWorkspace): TripWorkspace {
  const next: WorkspaceDay = { date: '', city: '', items: [] };
  return {
    ...workspace,
    itinerary: { ...workspace.itinerary, days: [...workspace.itinerary.days, next] },
    manualFields: Array.from(new Set([...(workspace.manualFields ?? []), 'itinerary'])),
    updatedAt: new Date().toISOString(),
  };
}

export function updateDay(workspace: TripWorkspace, index: number, patch: Partial<WorkspaceDay>): TripWorkspace {
  const days = workspace.itinerary.days.map((day, i) => (i === index ? { ...day, ...patch } : day));
  return markItineraryManual({ ...workspace, itinerary: { ...workspace.itinerary, days } });
}

export function removeDay(workspace: TripWorkspace, index: number): TripWorkspace {
  const days = workspace.itinerary.days.filter((_, i) => i !== index);
  return markItineraryManual({ ...workspace, itinerary: { ...workspace.itinerary, days } });
}

export function addItem(workspace: TripWorkspace, dayIndex: number): TripWorkspace {
  const item: WorkspaceItem = { title: '新的行程项', kind: 'spot', status: 'pending' };
  const days = workspace.itinerary.days.map((day, i) => (
    i === dayIndex ? { ...day, items: [...day.items, item] } : day
  ));
  return markItineraryManual({ ...workspace, itinerary: { ...workspace.itinerary, days } });
}

export function updateItem(
  workspace: TripWorkspace,
  dayIndex: number,
  itemIndex: number,
  patch: Partial<WorkspaceItem>,
): TripWorkspace {
  const days = workspace.itinerary.days.map((day, i) => {
    if (i !== dayIndex) return day;
    return {
      ...day,
      items: day.items.map((item, j) => (j === itemIndex ? { ...item, ...patch } : item)),
    };
  });
  return markItineraryManual({ ...workspace, itinerary: { ...workspace.itinerary, days } });
}

export function removeItem(workspace: TripWorkspace, dayIndex: number, itemIndex: number): TripWorkspace {
  const days = workspace.itinerary.days.map((day, i) => (
    i === dayIndex ? { ...day, items: day.items.filter((_, j) => j !== itemIndex) } : day
  ));
  return markItineraryManual({ ...workspace, itinerary: { ...workspace.itinerary, days } });
}

function markItineraryManual(workspace: TripWorkspace): TripWorkspace {
  return {
    ...workspace,
    manualFields: Array.from(new Set([...(workspace.manualFields ?? []), 'itinerary'])),
    updatedAt: new Date().toISOString(),
  };
}

function numberOrUndefined(value: string): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
