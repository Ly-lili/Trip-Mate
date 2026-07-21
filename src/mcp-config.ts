import type { MCPServerConfig } from './tools/mcp.js';

const MCP_SERVER_DEFINITIONS = [
  { name: '12306', transport: 'http', envVar: 'TRIPMATE_MCP_12306_URL' },
  { name: 'amap', transport: 'http', envVar: 'TRIPMATE_MCP_AMAP_URL' },
  { name: 'bing', transport: 'sse', envVar: 'TRIPMATE_MCP_BING_URL' },
  { name: 'rollinggo', transport: 'http', envVar: 'TRIPMATE_MCP_ROLLINGGO_URL' },
  { name: 'variflight', transport: 'sse', envVar: 'TRIPMATE_MCP_VARIFLIGHT_URL' },
] as const;

/**
 * Builds the MCP connection list from server-only environment variables.
 * Empty variables deliberately disable the corresponding integration.
 */
export function getMcpServers(): MCPServerConfig[] {
  return MCP_SERVER_DEFINITIONS.flatMap(({ name, transport, envVar }) => {
    const url = process.env[envVar]?.trim();
    return url ? [{ name, transport, url }] : [];
  });
}
