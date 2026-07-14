import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import type {
  PreferenceStoreBackend,
  Session,
  SessionStoreBackend,
  UserPreferences,
} from './store.js';
import type { MemoryEntry, MemoryStore } from './memory-store.js';

interface SessionRow {
  id: string;
  user_id: string | null;
  data: string;
  created_at: number;
  updated_at: number;
}

interface PrefRow {
  user_id: string;
  data: string;
  updated_at: number;
}

interface MemoryRow {
  id: number;
  user_id: string;
  content: string;
  tags: string;
  created_at: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_updated
  ON sessions (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS preferences (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_user_created
  ON memories (user_id, created_at DESC);
`;

function reviveSession(row: SessionRow): Session {
  const parsed = JSON.parse(row.data) as Omit<Session, 'createdAt' | 'updatedAt'>;
  return {
    ...parsed,
    id: row.id,
    userId: row.user_id ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export interface SessionSummary {
  id: string;
  userId?: string;
  title?: string;
  titleSource?: 'auto' | 'manual' | 'fallback';
  archived?: boolean;
  preview: string;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export class SqliteBackend
  implements SessionStoreBackend, PreferenceStoreBackend, MemoryStore
{
  private readonly db: Db;
  private readonly insertSession;
  private readonly selectSession;
  private readonly listSessionsByUser;
  private readonly insertPref;
  private readonly selectPref;
  private readonly insertMemory;
  private readonly listMemoriesByUser;
  private readonly deleteMemory;
  private readonly clearMemories;

  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(SCHEMA);

    this.insertSession = this.db.prepare(`
      INSERT INTO sessions (id, user_id, data, created_at, updated_at)
      VALUES (@id, @user_id, @data, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id,
        data = excluded.data,
        updated_at = excluded.updated_at
    `);
    this.selectSession = this.db.prepare<[string], SessionRow>(
      'SELECT * FROM sessions WHERE id = ?',
    );
    this.listSessionsByUser = this.db.prepare<[string, number], SessionRow>(
      'SELECT * FROM sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?',
    );
    this.insertPref = this.db.prepare(`
      INSERT INTO preferences (user_id, data, updated_at)
      VALUES (@user_id, @data, @updated_at)
      ON CONFLICT(user_id) DO UPDATE SET
        data = excluded.data,
        updated_at = excluded.updated_at
    `);
    this.selectPref = this.db.prepare<[string], PrefRow>(
      'SELECT * FROM preferences WHERE user_id = ?',
    );
    this.insertMemory = this.db.prepare<
      { user_id: string; content: string; tags: string; created_at: number },
      MemoryRow
    >(
      `INSERT INTO memories (user_id, content, tags, created_at)
       VALUES (@user_id, @content, @tags, @created_at)
       RETURNING *`,
    );
    this.listMemoriesByUser = this.db.prepare<[string, number], MemoryRow>(
      'SELECT * FROM memories WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
    );
    this.deleteMemory = this.db.prepare<[number, string]>(
      'DELETE FROM memories WHERE id = ? AND user_id = ?',
    );
    this.clearMemories = this.db.prepare<[string]>(
      'DELETE FROM memories WHERE user_id = ?',
    );
  }

  // === SessionStoreBackend ===
  async load(id: string): Promise<Session | undefined> {
    const row = this.selectSession.get(id);
    return row ? reviveSession(row) : undefined;
  }

  async save(session: Session): Promise<void> {
    const data = JSON.stringify({
      id: session.id,
      title: session.title,
      titleSource: session.titleSource,
      archived: session.archived,
      deletedAt: session.deletedAt,
      messages: session.messages,
      constraints: session.constraints,
      itinerary: session.itinerary,
      workspace: session.workspace,
      memorySnapshot: session.memorySnapshot,
      compaction: session.compaction,
    });
    this.insertSession.run({
      id: session.id,
      user_id: session.userId ?? null,
      data,
      created_at: session.createdAt.getTime(),
      updated_at: session.updatedAt.getTime(),
    });
  }

  // === PreferenceStoreBackend ===
  async loadPreferences(userId: string): Promise<UserPreferences | undefined> {
    const row = this.selectPref.get(userId);
    if (!row) return undefined;
    return JSON.parse(row.data) as UserPreferences;
  }

  async savePreferences(userId: string, prefs: UserPreferences): Promise<void> {
    this.insertPref.run({
      user_id: userId,
      data: JSON.stringify(prefs),
      updated_at: Date.now(),
    });
  }

  // === MemoryStore ===
  async add(userId: string, content: string, tags: string[] = []): Promise<MemoryEntry> {
    const row = this.insertMemory.get({
      user_id: userId,
      content,
      tags: tags.join(','),
      created_at: Date.now(),
    });
    if (!row) throw new Error('Failed to insert memory');
    return rowToMemory(row);
  }

  async list(userId: string, limit = 50): Promise<MemoryEntry[]> {
    return this.listMemoriesByUser.all(userId, limit).map(rowToMemory);
  }

  async delete(userId: string, id: number): Promise<boolean> {
    const result = this.deleteMemory.run(id, userId);
    return result.changes > 0;
  }

  async clear(userId: string): Promise<number> {
    const result = this.clearMemories.run(userId);
    return result.changes;
  }

  // === Web sidebar support ===
  listSessions(userId: string, limit = 30, query = ''): SessionSummary[] {
    const rows = this.listSessionsByUser.all(userId, limit);
    const q = query.trim().toLowerCase();
    return rows.map((row) => {
      const data = JSON.parse(row.data) as {
        title?: string;
        titleSource?: 'auto' | 'manual' | 'fallback';
        archived?: boolean;
        messages?: Array<{ role: string; content?: unknown }>;
      };
      const msgs = data.messages ?? [];
      const firstUser = msgs.find((m) => m.role === 'user');
      const preview =
        typeof firstUser?.content === 'string'
          ? firstUser.content.slice(0, 80)
          : '(无内容)';
      return {
        id: row.id,
        userId: row.user_id ?? undefined,
        title: data.title,
        titleSource: data.titleSource,
        archived: data.archived,
        preview,
        messageCount: msgs.length,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
      };
    }).filter((s) => {
      if (!q) return !s.archived;
      return `${s.title ?? ''} ${s.preview} ${s.id}`.toLowerCase().includes(q);
    });
  }

  // === Replay text-only history for UI ===
  loadHistoryForUI(id: string): { role: 'user' | 'assistant'; content: string }[] {
    const row = this.selectSession.get(id);
    if (!row) return [];
    const data = JSON.parse(row.data) as { messages?: Array<{ role: string; content?: unknown }> };
    const msgs = data.messages ?? [];
    const out: { role: 'user' | 'assistant'; content: string }[] = [];
    for (const m of msgs) {
      if (m.role === 'user' && typeof m.content === 'string' && m.content.trim()) {
        out.push({ role: 'user', content: m.content });
      } else if (m.role === 'assistant' && typeof m.content === 'string' && m.content.trim()) {
        out.push({ role: 'assistant', content: m.content });
      }
    }
    return out;
  }

  close(): void {
    this.db.close();
  }
}

function rowToMemory(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    userId: row.user_id,
    content: row.content,
    tags: row.tags ? row.tags.split(',').filter(Boolean) : [],
    createdAt: new Date(row.created_at),
  };
}
