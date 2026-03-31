import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

function extractTenantSlug(request: NextRequest): string {
  const host = (request.headers.get('host') ?? '').toLowerCase();

  // Aldri tolk subdomain fra Azure App Service, localhost eller IP-adresser
  const isSystemHost =
    host.includes('azurewebsites.net') ||
    host.includes('azure.com') ||
    host.includes('.azure.') ||
    host === 'localhost' ||
    /^[\d.:]+$/.test(host) ||   // ren IP-adresse (med valgfri port)
    !host.includes('.');         // enkelt hostname uten punktum

  if (isSystemHost) return 'lns';

  const sub = host.split('.')[0];
  if (sub && sub !== 'www') return sub;
  return 'lns';
}

export function middleware(request: NextRequest) {
  const slug = extractTenantSlug(request);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-tenant-id', slug);

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
