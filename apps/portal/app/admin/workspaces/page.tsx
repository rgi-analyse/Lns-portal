'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Plus, Pencil, FileBarChart2, Shield, Trash2 } from 'lucide-react';
import { useMsal } from '@azure/msal-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { Dialog, DialogFooter } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/apiClient';

interface Workspace {
  id: string;
  navn: string;
  beskrivelse: string | null;
  opprettetDato: string;
  _count: { rapporter: number; tilgang: number };
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function WorkspacesPage() {
  const { accounts } = useMsal();
  const entraObjectId = accounts[0]?.localAccountId ?? '';

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetch_ = useCallback(() => {
    setLoading(true);
    apiFetch('/api/workspaces', {
      headers: entraObjectId ? { 'X-Entra-Object-Id': entraObjectId } : {},
    })
      .then((r) => r.json())
      .then(setWorkspaces)
      .catch(() => toast({ title: 'Kunne ikke laste workspaces', variant: 'destructive' }))
      .finally(() => setLoading(false));
  }, [entraObjectId]);

  useEffect(() => { fetch_(); }, [fetch_]);

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const r = await apiFetch(`/api/workspaces/${deleteId}`, { method: 'DELETE' });
      if (!r.ok) throw new Error();
      toast({ title: 'Workspace slettet', variant: 'success' });
      setDeleteId(null);
      fetch_();
    } catch {
      toast({ title: 'Sletting feilet', variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  const toDelete = workspaces.find((w) => w.id === deleteId);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Workspaces</h1>
          <p className="text-sm text-gray-500 mt-0.5">Administrer Power BI-workspaces og tilhørende rapporter.</p>
        </div>
        <Button size="sm">
          <Link href="/admin/workspaces/ny" className="flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Nytt workspace
          </Link>
        </Button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Navn</TableHead>
              <TableHead>Beskrivelse</TableHead>
              <TableHead className="text-center">Rapporter</TableHead>
              <TableHead className="text-center">Tilganger</TableHead>
              <TableHead>Opprettet</TableHead>
              <TableHead className="text-right">Handlinger</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : workspaces.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-gray-400 py-10">
                  Ingen workspaces ennå.
                </TableCell>
              </TableRow>
            ) : (
              workspaces.map((ws) => (
                <TableRow key={ws.id}>
                  <TableCell className="font-medium text-gray-900">{ws.navn}</TableCell>
                  <TableCell className="text-gray-500 max-w-[200px] truncate">
                    {ws.beskrivelse ?? <span className="italic text-gray-300">–</span>}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="secondary">{ws._count.rapporter}</Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="secondary">{ws._count.tilgang}</Badge>
                  </TableCell>
                  <TableCell className="text-gray-500 whitespace-nowrap">
                    {new Date(ws.opprettetDato).toLocaleDateString('nb-NO')}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Tooltip content="Rediger" side="top">
                        <Link
                          href={`/admin/workspaces/${ws.id}`}
                          className="inline-flex items-center justify-center h-8 w-8 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </Link>
                      </Tooltip>
                      <Tooltip content="Rapporter" side="top">
                        <Link
                          href={`/admin/workspaces/${ws.id}/rapporter`}
                          className="inline-flex items-center justify-center h-8 w-8 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors"
                        >
                          <FileBarChart2 className="w-4 h-4" />
                        </Link>
                      </Tooltip>
                      <Tooltip content="Sikkerhet" side="top">
                        <Link
                          href={`/admin/workspaces/${ws.id}/sikkerhet`}
                          className="inline-flex items-center justify-center h-8 w-8 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors"
                        >
                          <Shield className="w-4 h-4" />
                        </Link>
                      </Tooltip>
                      <Tooltip content="Slett" side="top">
                        <button
                          onClick={() => setDeleteId(ws.id)}
                          className="inline-flex items-center justify-center h-8 w-8 rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </Tooltip>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Slett-bekreftelse */}
      <Dialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Slett workspace"
      >
        <p className="text-sm text-gray-600">
          Er du sikker på at du vil slette{' '}
          <span className="font-semibold text-gray-900">{toDelete?.navn}</span>?
          Alle rapporter og tilganger tilknyttet dette workspacet vil også bli slettet.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeleteId(null)} disabled={deleting}>
            Avbryt
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Sletter...' : 'Slett'}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
