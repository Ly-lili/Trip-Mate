import { NextRequest } from 'next/server';
import { getRuntime } from '@/lib/agent-singleton';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SessionSummary {
  id: string;
  title?: string;
  titleSource?: 'auto' | 'manual' | 'fallback';
  archived?: boolean;
  preview: string;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export async function GET(req: NextRequest): Promise<Response> {
  const userId = req.nextUrl.searchParams.get('userId')?.trim() || 'web-default';
  const query = req.nextUrl.searchParams.get('query')?.trim() || '';
  const limitParam = Number(req.nextUrl.searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(100, limitParam) : 30;

  const { backend } = await getRuntime();
  const sessions = backend.listSessions(userId, limit, query);

  return Response.json({
    sessions: (sessions as SessionSummary[]).map((s) => ({
      id: s.id,
      title: s.title,
      titleSource: s.titleSource,
      archived: s.archived,
      preview: s.preview,
      messageCount: s.messageCount,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    })),
  });
}
