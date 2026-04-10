'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { apiFetch } from '@/lib/apiClient';
import { loggHendelse } from '@/lib/loggHendelse';
import dynamic from 'next/dynamic';
import type { FilterConfig, SlicerConfig } from '@/components/AIChat';
import LagRapportModal from '@/components/LagRapportModal';
import { useLisens } from '@/components/LisensProvider';

const PowerBIReport = dynamic(() => import('@/components/PowerBIReport'), { ssr: false });
const AIChat = dynamic(() => import('@/components/AIChat'), { ssr: false });

interface WorkspaceKontekst {
  id:              string;
  navn:            string;
  kontekstType?:   string | null;
  kontekstKolonne?: string | null;
  kontekstVerdi?:  string | null;
  kontekstLabel?:  string | null;
}

interface Rapport {
  id:             string;
  navn:           string;
  beskrivelse:    string | null;
  pbiReportId:    string;
  pbiDatasetId:   string;
  pbiWorkspaceId: string;
  workspaces:     Array<{ workspace: WorkspaceKontekst }>;
  erDesignerRapport?: boolean;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function RapportPage() {
  const { id }                                       = useParams<{ id: string }>();
  const router                                       = useRouter();
  const { isAuthenticated, authHeaders, grupper,
          entraObjectId }                            = usePortalAuth();
  const [brukerRolleState, setBrukerRolleState]      = useState<string>('');

  const [rapport,           setRapport]           = useState<Rapport | null>(null);
  const [error,             setError]             = useState<string | null>(null);
  const [brukerChatAktivert, setBrukerChatAktivert] = useState<boolean | null>(null);
  const lisens = useLisens();
  const [kanLageRapport,    setKanLageRapport]    = useState(false);
  const [visLagRapportModal, setVisLagRapportModal] = useState(false);
  const [filterConfig,  setFilterConfig]  = useState<FilterConfig | undefined>(undefined);
  const [slicerConfig,  setSlicerConfig]  = useState<SlicerConfig | undefined>(undefined);
  const [slicers,       setSlicers]       = useState<string[]>([]);
  const [slicerValues,      setSlicerValues]      = useState<Record<string, Record<string, string[]>>>({});
  const [clearSlicerTitle,  setClearSlicerTitle]  = useState<string | undefined>(undefined);
  const [activeSlicerState, setActiveSlicerState] = useState<Record<string, unknown>>({});
  const [availableTables,   setAvailableTables]   = useState<string[]>([]);
  const [aktivSide,         setAktivSide]         = useState<string>('');
  const getVisualsDataRef = useRef<(() => Promise<Record<string, string>>) | null>(null);

  useEffect(() => {
    if (!isAuthenticated) { router.replace('/'); return; }
    if (!id) return;

    async function load() {
      console.log('[RapportPage] laster rapport id:', id);
      // Hent rapport
      const rapportRes = await apiFetch(`/api/rapporter/${id}`);
      if (!rapportRes.ok) throw new Error(`HTTP ${rapportRes.status}`);
      const loadedRapport = await rapportRes.json() as Rapport;

      // Tilgangssjekk: verifiser at bruker har tilgang til minst ett av rapportens workspaces
      if (entraObjectId) {
        const url = new URL(`${API}/api/workspaces`);
        if (grupper.length > 0) url.searchParams.set('grupper', grupper.join(','));

        const wsRes = await apiFetch(url.pathname + url.search, { headers: authHeaders });
        const accessible = await wsRes.json() as { id: string }[];
        const wsIds      = loadedRapport.workspaces.map((wr) => wr.workspace.id);

        if (!accessible.some((ws) => wsIds.includes(ws.id))) {
          router.replace('/dashboard');
          return;
        }
      }

      // Sjekk om dette er en designer-rapport (flagget returneres direkte fra /api/rapporter/:id)
      console.log('[RapportPage] erDesignerRapport:', loadedRapport.erDesignerRapport, '| pbiReportId:', loadedRapport.pbiReportId || '(tom)');
      if (loadedRapport.erDesignerRapport) {
        console.log('[RapportPage] omdirigerer til rapport-interaktiv (designer)');
        router.replace(`/dashboard/rapport-interaktiv?rapportId=${loadedRapport.id}&fraLagret=true`);
        return;
      }

      // Hent brukerens rolle for å avgjøre om "Lag rapport"-knappen skal vises
      if (entraObjectId) {
        try {
          const megRes = await apiFetch('/api/meg', { headers: authHeaders, credentials: 'include' });
          if (megRes.ok) {
            const meg = await megRes.json() as { rolle?: string; chatAktivert?: boolean };
            console.log('[RapportPage] meg.rolle:', meg?.rolle);
            const r = meg.rolle ?? '';
            setBrukerRolleState(r);
            setKanLageRapport(['admin', 'tenantadmin'].includes(r) || r === 'redaktør');
            setBrukerChatAktivert(meg.chatAktivert !== false);
          }
        } catch { /* ikke kritisk */ }
      }

      console.log('[RapportPage] rapport fra API:', loadedRapport);
      console.log('[RapportPage] props til PowerBIReport:', {
        pbiReportId: loadedRapport.pbiReportId,
        pbiDatasetId: loadedRapport.pbiDatasetId,
        pbiWorkspaceId: loadedRapport.pbiWorkspaceId,
      });
      setRapport(loadedRapport);
      loggHendelse(
        { hendelsesType: 'åpnet_rapport', referanseId: loadedRapport.id, referanseNavn: loadedRapport.navn },
        authHeaders,
      );
    }

    load().catch(() => setError('Rapporten ble ikke funnet eller du har ikke tilgang.'));
  }, [id, isAuthenticated, router, entraObjectId, authHeaders, grupper]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-md">
          <h2 className="text-red-700 font-semibold mb-2">Ingen tilgang</h2>
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!rapport) return null;

  console.log('[RapportPage] AIChat props:', {
    rapportId:   rapport?.id,
    pbiReportId: rapport?.pbiReportId,
    rapportNavn: rapport?.navn,
  });

  return (
    <div className="h-full overflow-hidden" style={{ position: 'relative', width: '100%', height: '100%' }}>
      <PowerBIReport
        rapportId={rapport.id}
        portalWorkspaceId={rapport.workspaces[0]?.workspace.id}
        brukerRolle={brukerRolleState}
        pbiReportId={rapport.pbiReportId}
        pbiDatasetId={rapport.pbiDatasetId}
        pbiWorkspaceId={rapport.pbiWorkspaceId}
        filterConfig={filterConfig}
        slicerConfig={slicerConfig}
        clearSlicerTitle={clearSlicerTitle}
        onSlicersLoaded={setSlicers}
        onSlicerValuesLoaded={setSlicerValues}
        onActiveStateChange={setActiveSlicerState}
        onTablesLoaded={setAvailableTables}
        onAktivSideChange={setAktivSide}
        onRegisterGetVisualData={(fn) => { getVisualsDataRef.current = fn; }}
      />
      {lisens.chatAktivert && brukerChatAktivert === true && (
        <AIChat
          entraObjectId={entraObjectId}
          grupper={grupper}
          rapportId={rapport.id}
          pbiReportId={rapport.pbiReportId}
          rapportNavn={rapport.navn}
          slicers={slicers}
          slicerValues={slicerValues}
          activeSlicerState={activeSlicerState}
          availableTables={availableTables}
          aktivSide={aktivSide}
          onSetFilter={setFilterConfig}
          onSetSlicer={setSlicerConfig}
          onClearSlicer={setClearSlicerTitle}
          getVisualsData={() => getVisualsDataRef.current?.() ?? Promise.resolve({})}
        />
      )}

      {/* Flytende Lag rapport-knapp — over chat-knappen */}
      {kanLageRapport && (
        <div style={{ position: 'fixed', bottom: 92, right: 24, zIndex: 9998 }}>
          <button
            type="button"
            onClick={() => setVisLagRapportModal(true)}
            title="Lag rapport"
            style={{
              width: 48, height: 48, borderRadius: '50%',
              background: 'var(--gold)',
              border: 'none', color: 'var(--navy-darkest)',
              fontSize: 24, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 16px var(--gold-dim)',
              transition: 'all 0.2s', lineHeight: 1,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.1)';
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 6px 20px var(--gold-dim)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 16px var(--gold-dim)';
            }}
          >
            +
          </button>
        </div>
      )}

      {visLagRapportModal && (() => {
        const ws = rapport.workspaces[0]?.workspace;
        return (
          <LagRapportModal
            rapportId={rapport.id}
            rapportNavn={rapport.navn}
            prosjektNr={ws?.navn.match(/\b(\d{4,5})\b/)?.[1] ?? null}
            authHeaders={authHeaders}
            onLukk={() => setVisLagRapportModal(false)}
            kontekstType={ws?.kontekstType ?? null}
            kontekstKolonne={ws?.kontekstKolonne ?? null}
            kontekstVerdi={ws?.kontekstVerdi ?? null}
            kontekstLabel={ws?.kontekstLabel ?? null}
          />
        );
      })()}
    </div>
  );
}
