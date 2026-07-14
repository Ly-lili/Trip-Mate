import { NextRequest } from 'next/server';
import { getRuntime } from '@/lib/agent-singleton';
import { exportSessionPDF } from '@agent/export/index.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const { sessions, llm, logger } = await getRuntime();

  const session = await sessions.getOrCreate(id);
  if (session.messages.length === 0) {
    return Response.json({ error: 'session is empty' }, { status: 404 });
  }

  const force = req.nextUrl.searchParams.get('force') === '1';
  try {
    const result = await exportSessionPDF(session, { llm, sessions, logger, force });
    return new Response(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="tripmate-${id}.pdf"`,
        'X-Pdf-Source': result.source,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger?.warn('pdf_export_failed', { sessionId: id, error: msg });
    return Response.json({ error: msg }, { status: 500 });
  }
}
