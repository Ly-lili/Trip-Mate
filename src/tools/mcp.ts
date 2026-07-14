import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type {
  ToolCallResult,
  ToolContext,
  ToolDefinition,
  ToolProvider,
} from '../agent/types.js';

export type MCPServerConfig =
  | {
      name: string;
      transport: 'stdio';
      command: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
    }
  | {
      name: string;
      transport: 'http';
      url: string;
      headers?: Record<string, string>;
    }
  | {
      name: string;
      transport: 'sse';
      url: string;
      headers?: Record<string, string>;
    };

interface MCPContent {
  type: string;
  text?: string;
  [k: string]: unknown;
}

export class MCPToolProvider implements ToolProvider {
  readonly name: string;
  private client?: Client;
  private transport?: Transport;
  private readonly toolPrefix: string;
  private cached: ToolDefinition[] = [];

  constructor(private readonly config: MCPServerConfig) {
    this.name = `mcp:${config.name}`;
    this.toolPrefix = `${config.name}__`;
  }

  async connect(): Promise<void> {
    if (this.config.transport === 'stdio') {
      this.transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args ?? [],
        env: this.config.env,
        cwd: this.config.cwd,
      });
    } else if (this.config.transport === 'sse') {
      this.transport = new SSEClientTransport(new URL(this.config.url), {
        requestInit: this.config.headers ? { headers: this.config.headers } : undefined,
      });
    } else {
      this.transport = new StreamableHTTPClientTransport(new URL(this.config.url), {
        requestInit: this.config.headers ? { headers: this.config.headers } : undefined,
      });
    }

    this.client = new Client(
      { name: 'tripmate-agent', version: '0.1.0' },
      { capabilities: {} },
    );
    await this.client.connect(this.transport, { timeout: 12_000, maxTotalTimeout: 12_000 });

    const list = await this.client.listTools(undefined, { timeout: 12_000, maxTotalTimeout: 12_000 });
    this.cached = list.tools.map((t) => ({
      name: `${this.toolPrefix}${t.name}`,
      description: t.description ?? `MCP tool ${t.name} from ${this.config.name}`,
      inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
    }));
  }

  async close(): Promise<void> {
    try {
      await this.client?.close();
    } finally {
      this.client = undefined;
      this.transport = undefined;
    }
  }

  async listTools(): Promise<ToolDefinition[]> {
    if (!this.client) {
      throw new Error(`MCP provider "${this.name}" not connected — call connect() first`);
    }
    return this.cached;
  }

  async callTool(
    name: string,
    input: Record<string, unknown>,
    _ctx?: ToolContext,
  ): Promise<ToolCallResult> {
    if (!this.client) {
      throw new Error(`MCP provider "${this.name}" not connected`);
    }
    const localName = name.startsWith(this.toolPrefix) ? name.slice(this.toolPrefix.length) : name;
    const result = await this.client.callTool({ name: localName, arguments: input });

    const blocks = (result.content as MCPContent[] | undefined) ?? [];
    const text = blocks
      .map((c) => {
        if (c.type === 'text' && typeof c.text === 'string') return c.text;
        return JSON.stringify(c);
      })
      .join('\n');

    return {
      content: text || JSON.stringify(result),
      isError: !!result.isError,
    };
  }
}
