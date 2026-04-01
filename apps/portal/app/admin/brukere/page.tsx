'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { UserPlus, Download, KeyRound, Eye, EyeOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogFooter } from '@/components/ui/dialog';
import { Tooltip } from '@/components/ui/tooltip';
import { toast } from '@/components/ui/toast';
import { usePortalAuth } from '@/hooks/usePortalAuth';
import { apiFetch } from '@/lib/apiClient';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Rolle = 'tenantadmin' | 'admin' | 'redaktør' | 'bruker';
const ROLLER: { value: Rolle; label: string }[] = [
  { value: 'tenantadmin', label: 'Tenant Admin' },
  { value: 'admin',       label: 'Admin' },
  { value: 'redaktør',    label: 'Redaktør' },
  { value: 'bruker',      label: 'Bruker' },
];

interface Bruker {
  id:            string;
  entraObjectId: string;
  displayName:   string | null;
  email:         string | null;
  erAktiv:       boolean;
  lisensType:    string;
  rolle:         string;
  erEntraBruker: boolean;
  opprettet:     string;
  sistInnlogget: string | null;
}

interface GraphUser {
  id:                 string;
  displayName:        string;
  mail:               string | null;
  userPrincipalName:  string;
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function rolleLabel(rolle: string) {
  return ROLLER.find((r) => r.value === rolle)?.label ?? rolle;
}

export default function BrukerAdminPage() {
  const { authHeaders, rolle: innloggetRolle } = usePortalAuth();

  const tilgjengeligeRoller = innloggetRolle === 'tenantadmin'
    ? ROLLER
    : ROLLER.filter(r => r.value !== 'tenantadmin');

  const [brukere,  setBrukere]  = useState<Bruker[]>([]);
  const [loading,  setLoading]  = useState(true);

  // Importer Entra-dialog
  const [entraOpen,     setEntraOpen]     = useState(false);
  const [søk,           setSøk]           = useState('');
  const [søkResultater, setSøkResultater] = useState<GraphUser[]>([]);
  const [søkLaster,     setSøkLaster]     = useState(false);
  const [valgte,        setValgte]        = useState<Map<string, Rolle>>(new Map());
  const [importerer,    setImporterer]    = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ny lokal bruker-dialog
  const [lokalOpen,       setLokalOpen]       = useState(false);
  const [lokalNavn,       setLokalNavn]       = useState('');
  const [lokalEpost,      setLokalEpost]      = useState('');
  const [lokalPassord,    setLokalPassord]    = useState('');
  const [visLokalPassord, setVisLokalPassord] = useState(false);
  const [lokalRolle,      setLokalRolle]      = useState<Rolle>('bruker');
  const [lokalMåBytte,    setLokalMåBytte]    = useState(true);
  const [lokalFeil,       setLokalFeil]       = useState<string | null>(null);
  const [oppretter,       setOppretter]       = useState(false);

  // Reset passord-dialog
  const [resetBruker,    setResetBruker]    = useState<Bruker | null>(null);
  const [resetPassord,   setResetPassord]   = useState('');
  const [visReset,       setVisReset]       = useState(false);
  const [resetFeil,      setResetFeil]      = useState<string | null>(null);
  const [resetter,       setResetter]       = useState(false);

  useEffect(() => {
    apiFetch('/api/admin/brukere', { headers: authHeaders })
      .then((r) => r.json())
      .then((data: Bruker[]) => setBrukere(data))
      .catch(() => setBrukere([]))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authHeaders['X-Entra-Object-Id']]);

  const patch = useCallback(async (bruker: Bruker, data: Partial<Pick<Bruker, 'erAktiv' | 'rolle'>>) => {
    const snapshot = { ...bruker };
    setBrukere((prev) => prev.map((b) => (b.id === bruker.id ? { ...b, ...data } : b)));
    try {
      const res = await apiFetch(`/api/admin/brukere/${bruker.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body:    JSON.stringify(data),
      });
      if (!res.ok) throw new Error();
      const oppdatert: Bruker = await res.json();
      setBrukere((prev) => prev.map((b) => (b.id === bruker.id ? oppdatert : b)));
    } catch {
      setBrukere((prev) => prev.map((b) => (b.id === bruker.id ? snapshot : b)));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authHeaders['X-Entra-Object-Id']]);

  // ── Entra-søk (debounced) ──────────────────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!søk.trim()) { setSøkResultater([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSøkLaster(true);
      try {
        const res = await apiFetch(`/api/graph/search/brukere?q=${encodeURIComponent(søk.trim())}`, { headers: authHeaders });
        const data: GraphUser[] = await res.json();
        setSøkResultater(data);
      } catch {
        setSøkResultater([]);
      } finally {
        setSøkLaster(false);
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [søk]);

  const toggleValgt = (id: string) => {
    setValgte((prev) => {
      const next = new Map(prev);
      if (next.has(id)) { next.delete(id); } else { next.set(id, 'bruker'); }
      return next;
    });
  };

  const setValgRolle = (id: string, rolle: Rolle) => {
    setValgte((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.set(id, rolle);
      return next;
    });
  };

  const importer = async () => {
    if (valgte.size === 0) return;
    setImporterer(true);
    try {
      const res = await apiFetch('/api/admin/brukere/importer', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body:    JSON.stringify({
          brukere: Array.from(valgte.entries()).map(([entraObjectId, rolle]) => ({ entraObjectId, rolle })),
        }),
      });
      if (!res.ok) throw new Error();
      const importerte: Bruker[] = await res.json();
      setBrukere((prev) => {
        const map = new Map(prev.map((b) => [b.id, b]));
        importerte.forEach((b) => map.set(b.id, b));
        return Array.from(map.values()).sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? '', 'nb'));
      });
      lukkEntra();
    } catch {
      // dialog forblir åpen
    } finally {
      setImporterer(false);
    }
  };

  const lukkEntra = () => { setEntraOpen(false); setSøk(''); setSøkResultater([]); setValgte(new Map()); };

  // ── Opprett lokal bruker ──────────────────────────────────────────────────
  const opprettLokal = async (e: React.FormEvent) => {
    e.preventDefault();
    setLokalFeil(null);
    setOppretter(true);
    try {
      const res = await apiFetch('/api/admin/brukere/lokal', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body:    JSON.stringify({
          displayName:    lokalNavn.trim(),
          email:          lokalEpost.trim().toLowerCase(),
          passord:        lokalPassord,
          rolle:          lokalRolle,
          måByttePassord: lokalMåBytte,
        }),
      });
      const data = await res.json() as Bruker & { error?: string };
      if (!res.ok) { setLokalFeil(data.error ?? 'Kunne ikke opprette bruker.'); return; }
      setBrukere((prev) => [...prev, data].sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? '', 'nb')));
      toast({ title: 'Bruker opprettet', variant: 'success' });
      lukkLokal();
    } catch {
      setLokalFeil('Nettverksfeil. Prøv igjen.');
    } finally {
      setOppretter(false);
    }
  };

  const lukkLokal = () => {
    setLokalOpen(false); setLokalNavn(''); setLokalEpost('');
    setLokalPassord(''); setLokalRolle('bruker'); setLokalMåBytte(true);
    setLokalFeil(null);
  };

  // ── Reset passord ─────────────────────────────────────────────────────────
  const resetPassordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetBruker) return;
    setResetFeil(null);
    setResetter(true);
    try {
      const res = await apiFetch(`/api/admin/brukere/${resetBruker.id}/reset-passord`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body:    JSON.stringify({ nyttPassord: resetPassord }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { setResetFeil(data.error ?? 'Kunne ikke resette passord.'); return; }
      toast({ title: 'Passord er tilbakestilt', variant: 'success' });
      lukkReset();
    } catch {
      setResetFeil('Nettverksfeil. Prøv igjen.');
    } finally {
      setResetter(false);
    }
  };

  const lukkReset = () => { setResetBruker(null); setResetPassord(''); setResetFeil(null); setVisReset(false); };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Brukerregister</h1>
          <p className="mt-1 text-sm text-gray-500">
            Administrer portalbrukere — Entra-brukere og lokale brukere.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setLokalOpen(true)}
            className="inline-flex items-center gap-2 h-9 px-4 text-sm rounded-lg font-medium transition-colors"
            style={{
              background: 'var(--glass-bg)',
              border:     '1px solid var(--glass-border)',
              color:      'var(--text-secondary)',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--glass-border)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--glass-bg)'; }}
          >
            <UserPlus className="w-4 h-4" />
            Ny lokal bruker
          </button>
          <button
            onClick={() => setEntraOpen(true)}
            className="inline-flex items-center gap-2 h-9 px-4 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 font-medium transition-colors shadow-sm"
          >
            <Download className="w-4 h-4" />
            Importer fra Entra
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Laster brukere…</div>
        ) : brukere.length === 0 ? (
          <div className="p-12 text-center">
            <Download className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">Ingen brukere ennå.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-3 text-left font-medium">Navn</th>
                <th className="px-4 py-3 text-left font-medium">E-post</th>
                <th className="px-4 py-3 text-left font-medium">Type</th>
                <th className="px-4 py-3 text-left font-medium">Rolle</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Sist innlogget</th>
                <th className="px-4 py-3 text-left font-medium">Opprettet</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {brukere.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-3 font-medium text-gray-900">{b.displayName ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{b.email ?? '—'}</td>
                  <td className="px-4 py-3">
                    {/* erEntraBruker kan komme som boolean eller BIT (0/1) fra SQL Server */}
                    {(b.erEntraBruker === true || (b.erEntraBruker as unknown as number) === 1) ? (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium"
                        style={{
                          background: 'rgba(0,120,212,0.12)',
                          border:     '1px solid rgba(0,120,212,0.25)',
                          color:      'rgba(100,180,255,0.90)',
                        }}
                      >
                        <svg width="10" height="10" viewBox="0 0 21 21" fill="none" className="shrink-0">
                          <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
                          <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
                          <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
                          <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
                        </svg>
                        Microsoft
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                        style={{
                          background: 'var(--glass-bg)',
                          border:     '1px solid var(--glass-border-hover)',
                          color:      'var(--text-secondary)',
                        }}
                      >
                        Lokal
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={b.rolle}
                      onChange={(e) => patch(b, { rolle: e.target.value as Rolle })}
                      className="text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    >
                      {tilgjengeligeRoller.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={b.erAktiv ? 'default' : 'secondary'}>
                      {b.erAktiv ? 'Aktiv' : 'Inaktiv'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(b.sistInnlogget)}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(b.opprettet)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {!(b.erEntraBruker === true || (b.erEntraBruker as unknown as number) === 1) && (
                        <Tooltip content="Reset passord" side="top">
                          <button
                            onClick={() => { setResetBruker(b); setResetPassord(''); setResetFeil(null); }}
                            className="inline-flex items-center justify-center h-8 w-8 rounded-md text-gray-400 hover:bg-yellow-50 hover:text-yellow-600 transition-colors"
                          >
                            <KeyRound className="w-4 h-4" />
                          </button>
                        </Tooltip>
                      )}
                      <button
                        onClick={() => patch(b, { erAktiv: !b.erAktiv })}
                        className="text-xs px-3 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-100 transition-colors"
                      >
                        {b.erAktiv ? 'Deaktiver' : 'Aktiver'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Dialog: Importer fra Entra ──────────────────────────────────── */}
      <Dialog open={entraOpen} onClose={lukkEntra} title="Importer brukere fra Entra" className="max-w-xl">
        <div className="space-y-3">
          <input
            type="text"
            value={søk}
            onChange={(e) => setSøk(e.target.value)}
            placeholder="Søk på navn eller e-post…"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            autoFocus
          />
          {søkLaster && <p className="text-xs text-gray-400 text-center py-2">Søker…</p>}
          {!søkLaster && søkResultater.length > 0 && (
            <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-72 overflow-y-auto">
              {søkResultater.map((u) => {
                const erValgt = valgte.has(u.id);
                return (
                  <li key={u.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                    <input type="checkbox" checked={erValgt} onChange={() => toggleValgt(u.id)} className="accent-brand-600 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 truncate">{u.displayName}</p>
                      <p className="text-xs text-gray-500 truncate">{u.mail ?? u.userPrincipalName}</p>
                    </div>
                    {erValgt && (
                      <select
                        value={valgte.get(u.id) ?? 'bruker'}
                        onChange={(e) => setValgRolle(u.id, e.target.value as Rolle)}
                        className="text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-brand-500 flex-shrink-0"
                      >
                        {tilgjengeligeRoller.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {!søkLaster && søk.trim() && søkResultater.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-2">Ingen treff.</p>
          )}
          {valgte.size > 0 && (
            <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-600">
              <span className="font-medium">{valgte.size} valgt:</span>{' '}
              {Array.from(valgte.entries()).map(([id, rolle]) => {
                const u = søkResultater.find((x) => x.id === id);
                return `${u?.displayName ?? id} (${rolleLabel(rolle)})`;
              }).join(', ')}
            </div>
          )}
        </div>
        <DialogFooter>
          <button onClick={lukkEntra} className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors">
            Avbryt
          </button>
          <button
            onClick={importer}
            disabled={valgte.size === 0 || importerer}
            className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
          >
            {importerer ? 'Importerer…' : `Importer valgte (${valgte.size})`}
          </button>
        </DialogFooter>
      </Dialog>

      {/* ── Dialog: Ny lokal bruker ─────────────────────────────────────── */}
      <Dialog open={lokalOpen} onClose={lukkLokal} title="Ny lokal bruker" className="max-w-md">
        <form onSubmit={opprettLokal} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Visningsnavn <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={lokalNavn}
              onChange={(e) => { setLokalNavn(e.target.value); setLokalFeil(null); }}
              placeholder="Ola Nordmann"
              required
              autoFocus
              className="w-full px-3 py-2 text-sm rounded-lg"
              style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)', outline: 'none' }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">E-postadresse <span className="text-red-500">*</span></label>
            <input
              type="email"
              value={lokalEpost}
              onChange={(e) => { setLokalEpost(e.target.value); setLokalFeil(null); }}
              placeholder="ola@bedrift.no"
              required
              className="w-full px-3 py-2 text-sm rounded-lg"
              style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)', outline: 'none' }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Midlertidig passord <span className="text-red-500">*</span></label>
            <div className="relative">
              <input
                type={visLokalPassord ? 'text' : 'password'}
                value={lokalPassord}
                onChange={(e) => { setLokalPassord(e.target.value); setLokalFeil(null); }}
                placeholder="Minst 8 tegn, stor bokstav, tall"
                required
                className="w-full px-3 py-2 pr-10 text-sm rounded-lg"
                style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)', outline: 'none' }}
              />
              <button
                type="button"
                onClick={() => setVisLokalPassord((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--text-muted)' }}
                tabIndex={-1}
              >
                {visLokalPassord ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Rolle</label>
            <select
              value={lokalRolle}
              onChange={(e) => setLokalRolle(e.target.value as Rolle)}
              className="w-full px-3 py-2 text-sm rounded-lg"
              style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)', outline: 'none' }}
            >
              {tilgjengeligeRoller.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={lokalMåBytte}
              onChange={(e) => setLokalMåBytte(e.target.checked)}
              className="rounded accent-brand-600"
            />
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Bruker må bytte passord ved første innlogging
            </span>
          </label>
          {lokalFeil && <p className="text-xs" style={{ color: 'rgba(252,165,165,0.90)' }}>{lokalFeil}</p>}
          <DialogFooter>
            <button type="button" onClick={lukkLokal} className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors">
              Avbryt
            </button>
            <button
              type="submit"
              disabled={oppretter || !lokalNavn.trim() || !lokalEpost.trim() || !lokalPassord}
              className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
            >
              {oppretter ? 'Oppretter…' : 'Opprett bruker'}
            </button>
          </DialogFooter>
        </form>
      </Dialog>

      {/* ── Dialog: Reset passord ────────────────────────────────────────── */}
      <Dialog open={!!resetBruker} onClose={lukkReset} title={`Reset passord — ${resetBruker?.displayName ?? ''}`} className="max-w-sm">
        <form onSubmit={resetPassordSubmit} className="space-y-4">
          <p className="text-sm text-gray-500">
            Sett et nytt midlertidig passord. Brukeren vil bli bedt om å bytte det ved neste innlogging.
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nytt passord <span className="text-red-500">*</span></label>
            <div className="relative">
              <input
                type={visReset ? 'text' : 'password'}
                value={resetPassord}
                onChange={(e) => { setResetPassord(e.target.value); setResetFeil(null); }}
                placeholder="Minst 8 tegn, stor bokstav, tall"
                required
                autoFocus
                className="w-full px-3 py-2 pr-10 text-sm rounded-lg"
                style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)', outline: 'none' }}
              />
              <button
                type="button"
                onClick={() => setVisReset((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--text-muted)' }}
                tabIndex={-1}
              >
                {visReset ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          {resetFeil && <p className="text-xs" style={{ color: 'rgba(252,165,165,0.90)' }}>{resetFeil}</p>}
          <DialogFooter>
            <button type="button" onClick={lukkReset} className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors">
              Avbryt
            </button>
            <button
              type="submit"
              disabled={resetter || !resetPassord}
              className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
            >
              {resetter ? 'Resetter…' : 'Sett passord'}
            </button>
          </DialogFooter>
        </form>
      </Dialog>
    </div>
  );
}
