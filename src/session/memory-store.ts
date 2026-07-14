export interface MemoryEntry {
  id: number;
  userId: string;
  content: string;
  tags: string[];
  createdAt: Date;
}

export interface MemoryStore {
  add(userId: string, content: string, tags?: string[]): Promise<MemoryEntry>;
  list(userId: string, limit?: number): Promise<MemoryEntry[]>;
  delete(userId: string, id: number): Promise<boolean>;
  clear(userId: string): Promise<number>;
}

export class InMemoryMemoryStore implements MemoryStore {
  private nextId = 1;
  private byUser = new Map<string, MemoryEntry[]>();

  async add(userId: string, content: string, tags: string[] = []): Promise<MemoryEntry> {
    const entry: MemoryEntry = {
      id: this.nextId++,
      userId,
      content,
      tags,
      createdAt: new Date(),
    };
    const list = this.byUser.get(userId) ?? [];
    list.push(entry);
    this.byUser.set(userId, list);
    return entry;
  }

  async list(userId: string, limit?: number): Promise<MemoryEntry[]> {
    const all = (this.byUser.get(userId) ?? []).slice().sort((a, b) => b.id - a.id);
    return limit ? all.slice(0, limit) : all;
  }

  async delete(userId: string, id: number): Promise<boolean> {
    const list = this.byUser.get(userId);
    if (!list) return false;
    const idx = list.findIndex((m) => m.id === id);
    if (idx < 0) return false;
    list.splice(idx, 1);
    return true;
  }

  async clear(userId: string): Promise<number> {
    const list = this.byUser.get(userId);
    if (!list) return 0;
    const n = list.length;
    this.byUser.set(userId, []);
    return n;
  }
}
