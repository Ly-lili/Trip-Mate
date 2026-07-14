'use client';

import { UIEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ActivityItem, ChatMessage } from './types';
import { QUICK_PROMPTS, toneDotClass } from './helpers';

export function MessageList({
  messages,
  hasConversation,
  onPrompt,
  onScroll,
  bottomRef,
}: {
  messages: ChatMessage[];
  hasConversation: boolean;
  onPrompt: (text: string) => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  bottomRef: React.RefObject<HTMLDivElement>;
}): JSX.Element {
  return (
    <div onScroll={onScroll} className="relative min-h-0 flex-1 overflow-hidden bg-[#F3F3F3] px-[30px] pb-2 pt-[26px]">
      {!hasConversation ? (
        <WelcomePanel onPrompt={onPrompt} />
      ) : (
        <div className="flex h-full flex-col gap-[18px] overflow-y-auto [-webkit-mask-image:linear-gradient(#000_90%,transparent)]">
          {messages.map((message, index) => (
            <article key={`${message.role}-${index}`} className={message.role === 'user' ? 'flex justify-end' : 'flex items-start gap-3'}>
              {message.role === 'assistant' ? (
                <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px] bg-gradient-to-br from-[#111111] to-[#111111] text-white">
                  <CompassIcon size={18} />
                </div>
              ) : null}
              <div
                className={
                  message.role === 'user'
                    ? 'max-w-[74%] rounded-[16px_16px_5px_16px] bg-[#F3F3F3] px-4 py-[13px] text-sm leading-[1.6] text-[#303030]'
                    : 'prose-content markdown-body max-w-[78%] rounded-[5px_16px_16px_16px] border border-[#EDEDED] bg-white px-4 py-3.5 text-sm leading-[1.65] text-[#171717] shadow-[0_4px_14px_rgba(28,58,44,0.05)]'
                }
              >
                {message.role === 'assistant' ? (
                  <>
                    {message.activity?.length ? <ThinkingBlock activity={message.activity} /> : null}
                    {message.content ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                    ) : (
                      <span className="text-[#737373]">正在准备你的路线...</span>
                    )}
                  </>
                ) : (
                  <p className="whitespace-pre-wrap">{message.content}</p>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}

function WelcomePanel({ onPrompt }: { onPrompt: (text: string) => void }): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <div className="mb-1.5 flex h-[74px] w-[74px] items-center justify-center rounded-[22px] bg-gradient-to-br from-[#111111] to-[#111111] text-white shadow-[0_14px_34px_rgba(46,158,106,0.34)]">
        <CompassIcon size={38} />
      </div>
      <h2 className="font-['Sora'] text-[27px] font-bold leading-9 tracking-[-0.5px] text-[#171717]">嗨，想去哪儿玩？</h2>
      <p className="max-w-[440px] text-[14.5px] leading-[1.6] text-[#8A8A8A]">
        告诉我目的地、出行时间、预算和偏好，我会帮你排好每日行程、估算花费并提醒潜在冲突。
      </p>
      <div className="mt-3.5 flex max-w-[560px] flex-wrap justify-center gap-2.5">
        {QUICK_PROMPTS.map((prompt) => (
          <button
            key={prompt.label}
            type="button"
            onClick={() => onPrompt(prompt.text)}
            className="flex items-center gap-2 rounded-[14px] border border-[#E8E8E8] bg-white px-[15px] py-[11px] text-[13.5px] text-[#171717] shadow-[0_3px_10px_rgba(28,58,44,0.04)]"
          >
            <PromptIcon name={prompt.icon} />
            {prompt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ThinkingBlock({ activity }: { activity: ActivityItem[] }): JSX.Element {
  const latest = activity[activity.length - 1];

  return (
    <details className="mb-3 rounded-[12px] border border-[#E0E0E0] bg-[#F7F7F7] px-3 py-2 text-[12.5px]" open={!latest || latest.tone === 'active'}>
      <summary className="cursor-pointer select-none font-bold text-[#3F3F3F]">
        {latest?.tone === 'active' ? '正在梳理行程...' : `活动时间线（${activity.length}）`}
      </summary>
      <div className="mt-3 max-h-44 space-y-3 overflow-y-auto pr-1">
        {activity.map((item) => (
          <div key={item.id} className="flex gap-3">
            <span className={`${toneDotClass(item.tone)} mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full`} />
            <div className="min-w-0 flex-1">
              <div className="font-bold text-[#171717]">{item.label}</div>
              {item.detail ? <div className="mt-1 break-words text-xs leading-5 text-[#737373]">{item.detail}</div> : null}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function CompassIcon({ size }: { size: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" />
      <path d="M15.6 8.4 13 13l-4.6 2.6L11 11l4.6-2.6Z" fill="currentColor" />
    </svg>
  );
}

function PromptIcon({ name }: { name: string }): JSX.Element {
  if (name === 'wallet') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-[#111111]">
        <path d="M4 7h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M17 13h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === 'smile') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-[#111111]">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        <path d="M8.5 10h.01M15.5 10h.01M8.5 14.5c1.2 1.3 5.8 1.3 7 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-[#737373]">
      <path d="M5 19c4-1 10-9 14-14M5 19l2-6 4 4-6 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
