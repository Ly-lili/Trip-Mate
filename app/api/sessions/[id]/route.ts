import { NextRequest } from 'next/server';
import { getRuntime } from '@/lib/agent-singleton';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const { backend, sessions } = await getRuntime();
  const messages = backend.loadHistoryForUI(id);
  const session = await sessions.getOrCreate(id);
  return Response.json({
    id,
    title: session.title,
    titleSource: session.titleSource,
    archived: session.archived,
    messages,
  });
}

interface PatchSessionBody {
  title?: string;
  archived?: boolean;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  let body: PatchSessionBody;
  try {
    body = (await req.json()) as PatchSessionBody;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { sessions } = await getRuntime();
  const patch: Record<string, unknown> = {};
  if (typeof body.title === 'string') {
    patch.title = body.title.trim().slice(0, 40) || undefined;
    patch.titleSource = 'manual';
  }
  if (typeof body.archived === 'boolean') patch.archived = body.archived;
  const session = await sessions.patchMeta(id, patch);
  return Response.json({
    id,
    title: session?.title,
    titleSource: session?.titleSource,
    archived: session?.archived,
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const userId = req.nextUrl.searchParams.get('userId')?.trim() || 'web-default';
  const { backend, sessions } = await getRuntime();

  const result = backend.db
    .prepare('DELETE FROM sessions WHERE id = ? AND (user_id = ? OR user_id IS NULL)')
    .run(id, userId);
  sessions.sessions?.delete?.(id);

  return Response.json({ id, deleted: result.changes > 0 });
}
