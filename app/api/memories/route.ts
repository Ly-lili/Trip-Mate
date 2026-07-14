import { NextRequest } from 'next/server';
import { getRuntime } from '@/lib/agent-singleton';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface MemoryEntry {
  id: number;
  content: string;
  tags: string[];
  createdAt: Date;
}

export async function GET(req: NextRequest): Promise<Response> {
  const userId = req.nextUrl.searchParams.get('userId')?.trim() || 'web-default';
  const limitParam = Number(req.nextUrl.searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(200, limitParam) : 50;

  const { backend } = await getRuntime();
  const memories = await backend.list(userId, limit);

  return Response.json({
    memories: (memories as MemoryEntry[]).map((m) => ({
      id: m.id,
      content: m.content,
      tags: m.tags,
      createdAt: m.createdAt.toISOString(),
    })),
  });
}

interface AddMemoryBody {
  userId?: string;
  content: string;
  tags?: string[];
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: AddMemoryBody;
  try {
    body = (await req.json()) as AddMemoryBody;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const content = body.content?.trim();
  if (!content) {
    return Response.json({ error: 'content is required' }, { status: 400 });
  }
  const userId = body.userId?.trim() || 'web-default';
  const tags = Array.isArray(body.tags) ? body.tags.filter((t) => typeof t === 'string') : [];

  const { backend } = await getRuntime();
  const entry = await backend.add(userId, content, tags);

  return Response.json({
    memory: {
      id: entry.id,
      content: entry.content,
      tags: entry.tags,
      createdAt: entry.createdAt.toISOString(),
    },
  });
}
