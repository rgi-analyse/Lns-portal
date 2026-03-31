import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

function extractTenantSlug(request: NextRequest): string {
  const host = request.headers.get('host') ?? '';
  const sub = host.split('.')[0].toLowerCase();
  if (sub && sub !== 'www' && !/^\d/.test(sub) && sub !== 'localhost') return sub;
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
