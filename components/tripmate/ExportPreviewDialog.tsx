'use client';

export function ExportPreviewDialog({
  open,
  title,
  markdown,
  onClose,
  onCopy,
  onExportPdf,
}: {
  open: boolean;
  title: string;
  markdown: string;
  onClose: () => void;
  onCopy: () => void;
  onExportPdf: () => void;
}): JSX.Element | null {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4">
      <section className="flex max-h-[86vh] w-full max-w-3xl flex-col rounded-xl border border-[#E5E5E5] bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[#E5E5E5] px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#111111]">导出预览</p>
            <h2 className="mt-1 text-lg font-semibold">{title}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-[#E5E5E5] px-3 py-1 text-sm">
            关闭
          </button>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap bg-[#FAFAFA] p-5 text-sm leading-6 text-[#111111]">
          {markdown || '暂无可导出的内容。'}
        </pre>
        <div className="flex justify-end gap-2 border-t border-[#E5E5E5] px-5 py-4">
          <button type="button" onClick={onCopy} className="rounded-full border border-[#E5E5E5] px-4 py-2 text-sm">
            复制 Markdown
          </button>
          <button type="button" onClick={onExportPdf} className="rounded-full bg-[#111111] px-4 py-2 text-sm font-medium text-white">
            导出 PDF
          </button>
        </div>
      </section>
    </div>
  );
}
