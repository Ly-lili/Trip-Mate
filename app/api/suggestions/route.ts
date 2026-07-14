import { NextRequest } from 'next/server';
import { getRuntime } from '@/lib/agent-singleton';
import { getSuggestions, DEFAULT_SUGGESTIONS } from '@/lib/suggestions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const userId = req.nextUrl.searchParams.get('userId') ?? undefined;
  try {
    const { llm, backend, logger } = await getRuntime();
    const suggestions = await getSuggestions({
      llm,
      memoryStore: backend,
      userId,
      logger,
    });
    return Response.json({ suggestions });
  } catch {
    // Even runtime bootstrap failures shouldn't break the homepage — the UI
    // will just see a static list.
    return Response.json({ suggestions: [...DEFAULT_SUGGESTIONS] });
  }
}
