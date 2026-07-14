import { NextRequest } from 'next/server';
import { getRuntime } from '@/lib/agent-singleton';
import { emptyWorkspace, mergeWorkspaceSuggestion } from '@agent/workspace.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const { sessions } = await getRuntime();
  const session = await sessions.getOrCreate(id);
  return Response.json({ workspace: session.workspace ?? emptyWorkspace() });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  let body: { workspace?: unknown; applySuggestion?: boolean };
  try {
    body = (await req.json()) as { workspace?: unknown; applySuggestion?: boolean };
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.workspace || typeof body.workspace !== 'object') {
    return Response.json({ error: 'workspace is required' }, { status: 400 });
  }
  const { sessions } = await getRuntime();
  const session = await sessions.getOrCreate(id);
  const next = body.applySuggestion
    ? mergeWorkspaceSuggestion(session.workspace, body.workspace as never)
    : {
        ...(body.workspace as Record<string, unknown>),
        updatedAt: new Date().toISOString(),
      };
  await sessions.setWorkspace(id, next);
  return Response.json({ workspace: next });
}
