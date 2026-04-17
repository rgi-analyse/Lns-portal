'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { harBetaTilgang } from '@/lib/featureFlags';
import SamtaleHistorikkSidebar from '@/components/chat/SamtaleHistorikkSidebar';
import { apiFetch, apiHeaders } from '@/lib/apiClient';

const AIChat = dynamic(() => import('@/components/AIChat'), { ssr: false });

interface ChatMelding {
  rolle: string;
  innhold: string;
  tidspunkt: string;
}

export default function AiChatPage() {
  const { entraObjectId, grupper } = usePortalAuth();

  // URL- og localStorage-fallback for beta-tilgang
  const urlParams = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : null;
  const betaViaUrl = urlParams?.get('beta') === 'true';
  const betaViaStorage = typeof window !== 'undefined'
    && localStorage.getItem('beta_samtalehistorikk') === 'true';

  const betaViaFlag = harBetaTilgang(entraObjectId);
  const betaBruker = betaViaFlag || betaViaUrl || betaViaStorage;

  // DEBUG — fjernes etter verifisering
  console.log('[FEATURE FLAG DEBUG]', {
    entraObjectId,
    entraObjectIdType: typeof entraObjectId,
    entraObjectIdTrimmed: entraObjectId?.trim(),
    betaViaFlag,
    betaViaUrl,
    betaViaStorage,
    betaBruker,
    BETA_BRUKERE_match: entraObjectId?.trim() === 'bb012447-096e-447f-8d0e-9052caaa0e1a',
  });

  const iDagDato = new Date().toISOString().slice(0, 10);
  const defaultØktId = entraObjectId ? `${entraObjectId}-${iDagDato}` : undefined;

  const [aktivtØktId, setAktivtØktId] = useState<string | null>(defaultØktId ?? null);
  // Key brukes til å tvinge re-mount av AIChat ved ny samtale / bytte av samtale
  const [chatKey, setChatKey] = useState(0);
  const [initialMessages, setInitialMessages] = useState<{ role: string; content: string }[] | null>(null);

  // Oppdater defaultØktId når entraObjectId lastes
  useEffect(() => {
    if (entraObjectId && !aktivtØktId) {
      const id = `${entraObjectId}-${iDagDato}`;
      setAktivtØktId(id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entraObjectId]);

  const velgSamtale = useCallback(async (øktId: string) => {
    if (!entraObjectId) return;
    try {
      const res = await apiFetch(`/api/chat/samtaler/${encodeURIComponent(øktId)}`, {
        headers: { 'x-entra-object-id': entraObjectId, ...apiHeaders() },
      });
      if (res.ok) {
        const meldinger = (await res.json()) as ChatMelding[];
        const mapped = meldinger
          .filter(m => m.rolle === 'user' || m.rolle === 'assistant')
          .map(m => ({ role: m.rolle, content: m.innhold }));
        setInitialMessages(mapped);
      }
    } catch {
      setInitialMessages(null);
    }
    setAktivtØktId(øktId);
    setChatKey(k => k + 1);
  }, [entraObjectId]);

  const nySamtale = useCallback(() => {
    if (!entraObjectId) return;
    const nyId = `${entraObjectId}-${new Date().toISOString()}`;
    setAktivtØktId(nyId);
    setInitialMessages(null);
    setChatKey(k => k + 1);
  }, [entraObjectId]);

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>
      {betaBruker && entraObjectId && (
        <SamtaleHistorikkSidebar
          entraObjectId={entraObjectId}
          aktivtØktId={aktivtØktId}
          onVelgSamtale={velgSamtale}
          onNySamtale={nySamtale}
        />
      )}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <AIChat
          key={chatKey}
          entraObjectId={entraObjectId}
          grupper={grupper}
          øktId={aktivtØktId ?? undefined}
          standaloneMode
          initialMessages={initialMessages ?? undefined}
        />
      </div>
    </div>
  );
}
