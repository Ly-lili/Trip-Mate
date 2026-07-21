declare module '*.css';
declare module '*.js';
declare module '@agent/export/index.js';
declare module '../dist/agent/runtime.js';
declare module '../dist/llm/client.js';
declare module '../dist/tools/registry.js';
declare module '../dist/tools/mcp.js';
declare module '../dist/mcp-config.js' {
  export function getMcpServers(): Array<{
    name: string;
    transport: 'http' | 'sse';
    url: string;
  }>;
}
declare module '../dist/session/store.js';
declare module '../dist/session/sqlite-backend.js';
declare module '../dist/session/compactor.js';
declare module '../dist/tools/memory-tool.js';
declare module '../dist/observability.js';
