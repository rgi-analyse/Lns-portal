/**
 * Hjelper for API-kall fra portalen.
 * Legger automatisk til x-tenant-id basert på hostname.
 */

export function getTenantSlug(): string {
  if (typeof window === 'undefined') return 'lns';
  const host = window.location.hostname.toLowerCase();

  // Aldri tolk subdomain fra Azure App Service, localhost eller IP-adresser
  const isSystemHost =
    host.includes('azurewebsites.net') ||
    host.includes('azure.com') ||
    host.includes('.azure.') ||
    host === 'localhost' ||
    /^[\d.]+$/.test(host) ||   // ren IP-adresse
    !host.includes('.');        // enkelt hostname uten punktum

  if (isSystemHost) return 'lns';

  const sub = host.split('.')[0];
  if (sub && sub !== 'www') return sub;
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
