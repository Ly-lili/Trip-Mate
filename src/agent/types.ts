export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  parallelSafe?: boolean;
  // Retry / circuit-breaker policy hint.
  //   'read'              — pure query; safe to retry on transient failures (default)
  //   'idempotent_write'  — mutating but re-doing the same call is safe (e.g. delete by id)
  //   'write'             — non-idempotent mutation; never retry on unknown error
  safety?: 'read' | 'idempotent_write' | 'write';
}

export interface ToolCallResult {
  content: string;
  isError?: boolean;
}

export interface ToolContext {
  userId?: string;
  sessionId?: string;
}

export interface ToolProvider {
  readonly name: string;
  listTools(): Promise<ToolDefinition[]>;
  callTool(
    name: string,
    input: Record<string, unknown>,
    ctx?: ToolContext,
  ): Promise<ToolCallResult>;
}

export type StopReason = 'end_turn' | 'max_iterations' | 'stop_sequence' | 'refusal' | 'other';

export type TurnEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; name: string; input: unknown }
  | { type: 'tool_result'; name: string; content: string; isError?: boolean; latencyMs: number }
  | {
      type: 'usage';
      model: string;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreateTokens: number;
      latencyMs: number;
    }
  | { type: 'done'; reason: StopReason };
