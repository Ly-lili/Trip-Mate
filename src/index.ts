import * as readline from 'node:readline/promises';
import { stdin, stdout, env } from 'node:process';
import * as path from 'node:path';
import * as os from 'node:os';
import { mkdirSync } from 'node:fs';
import { config } from './config.js';
import { Agent } from './agent/runtime.js';
import { LLMClient } from './llm/client.js';
import { ToolRegistry } from './tools/registry.js';
import { MCPToolProvider, type MCPServerConfig } from './tools/mcp.js';
import { SessionStore } from './session/store.js';
import { SqliteBackend } from './session/sqlite-backend.js';
import { Compactor } from './session/compactor.js';
import { MemoryToolProvider } from './tools/memory-tool.js';
import { Logger, Metrics } from './observability.js';
import { exportSessionPDF } from './export/index.js';
import { writeFile } from 'node:fs/promises';

const MCP_SERVERS: MCPServerConfig[] = [
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
];

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';

async function main(): Promise<void> {
  const logger = new Logger('tripmate', config.logLevel);
  const metrics = new Metrics();

  const llm = new LLMClient({
    apiKey: config.deepseekApiKey,
    baseURL: config.baseURL,
    mainModel: config.mainModel,
    fastModel: config.fastModel,
  });

  const dbPath = env.TRIPMATE_DB ?? defaultDbPath();
  const backend = new SqliteBackend(dbPath);
  logger.info('sqlite_open', { path: dbPath });

  const tools = new ToolRegistry({ logger, metrics });
  await tools.register(new MemoryToolProvider(backend));

  const mcpProviders: MCPToolProvider[] = [];
  for (const cfg of MCP_SERVERS) {
    const provider = new MCPToolProvider(cfg);
    try {
      await provider.connect();
      await tools.register(provider);
      mcpProviders.push(provider);
    } catch (err) {
      logger.warn('mcp_connect_failed', {
        server: cfg.name,
        error: err instanceof Error ? err.message : String(err),
      });
      await provider.close().catch(() => {});
    }
  }

  const sessions = new SessionStore(backend, backend);
  const compactor = new Compactor({
    llm,
    logger,
    onPersist: (s) => backend.save(s),
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

  const userId = env.TRIPMATE_USER ?? 'cli-default';
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const sessionId = env.TRIPMATE_SESSION ?? `cli-${Date.now()}`;

  stdout.write(`${CYAN}TripMate Agent${RESET} ${DIM}(${config.mainModel})${RESET}\n`);
  stdout.write(`${DIM}User: ${userId}  DB: ${dbPath}${RESET}\n`);
  stdout.write(`${DIM}Session: ${sessionId}${RESET}\n`);
  stdout.write(`${DIM}Tools: ${tools.toolNames().join(', ') || '(none)'}${RESET}\n`);
  stdout.write(
    `${DIM}Commands: "exit" / "stats" / "reset" / "memories" / "forget <id>" / "history" / "export [session-id]".${RESET}\n\n`,
  );

  let activeSession = sessionId;

  const shutdown = async (): Promise<void> => {
    rl.close();
    await tools.shutdown();
    backend.close();
    printSummary(metrics, tools);
  };

  process.on('SIGINT', () => {
    stdout.write('\n');
    shutdown().finally(() => process.exit(0));
  });

  while (true) {
    let input: string;
    try {
      input = (await rl.question(`${GREEN}You> ${RESET}`)).trim();
    } catch {
      break;
    }
    if (!input) continue;
    if (input === 'exit' || input === 'quit') break;
    if (input === 'stats') {
      printSummary(metrics, tools);
      continue;
    }
    if (input === 'reset') {
      activeSession = `cli-${Date.now()}`;
      stdout.write(`${DIM}New session: ${activeSession}${RESET}\n\n`);
      continue;
    }
    if (input === 'memories') {
      const list = await backend.list(userId, 50);
      if (list.length === 0) {
        stdout.write(`${DIM}(no saved memories)${RESET}\n\n`);
      } else {
        for (const m of list) {
          const tagPart = m.tags.length > 0 ? ` [${m.tags.join(', ')}]` : '';
          stdout.write(`${DIM}#${m.id}${tagPart}: ${m.content}${RESET}\n`);
        }
        stdout.write('\n');
      }
      continue;
    }
    if (input.startsWith('forget ')) {
      const id = Number(input.slice('forget '.length).trim());
      if (Number.isFinite(id)) {
        const ok = await backend.delete(userId, id);
        stdout.write(`${DIM}${ok ? `forgot #${id}` : `no memory #${id}`}${RESET}\n\n`);
      } else {
        stdout.write(`${RED}usage: forget <id>${RESET}\n\n`);
      }
      continue;
    }
    if (input === 'export' || input.startsWith('export ')) {
      const arg = input.slice('export'.length).trim();
      const targetId = arg || activeSession;
      const session = await sessions.getOrCreate(targetId);
      if (session.messages.length === 0) {
        stdout.write(`${YELLOW}session "${targetId}" is empty${RESET}\n\n`);
        continue;
      }
      stdout.write(`${DIM}exporting ${targetId}...${RESET}\n`);
      try {
        const result = await exportSessionPDF(session, { llm, sessions, logger });
        const filename = `tripmate-${targetId}.pdf`;
        await writeFile(filename, result.buffer);
        stdout.write(
          `${GREEN}wrote ${filename}${RESET} ${DIM}(${result.source}, ${(result.bytes / 1024).toFixed(1)}KB)${RESET}\n\n`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        stdout.write(`${RED}export failed: ${msg}${RESET}\n\n`);
      }
      continue;
    }
    if (input === 'history') {
      const sessions = backend.listSessions(userId, 20);
      if (sessions.length === 0) {
        stdout.write(`${DIM}(no past sessions)${RESET}\n\n`);
      } else {
        for (const s of sessions) {
          const marker = s.id === activeSession ? '*' : ' ';
          stdout.write(
            `${DIM}${marker} ${s.id} (${s.messageCount} msg, ${s.updatedAt.toISOString().slice(0, 16)}): ${s.preview}${RESET}\n`,
          );
        }
        stdout.write('\n');
      }
      continue;
    }

    stdout.write(`${CYAN}Agent> ${RESET}`);
    let sawText = false;
    try {
      for await (const event of agent.turn(activeSession, input, { userId })) {
        switch (event.type) {
          case 'text':
            stdout.write(event.text);
            sawText = true;
            break;
          case 'tool_call':
            if (sawText) stdout.write('\n');
            stdout.write(
              `${DIM}  → ${event.name}(${truncate(JSON.stringify(event.input), 120)})${RESET}\n`,
            );
            sawText = false;
            break;
          case 'tool_result': {
            const tag = event.isError ? `${RED}[error]${RESET} ` : '';
            stdout.write(
              `${DIM}  ← ${tag}${truncate(event.content, 200)} (${event.latencyMs}ms)${RESET}\n`,
            );
            break;
          }
          case 'usage':
            stdout.write(
              `${DIM}  · ${event.inputTokens}↑ ${event.outputTokens}↓ ` +
                `cache:${event.cacheReadTokens}r/${event.cacheCreateTokens}w ` +
                `${event.latencyMs}ms${RESET}\n`,
            );
            break;
          case 'done':
            if (event.reason === 'max_iterations') {
              stdout.write(`${YELLOW}  [stopped: max iterations]${RESET}\n`);
            } else if (event.reason === 'refusal') {
              stdout.write(`${YELLOW}  [stopped: refusal]${RESET}\n`);
            }
            break;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stdout.write(`\n${RED}Error: ${msg}${RESET}\n`);
      logger.error('turn_failed', { error: msg });
    }
    stdout.write('\n');
  }

  await shutdown();
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function defaultDbPath(): string {
  const dir = path.join(os.homedir(), '.tripmate');
  mkdirSync(dir, { recursive: true });
  return path.join(dir, 'tripmate.db');
}

function printSummary(metrics: Metrics, tools?: ToolRegistry): void {
  const s = metrics.summary();
  stdout.write(`\n${DIM}── session metrics ──${RESET}\n`);
  stdout.write(
    `${DIM}requests: ${s.requests}  ` +
      `tokens in/out: ${s.inputTokens}/${s.outputTokens}  ` +
      `cache hit: ${(s.cacheHitRate * 100).toFixed(1)}%  ` +
      `est. cost: $${s.estCostUSD.toFixed(4)}${RESET}\n`,
  );
  for (const t of s.toolCalls) {
    stdout.write(
      `${DIM}  ${t.name}: ${t.count} call${t.count === 1 ? '' : 's'}, ` +
        `${t.errors} error${t.errors === 1 ? '' : 's'}, ${t.avgLatencyMs}ms avg${RESET}\n`,
    );
  }
  if (tools) {
    const open = tools.healthSnapshot().filter((h) => h.snapshot.state === 'open');
    if (open.length > 0) {
      stdout.write(`${DIM}── circuit breaker ──${RESET}\n`);
      for (const { provider, snapshot } of open) {
        stdout.write(
          `${YELLOW}  ⚠ ${provider}: open, retry in ${Math.round(snapshot.cooldownRemainingMs / 1000)}s ` +
            `(next cooldown ${Math.round(snapshot.nextCooldownMs / 1000)}s)${RESET}\n`,
        );
      }
    }
  }
  stdout.write('\n');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
