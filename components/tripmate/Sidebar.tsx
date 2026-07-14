'use client';

import type { SessionSummary } from './types';
import { formatDate } from './helpers';

const FALLBACK_TRIPS = [
  { id: 'demo-tokyo', title: '东京 5 日轻旅行', date: '3月12日 · 进行中', icon: 'compass' },
  { id: 'demo-bangkok', title: '曼谷美食之旅', date: '上周', icon: 'food' },
  { id: 'demo-iceland', title: '冰岛环岛自驾', date: '2月', icon: 'road' },
  { id: 'demo-paris', title: '巴黎周末漫步', date: '1月', icon: 'museum' },
];

export function Sidebar({
  sessions,
  sessionId,
  query,
  isLoadingSessions,
  onQuery,
  onNew,
  onLoad,
  onToggleSettings,
}: {
  sessions: SessionSummary[];
  sessionId: string;
  query: string;
  isLoadingSessions: boolean;
  connectedMcpCount: number;
  mcpCount: number;
  isLoadingStatus: boolean;
  onQuery: (value: string) => void;
  onNew: () => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (session: SessionSummary) => void;
  onToggleSettings: () => void;
}): JSX.Element {
  const items = sessions.length > 0
    ? sessions.map((session, index) => ({
      id: session.id,
      title: session.title || session.preview || '未命名行程',
      date: formatDate(session.updatedAt),
      icon: ['compass', 'food', 'road', 'museum'][index % 4],
      session,
    }))
    : FALLBACK_TRIPS;

  return (
    <aside className="flex max-h-80 min-h-0 flex-col border-b border-[#DEDEDE] bg-white px-4 py-6 lg:h-screen lg:max-h-none lg:border-b-0 lg:border-r">
      <div className="mb-5 flex shrink-0 items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#111111] text-white shadow-sm shadow-[#111111]/20">
          <CompassLogo />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-extrabold leading-5 text-[#111111]">TripMate</h1>
          <p className="mt-1 truncate text-xs font-medium text-[#7A7A7A]">AI 旅行规划伙伴</p>
        </div>
      </div>

      <button
        type="button"
        onClick={onNew}
        className="mb-4 flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#111111] text-sm font-bold text-white shadow-sm shadow-[#111111]/20 transition hover:bg-[#2A2A2A]"
      >
        <span className="text-xl leading-none">+</span>
        新建行程
      </button>

      <label className="relative mb-4 shrink-0">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#A8A8A8]">
          <SearchIcon />
        </span>
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="搜索历史行程"
          className="h-11 w-full rounded-xl border border-[#E5E5E5] bg-[#F7F7F7] pl-10 pr-3 text-sm font-medium text-[#171717] outline-none transition placeholder:text-[#9A9A9A] focus:border-[#111111] focus:bg-white focus:ring-4 focus:ring-[#111111]/10"
        />
      </label>

      <div className="mb-3 shrink-0 text-xs font-bold text-[#8A8A8A]">
        {isLoadingSessions ? '加载行程' : '历史行程'}
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pb-4">
        {items.map((item, index) => {
          const selected = 'session' in item ? item.id === sessionId : index === 0 && sessions.length === 0;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if ('session' in item) onLoad(item.id);
              }}
              className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${
                selected ? 'bg-[#F0F0F0]' : 'hover:bg-[#F7F7F7]'
              }`}
            >
              {selected ? <span className="absolute bottom-2 left-0 top-2 w-1 rounded-full bg-[#111111]" /> : null}
              <span className={`ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                selected ? 'bg-white text-[#111111]' : 'bg-[#F5F5F5] text-[#A8A8A8]'
              }`}>
                <TripIcon name={item.icon} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-extrabold leading-5 text-[#111111]">{item.title}</span>
                <span className="mt-0.5 block truncate text-xs font-medium text-[#8A8A8A]">{item.date}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="shrink-0 border-t border-[#E5E5E5] pt-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F0F0F0] text-sm font-extrabold text-[#111111]">
            旅
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-extrabold text-[#111111]">林小旅</div>
            <div className="mt-0.5 text-xs font-medium text-[#8A8A8A]">免费版</div>
          </div>
          <button
            type="button"
            onClick={onToggleSettings}
            title="设置"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#A8A8A8] hover:bg-[#F2F2F2] hover:text-[#111111]"
          >
            <GearIcon />
          </button>
        </div>
      </div>
    </aside>
  );
}

function CompassLogo(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2" />
      <path d="M15.5 8.5 13 13l-4.5 2.5L11 11l4.5-2.5Z" fill="currentColor" />
    </svg>
  );
}

function SearchIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="2" />
      <path d="m16 16 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function GearIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M19 13.5v-3l-2.1-.5a7 7 0 0 0-.7-1.6l1.1-1.8-2.1-2.1-1.8 1.1a7 7 0 0 0-1.6-.7L11.3 3h-3l-.5 2.1a7 7 0 0 0-1.6.7L4.4 4.7 2.3 6.8l1.1 1.8a7 7 0 0 0-.7 1.6L.7 10.7v3l2 .5c.2.6.4 1.1.7 1.6l-1.1 1.8 2.1 2.1 1.8-1.1c.5.3 1 .5 1.6.7l.5 2.1h3l.5-2.1c.6-.2 1.1-.4 1.6-.7l1.8 1.1 2.1-2.1-1.1-1.8c.3-.5.5-1 .7-1.6l2.1-.7Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" transform="translate(2 0)" />
    </svg>
  );
}

function TripIcon({ name }: { name: string }): JSX.Element {
  if (name === 'food') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M7 3v8M10 3v8M7 11h3M8.5 11v10M16 3v18M16 3c2.5 2 3 5.5 0 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'road') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M8 21 11 3M16 21 13 3M12 7v2M12 13v2M12 19v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'museum') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 10h16M6 10v8M10 10v8M14 10v8M18 10v8M5 18h14M3 21h18M12 3l8 4H4l8-4Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return <CompassLogo />;
}
