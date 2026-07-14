import { NextRequest } from 'next/server';
import { getRuntime } from '@/lib/agent-singleton';
import { extractItinerary } from '@agent/export/extract.js';
import { workspaceFromItinerary } from '@agent/workspace.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const { sessions, llm, logger } = await getRuntime();
  const session = await sessions.getOrCreate(id);
  if (session.messages.length === 0) {
    return Response.json({ suggestion: workspaceFromItinerary(null), empty: true });
  }
  const itinerary = await extractItinerary(session, { llm, logger });
  const suggestion = workspaceFromItinerary(itinerary, session.workspace?.profile ?? {});
  return Response.json({ suggestion, empty: !itinerary });
}
