'use client';

import { FormEvent } from 'react';

export function Composer({
  input,
  status,
  canSend,
  onInput,
  onSubmit,
}: {
  input: string;
  status: string;
  canSend: boolean;
  onInput: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}): JSX.Element {
  const isGenerating = status === 'Thinking' || status.startsWith('Using ');

  return (
    <form onSubmit={onSubmit} className="shrink-0 bg-[#F3F3F3] px-[30px] pb-5 pt-3">
      {isGenerating ? null : (
        <div className="mb-[11px] flex flex-wrap gap-2">
          {['换成亲子路线', '增加美食推荐', '帮我缩减预算', '第 3 天太满了'].map((chip) => (
            <button key={chip} type="button" className="rounded-full border border-[#E8E8E8] bg-white px-[13px] py-1.5 text-[12.5px] text-[#5E5E5E]">
              {chip}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2.5 rounded-[18px] border border-[#E5E5E5] bg-white px-4 py-[11px] shadow-[0_6px_20px_rgba(28,58,44,0.06)]">
        <span className="mb-1.5 text-[#9A9A9A]">
          <PaperclipIcon />
        </span>
        <textarea
          id="tripmate-composer"
          value={input}
          onChange={(event) => onInput(event.target.value)}
          rows={1}
          placeholder={isGenerating ? '继续和 TripMate 对话，调整你的行程…' : '告诉 TripMate 你的目的地、时间和预算…'}
          className="min-h-6 max-h-28 flex-1 resize-none bg-transparent py-[5px] text-sm leading-[1.5] text-[#171717] outline-none placeholder:text-[#989898]"
        />
        {isGenerating ? (
          <button type="button" className="flex items-center gap-1.5 rounded-[12px] border border-[#E5E5E5] bg-white px-3.5 py-[9px] text-[13px] font-bold text-[#5E5E5E]">
            <StopIcon />
            停止
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] bg-gradient-to-br from-[#111111] to-[#111111] text-white shadow-[0_5px_13px_rgba(46,158,106,0.3)] disabled:cursor-not-allowed disabled:from-[#C7C7C7] disabled:to-[#C7C7C7] disabled:shadow-none"
          >
            <ArrowUpIcon />
          </button>
        )}
      </div>
    </form>
  );
}

function PaperclipIcon(): JSX.Element {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m21 11-8.5 8.5a6 6 0 0 1-8.5-8.5l8.5-8.5a4 4 0 0 1 5.7 5.7L9.7 16.7a2 2 0 0 1-2.8-2.8L15 5.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowUpIcon(): JSX.Element {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 19V5m0 0-6 6m6-6 6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StopIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}
