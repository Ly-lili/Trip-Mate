import { NextRequest } from 'next/server';
import { getRuntime } from '@/lib/agent-singleton';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PreferencesBody = {
  userId?: string;
  defaultDepartureCity?: string;
  currency?: 'CNY' | 'USD' | 'EUR' | 'JPY' | 'HKD';
  language?: 'zh-CN' | 'en';
  pace?: 'relaxed' | 'balanced' | 'packed';
  hotelTier?: 'budget' | 'midrange' | 'luxury';
  notes?: string[];
};

export async function GET(req: NextRequest): Promise<Response> {
  const userId = req.nextUrl.searchParams.get('userId')?.trim() || 'web-default';
  const { sessions } = await getRuntime();
  const preferences = await sessions.loadPreferences(userId);
  return Response.json({ preferences: preferences ?? {} });
}

export async function PUT(req: NextRequest): Promise<Response> {
  let body: PreferencesBody;
  try {
    body = (await req.json()) as PreferencesBody;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const userId = body.userId?.trim() || 'web-default';
  const preferences = {
    defaultDepartureCity: clean(body.defaultDepartureCity),
    currency: body.currency ?? 'CNY',
    language: body.language ?? 'zh-CN',
    pace: body.pace ?? 'balanced',
    hotelTier: body.hotelTier ?? 'midrange',
    notes: Array.isArray(body.notes) ? body.notes.map(clean).filter(Boolean) : [],
  };
  const { sessions } = await getRuntime();
  await sessions.savePreferences(userId, preferences);
  return Response.json({ preferences });
}

function clean(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim().slice(0, 120) || undefined : undefined;
}
