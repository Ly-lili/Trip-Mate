import { env } from 'node:process';
import path from 'node:path';
import os from 'node:os';
import { mkdirSync } from 'node:fs';

import { Agent } from '../dist/agent/runtime.js';
import { LLMClient } from '../dist/llm/client.js';
import { ToolRegistry } from '../dist/tools/registry.js';
import { MCPToolProvider } from '../dist/tools/mcp.js';
import { SessionStore } from '../dist/session/store.js';
import { SqliteBackend } from '../dist/session/sqlite-backend.js';
import { Compactor } from '../dist/session/compactor.js';
import { MemoryToolProvider } from '../dist/tools/memory-tool.js';
import { Logger, Metrics } from '../dist/observability.js';

const MCP_SERVERS = [
  {
    name: '12306',
    transport: 'http',
    url: 'https://mcp.api-inference.modelscope.net/b793b009505842/mcp',
  },
  {
    name: 'amap',
    transport: 'http',
    url: 'https://mcp.api-inference.modelscope.net/e31e8c631e8744/mcp',
  },
  {
    name: 'bing',
    transport: 'sse',
    url: 'https://mcp.api-inference.modelscope.net/6ab4fe285a174c/sse',
  },
  {
    name: 'rollinggo',
    transport: 'http',
    url: 'https://mcp.api-inference.modelscope.net/7cd3c31d85ca45/mcp',
  },
  {
    name: 'variflight',
    transport: 'sse',
    url: 'https://mcp.api-inference.modelscope.net/c6c1123a1a224a/sse',
  },
] as const;

type RuntimeState = {
  agent: any;
  backend: any;
  sessions: any;
  llm: any;
  logger: any;
  metrics: any;
  toolNames: string[];
  mcpStatus: Array<{ name: string; ok: boolean; error?: string }>;
};

let runtimePromise: Promise<RuntimeState> | undefined;

export function getRuntime(): Promise<RuntimeState> {
  runtimePromise ??= createRuntime();
  return runtimePromise;
}

async function createRuntime(): Promise<RuntimeState> {
  const logger = new Logger('tripmate.web', (env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error');
  const metrics = new Metrics();
  const apiKey = env.DEEPSEEK_API_KEY || 'missing-deepseek-api-key';
  const llm = new LLMClient({
    apiKey,
    baseURL: env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    mainModel: env.MAIN_MODEL ?? 'deepseek-v4-pro',
    fastModel: env.FAST_MODEL ?? 'deepseek-v4-flash',
  });

  const backend = new SqliteBackend(env.TRIPMATE_DB ?? defaultDbPath());
  const tools = new ToolRegistry({ logger, metrics });
  await tools.register(new MemoryToolProvider(backend));

  const mcpStatus: RuntimeState['mcpStatus'] = [];
  if (env.TRIPMATE_SKIP_MCP !== '1') {
    const connections = await Promise.all(MCP_SERVERS.map(async (cfg) => {
      const provider = new MCPToolProvider(cfg);
      try {
        await withTimeout(provider.connect(), 12_000, `${cfg.name} MCP connection timed out`);
        return { cfg, provider, ok: true as const };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logger.warn('mcp_connect_failed', { server: cfg.name, error });
        void provider.close().catch(() => {});
        return { cfg, provider, ok: false as const, error };
      }
    }));

    for (const connection of connections) {
      if (connection.ok) {
        await tools.register(connection.provider);
        mcpStatus.push({ name: connection.cfg.name, ok: true });
      } else {
        mcpStatus.push({ name: connection.cfg.name, ok: false, error: connection.error });
      }
    }
  }

  const sessions = new SessionStore(backend, backend);
  const compactor = new Compactor({
    llm,
    logger,
    onPersist: (session: unknown) => backend.save(session as never),
  });
  const agent = new Agent({
    llm,
    tools,
    sessions,
    memories: backend,
    compactor,
    logger,
    metrics,
  });

  return {
    agent,
    backend,
    sessions,
    llm,
    logger,
    metrics,
    toolNames: tools.toolNames(),
    mcpStatus,
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function defaultDbPath(): string {
  const dir = path.join(os.homedir(), '.tripmate-agent');
  mkdirSync(dir, { recursive: true });
  return path.join(dir, 'tripmate.sqlite');
}
