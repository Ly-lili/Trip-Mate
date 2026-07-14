'use client';

import type { ModelMode } from './types';
import { formatStatus } from './helpers';

export function ChatHeader({
  status,
  modelMode,
  hasConversation,
  isExporting,
  onModeChange,
  onExport,
  onPreview,
}: {
  status: string;
  modelMode: ModelMode;
  hasConversation: boolean;
  isExporting: boolean;
  onModeChange: (mode: ModelMode) => void;
  onExport: () => void;
  onPreview: () => void;
}): JSX.Element {
  const isBusy = status === 'Thinking' || status.startsWith('Using ') || status === 'Exporting PDF';

  return (
    <header className="relative z-10 flex h-[66px] shrink-0 items-center gap-4 border-b border-[#ECECEC] bg-white/90 px-6 backdrop-blur">
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-['Sora'] text-base font-bold leading-5 tracking-[-0.2px] text-[#171717]">
          {hasConversation ? '东京 5 日轻旅行' : '新的行程'}
        </h1>
        <p className="mt-0.5 truncate text-xs leading-4 text-[#8A8A8A]">
          {hasConversation ? '3月12日 – 3月16日 · 2 位旅客' : '还没有目的地，先和 TripMate 聊聊吧'}
        </p>
      </div>

      <select
        value={modelMode}
        onChange={(event) => onModeChange(event.target.value as ModelMode)}
        className="hidden h-9 rounded-[11px] border border-[#DEDEDE] bg-white px-3 text-[13px] font-bold text-[#171717] outline-none md:block"
      >
        <option value="main">深度规划</option>
        <option value="fast">快速模式</option>
      </select>

      <span className="hidden h-9 items-center gap-2 rounded-full border border-[#DEDEDE] bg-white px-3 text-[12.5px] font-bold text-[#5E5E5E] md:flex">
        <span className={`h-2 w-2 rounded-full ${isBusy ? 'animate-pulse bg-[#E39A3B]' : status === 'Error' ? 'bg-[#D65A4E]' : 'bg-[#2E9E6A]'}`} />
        {formatStatus(status)}
      </span>

      <button
        type="button"
        onClick={onPreview}
        disabled={!hasConversation}
        className="hidden h-9 rounded-[11px] border border-[#EDEDED] bg-white px-[15px] text-[13px] font-bold text-[#BDBDBD] disabled:cursor-not-allowed md:block"
      >
        预览
      </button>

      <button
        type="button"
        onClick={onExport}
        disabled={!hasConversation || isExporting}
        className="flex h-9 items-center gap-2 rounded-[11px] border border-[#EDEDED] bg-[#F5F5F5] px-[15px] text-[13px] font-bold text-[#BDBDBD] disabled:cursor-not-allowed enabled:border-[#E0E0E0] enabled:bg-white enabled:text-[#111111]"
      >
        <DownloadIcon />
        {isExporting ? '导出中' : '导出 PDF'}
      </button>

      <button type="button" title="更多" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] border border-[#ECECEC] bg-white text-[#8A8A8A]">
        <MoreIcon />
      </button>
    </header>
  );
}

function DownloadIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4v10m0 0 4-4m-4 4-4-4M5 20h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MoreIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}
