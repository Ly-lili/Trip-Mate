'use client';

import { FormEvent, useEffect, useState } from 'react';

export function SessionRenameDialog({
  title,
  open,
  onClose,
  onSave,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  onSave: (title: string) => void;
}): JSX.Element | null {
  const [value, setValue] = useState(title);

  useEffect(() => {
    setValue(title);
  }, [title, open]);

  if (!open) return null;

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const next = value.trim();
    if (next) onSave(next);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-[#E5E5E5] bg-white p-4 shadow-xl">
        <h2 className="text-base font-semibold">重命名会话</h2>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="mt-4 h-11 w-full rounded-lg border border-[#E5E5E5] px-3 text-sm outline-none focus:border-[#111111]"
          maxLength={40}
          autoFocus
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full border border-[#E5E5E5] px-4 py-2 text-sm">
            取消
          </button>
          <button type="submit" className="rounded-full bg-[#111111] px-4 py-2 text-sm font-medium text-white">
            保存
          </button>
        </div>
      </form>
    </div>
  );
}
