'use client';

/**
 * Detalj-side for én slicer-indeks-konfig.
 * Viser metadata, DAX, og knapp-rad: Re-indekser, Rediger, Deaktiver/Aktivér, Slett.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMsal } from '@azure/msal-react';
import {
  ArrowLeft, Database, Loader2, Pencil, Play, Power, RefreshCw, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogFooter } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { adminApi, formaterAlder, type SlicerKonfigDetalj } from '../_lib';

const ETT_DØGN_MS = 24 * 60 * 60 * 1000;

interface RedigerForm {
  slicer_type:      'basic' | 'hierarchy';
  tabell:           string;
  verdi_kolonne:    string;
  forelder_kolonne: string;
}

/** Parse "tabell[kolonne]" → { tabell, kolonne } */
function parseFq(fq: string | null | undefined): { tabell: string; kolonne: string } | null {
  if (!fq) return null;
  const m = fq.match(/^(.+)\[([^\]]+)\]$/);
  return m ? { tabell: m[1], kolonne: m[2] } : null;
}

export default function SlicerKonfigDetaljPage() {
  const router = useRouter();
  const { id }  = useParams<{ id: string }>();
  const { accounts } = useMsal();
  const entraObjectId = accounts[0]?.localAccountId ?? '';

  const [konfig, setKonfig] = useState<SlicerKonfigDetalj | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [arbeider, setArbeider] = useState<'indekser' | 'aktiv' | 'slett' | 'lagre' | null>(null);
  const [visRediger, setVisRediger] = useState(false);
  const [visSlett, setVisSlett]     = useState(false);
  const [redigerForm, setRedigerForm] = useState<RedigerForm | null>(null);

  const lastInn = useCallback(async () => {
    if (!entraObjectId || !id) return;
    setError(null);
    try {
      const k = await adminApi.detalj(entraObjectId, id);
      setKonfig(k);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ukjent feil');
    }
  }, [entraObjectId, id]);

  useEffect(() => { lastInn(); }, [lastInn]);

  // Når rediger-modalen åpnes, fyll inn fra eksisterende konfig
  useEffect(() => {
    if (visRediger && konfig) {
      const verdi = parseFq(konfig.verdi_kolonne);
      const forelder = parseFq(konfig.forelder_kolonne);
      setRedigerForm({
        slicer_type:      konfig.slicer_type,
        tabell:           verdi?.tabell ?? forelder?.tabell ?? '',
        verdi_kolonne:    verdi?.kolonne ?? '',
        forelder_kolonne: forelder?.kolonne ?? '',
      });
    }
  }, [visRediger, konfig]);

  const håndterIndekser = async () => {
    if (!konfig) return;
    setArbeider('indekser');
    try {
      const r = await adminApi.indekser(entraObjectId, konfig.id);
      toast({
        title: 'Indeksert',
        description: `${r.antall_rader} rader på ${r.dax_ms + r.indeks_ms}ms`,
        variant: 'success',
      });
      lastInn();
    } catch (err) {
      toast({ title: 'Indeksering feilet', description: err instanceof Error ? err.message : undefined, variant: 'destructive' });
    } finally {
      setArbeider(null);
    }
  };

  const håndterAktiv = async () => {
    if (!konfig) return;
    setArbeider('aktiv');
    try {
      await adminApi.oppdater(entraObjectId, konfig.id, { er_aktiv: !konfig.er_aktiv });
      toast({ title: konfig.er_aktiv ? 'Deaktivert' : 'Aktivert', variant: 'success' });
      lastInn();
    } catch (err) {
      toast({ title: 'Kunne ikke endre status', description: err instanceof Error ? err.message : undefined, variant: 'destructive' });
    } finally {
      setArbeider(null);
    }
  };

  const håndterLagre = async () => {
    if (!konfig || !redigerForm) return;
    if (!redigerForm.tabell.trim() || !redigerForm.verdi_kolonne.trim()) {
      toast({ title: 'Tabell og verdi-kolonne er påkrevd', variant: 'destructive' });
      return;
    }
    if (redigerForm.slicer_type === 'hierarchy' && !redigerForm.forelder_kolonne.trim()) {
      toast({ title: 'Hierarchy krever forelder-kolonne', variant: 'destructive' });
      return;
    }
    setArbeider('lagre');
    try {
      await adminApi.oppdater(entraObjectId, konfig.id, {
        slicer_type:      redigerForm.slicer_type,
        tabell:           redigerForm.tabell.trim(),
        verdi_kolonne:    redigerForm.verdi_kolonne.trim(),
        forelder_kolonne: redigerForm.slicer_type === 'hierarchy'
          ? redigerForm.forelder_kolonne.trim()
          : null,
      });
      toast({
        title: 'Endringer lagret',
        description: 'Husk å re-indeksere for å bruke ny DAX.',
        variant: 'success',
      });
      setVisRediger(false);
      lastInn();
    } catch (err) {
      toast({ title: 'Kunne ikke lagre', description: err instanceof Error ? err.message : undefined, variant: 'destructive' });
    } finally {
      setArbeider(null);
    }
  };

  const håndterSlett = async () => {
    if (!konfig) return;
    setArbeider('slett');
    try {
      const r = await adminApi.slett(entraObjectId, konfig.id);
      toast({
        title: 'Slettet',
        description: `${r.indeks_dokumenter_slettet} søke-dokumenter ryddet bort.`,
        variant: 'success',
      });
      router.push('/admin/slicer-indeksering');
    } catch (err) {
      toast({ title: 'Sletting feilet', description: err instanceof Error ? err.message : undefined, variant: 'destructive' });
      setArbeider(null);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="p-8 max-w-3xl">
        <Link
          href="/admin/slicer-indeksering"
          className="inline-flex items-center gap-1.5 text-sm mb-4"
          style={{ color: 'var(--text-muted)' }}
        >
          <ArrowLeft className="w-4 h-4" /> Tilbake til oversikt
        </Link>
        <div className="rounded-xl p-6" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
          <p className="text-sm font-medium" style={{ color: 'rgba(252,165,165,0.95)' }}>Kunne ikke laste konfigurasjon</p>
          <p className="text-xs mt-1" style={{ color: 'rgba(252,165,165,0.7)' }}>{error}</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => lastInn()}>Prøv igjen</Button>
        </div>
      </div>
    );
  }

  if (!konfig) {
    return (
      <div className="p-8 max-w-3xl space-y-3">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  const trenger = konfig.er_aktiv && (!konfig.sist_indeksert
    || Date.now() - new Date(konfig.sist_indeksert).getTime() > ETT_DØGN_MS);

  return (
    <div className="p-8 max-w-3xl">
      {/* Brødsmuler */}
      <div className="flex items-center gap-1.5 text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
        <Link href="/admin" className="hover:underline">Admin</Link>
        <span>/</span>
        <Link href="/admin/slicer-indeksering" className="hover:underline">Slicer-indeksering</Link>
        <span>/</span>
        <span style={{ color: 'var(--text-secondary)' }}>{konfig.rapport_navn ?? '(ukjent)'}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h1
            className="uppercase tracking-wide truncate"
            style={{
              fontFamily: 'Barlow Condensed, sans-serif',
              fontWeight: 800,
              fontSize: 24,
              color: 'var(--text-primary)',
            }}
          >
            {konfig.slicer_tittel}
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={konfig.slicer_type === 'hierarchy' ? 'default' : 'secondary'}>
              {konfig.slicer_type}
            </Badge>
            {!konfig.er_aktiv ? (
              <Badge variant="secondary" className="bg-gray-100 text-gray-600">deaktivert</Badge>
            ) : trenger ? (
              <Badge className="bg-amber-100 text-amber-700 border border-amber-200">trenger reindeks</Badge>
            ) : (
              <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-200">ok</Badge>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Button size="sm" onClick={håndterIndekser} disabled={!konfig.er_aktiv || arbeider !== null}>
            {arbeider === 'indekser' ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Play className="w-3.5 h-3.5 mr-1.5" />}
            Re-indekser
          </Button>
          <Button size="sm" variant="outline" onClick={() => setVisRediger(true)} disabled={arbeider !== null}>
            <Pencil className="w-3.5 h-3.5 mr-1.5" /> Rediger
          </Button>
          <Button size="sm" variant="outline" onClick={håndterAktiv} disabled={arbeider !== null}>
            {arbeider === 'aktiv' ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Power className="w-3.5 h-3.5 mr-1.5" />}
            {konfig.er_aktiv ? 'Deaktiver' : 'Aktiver'}
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setVisSlett(true)} disabled={arbeider !== null}>
            <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Slett
          </Button>
        </div>
      </div>

      {/* Stat-kort */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Antall verdier', value: konfig.sist_antall_rader ?? '–', icon: Database },
          { label: 'Sist indeksert', value: formaterAlder(konfig.sist_indeksert), icon: RefreshCw },
          { label: 'Aktiv', value: konfig.er_aktiv ? 'Ja' : 'Nei', icon: Power },
        ].map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className="rounded-xl p-4 flex items-center gap-3"
            style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-bg-hover)' }}
          >
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: 'rgba(27,42,74,0.60)', border: '1px solid var(--glass-border)' }}
            >
              <Icon className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: 'var(--text-muted)' }}>{label}</p>
              <p className="text-base font-semibold" style={{ color: 'var(--text-primary)', lineHeight: 1.2 }}>{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Konfigurasjon */}
      <div
        className="rounded-xl p-5 mb-6"
        style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-bg-hover)' }}
      >
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-secondary)' }}>
          Konfigurasjon
        </h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {[
            ['Rapport',          konfig.rapport_navn ?? '(ukjent)'],
            ['Rapport-ID',       konfig.rapport_id],
            ['Slicer-tittel',    konfig.slicer_tittel],
            ['Type',             konfig.slicer_type],
            ['Workspace-ID',     konfig.workspace_id],
            ['Dataset-ID',       konfig.dataset_id],
            ['Verdi-kolonne',    konfig.verdi_kolonne],
            ['Forelder-kolonne', konfig.forelder_kolonne ?? '–'],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs" style={{ color: 'var(--text-muted)' }}>{k}</dt>
              <dd className="font-mono text-xs truncate" style={{ color: 'var(--text-primary)' }}>{v}</dd>
            </div>
          ))}
        </dl>

        <details className="mt-4">
          <summary className="text-xs cursor-pointer hover:underline" style={{ color: 'var(--text-secondary)' }}>
            Vis DAX-spørring
          </summary>
          <pre
            className="text-xs rounded-md p-3 mt-2 overflow-x-auto whitespace-pre"
            style={{
              background: 'rgba(0,0,0,0.30)',
              border: '1px solid var(--glass-bg-hover)',
              color: 'var(--text-secondary)',
              fontFamily: 'ui-monospace, monospace',
            }}
          >
            {konfig.dax_query}
          </pre>
        </details>
      </div>

      {/* Historikk-placeholder */}
      <div
        className="rounded-xl p-5"
        style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-bg-hover)' }}
      >
        <h2 className="text-sm font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>
          Indekserings-historikk
        </h2>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Historikk kommer i senere versjon. Inntil da: «Sist indeksert» over viser når siste kjøring var.
        </p>
      </div>

      {/* Rediger-dialog */}
      <Dialog
        open={visRediger}
        onClose={() => { if (arbeider !== 'lagre') setVisRediger(false); }}
        title="Rediger konfigurasjon"
        className="max-w-lg"
      >
        {redigerForm && (
          <div className="space-y-4">
            <p className="text-xs text-gray-500">
              Endring av tabell eller kolonner krever ny indeksering. Bruk Re-indekser etter lagring.
            </p>
            <div>
              <Label>Type</Label>
              <div className="flex gap-2 mt-1">
                {(['basic', 'hierarchy'] as const).map((t) => (
                  <label
                    key={t}
                    className={`flex-1 text-center cursor-pointer rounded-md border px-3 py-2 text-sm ${
                      redigerForm.slicer_type === t
                        ? 'bg-amber-50 border-amber-300 text-amber-900 font-medium'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      checked={redigerForm.slicer_type === t}
                      onChange={() => setRedigerForm({ ...redigerForm, slicer_type: t })}
                      className="sr-only"
                    />
                    {t}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="r_tabell">Tabell <span className="text-red-500">*</span></Label>
              <Input
                id="r_tabell"
                value={redigerForm.tabell}
                onChange={(e) => setRedigerForm({ ...redigerForm, tabell: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="r_verdi">Verdi-kolonne <span className="text-red-500">*</span></Label>
              <Input
                id="r_verdi"
                value={redigerForm.verdi_kolonne}
                onChange={(e) => setRedigerForm({ ...redigerForm, verdi_kolonne: e.target.value })}
              />
            </div>
            {redigerForm.slicer_type === 'hierarchy' && (
              <div>
                <Label htmlFor="r_forelder">Forelder-kolonne <span className="text-red-500">*</span></Label>
                <Input
                  id="r_forelder"
                  value={redigerForm.forelder_kolonne}
                  onChange={(e) => setRedigerForm({ ...redigerForm, forelder_kolonne: e.target.value })}
                />
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setVisRediger(false)} disabled={arbeider === 'lagre'}>Avbryt</Button>
          <Button onClick={håndterLagre} disabled={arbeider === 'lagre'}>
            {arbeider === 'lagre' ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Lagrer…</> : 'Lagre'}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Slett-bekreftelse */}
      <Dialog
        open={visSlett}
        onClose={() => { if (arbeider !== 'slett') setVisSlett(false); }}
        title="Slett indekserings-konfigurasjon?"
      >
        <p className="text-sm text-gray-700">
          Sletter konfig for <strong>{konfig.slicer_tittel}</strong> i {konfig.rapport_navn ?? '(ukjent rapport)'}.
          Alle relaterte dokumenter i Azure AI Search ryddes også. Handlingen kan ikke angres.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setVisSlett(false)} disabled={arbeider === 'slett'}>Avbryt</Button>
          <Button variant="destructive" onClick={håndterSlett} disabled={arbeider === 'slett'}>
            {arbeider === 'slett' ? 'Sletter…' : 'Slett'}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
