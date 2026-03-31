import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const base = {
    status: 'ok' as 'ok' | 'degraded',
    timestamp: new Date().toISOString(),
    service: 'lns-dataportal-portal',
  };

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? process.env.API_URL;
  if (!apiUrl) {
    return NextResponse.json({ ...base, status: 'degraded', api: { status: 'error', error: 'API_URL ikke konfigurert' } }, { status: 503 });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${apiUrl}/health/live`, { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`API svarte ${res.status}`);
  } catch (err: unknown) {
    return NextResponse.json(
      { ...base, status: 'degraded', api: { status: 'error', error: err instanceof Error ? err.message : 'Ukjent feil' } },
      { status: 503 },
    );
  }

  return NextResponse.json(base, { status: 200 });
}
