'use client';

import { useState } from 'react';
import type { UserPreferences } from './types';

export function SettingsPanel({
  open,
  preferences,
  onClose,
  onSave,
}: {
  open: boolean;
  preferences: UserPreferences;
  onClose: () => void;
  onSave: (preferences: UserPreferences) => void;
}): JSX.Element | null {
  const [draft, setDraft] = useState<UserPreferences>(preferences);

  if (!open) return null;

  function update<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20">
      <aside className="h-full w-full max-w-md overflow-y-auto border-l border-[#E5E5E5] bg-white p-5 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#111111]">用户设置</p>
            <h2 className="mt-1 text-lg font-semibold">默认偏好</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-[#E5E5E5] px-3 py-1 text-sm">
            关闭
          </button>
        </div>

        <div className="space-y-4">
          <Field label="默认出发城市">
            <input value={draft.defaultDepartureCity ?? ''} onChange={(e) => update('defaultDepartureCity', e.target.value)} className="input" placeholder="例如：上海" />
          </Field>
          <Field label="默认预算币种">
            <select value={draft.currency ?? 'CNY'} onChange={(e) => update('currency', e.target.value as UserPreferences['currency'])} className="input">
              <option value="CNY">人民币 CNY</option>
              <option value="USD">美元 USD</option>
              <option value="EUR">欧元 EUR</option>
              <option value="JPY">日元 JPY</option>
              <option value="HKD">港币 HKD</option>
            </select>
          </Field>
          <Field label="偏好语言">
            <select value={draft.language ?? 'zh-CN'} onChange={(e) => update('language', e.target.value as UserPreferences['language'])} className="input">
              <option value="zh-CN">中文</option>
              <option value="en">英文</option>
            </select>
          </Field>
          <Field label="旅行节奏">
            <select value={draft.pace ?? 'balanced'} onChange={(e) => update('pace', e.target.value as UserPreferences['pace'])} className="input">
              <option value="relaxed">轻松</option>
              <option value="balanced">均衡</option>
              <option value="packed">紧凑</option>
            </select>
          </Field>
          <Field label="住宿偏好">
            <select value={draft.hotelTier ?? 'midrange'} onChange={(e) => update('hotelTier', e.target.value as UserPreferences['hotelTier'])} className="input">
              <option value="budget">经济</option>
              <option value="midrange">舒适</option>
              <option value="luxury">高端</option>
            </select>
          </Field>
          <Field label="其他偏好">
            <textarea
              value={(draft.notes ?? []).join('\n')}
              onChange={(e) => update('notes', e.target.value.split('\n').map((item) => item.trim()).filter(Boolean))}
              className="input min-h-24 py-2"
              placeholder="每行一条，例如：不喜欢太赶；优先高铁"
            />
          </Field>
        </div>

        <div className="mt-6 rounded-lg bg-[#F7F7F7] p-3 text-sm leading-6 text-[#525252]">
          设置会作为“低优先级默认偏好”发送给模型。若你本轮输入与设置冲突，系统会优先遵循你本轮输入。
        </div>

        <button type="button" onClick={() => onSave(draft)} className="mt-5 w-full rounded-full bg-[#111111] px-4 py-3 text-sm font-semibold text-white">
          保存设置
        </button>
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-[#111111]">{label}</span>
      {children}
    </label>
  );
}
