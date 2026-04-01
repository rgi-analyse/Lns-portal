'use client';

export const dynamic = 'force-dynamic';

import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { Report } from 'powerbi-client';
import { ArrowLeft, Save, Trash2, Loader2 } from 'lucide-react';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { apiFetch } from '@/lib/apiClient';

// Visual type mapping: AI forslag → PBI visual type string
const VISUAL_TYPE_MAP: Record<string, string> = {
  bar:   'clusteredBarChart',
  line:  'lineChart',
  table: 'tableEx',
  pie:   'pieChart',
  card:  'card',
  combo: 'lineClusteredColumnComboChart',
};

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function RapportPreviewPage() {
  const params  = useSearchParams();
  const router  = useRouter();
  const { entraObjectId } = usePortalAuth();

  const pbiDatasetId   = params.get('pbiDatasetId')   ?? '';
  const pbiWorkspaceId = params.get('pbiWorkspaceId') ?? '';
  const tittel         = params.get('tittel')         ?? 'Ny rapport';
  const visualType     = params.get('visualType')     ?? '';

  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reportRef    = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pbiRef       = useRef<any>(null);

  const [tokenFeil, setTokenFeil] = useState<string | null>(null);
  const [laster,    setLaster]    = useState(true);
  const [lagrer,    setLagrer]    = useState(false);
  const [lagretId,  setLagretId]  = useState<string | null>(null);

  useEffect(() => {
    if (!pbiDatasetId || !pbiWorkspaceId) {
      setTokenFeil('Mangler dataset- eller workspace-ID i URL.');
      setLaster(false);
      return;
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (entraObjectId) headers['X-Entra-Object-Id'] = entraObjectId;

    apiFetch('/api/pbi/create-token', {
      method: 'POST',
      headers,
      body: JSON.stringify({ pbiDatasetId, pbiWorkspaceId }),
    })
      .then(r => r.json())
      .then(async (data: { token?: string; error?: string }) => {
        if (!data.token) {
          setTokenFeil(data.error ?? 'Kunne ikke hente opprettings-token.');
          return;
        }
        await initCreateReport(data.token);
      })
      .catch(err => setTokenFeil(`Token-feil: ${(err as Error).message}`))
      .finally(() => setLaster(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pbiDatasetId, pbiWorkspaceId, entraObjectId]);

  async function initCreateReport(token: string) {
    if (!containerRef.current) return;

    // Lazy-import powerbi-client (client-only)
    const { service, factories, models } = await import('powerbi-client');

    const powerbiService = new service.Service(
      factories.hpmFactory,
      factories.wpmpFactory,
      factories.routerFactory,
    );
    pbiRef.current = powerbiService;

    const embedConfig = {
      type: 'report',
      datasetId: pbiDatasetId,
      embedUrl: 'https://app.powerbi.com/reportEmbed',
      accessToken: token,
      tokenType: models.TokenType.Embed,
      settings: {
        panes: {
          filters: { visible: false },
          pageNavigation: { visible: false },
        },
        bars: {
          actionBar: { visible: true },
        },
      },
    };

    const rapport = powerbiService.createReport(containerRef.current, embedConfig);
    reportRef.current = rapport;

    // Legg til visual automatisk etter lasting
    rapport.on('loaded', async () => {
      console.log('[Preview] rapport lastet');
      if (!visualType) return;
      const pbiType = VISUAL_TYPE_MAP[visualType] ?? visualType;
      try {
        const pages = await (rapport as Report).getPages();
        const page  = pages[0] as unknown as { addVisual: (type: string, layout: object) => Promise<void> };
        await page.addVisual(pbiType, { x: 20, y: 20, width: 500, height: 350 });
        console.log('[Preview] visual lagt til:', pbiType);
      } catch (err) {
        console.warn('[Preview] Kunne ikke legge til visual automatisk:', err);
      }
    });

    // Registrer i portal DB etter at bruker har lagret via toolbar
    rapport.on('saved', async (event: Event) => {
      const savedData = (event as CustomEvent).detail as { reportObjectId?: string; reportName?: string };
      const pbiReportId = savedData?.reportObjectId;
      const reportNavn  = savedData?.reportName ?? tittel;
      console.log('[Preview] saved event:', savedData);
      if (!pbiReportId) return;

      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (entraObjectId) headers['X-Entra-Object-Id'] = entraObjectId;
        const res = await apiFetch('/api/pbi/register-rapport', {
          method: 'POST',
          headers,
          body: JSON.stringify({ pbiReportId, pbiDatasetId, pbiWorkspaceId, navn: reportNavn }),
        });
        if (res.ok) {
          const data = await res.json() as { id: string };
          setLagretId(data.id);
          router.push(`/dashboard/rapport/${data.id}`);
        }
      } catch (err) {
        console.error('[Preview] register-rapport feil:', err);
      } finally {
        setLagrer(false);
      }
    });
  }

  async function lagreRapport() {
    if (!reportRef.current) return;
    setLagrer(true);
    try {
      // Trigger PBI save — utløser 'saved' event som håndterer navigasjon
      await reportRef.current.save();
    } catch (err) {
      console.error('[Preview] save feil:', err);
      setLagrer(false);
    }
  }

  function forkast() {
    if (containerRef.current && pbiRef.current) {
      try { pbiRef.current.reset(containerRef.current); } catch { /* ignore */ }
    }
    router.back();
  }

  if (tokenFeil) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="rounded-xl p-6 max-w-md" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.20)' }}>
          <p style={{ color: 'rgba(252,165,165,0.9)', fontSize: 14 }}>❌ {tokenFeil}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sub-banner */}
      <div
        className="shrink-0 flex items-center gap-3 px-5 py-2.5"
        style={{
          background: 'var(--gold-dim)',
          borderBottom: '1px solid var(--gold-dim)',
        }}
      >
        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-xs transition-colors"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'; }}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Tilbake
        </button>

        <div style={{ fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700, fontSize: 14, color: 'var(--gold)', letterSpacing: '0.04em' }}>
          ✏️ {tittel}
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>
          Blank rapport med datasett. Bruk Power BI-verktøylinjen til å legge til og redigere visuals, deretter lagre.
        </div>

        <div className="flex-1" />

        {lagretId ? (
          <div style={{ fontSize: 12, color: 'rgba(74,222,128,0.90)' }}>✅ Lagret!</div>
        ) : (
          <>
            <button
              type="button"
              onClick={lagreRapport}
              disabled={lagrer || laster}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'var(--gold-dim)', border: '1px solid var(--gold-dim)', color: 'var(--gold)' }}
              onMouseEnter={(e) => { if (!lagrer && !laster) (e.currentTarget as HTMLButtonElement).style.background = 'var(--gold-dim)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--gold-dim)'; }}
            >
              {lagrer ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {lagrer ? 'Lagrer...' : 'Lagre rapport'}
            </button>

            <button
              type="button"
              onClick={forkast}
              disabled={lagrer}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)' }}
              onMouseEnter={(e) => { if (!lagrer) (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'; }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Forkast
            </button>
          </>
        )}
      </div>

      {/* PBI createReport container */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {laster && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(10,18,35,0.85)' }}>
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--gold)' }} />
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Kobler til datasett...</p>
            </div>
          </div>
        )}
        <div
          ref={containerRef}
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  );
}
