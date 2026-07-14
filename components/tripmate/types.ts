export type ActivityItem = {
  id: string;
  label: string;
  detail?: string;
  tone: 'active' | 'ok' | 'warn' | 'muted';
};

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  activity?: ActivityItem[];
};

export type SessionSummary = {
  id: string;
  title?: string;
  titleSource?: 'auto' | 'manual' | 'fallback';
  archived?: boolean;
  preview: string;
  messageCount: number;
  updatedAt: string;
};

export type McpStatus = {
  name: string;
  ok: boolean;
  error?: string;
};

export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; name: string; input?: unknown }
  | { type: 'tool_result'; name: string; content: string; isError?: boolean; latencyMs?: number }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; latencyMs?: number }
  | { type: 'error'; message: string }
  | { type: 'done' | 'end'; reason?: string };

export type UserPreferences = {
  defaultDepartureCity?: string;
  currency?: 'CNY' | 'USD' | 'EUR' | 'JPY' | 'HKD';
  language?: 'zh-CN' | 'en';
  pace?: 'relaxed' | 'balanced' | 'packed';
  hotelTier?: 'budget' | 'midrange' | 'luxury';
  notes?: string[];
};

export type WorkspaceItem = {
  time?: string;
  title: string;
  location?: string;
  estCostCNY?: number;
  notes?: string;
  kind?: 'spot' | 'transport' | 'hotel' | 'food' | 'activity' | 'other';
  status?: 'pending' | 'confirmed';
};

export type WorkspaceDay = {
  date: string;
  city: string;
  items: WorkspaceItem[];
  estCostCNY?: number;
};

export type TripWorkspace = {
  version: number;
  profile: {
    departure?: string;
    destination?: string;
    dateRange?: { start: string; end: string };
    budgetCNY?: number;
    travelers?: number;
    pace?: 'relaxed' | 'balanced' | 'packed';
    hotelTier?: 'budget' | 'midrange' | 'luxury';
  };
  itinerary: {
    version: number;
    days: WorkspaceDay[];
    totalCost?: {
      flightsCNY?: number;
      hotelsCNY?: number;
      transitCNY?: number;
      foodCNY?: number;
      activitiesCNY?: number;
      totalCNY: number;
    };
    notes?: string;
  };
  pendingQuestions?: string[];
  manualFields?: string[];
  updatedAt?: string;
};

export type ModelMode = 'main' | 'fast';
