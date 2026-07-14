import { create } from 'zustand';
import type { ChatMessage, McpStatus, ModelMode, SessionSummary, TripWorkspace, UserPreferences } from './types';

export const USER_ID = 'web-default';

export const WELCOME_MESSAGE: ChatMessage = {
  role: 'assistant',
  content: '你好，我是 TripMate。告诉我你的出发地、目的地、日期、预算和旅行偏好，我会帮你规划一份可执行的行程。',
};

export const EMPTY_WORKSPACE: TripWorkspace = {
  version: 1,
  profile: {},
  itinerary: { version: 1, days: [] },
  pendingQuestions: [],
  manualFields: [],
};

type SessionState = {
  sessionId: string;
  sessions: SessionSummary[];
  query: string;
  isLoadingSessions: boolean;
  setSessionId: (sessionId: string) => void;
  setSessions: (sessions: SessionSummary[]) => void;
  setQuery: (query: string) => void;
  setIsLoadingSessions: (value: boolean) => void;
};

export const useSessionStore = create<SessionState>((set) => ({
  sessionId: `web-${Date.now()}`,
  sessions: [],
  query: '',
  isLoadingSessions: false,
  setSessionId: (sessionId) => set({ sessionId }),
  setSessions: (sessions) => set({ sessions }),
  setQuery: (query) => set({ query }),
  setIsLoadingSessions: (isLoadingSessions) => set({ isLoadingSessions }),
}));

type ChatState = {
  messages: ChatMessage[];
  input: string;
  status: string;
  isSending: boolean;
  isExporting: boolean;
  mcpStatus: McpStatus[];
  toolCount: number;
  isLoadingStatus: boolean;
  showMcpPanel: boolean;
  setMessages: (messages: ChatMessage[] | ((current: ChatMessage[]) => ChatMessage[])) => void;
  setInput: (input: string) => void;
  setStatus: (status: string) => void;
  setIsSending: (value: boolean) => void;
  setIsExporting: (value: boolean) => void;
  setMcpStatus: (status: McpStatus[]) => void;
  setToolCount: (count: number) => void;
  setIsLoadingStatus: (value: boolean) => void;
  setShowMcpPanel: (value: boolean | ((current: boolean) => boolean)) => void;
};

export const useChatStore = create<ChatState>((set) => ({
  messages: [WELCOME_MESSAGE],
  input: '',
  status: 'Ready',
  isSending: false,
  isExporting: false,
  mcpStatus: [],
  toolCount: 0,
  isLoadingStatus: false,
  showMcpPanel: false,
  setMessages: (messages) => set((state) => ({ messages: typeof messages === 'function' ? messages(state.messages) : messages })),
  setInput: (input) => set({ input }),
  setStatus: (status) => set({ status }),
  setIsSending: (isSending) => set({ isSending }),
  setIsExporting: (isExporting) => set({ isExporting }),
  setMcpStatus: (mcpStatus) => set({ mcpStatus }),
  setToolCount: (toolCount) => set({ toolCount }),
  setIsLoadingStatus: (isLoadingStatus) => set({ isLoadingStatus }),
  setShowMcpPanel: (value) => set((state) => ({ showMcpPanel: typeof value === 'function' ? value(state.showMcpPanel) : value })),
}));

type SettingsState = {
  preferences: UserPreferences;
  modelMode: ModelMode;
  isSettingsOpen: boolean;
  setPreferences: (preferences: UserPreferences) => void;
  setModelMode: (mode: ModelMode) => void;
  setIsSettingsOpen: (value: boolean) => void;
};

export const useSettingsStore = create<SettingsState>((set) => ({
  preferences: { currency: 'CNY', language: 'zh-CN', pace: 'balanced', hotelTier: 'midrange', notes: [] },
  modelMode: 'main',
  isSettingsOpen: false,
  setPreferences: (preferences) => set({ preferences }),
  setModelMode: (modelMode) => set({ modelMode }),
  setIsSettingsOpen: (isSettingsOpen) => set({ isSettingsOpen }),
}));

type WorkspaceState = {
  workspace: TripWorkspace;
  suggestion?: TripWorkspace;
  isDirty: boolean;
  isExtracting: boolean;
  setWorkspace: (workspace: TripWorkspace) => void;
  setSuggestion: (suggestion?: TripWorkspace) => void;
  setIsDirty: (value: boolean) => void;
  setIsExtracting: (value: boolean) => void;
};

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  workspace: EMPTY_WORKSPACE,
  suggestion: undefined,
  isDirty: false,
  isExtracting: false,
  setWorkspace: (workspace) => set({ workspace }),
  setSuggestion: (suggestion) => set({ suggestion }),
  setIsDirty: (isDirty) => set({ isDirty }),
  setIsExtracting: (isExtracting) => set({ isExtracting }),
}));
