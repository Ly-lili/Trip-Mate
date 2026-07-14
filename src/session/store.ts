import type OpenAI from 'openai';
import type { TripConstraints, Itinerary, TripWorkspace } from '../domain.js';

export type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface UserPreferences {
  defaultDepartureCity?: string;
  currency?: 'CNY' | 'USD' | 'EUR' | 'JPY' | 'HKD';
  language?: 'zh-CN' | 'en';
  avoidChains?: boolean;
  cuisinePrefs?: string[];
  hotelTier?: 'budget' | 'midrange' | 'luxury';
  pace?: 'relaxed' | 'balanced' | 'packed';
  notes?: string[];
}

// Compaction state — set by the Compactor when a session's message history
// has been summarized. `compactedThrough` is an absolute index into
// `session.messages`: everything before that index has been folded into
// `summary` and should be replaced by the summary when building requests.
export interface CompactionState {
  summary: string;             // structured JSON summary of compacted turns
  compactedThrough: number;    // absolute index in session.messages
  compactedAt: number;         // unix ms
  originalTokenCount: number;  // prompt_tokens at time of compaction (audit)
}

export interface Session {
  id: string;
  userId?: string;
  title?: string;
  titleSource?: 'auto' | 'manual' | 'fallback';
  archived?: boolean;
  deletedAt?: string;
  messages: ChatMessage[];
  constraints?: TripConstraints;
  itinerary?: Itinerary;
  workspace?: TripWorkspace;
  // Snapshot of long-term memory taken at session start.
  // Frozen for the lifetime of the session so the request prefix stays
  // byte-stable across turns and DeepSeek prompt caching can hit.
  // `undefined` = not yet initialized; `""` = initialized, user has no memories.
  memorySnapshot?: string;
  // Optional running summary of compacted earlier turns. When set, the
  // Agent skips messages[0..compactedThrough) and injects the summary
  // as a synthetic user/assistant pair instead.
  compaction?: CompactionState;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionStoreBackend {
  load(id: string): Promise<Session | undefined>;
  save(session: Session): Promise<void>;
}

export interface PreferenceStoreBackend {
  loadPreferences(userId: string): Promise<UserPreferences | undefined>;
  savePreferences(userId: string, prefs: UserPreferences): Promise<void>;
}

export class SessionStore {
  private sessions = new Map<string, Session>();
  private prefs = new Map<string, UserPreferences>();

  constructor(
    private readonly sessionBackend?: SessionStoreBackend,
    private readonly prefBackend?: PreferenceStoreBackend,
  ) {}

  async getOrCreate(id: string, userId?: string): Promise<Session> {
    let s = this.sessions.get(id);
    if (s) return s;
    if (this.sessionBackend) {
      const loaded = await this.sessionBackend.load(id);
      if (loaded) {
        this.sessions.set(id, loaded);
        return loaded;
      }
    }
    s = { id, userId, messages: [], createdAt: new Date(), updatedAt: new Date() };
    this.sessions.set(id, s);
    return s;
  }

  async append(id: string, message: ChatMessage): Promise<void> {
    const s = await this.getOrCreate(id);
    s.messages.push(message);
    s.updatedAt = new Date();
    await this.sessionBackend?.save(s);
  }

  async setConstraints(id: string, constraints: TripConstraints): Promise<void> {
    const s = await this.getOrCreate(id);
    s.constraints = constraints;
    s.updatedAt = new Date();
    await this.sessionBackend?.save(s);
  }

  async setItinerary(id: string, itinerary: Itinerary): Promise<void> {
    const s = await this.getOrCreate(id);
    s.itinerary = itinerary;
    s.updatedAt = new Date();
    await this.sessionBackend?.save(s);
  }

  async setWorkspace(id: string, workspace: TripWorkspace): Promise<void> {
    const s = await this.getOrCreate(id);
    s.workspace = workspace;
    s.itinerary = workspace.itinerary;
    s.updatedAt = new Date();
    await this.sessionBackend?.save(s);
  }

  async patchMeta(
    id: string,
    patch: Pick<Session, 'title' | 'titleSource' | 'archived' | 'deletedAt'>,
  ): Promise<Session | undefined> {
    const s = await this.getOrCreate(id);
    if (patch.title !== undefined) s.title = patch.title;
    if (patch.titleSource !== undefined) s.titleSource = patch.titleSource;
    if (patch.archived !== undefined) s.archived = patch.archived;
    if (patch.deletedAt !== undefined) s.deletedAt = patch.deletedAt;
    s.updatedAt = new Date();
    await this.sessionBackend?.save(s);
    return s;
  }

  async save(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (!s) return;
    s.updatedAt = new Date();
    await this.sessionBackend?.save(s);
  }

  async loadPreferences(userId: string): Promise<UserPreferences | undefined> {
    if (this.prefs.has(userId)) return this.prefs.get(userId);
    const loaded = await this.prefBackend?.loadPreferences(userId);
    if (loaded) this.prefs.set(userId, loaded);
    return loaded;
  }

  async savePreferences(userId: string, prefs: UserPreferences): Promise<void> {
    this.prefs.set(userId, prefs);
    await this.prefBackend?.savePreferences(userId, prefs);
  }
}
