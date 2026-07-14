import type OpenAI from 'openai';
import type {
  ToolCallResult,
  ToolContext,
  ToolDefinition,
  ToolProvider,
} from '../agent/types.js';
import type { Logger, Metrics } from '../observability.js';
import {
  CircuitBreaker,
  DEFAULT_CB_CONFIG,
  isTransientError,
  withRetry,
  type CircuitBreakerConfig,
  type CircuitBreakerSnapshot,
} from './health.js';

export interface ToolRegistryOptions {
  logger?: Logger;
  metrics?: Metrics;
  toolTimeoutMs?: number;
  circuitBreakerConfig?: CircuitBreakerConfig;
}

export class ToolRegistry {
  private providers: ToolProvider[] = [];
  private toolToProvider = new Map<string, ToolProvider>();
  private cached: ToolDefinition[] = [];
  private breakers = new Map<string, CircuitBreaker>();
  private logger?: Logger;
  private metrics?: Metrics;
  private toolTimeoutMs: number;
  private cbConfig: CircuitBreakerConfig;

  constructor(opts: ToolRegistryOptions = {}) {
    this.logger = opts.logger;
    this.metrics = opts.metrics;
    this.toolTimeoutMs = opts.toolTimeoutMs ?? 30_000;
    this.cbConfig = opts.circuitBreakerConfig ?? DEFAULT_CB_CONFIG;
  }

  async register(provider: ToolProvider): Promise<void> {
    const tools = await provider.listTools();
    for (const tool of tools) {
      if (this.toolToProvider.has(tool.name)) {
        throw new Error(`Tool name collision on "${tool.name}" from provider "${provider.name}"`);
      }
      this.toolToProvider.set(tool.name, provider);
      this.cached.push(tool);
    }
    this.providers.push(provider);
    if (!this.breakers.has(provider.name)) {
      this.breakers.set(provider.name, new CircuitBreaker(provider.name, this.cbConfig));
    }
    this.logger?.info('tool_provider_registered', {
      provider: provider.name,
      toolCount: tools.length,
      tools: tools.map((t) => t.name),
    });
  }

  openaiTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    // Hide tools whose provider's circuit breaker is open — the LLM
    // shouldn't see (and try to call) tools that will fail-fast anyway.
    const visible = this.cached.filter((t) => {
      const provider = this.toolToProvider.get(t.name);
      if (!provider) return false;
      const breaker = this.breakers.get(provider.name);
      return breaker ? breaker.canCall() : true;
    });
    // Sort by name so the serialized tools array is byte-stable across
    // requests, regardless of provider register order. Prefix-based prompt
    // caching depends on this.
    const sorted = [...visible].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return sorted.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema as Record<string, unknown>,
      },
    }));
  }

  toolNames(): string[] {
    return this.cached.map((t) => t.name);
  }

  async execute(
    name: string,
    input: Record<string, unknown>,
    ctx?: ToolContext,
  ): Promise<ToolCallResult & { latencyMs: number }> {
    const provider = this.toolToProvider.get(name);
    const startedAt = Date.now();
    if (!provider) {
      const latencyMs = Date.now() - startedAt;
      this.metrics?.recordToolCall({ name, latencyMs, isError: true });
      return { content: `Unknown tool: ${name}`, isError: true, latencyMs };
    }

    const breaker = this.breakers.get(provider.name);
    if (breaker && !breaker.canCall()) {
      const snap = breaker.snapshot();
      const latencyMs = Date.now() - startedAt;
      this.metrics?.recordToolCall({ name, latencyMs, isError: true });
      this.logger?.warn('tool_circuit_open', {
        tool: name,
        provider: provider.name,
        cooldownRemainingMs: snap.cooldownRemainingMs,
      });
      return {
        content:
          `Tool "${name}" is temporarily unavailable ` +
          `(provider ${provider.name} circuit breaker open, ` +
          `retry in ~${Math.round(snap.cooldownRemainingMs / 1000)}s).`,
        isError: true,
        latencyMs,
      };
    }

    const tool = this.cached.find((t) => t.name === name);
    const safety = tool?.safety ?? 'read';
    const maxAttempts = safety === 'write' ? 1 : safety === 'idempotent_write' ? 2 : 3;

    try {
      const result = await withRetry(
        () => this.withTimeout(provider.callTool(name, input, ctx), this.toolTimeoutMs, name),
        { maxAttempts, baseDelayMs: 200, isRetriable: isTransientError },
        (attempt, err, delayMs) => {
          this.logger?.debug('tool_retry', {
            tool: name,
            provider: provider.name,
            attempt,
            delayMs,
            error: err instanceof Error ? err.message : String(err),
          });
        },
      );
      const latencyMs = Date.now() - startedAt;
      // A returned `isError: true` is application-level (e.g. "no trains found")
      // and does NOT indicate provider unhealth — only thrown exceptions count
      // toward the circuit breaker.
      breaker?.onSuccess();
      this.metrics?.recordToolCall({ name, latencyMs, isError: !!result.isError });
      this.logger?.debug('tool_executed', { name, latencyMs, isError: !!result.isError });
      return { ...result, latencyMs };
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const message = err instanceof Error ? err.message : String(err);
      const justOpened = breaker?.onFailure() ?? false;
      if (justOpened) {
        this.logger?.warn('tool_circuit_opened', {
          provider: provider.name,
          tool: name,
          error: message,
        });
      }
      this.metrics?.recordToolCall({ name, latencyMs, isError: true });
      this.logger?.warn('tool_failed', {
        name,
        provider: provider.name,
        latencyMs,
        error: message,
      });
      return { content: `Tool "${name}" failed: ${message}`, isError: true, latencyMs };
    }
  }

  // Snapshot of all circuit breaker states — for stats / observability.
  healthSnapshot(): { provider: string; snapshot: CircuitBreakerSnapshot }[] {
    const out: { provider: string; snapshot: CircuitBreakerSnapshot }[] = [];
    for (const [provider, cb] of this.breakers) {
      out.push({ provider, snapshot: cb.snapshot() });
    }
    return out;
  }

  async shutdown(): Promise<void> {
    for (const p of this.providers) {
      const close = (p as ToolProvider & { close?: () => Promise<void> }).close;
      if (typeof close === 'function') {
        try {
          await close.call(p);
        } catch (err) {
          this.logger?.warn('tool_provider_close_failed', {
            provider: p.name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`Tool "${label}" timed out after ${ms}ms`)), ms);
      promise.then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        (e) => {
          clearTimeout(t);
          reject(e);
        },
      );
    });
  }
}
