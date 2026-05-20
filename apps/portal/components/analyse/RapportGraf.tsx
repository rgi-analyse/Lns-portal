'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { apiFetch } from '@/lib/apiClient';

interface Props {
  bestillingId: string;
  seksjonId: string;
  authHeaders: Record<string, string>;
  alt?: string;
}

/**
 * Henter graf-PNG for én seksjon som blob og rendrer den inline.
 * Rydder opp blob-URL ved unmount / endring av input.
 */
export default function RapportGraf({ bestillingId, seksjonId, authHeaders, alt }: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [laster, setLaster] = useState(true);

  useEffect(() => {
    let avbrutt = false;
    let lokalUrl: string | null = null;

    (async () => {
      setLaster(true);
      setFeil(null);
      try {
        const r = await apiFetch(
          `/api/analyse/bestillinger/${bestillingId}/grafer/${seksjonId}`,
          { headers: authHeaders },
        );
        if (!r.ok) {
          const detail = await r.json().catch(() => ({}));
          throw new Error(detail?.error ?? `Graf-lasting feilet (${r.status})`);
        }
        const blob = await r.blob();
        if (avbrutt) return;
        lokalUrl = URL.createObjectURL(blob);
        setBlobUrl(lokalUrl);
      } catch (err) {
        if (avbrutt) return;
        setFeil(err instanceof Error ? err.message : 'Ukjent feil');
      } finally {
        if (!avbrutt) setLaster(false);
      }
    })();

    return () => {
      avbrutt = true;
      if (lokalUrl) URL.revokeObjectURL(lokalUrl);
    };
  }, [bestillingId, seksjonId, authHeaders]);

  if (laster) {
    return (
      <div className="flex items-center gap-2 my-4 text-sm" style={{ color: 'var(--text-muted)' }}>
        <Loader2 className="w-4 h-4 animate-spin" />
        Laster graf…
      </div>
    );
  }
  if (feil) {
    return <p className="text-sm text-red-400 my-4">Kunne ikke laste graf: {feil}</p>;
  }
  if (!blobUrl) return null;

  return (
    <img
      src={blobUrl}
      alt={alt ?? seksjonId}
      className="w-full rounded-lg my-4"
      style={{ background: 'var(--glass-bg)' }}
    />
  );
}
