type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export class Logger {
  constructor(
    private readonly name: string,
    private readonly minLevel: LogLevel = 'info',
  ) {}

  child(name: string): Logger {
    return new Logger(`${this.name}.${name}`, this.minLevel);
  }

  debug(msg: string, fields?: Record<string, unknown>): void { this.emit('debug', msg, fields); }
  info(msg: string, fields?: Record<string, unknown>): void { this.emit('info', msg, fields); }
  warn(msg: string, fields?: Record<string, unknown>): void { this.emit('warn', msg, fields); }
  error(msg: string, fields?: Record<string, unknown>): void { this.emit('error', msg, fields); }

  private emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.minLevel]) return;
    const entry = { ts: new Date().toISOString(), level, logger: this.name, msg, ...fields };
    process.stderr.write(JSON.stringify(entry) + '\n');
  }
}

export interface RequestSample {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  latencyMs: number;
}

export interface ToolSample {
  name: string;
  latencyMs: number;
  isError: boolean;
}

export interface MetricsSummary {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  cacheHitRate: number;
  estCostUSD: number;
  toolCalls: { name: string; count: number; errors: number; avgLatencyMs: number }[];
}

// USD per 1M tokens. Verify against current DeepSeek pricing page.
const PRICING_PER_MTOK: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'deepseek-v4-pro': { input: 0.55, output: 2.19, cacheRead: 0.14, cacheWrite: 0 },
  'deepseek-v4-flash': { input: 0.27, output: 1.10, cacheRead: 0.07, cacheWrite: 0 },
  'deepseek-reasoner': { input: 0.55, output: 2.19, cacheRead: 0.14, cacheWrite: 0 },
  'deepseek-chat': { input: 0.27, output: 1.10, cacheRead: 0.07, cacheWrite: 0 },
};

export class Metrics {
  private requests: RequestSample[] = [];
  private toolCalls: ToolSample[] = [];

  recordRequest(sample: RequestSample): void {
    this.requests.push(sample);
  }

  recordToolCall(sample: ToolSample): void {
    this.toolCalls.push(sample);
  }

  summary(): MetricsSummary {
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheRead = 0;
    let cacheCreate = 0;
    let estCost = 0;
    for (const r of this.requests) {
      inputTokens += r.inputTokens;
      outputTokens += r.outputTokens;
      cacheRead += r.cacheReadTokens;
      cacheCreate += r.cacheCreateTokens;
      const price = PRICING_PER_MTOK[r.model];
      if (price) {
        estCost +=
          (r.inputTokens * price.input +
            r.outputTokens * price.output +
            r.cacheReadTokens * price.cacheRead +
            r.cacheCreateTokens * price.cacheWrite) /
          1_000_000;
      }
    }
    const totalIn = inputTokens + cacheRead + cacheCreate;
    const cacheHitRate = totalIn === 0 ? 0 : cacheRead / totalIn;

    const grouped = new Map<string, { count: number; errors: number; totalMs: number }>();
    for (const t of this.toolCalls) {
      const cur = grouped.get(t.name) ?? { count: 0, errors: 0, totalMs: 0 };
      cur.count++;
      if (t.isError) cur.errors++;
      cur.totalMs += t.latencyMs;
      grouped.set(t.name, cur);
    }
    const toolCalls = [...grouped.entries()]
      .map(([name, v]) => ({
        name,
        count: v.count,
        errors: v.errors,
        avgLatencyMs: Math.round(v.totalMs / v.count),
      }))
      .sort((a, b) => b.count - a.count);

    return {
      requests: this.requests.length,
      inputTokens,
      outputTokens,
      cacheReadTokens: cacheRead,
      cacheCreateTokens: cacheCreate,
      cacheHitRate: Number(cacheHitRate.toFixed(3)),
      estCostUSD: Number(estCost.toFixed(4)),
      toolCalls,
    };
  }
}
