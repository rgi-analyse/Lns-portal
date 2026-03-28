'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Trash2, User, Users } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogFooter } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { usePortalAuth } from '@/hooks/usePortalAuth';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface GraphGroup {
  id: string;
  displayName: string;
  description: string | null;
  mail: string | null;
}

interface PortalBruker {
  id: string;
  entraObjectId: string;
  displayName: string | null;
  email: string | null;
  erAktiv: boolean;
}

interface Tilgang {
  id: string;
  type: string;
  entraId: string;
  visningsnavn: string;
  epost: string | null;
  rolle: string;
  lagtTilDato: string;
}

export interface TilgangStyringProps {
  entityType: 'workspace' | 'rapport';
  entityId: string;
  entityNavn: string;
}

const ROLLER = [
  { value: 'leser', label: 'Leser' },
  { value: 'admin', label: 'Admin' },
];

export default function TilgangStyring({ entityType, entityId }: TilgangStyringProps) {
  console.log('[TilgangStyring] entityType:', entityType, '| entityId:', entityId);
  const { authHeaders } = usePortalAuth();

  const tilgangBaseUrl = `${API}/api/${
    entityType === 'workspace' ? 'workspaces' : 'rapporter'
  }/${entityId}/tilgang`;

  const [activeTab, setActiveTab] = useState('grupper');

  const [groupQuery, setGroupQuery] = useState('');
  const [userQuery,  setUserQuery]  = useState('');
  const [groupResults, setGroupResults] = useState<GraphGroup[] | null>(null);
  const [userResults,  setUserResults]  = useState<PortalBruker[] | null>(null);
  const [groupLoading, setGroupLoading] = useState(false);
  const [userLoading,  setUserLoading]  = useState(false);

  const [tilganger,      setTilganger]      = useState<Tilgang[]>([]);
  const [tilgangLoading, setTilgangLoading] = useState(true);

  const [roleMap,   setRoleMap]   = useState<Record<string, string>>({});
  const [addingId,  setAddingId]  = useState<string | null>(null);
  const [deleteId,  setDeleteId]  = useState<string | null>(null);
  const [deleting,  setDeleting]  = useState(false);

  const fetchTilganger = useCallback(() => {
    setTilgangLoading(true);
    fetch(tilgangBaseUrl, { headers: authHeaders })
      .then((r) => r.json())
      .then((data: unknown) => {
        const arr = Array.isArray(data)
          ? data
          : (data as { value?: Tilgang[]; tilgang?: Tilgang[] })?.value
            ?? (data as { value?: Tilgang[]; tilgang?: Tilgang[] })?.tilgang
            ?? [];
        setTilganger(arr as Tilgang[]);
      })
      .catch(() => toast({ title: 'Kunne ikke hente tilganger', variant: 'destructive' }))
      .finally(() => setTilgangLoading(false));
  }, [tilgangBaseUrl, authHeaders]);

  useEffect(() => { fetchTilganger(); }, [fetchTilganger]);

  // Debounced gruppe-søk
  useEffect(() => {
    if (!groupQuery.trim()) { setGroupResults(null); return; }
    const timer = setTimeout(() => {
      setGroupLoading(true);
      fetch(`${API}/api/graph/search/grupper?q=${encodeURIComponent(groupQuery.trim())}`, { headers: authHeaders })
        .then((r) => r.json() as Promise<GraphGroup[] | { value?: GraphGroup[] }>)
        .then((data) => {
          const results = Array.isArray(data) ? data : (data.value ?? []);
          setGroupResults(results);
        })
        .catch(() => toast({ title: 'Gruppe-søk feilet', variant: 'destructive' }))
        .finally(() => setGroupLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [groupQuery]);

  // Debounced bruker-søk (portal-brukertabell)
  useEffect(() => {
    if (!userQuery.trim()) { setUserResults(null); return; }
    const timer = setTimeout(() => {
      setUserLoading(true);
      fetch(`${API}/api/admin/brukere?search=${encodeURIComponent(userQuery.trim())}`, { headers: authHeaders })
        .then((r) => r.json() as Promise<PortalBruker[]>)
        .then((data) => setUserResults(Array.isArray(data) ? data : []))
        .catch(() => toast({ title: 'Bruker-søk feilet', variant: 'destructive' }))
        .finally(() => setUserLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [userQuery]);

  const getRolle  = (id: string) => roleMap[id] ?? 'leser';
  const setRolle  = (id: string, rolle: string) =>
    setRoleMap((prev) => ({ ...prev, [id]: rolle }));
  const alreadyAdded = (entraId: string) => tilganger.some((t) => t.entraId === entraId);

  const handleAdd = async (entry: {
    type: 'gruppe' | 'bruker';
    entraId: string;
    visningsnavn: string;
    epost?: string;
  }) => {
    setAddingId(entry.entraId);
    try {
      const r = await fetch(tilgangBaseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ ...entry, rolle: getRolle(entry.entraId) }),
      });
      if (!r.ok) {
        const data = await r.json() as { error?: string };
        throw new Error(data.error ?? `HTTP ${r.status}`);
      }
      toast({ title: 'Tilgang lagt til', variant: 'success' });
      fetchTilganger();
    } catch (err) {
      toast({
        title: 'Kunne ikke legge til tilgang',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setAddingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const r = await fetch(`${tilgangBaseUrl}/${deleteId}`, { method: 'DELETE', headers: authHeaders });
      if (!r.ok && r.status !== 204) throw new Error();
      toast({ title: 'Tilgang fjernet', variant: 'success' });
      setDeleteId(null);
      fetchTilganger();
    } catch {
      toast({ title: 'Kunne ikke fjerne tilgang', variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  const gruppeTilganger = tilganger.filter((t) => t.type === 'gruppe');
  const brukerTilganger = tilganger.filter((t) => t.type === 'bruker');
  const toDelete = tilganger.find((t) => t.id === deleteId);
  const harEgenTilgang = tilganger.length > 0;

  return (
    <>
      {/* Info-boks for rapport-nivå tilgang */}
      {entityType === 'rapport' && !tilgangLoading && (
        harEgenTilgang ? (
          <div className="flex items-start gap-2.5 px-3.5 py-3 mb-5 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            <span className="shrink-0">⚠️</span>
            <p>Denne rapporten har <strong>egen tilgangsstyring</strong> som overstyrer workspace-tilgangen.</p>
          </div>
        ) : (
          <div className="flex items-start gap-2.5 px-3.5 py-3 mb-5 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
            <span className="shrink-0">ℹ️</span>
            <p>Denne rapporten <strong>arver tilgang fra workspace</strong>. Legg til tilgang nedenfor for å aktivere rapport-nivå sikkerhet.</p>
          </div>
        )
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="grupper">
            <Users className="w-4 h-4" />
            Grupper {!tilgangLoading && `(${gruppeTilganger.length})`}
          </TabsTrigger>
          <TabsTrigger value="brukere">
            <User className="w-4 h-4" />
            Brukere {!tilgangLoading && `(${brukerTilganger.length})`}
          </TabsTrigger>
        </TabsList>

        {/* ── GRUPPER ──────────────────────────────────────────────────────── */}
        <TabsContent value="grupper">
          <div className="space-y-5">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Legg til gruppe</h3>
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <Input
                  placeholder="Søk etter Entra ID-gruppe..."
                  className="pl-9"
                  value={groupQuery}
                  onChange={(e) => setGroupQuery(e.target.value)}
                />
              </div>
              {groupLoading && (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              )}
              {!groupLoading && groupResults !== null && (
                <div className="space-y-0.5">
                  {groupResults.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">Ingen grupper funnet.</p>
                  ) : (
                    groupResults.map((g) => {
                      const added = alreadyAdded(g.id);
                      return (
                        <div key={g.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50">
                          <Users className="w-4 h-4 text-gray-400 flex-shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 truncate">{g.displayName}</p>
                            {g.description && <p className="text-xs text-gray-400 truncate">{g.description}</p>}
                          </div>
                          {added ? (
                            <span className="text-xs text-gray-400 italic flex-shrink-0">Allerede lagt til</span>
                          ) : (
                            <>
                              <Select value={getRolle(g.id)} onChange={(e) => setRolle(g.id, e.target.value)} className="w-28 flex-shrink-0">
                                {ROLLER.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                              </Select>
                              <Button size="sm" disabled={addingId === g.id} className="flex-shrink-0"
                                onClick={() => handleAdd({ type: 'gruppe', entraId: g.id, visningsnavn: g.displayName, epost: g.mail ?? undefined })}>
                                {addingId === g.id ? 'Legger til...' : 'Legg til'}
                              </Button>
                            </>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-700">Gruppe-tilganger</h3>
              </div>
              {tilgangLoading ? (
                <div className="p-5 space-y-2">
                  {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : gruppeTilganger.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">Ingen gruppe-tilganger ennå.</p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {gruppeTilganger.map((t) => (
                    <div key={t.id} className="flex items-center gap-3 px-5 py-3">
                      <Users className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900">{t.visningsnavn}</p>
                        <p className="text-xs text-gray-400">{t.rolle} · {new Date(t.lagtTilDato).toLocaleDateString('nb-NO')}</p>
                      </div>
                      <button onClick={() => setDeleteId(t.id)} className="inline-flex items-center justify-center h-8 w-8 rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── BRUKERE ──────────────────────────────────────────────────────── */}
        <TabsContent value="brukere">
          <div className="space-y-5">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Legg til bruker</h3>
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <Input
                  placeholder="Søk etter navn eller e-post..."
                  className="pl-9"
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                />
              </div>
              {userLoading && (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              )}
              {!userLoading && userResults !== null && (
                <div className="space-y-0.5">
                  {userResults.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">Ingen brukere funnet.</p>
                  ) : (
                    userResults.map((u) => {
                      const added = alreadyAdded(u.entraObjectId);
                      const navn  = u.displayName ?? u.entraObjectId;
                      return (
                        <div key={u.entraObjectId} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50">
                          <User className="w-4 h-4 text-gray-400 flex-shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 truncate">{navn}</p>
                            <p className="text-xs text-gray-400 truncate">{u.email ?? '—'}</p>
                          </div>
                          {added ? (
                            <span className="text-xs text-gray-400 italic flex-shrink-0">Allerede lagt til</span>
                          ) : (
                            <>
                              <Select value={getRolle(u.entraObjectId)} onChange={(e) => setRolle(u.entraObjectId, e.target.value)} className="w-28 flex-shrink-0">
                                {ROLLER.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                              </Select>
                              <Button size="sm" disabled={addingId === u.entraObjectId} className="flex-shrink-0"
                                onClick={() => handleAdd({ type: 'bruker', entraId: u.entraObjectId, visningsnavn: navn, epost: u.email ?? undefined })}>
                                {addingId === u.entraObjectId ? 'Legger til...' : 'Legg til'}
                              </Button>
                            </>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-700">Bruker-tilganger</h3>
              </div>
              {tilgangLoading ? (
                <div className="p-5 space-y-2">
                  {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : brukerTilganger.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">Ingen bruker-tilganger ennå.</p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {brukerTilganger.map((t) => (
                    <div key={t.id} className="flex items-center gap-3 px-5 py-3">
                      <User className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900">{t.visningsnavn}</p>
                        <p className="text-xs text-gray-400">{t.epost} · {t.rolle} · {new Date(t.lagtTilDato).toLocaleDateString('nb-NO')}</p>
                      </div>
                      <button onClick={() => setDeleteId(t.id)} className="inline-flex items-center justify-center h-8 w-8 rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Slett-bekreftelse */}
      <Dialog open={!!deleteId} onClose={() => setDeleteId(null)} title="Fjern tilgang">
        <p className="text-sm text-gray-600">
          Vil du fjerne tilgangen for{' '}
          <span className="font-semibold text-gray-900">{toDelete?.visningsnavn}</span>?
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeleteId(null)} disabled={deleting}>Avbryt</Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Fjerner...' : 'Fjern tilgang'}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
