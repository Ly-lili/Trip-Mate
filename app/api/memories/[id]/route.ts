import { NextRequest } from 'next/server';
import { getRuntime } from '@/lib/agent-singleton';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: idRaw } = await params;
  const id = Number(idRaw);
  if (!Number.isFinite(id)) {
    return Response.json({ error: 'invalid id' }, { status: 400 });
  }
  const userId = req.nextUrl.searchParams.get('userId')?.trim() || 'web-default';

  const { backend } = await getRuntime();
  const ok = await backend.delete(userId, id);
  return Response.json({ ok });
}
