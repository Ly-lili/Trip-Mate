import { getRuntime } from '@/lib/agent-singleton';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const { toolNames, mcpStatus } = await getRuntime();
  return Response.json({ toolNames, mcpStatus, toolCount: toolNames.length });
}
