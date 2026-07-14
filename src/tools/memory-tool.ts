import type {
  ToolCallResult,
  ToolContext,
  ToolDefinition,
  ToolProvider,
} from '../agent/types.js';
import type { MemoryStore } from '../session/memory-store.js';

export class MemoryToolProvider implements ToolProvider {
  readonly name = 'memory';

  constructor(private readonly store: MemoryStore) {}

  async listTools(): Promise<ToolDefinition[]> {
    return [
      {
        name: 'memory__remember',
        safety: 'write',
        description:
          'Save a long-term fact about the current user (preferences, constraints, recurring requests). ' +
          'Use this when the user shares something stable that should persist across sessions — e.g. ' +
          '"我吃素", "出差只住快捷酒店", "对花生过敏". Do NOT save ephemeral session details (current trip dates, this-week mood). ' +
          'Each call stores ONE atomic fact.',
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'A short, declarative fact stated from the user perspective. e.g. "用户偏好高铁优先，避免红眼航班"',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Optional categorical tags such as ["饮食"], ["交通", "偏好"]. Helps filter later.',
            },
          },
          required: ['content'],
          additionalProperties: false,
        },
      },
      {
        name: 'memory__recall',
        safety: 'read',
        description:
          'List previously saved long-term facts about the current user. Call this near the start of a planning task ' +
          'to load known preferences before asking the user about them. Returns most-recent first.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              description: 'Maximum number of memories to return. Default 20.',
            },
          },
          additionalProperties: false,
        },
      },
      {
        name: 'memory__forget',
        safety: 'idempotent_write',
        description:
          'Delete a previously saved memory by id. Use this only when the user explicitly asks to forget something.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              description: 'The memory id, as returned by memory__recall.',
            },
          },
          required: ['id'],
          additionalProperties: false,
        },
      },
    ];
  }

  async callTool(
    name: string,
    input: Record<string, unknown>,
    ctx?: ToolContext,
  ): Promise<ToolCallResult> {
    const userId = ctx?.userId;
    if (!userId) {
      return {
        content: 'memory tool requires a logged-in user (no userId in context)',
        isError: true,
      };
    }

    if (name === 'memory__remember') {
      const content = typeof input.content === 'string' ? input.content.trim() : '';
      if (!content) {
        return { content: 'memory__remember: content is required', isError: true };
      }
      const tags = Array.isArray(input.tags)
        ? (input.tags.filter((t) => typeof t === 'string') as string[])
        : [];
      const entry = await this.store.add(userId, content, tags);
      return {
        content: `Saved memory #${entry.id}: ${entry.content}`,
      };
    }

    if (name === 'memory__recall') {
      const limit = typeof input.limit === 'number' ? Math.max(1, Math.floor(input.limit)) : 20;
      const memories = await this.store.list(userId, limit);
      if (memories.length === 0) {
        return { content: '(no saved memories for this user)' };
      }
      const lines = memories.map((m) => {
        const tagPart = m.tags.length > 0 ? ` [${m.tags.join(', ')}]` : '';
        return `#${m.id}${tagPart}: ${m.content}`;
      });
      return { content: lines.join('\n') };
    }

    if (name === 'memory__forget') {
      const id = typeof input.id === 'number' ? Math.floor(input.id) : NaN;
      if (!Number.isFinite(id)) {
        return { content: 'memory__forget: id must be a number', isError: true };
      }
      const ok = await this.store.delete(userId, id);
      return {
        content: ok ? `Forgot memory #${id}` : `No memory #${id} for this user`,
        isError: !ok,
      };
    }

    return { content: `Unknown memory tool: ${name}`, isError: true };
  }
}
