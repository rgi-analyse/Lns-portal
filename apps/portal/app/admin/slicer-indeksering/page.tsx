'use client';

/**
 * Admin-side: oversikt over slicer-indeks-konfigurasjoner.
 * Bruker glassmorphic dark-stil — matcher /admin/page.tsx (admin overview).
 * Tabell-komponent fra components/ui/ — matcher /admin/workspaces.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useMsal } from '@azure/msal-react';
import {
  AlertCircle, Database, FileBarChart2, Layers, MoreVertical,
  Pencil, Play, Plus, RefreshCw, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogFooter } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { adminApi, formaterAlder, type SlicerKonfigKort, type ForslagRespons } from './_lib';

// ── Stat-kort ──────────────────────────────────────────────────────────

interface StatKortProps {
  label:      string;
  value:      string | number | null;
  icon:       React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  iconBg:     string;
  iconBorder: string;
  iconColor:  string;
}

function StatKort({ label, value, icon: Icon, iconBg, iconBorder, iconColor }: StatKortProps) {
  return (
    <div
      className="rounded-2xl p-5 flex items-center gap-4"
      style={{
        background: 'var(--glass-bg)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid var(--glass-bg-hover)',
      }}
    >
      <div
        className="w-11 h-11 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: iconBg, border: `1px solid ${iconBorder}` }}
      >
        <Icon className="w-5 h-5" style={{ color: iconColor }} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: 'var(--text-muted)' }}>
          {label}
        </p>
        <p
          className="truncate"
          style={{
            fontFamily: 'Barlow Condensed, sans-serif',
            fontWeight: 800,
            fontSize: 24,
            color: 'var(--text-primary)',
            lineHeight: 1.1,
            marginTop: 2,
          }}
        >
          {value === null
            ? <span className="inline-block w-12 h-6 rounded animate-pulse" style={{ background: 'var(--glass-bg-hover)' }} />
            : value}
        </p>
      </div>
    </div>
  );
}

// ── Tre-prikks-meny ────────────────────────────────────────────────────

interface RadMeny {
  pos:       { x: number; y: number };
  konfigId:  string;
  erAktiv:   boolean;
}

// ── Hovedkomponent ─────────────────────────────────────────────────────

const ETT_DØGN_MS = 24 * 60 * 60 * 1000;

export default function SlicerIndekseringPage() {
  const { accounts } = useMsal();
  const entraObjectId = accounts[0]?.localAccountId ?? '';

  const [konfiger, setKonfiger]   = useState<SlicerKonfigKort[] | null>(null);
  const [forslag, setForslag]     = useState<ForslagRespons | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [meny, setMeny]           = useState<RadMeny | null>(null);
  const [slettId, setSlettId]     = useState<string | null>(null);
  const [arbeider, setArbeider]   = useState<string | null>(null);

  const lastInn = useCallback(async () => {
    if (!entraObjectId) return;
    setError(null);
    try {
      const [k, f] = await Promise.all([
        adminApi.list(entraObjectId),
        adminApi.forslag(entraObjectId).catch(() => null),
      ]);
      setKonfiger(k);
      setForslag(f);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ukjent feil');
    }
  }, [entraObjectId]);

  useEffect(() => { lastInn(); }, [lastInn]);

  // Lukk meny ved klikk utenfor
  useEffect(() => {
    if (!meny) return;
    const lukk = () => setMeny(null);
    document.addEventListener('click', lukk);
    document.addEventListener('scroll', lukk, true);
    return () => {
      document.removeEventListener('click', lukk);
      document.removeEventListener('scroll', lukk, true);
    };
  }, [meny]);

  const håndterIndekser = async (id: string) => {
    setArbeider(id);
    setMeny(null);
    try {
      const r = await adminApi.indekser(entraObjectId, id);
      toast({
        title: `Indeksert: ${r.slicer_tittel}`,
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

  const håndterAktiv = async (id: string, nyAktiv: boolean) => {
    setArbeider(id);
    setMeny(null);
    try {
      await adminApi.oppdater(entraObjectId, id, { er_aktiv: nyAktiv });
      toast({ title: nyAktiv ? 'Aktivert' : 'Deaktivert', variant: 'success' });
      lastInn();
    } catch (err) {
      toast({ title: 'Kunne ikke endre status', description: err instanceof Error ? err.message : undefined, variant: 'destructive' });
    } finally {
      setArbeider(null);
    }
  };

  const håndterSlett = async () => {
    if (!slettId) return;
    setArbeider(slettId);
    try {
      const r = await adminApi.slett(entraObjectId, slettId);
      toast({
        title: 'Slettet',
        description: `${r.indeks_dokumenter_slettet} søke-dokumenter ryddet bort.`,
        variant: 'success',
      });
      setSlettId(null);
      lastInn();
    } catch (err) {
      toast({ title: 'Sletting feilet', description: err instanceof Error ? err.message : undefined, variant: 'destructive' });
    } finally {
      setArbeider(null);
    }
  };

  // Stats
  const aktive  = konfiger?.filter((k) => k.er_aktiv) ?? [];
  const stats = konfiger === null ? null : {
    aktive:           aktive.length,
    totale_verdier:   aktive.reduce((s, k) => s + (k.sist_antall_rader ?? 0), 0),
    sist_indeksert:   aktive
      .map((k) => k.sist_indeksert)
      .filter((s): s is string => s !== null)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null,
    trenger:          aktive.filter((k) =>
      !k.sist_indeksert || (Date.now() - new Date(k.sist_indeksert).getTime() > ETT_DØGN_MS),
    ).length,
  };

  const slettKonfig = slettId ? konfiger?.find((k) => k.id === slettId) ?? null : null;

  return (
    <div className="p-8 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1
            className="uppercase tracking-wide"
            style={{
              fontFamily: 'Barlow Condensed, sans-serif',
              fontWeight: 800,
              fontSize: 24,
              color: 'var(--text-primary)',
            }}
          >
            Slicer-indeksering
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            Indekser slicer-verdier i Azure AI Search slik at AI kan finne riktig verdi for alle slicere — også de med flere enn 50 verdier.
          </p>
        </div>
        <Button size="sm">
          <Link href="/admin/slicer-indeksering/ny" className="flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Ny konfigurasjon
          </Link>
        </Button>
      </div>

      {/* Stat-kort */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatKort
          label="Aktive konfig" value={stats?.aktive ?? null}
          icon={Layers}
          iconBg="var(--glass-gold-bg)" iconBorder="var(--glass-gold-border)" iconColor="var(--gold)"
        />
        <StatKort
          label="Totalt indeksert" value={stats?.totale_verdier ?? null}
          icon={Database}
          iconBg="rgba(27,42,74,0.60)" iconBorder="var(--glass-border)" iconColor="var(--text-secondary)"
        />
        <StatKort
          label="Sist indeksert" value={stats?.sist_indeksert ? formaterAlder(stats.sist_indeksert) : '–'}
          icon={RefreshCw}
          iconBg="rgba(16,185,129,0.10)" iconBorder="rgba(16,185,129,0.20)" iconColor="rgba(110,231,183,0.9)"
        />
        <StatKort
          label="Trenger reindeks" value={stats?.trenger ?? null}
          icon={AlertCircle}
          iconBg="rgba(245,158,11,0.10)" iconBorder="rgba(245,158,11,0.25)" iconColor="rgba(252,211,77,0.95)"
        />
      </div>

      {/* Forslags-banner */}
      {forslag && forslag.rapporter_uten_konfig.length > 0 && (
        <div
          className="rounded-xl p-4 mb-6 flex items-start gap-3"
          style={{
            background: 'rgba(245,158,11,0.08)',
            border: '1px solid rgba(245,158,11,0.25)',
          }}
        >
          <FileBarChart2 className="w-5 h-5 mt-0.5 shrink-0" style={{ color: 'rgba(252,211,77,0.95)' }} />
          <div className="flex-1 text-sm" style={{ color: 'var(--text-primary)' }}>
            <strong>{forslag.rapporter_uten_konfig.length} rapport(er)</strong> har ennå ingen indekserte slicere.
            <span style={{ color: 'var(--text-muted)' }}>
              {' '}Åpne en av dem og legg til en konfigurasjon — AI får da hjelp til verdier utenfor de 50 synlige.
            </span>
            <details className="mt-2">
              <summary className="cursor-pointer text-xs hover:underline" style={{ color: 'var(--text-secondary)' }}>
                Vis liste
              </summary>
              <ul className="mt-2 space-y-1 text-xs">
                {forslag.rapporter_uten_konfig.slice(0, 20).map((r) => (
                  <li key={r.id} style={{ color: 'var(--text-secondary)' }}>
                    • {r.navn}{r.område ? ` — ${r.område}` : ''}
                  </li>
                ))}
                {forslag.rapporter_uten_konfig.length > 20 && (
                  <li style={{ color: 'var(--text-muted)' }}>… og {forslag.rapporter_uten_konfig.length - 20} til</li>
                )}
              </ul>
            </details>
          </div>
        </div>
      )}

      {/* Feil / loading / empty / tabell */}
      {error ? (
        <div className="rounded-xl p-6" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
          <p className="text-sm font-medium" style={{ color: 'rgba(252,165,165,0.95)' }}>Kunne ikke laste konfigurasjoner</p>
          <p className="text-xs mt-1" style={{ color: 'rgba(252,165,165,0.7)' }}>{error}</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => lastInn()}>
            Prøv igjen
          </Button>
        </div>
      ) : konfiger === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
        </div>
      ) : konfiger.length === 0 ? (
        <div
          className="rounded-2xl p-10 text-center"
          style={{
            background: 'var(--glass-bg)',
            border: '1px solid var(--glass-bg-hover)',
          }}
        >
          <Layers className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Du har ingen indekserte slicere ennå
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            Opprett din første nå — det tar et minutt og lærer AI alle verdiene i sliceren.
          </p>
          <Button size="sm" className="mt-4">
            <Link href="/admin/slicer-indeksering/ny">Opprett første konfigurasjon</Link>
          </Button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rapport</TableHead>
                <TableHead>Slicer</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Antall</TableHead>
                <TableHead>Sist</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Handlinger</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {konfiger.map((k) => {
                const trenger = k.er_aktiv && (!k.sist_indeksert || Date.now() - new Date(k.sist_indeksert).getTime() > ETT_DØGN_MS);
                return (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium text-gray-900">
                      <Link href={`/admin/slicer-indeksering/${k.id}`} className="hover:underline">
                        {k.rapport_navn ?? <span className="text-gray-400 italic">(ukjent)</span>}
                      </Link>
                    </TableCell>
                    <TableCell className="text-gray-700">{k.slicer_tittel}</TableCell>
                    <TableCell>
                      <Badge variant={k.slicer_type === 'hierarchy' ? 'default' : 'secondary'}>
                        {k.slicer_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-gray-700">
                      {k.sist_antall_rader ?? '–'}
                    </TableCell>
                    <TableCell className="text-gray-500 text-sm whitespace-nowrap">
                      {formaterAlder(k.sist_indeksert)}
                    </TableCell>
                    <TableCell>
                      {!k.er_aktiv ? (
                        <Badge variant="secondary" className="bg-gray-100 text-gray-600">deaktivert</Badge>
                      ) : trenger ? (
                        <Badge className="bg-amber-100 text-amber-700 border border-amber-200">trenger reindeks</Badge>
                      ) : (
                        <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-200">ok</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                          setMeny({
                            konfigId: k.id,
                            erAktiv:  k.er_aktiv,
                            pos:      { x: rect.right, y: rect.bottom + 4 },
                          });
                        }}
                        disabled={arbeider === k.id}
                        className="inline-flex items-center justify-center h-8 w-8 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors disabled:opacity-40"
                        aria-label="Flere handlinger"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Tre-prikks-meny (fixed positioned) */}
      {meny && (
        <div
          className="fixed z-50 min-w-[180px] rounded-lg shadow-lg border bg-white py-1"
          style={{ left: meny.pos.x - 180, top: meny.pos.y, borderColor: '#e5e7eb' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => håndterIndekser(meny.konfigId)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-gray-700 hover:bg-gray-100"
          >
            <Play className="w-3.5 h-3.5" /> Re-indekser nå
          </button>
          <Link
            href={`/admin/slicer-indeksering/${meny.konfigId}`}
            onClick={() => setMeny(null)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
          >
            <Pencil className="w-3.5 h-3.5" /> Vis detaljer
          </Link>
          <button
            onClick={() => håndterAktiv(meny.konfigId, !meny.erAktiv)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-gray-700 hover:bg-gray-100"
          >
            <RefreshCw className="w-3.5 h-3.5" /> {meny.erAktiv ? 'Deaktivér' : 'Aktivér'}
          </button>
          <div className="my-1 border-t" style={{ borderColor: '#e5e7eb' }} />
          <button
            onClick={() => { setSlettId(meny.konfigId); setMeny(null); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-red-600 hover:bg-red-50"
          >
            <Trash2 className="w-3.5 h-3.5" /> Slett
          </button>
        </div>
      )}

      {/* Slett-bekreftelse */}
      <Dialog
        open={slettId !== null}
        onClose={() => setSlettId(null)}
        title="Slett indekserings-konfigurasjon?"
      >
        <p className="text-sm text-gray-700">
          Sletter konfig for <strong>{slettKonfig?.slicer_tittel}</strong> i {slettKonfig?.rapport_navn ?? '(ukjent rapport)'}.
          Alle relaterte dokumenter i Azure AI Search ryddes også. Handlingen kan ikke angres.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setSlettId(null)} disabled={arbeider === slettId}>Avbryt</Button>
          <Button variant="destructive" onClick={håndterSlett} disabled={arbeider === slettId}>
            {arbeider === slettId ? 'Sletter…' : 'Slett'}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
