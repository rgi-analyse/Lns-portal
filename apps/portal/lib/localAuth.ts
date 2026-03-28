const KEY = 'synapse_local_session';

export interface LocalSession {
  entraObjectId: string;
  displayName:   string | null;
  email:         string | null;
  rolle:         string;
}

export function getLocalSession(): LocalSession | null {
  if (typeof window === 'undefined') return null;
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as LocalSession; } catch { return null; }
}

export function setLocalSession(session: LocalSession): void {
  sessionStorage.setItem(KEY, JSON.stringify(session));
}

export function clearLocalSession(): void {
  sessionStorage.removeItem(KEY);
}
