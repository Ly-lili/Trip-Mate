'use client';

import { FormEvent, UIEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ChatHeader } from './tripmate/ChatHeader';
import { Composer } from './tripmate/Composer';
import { ExportPreviewDialog } from './tripmate/ExportPreviewDialog';
import { MessageList } from './tripmate/MessageList';
import { SessionRenameDialog } from './tripmate/SessionRenameDialog';
import { SettingsPanel } from './tripmate/SettingsPanel';
import { Sidebar } from './tripmate/Sidebar';
import { TripWorkspace } from './tripmate/TripWorkspace';
import { shorten } from './tripmate/helpers';
import {
  EMPTY_WORKSPACE,
  USER_ID,
  WELCOME_MESSAGE,
  useChatStore,
  useSessionStore,
  useSettingsStore,
  useWorkspaceStore,
} from './tripmate/stores';
import type { ChatMessage, SessionSummary, StreamEvent, TripWorkspace as TripWorkspaceType } from './tripmate/types';

export default function ChatUI(): JSX.Element {
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null);
  const [exportPreview, setExportPreview] = useState<{ open: boolean; title: string; markdown: string }>({
    open: false,
    title: '',
    markdown: '',
  });

  const { sessionId, sessions, query, isLoadingSessions, setSessionId, setSessions, setQuery, setIsLoadingSessions } = useSessionStore();
  const {
    messages,
    input,
    status,
    isSending,
    isExporting,
    mcpStatus,
    isLoadingStatus,
    setMessages,
    setInput,
    setStatus,
    setIsSending,
    setIsExporting,
    setMcpStatus,
    setToolCount,
    setIsLoadingStatus,
  } = useChatStore();
  const { preferences, modelMode, isSettingsOpen, setPreferences, setModelMode, setIsSettingsOpen } = useSettingsStore();
  const { workspace, suggestion, setWorkspace, setSuggestion, setIsDirty, setIsExtracting, isExtracting } = useWorkspaceStore();
  const hasConversation = messages.some((message) => message.role === 'user');
  const connectedMcpCount = mcpStatus.filter((server) => server.ok).length;
  const canSend = useMemo(() => input.trim().length > 0 && !isSending, [input, isSending]);

  useEffect(() => {
    void refreshSessions();
    void refreshMcpStatus();
    void loadPreferences();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshSessions(query);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (shouldStickToBottomRef.current) {
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }));
    }
  }, [messages, status]);

  async function refreshSessions(nextQuery = query): Promise<void> {
    setIsLoadingSessions(true);
    try {
      const res = await fetch(`/api/sessions?userId=${encodeURIComponent(USER_ID)}&limit=80&query=${encodeURIComponent(nextQuery)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { sessions?: SessionSummary[] };
      setSessions(data.sessions ?? []);
    } catch {
      setSessions([]);
    } finally {
      setIsLoadingSessions(false);
    }
  }

  async function refreshMcpStatus(): Promise<void> {
    setIsLoadingStatus(true);
    try {
      const res = await fetch('/api/status', { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { mcpStatus?: typeof mcpStatus; toolCount?: number };
      setMcpStatus(data.mcpStatus ?? []);
      setToolCount(data.toolCount ?? 0);
    } catch {
      setMcpStatus([]);
      setToolCount(0);
    } finally {
      setIsLoadingStatus(false);
    }
  }

  async function loadPreferences(): Promise<void> {
    const res = await fetch(`/api/preferences?userId=${encodeURIComponent(USER_ID)}`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as { preferences?: typeof preferences };
    setPreferences(data.preferences ?? preferences);
  }

  async function savePreferences(next: typeof preferences): Promise<void> {
    const res = await fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...next, userId: USER_ID }),
    });
    if (!res.ok) {
      setStatus('设置保存失败');
      return;
    }
    const data = (await res.json()) as { preferences: typeof preferences };
    setPreferences(data.preferences);
    setIsSettingsOpen(false);
    setStatus('Ready');
  }

  async function loadSession(id: string): Promise<void> {
    abortRef.current?.abort();
    setSessionId(id);
    setStatus('Loading');
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { messages?: ChatMessage[] };
      setMessages(data.messages && data.messages.length > 0 ? data.messages : [WELCOME_MESSAGE]);
      await loadWorkspace(id);
      setStatus('Ready');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setMessages([{ role: 'assistant', content: `加载会话失败：${message}` }]);
      setStatus('Error');
    }
  }

  async function loadWorkspace(id: string): Promise<void> {
    const res = await fetch(`/api/sessions/${encodeURIComponent(id)}/workspace`, { cache: 'no-store' });
    if (!res.ok) {
      setWorkspace(EMPTY_WORKSPACE);
      setIsDirty(false);
      return;
    }
    const data = (await res.json()) as { workspace?: TripWorkspaceType };
    setWorkspace(data.workspace ?? EMPTY_WORKSPACE);
    setIsDirty(false);
  }

  async function saveWorkspace(applySuggestion = false): Promise<void> {
    const target = applySuggestion ? suggestion : workspace;
    if (!target) return;
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/workspace`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace: target, applySuggestion }),
    });
    if (!res.ok) {
      setStatus('工作区保存失败');
      return;
    }
    const data = (await res.json()) as { workspace: TripWorkspaceType };
    setWorkspace(data.workspace);
    setSuggestion(undefined);
    setIsDirty(false);
  }

  async function extractWorkspace(): Promise<void> {
    setIsExtracting(true);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/workspace/extract`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { suggestion?: TripWorkspaceType };
      setSuggestion(data.suggestion);
    } catch (err) {
      setStatus(`抽取失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsExtracting(false);
    }
  }

  async function deleteSession(id: string): Promise<void> {
    if (!window.confirm('确定删除这个会话吗？')) return;
    const res = await fetch(`/api/sessions/${encodeURIComponent(id)}?userId=${encodeURIComponent(USER_ID)}`, { method: 'DELETE' });
    if (!res.ok) {
      setStatus('删除失败');
      return;
    }
    await refreshSessions();
    if (id === sessionId) newSession();
  }

  async function renameSession(id: string, title: string): Promise<void> {
    const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) {
      setStatus('重命名失败');
      return;
    }
    setRenameTarget(null);
    await refreshSessions();
  }

  function newSession(): void {
    abortRef.current?.abort();
    const id = `web-${Date.now()}`;
    setSessionId(id);
    setMessages([{ role: 'assistant', content: '新会话已开始。请告诉我你的目的地、日期、预算和旅行偏好。' }]);
    setWorkspace(EMPTY_WORKSPACE);
    setSuggestion(undefined);
    setIsDirty(false);
    setStatus('Ready');
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const content = input.trim();
    if (!content || isSending) return;

    setInput('');
    setIsSending(true);
    setStatus('Thinking');
    shouldStickToBottomRef.current = true;
    setMessages((current) => [
      ...current,
      { role: 'user', content },
      {
        role: 'assistant',
        content: '',
        activity: [{ id: `thinking-${Date.now()}`, label: '正在思考', detail: '理解你的需求，并判断是否需要调用工具。', tone: 'active' }],
      },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, userId: USER_ID, message: content, mode: modelMode }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(await res.text());
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.split('\n').find((item) => item.startsWith('data: '));
          if (!line) continue;
          handleStreamEvent(JSON.parse(line.slice(6)) as StreamEvent);
        }
      }
      setStatus('Ready');
      await refreshSessions();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message !== 'The operation was aborted.') {
        appendAssistant(`\n\n请求失败：${message}`);
        pushAssistantActivity('请求失败', message, 'warn');
        setStatus('Error');
      }
    } finally {
      setIsSending(false);
      abortRef.current = null;
    }
  }

  function handleStreamEvent(event: StreamEvent): void {
    if (event.type === 'text') {
      appendAssistant(event.text);
      return;
    }
    if (event.type === 'tool_call') {
      setStatus(`Using ${event.name}`);
      pushAssistantActivity('正在调用工具', `${event.name}${event.input ? ` ${shorten(JSON.stringify(event.input))}` : ''}`, 'active');
      return;
    }
    if (event.type === 'tool_result') {
      setStatus(event.isError ? `${event.name} failed` : `${event.name} done`);
      pushAssistantActivity(event.isError ? '工具调用失败' : '工具调用完成', `${event.name}${event.latencyMs ? ` - ${event.latencyMs}ms` : ''}`, event.isError ? 'warn' : 'ok');
      return;
    }
    if (event.type === 'usage') {
      setStatus(`Used ${event.inputTokens ?? 0}/${event.outputTokens ?? 0} tokens`);
      pushAssistantActivity('已生成回答', `${event.inputTokens ?? 0} 输入 / ${event.outputTokens ?? 0} 输出 tokens`, 'muted');
      return;
    }
    if (event.type === 'error') {
      appendAssistant(`\n\n${event.message}`);
      pushAssistantActivity('请求失败', event.message, 'warn');
      setStatus('Error');
      return;
    }
    setStatus('Ready');
  }

  function appendAssistant(text: string): void {
    setMessages((current) => {
      const next = [...current];
      const last = next[next.length - 1];
      if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: last.content + text };
      return next;
    });
  }

  function pushAssistantActivity(label: string, detail: string | undefined, tone: 'active' | 'ok' | 'warn' | 'muted'): void {
    setMessages((current) => {
      const next = [...current];
      const last = next[next.length - 1];
      if (last?.role !== 'assistant') return next;
      const activity = last.activity ?? [];
      next[next.length - 1] = { ...last, activity: [...activity, { id: `${label}-${Date.now()}-${activity.length}`, label, detail, tone }] };
      return next;
    });
  }

  function handleMessagesScroll(event: UIEvent<HTMLDivElement>): void {
    const target = event.currentTarget;
    shouldStickToBottomRef.current = target.scrollHeight - target.scrollTop - target.clientHeight < 96;
  }

  function usePrompt(text: string): void {
    setInput(text);
    requestAnimationFrame(() => document.getElementById('tripmate-composer')?.focus());
  }

  async function openExportPreview(): Promise<void> {
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/export-preview`, { cache: 'no-store' });
    if (!res.ok) {
      setStatus('导出预览失败');
      return;
    }
    const data = (await res.json()) as { title?: string; markdown?: string };
    setExportPreview({ open: true, title: data.title ?? 'TripMate 行程草稿', markdown: data.markdown ?? '' });
  }

  async function copyMarkdown(): Promise<void> {
    const text = exportPreview.markdown;
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setStatus('Markdown 已复制');
  }

  async function exportPdf(): Promise<void> {
    if (!hasConversation || isExporting) return;
    setIsExporting(true);
    setStatus('Exporting PDF');
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/export-pdf`, { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `tripmate-${sessionId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setStatus('Ready');
    } catch (err) {
      appendAssistant(`\n\nPDF 导出失败：${err instanceof Error ? err.message : String(err)}`);
      setStatus('Error');
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <main className="min-h-screen w-full bg-white text-[#171717] lg:h-[100dvh] lg:min-h-0 lg:overflow-hidden">
      <div className="flex min-h-screen w-full flex-col overflow-hidden bg-white lg:grid lg:h-full lg:min-h-0 lg:grid-cols-[272px_minmax(0,1fr)_316px]">
        <Sidebar
          sessions={sessions}
          sessionId={sessionId}
          query={query}
          isLoadingSessions={isLoadingSessions}
          connectedMcpCount={connectedMcpCount}
          mcpCount={mcpStatus.length}
          isLoadingStatus={isLoadingStatus}
          onQuery={setQuery}
          onNew={newSession}
          onLoad={(id) => void loadSession(id)}
          onDelete={(id) => void deleteSession(id)}
          onRename={setRenameTarget}
          onToggleSettings={() => setIsSettingsOpen(true)}
        />
        <section className="flex min-h-[72vh] flex-col bg-white lg:h-screen lg:min-h-0">
          <ChatHeader
            status={status}
            modelMode={modelMode}
            hasConversation={hasConversation}
            isExporting={isExporting}
            onModeChange={setModelMode}
            onExport={() => void exportPdf()}
            onPreview={() => void openExportPreview()}
          />
          <MessageList messages={hasConversation ? messages : []} hasConversation={hasConversation} onPrompt={usePrompt} onScroll={handleMessagesScroll} bottomRef={bottomRef} />
          <Composer input={input} status={status} canSend={canSend} onInput={setInput} onSubmit={sendMessage} />
        </section>
        <TripWorkspace
          workspace={workspace}
          suggestion={suggestion}
          status={status}
          mcpStatus={mcpStatus}
          isExtracting={isExtracting}
          onExtract={() => void extractWorkspace()}
          onApplySuggestion={() => void saveWorkspace(true)}
          onExport={() => void openExportPreview()}
        />
      </div>

      <SettingsPanel open={isSettingsOpen} preferences={preferences} onClose={() => setIsSettingsOpen(false)} onSave={(next) => void savePreferences(next)} />
      <SessionRenameDialog
        open={Boolean(renameTarget)}
        title={renameTarget?.title || renameTarget?.preview || ''}
        onClose={() => setRenameTarget(null)}
        onSave={(title) => renameTarget && void renameSession(renameTarget.id, title)}
      />
      <ExportPreviewDialog
        open={exportPreview.open}
        title={exportPreview.title}
        markdown={exportPreview.markdown}
        onClose={() => setExportPreview((current) => ({ ...current, open: false }))}
        onCopy={() => void copyMarkdown()}
        onExportPdf={() => void exportPdf()}
      />
    </main>
  );
}
