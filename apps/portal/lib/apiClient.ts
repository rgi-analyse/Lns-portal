/**
 * Hjelper for API-kall fra portalen.
 * Legger automatisk til x-tenant-id basert på hostname.
 */

export function getTenantSlug(): string {
  if (typeof window === 'undefined') return 'lns';
  const host = window.location.hostname;
  const sub = host.split('.')[0].toLowerCase();
  if (sub && sub !== 'www' && !/^\d/.test(sub) && sub !== 'localhost') return sub;
  return 'lns';
}

export function apiHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'x-tenant-id': getTenantSlug(),
    ...extra,
  };
}

export async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? '';
  return fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      ...apiHeaders(),
      ...(options?.headers as Record<string, string> | undefined),
    },
  });
}
