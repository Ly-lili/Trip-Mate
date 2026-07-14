import { NextRequest } from 'next/server';
import { getRuntime } from '@/lib/agent-singleton';
import { workspaceFromItinerary, workspaceToMarkdown } from '@agent/workspace.js';
import { latestAssistantMarkdown } from '@agent/export/extract.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const { sessions } = await getRuntime();
  const session = await sessions.getOrCreate(id);
  const title = session.title || 'TripMate 行程草稿';
  const workspace = session.workspace ?? (session.itinerary ? workspaceFromItinerary(session.itinerary) : null);
  const markdown = workspace && workspace.itinerary.days.length > 0
    ? workspaceToMarkdown(workspace, title)
    : latestAssistantMarkdown(session) ?? '';
  return Response.json({ markdown, source: workspace ? 'workspace' : 'markdown' });
}
