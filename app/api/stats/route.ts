import { getRuntime } from '@/lib/agent-singleton';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const { metrics } = await getRuntime();
  return Response.json(metrics.summary());
}
