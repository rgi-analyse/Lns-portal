import { apiFetch } from './apiClient';

interface Hendelse {
  hendelsesType: 'åpnet_rapport' | 'åpnet_workspace' | 'brukt_filter' | 'innlogget';
  referanseId?:   string;
  referanseNavn?: string;
  verdi?:         Record<string, unknown>;
}

export function loggHendelse(
  hendelse: Hendelse,
  authHeaders: Record<string, string>,
): void {
  // Fire-and-forget — aldri await denne
  apiFetch('/api/meg/logg', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(hendelse),
  }).catch(() => {}); // ignorer alltid feil
}
