'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Plus, Pencil, FileBarChart2, Shield, Trash2, GripVertical } from 'lucide-react';
import { useMsal } from '@azure/msal-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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
  sortOrder: number;
  _count: { rapporter: number; tilgang: number };
}

function SortableWorkspaceRow({
  ws,
  onDelete,
}: {
  ws: Workspace;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: ws.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    background: isDragging ? '#f9fafb' : undefined,
  };

  return (
    <TableRow ref={setNodeRef} style={style}>
      <TableCell className="w-8 p-0 pl-2">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing inline-flex items-center justify-center h-8 w-8 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
          aria-label={`Dra ${ws.navn}`}
          title="Dra for å endre rekkefølge"
        >
          <GripVertical className="w-4 h-4" />
        </button>
      </TableCell>
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
              onClick={() => onDelete(ws.id)}
              className="inline-flex items-center justify-center h-8 w-8 rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </Tooltip>
        </div>
      </TableCell>
    </TableRow>
  );
}

export default function WorkspacesPage() {
  const { accounts } = useMsal();
  const entraObjectId = accounts[0]?.localAccountId ?? '';

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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
      const r = await apiFetch(`/api/workspaces/${deleteId}`, {
        method: 'DELETE',
        headers: entraObjectId ? { 'X-Entra-Object-Id': entraObjectId } : {},
      });
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

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = workspaces.findIndex((w) => w.id === active.id);
    const newIndex = workspaces.findIndex((w) => w.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const forrige = workspaces;
    const nyRekkefolge = arrayMove(workspaces, oldIndex, newIndex).map((w, i) => ({
      ...w,
      sortOrder: (i + 1) * 10,
    }));
    setWorkspaces(nyRekkefolge);

    try {
      const r = await apiFetch('/api/workspaces/rekkefolge', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(entraObjectId ? { 'X-Entra-Object-Id': entraObjectId } : {}),
        },
        body: JSON.stringify({
          rekkefolge: nyRekkefolge.map((w) => ({ id: w.id, sortOrder: w.sortOrder })),
        }),
      });
      if (!r.ok) throw new Error();
      toast({ title: 'Rekkefølge oppdatert', variant: 'success' });
    } catch {
      setWorkspaces(forrige);
      toast({ title: 'Kunne ikke oppdatere rekkefølge', variant: 'destructive' });
    }
  };

  const toDelete = workspaces.find((w) => w.id === deleteId);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Workspaces</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Administrer Power BI-workspaces og tilhørende rapporter. Dra <GripVertical className="inline w-3.5 h-3.5 -mt-0.5" /> for å endre rekkefølge i sidebaren.
          </p>
        </div>
        <Button size="sm">
          <Link href="/admin/workspaces/ny" className="flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Nytt workspace
          </Link>
        </Button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
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
                    {Array.from({ length: 7 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : workspaces.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-gray-400 py-10">
                    Ingen workspaces ennå.
                  </TableCell>
                </TableRow>
              ) : (
                <SortableContext
                  items={workspaces.map((w) => w.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {workspaces.map((ws) => (
                    <SortableWorkspaceRow key={ws.id} ws={ws} onDelete={setDeleteId} />
                  ))}
                </SortableContext>
              )}
            </TableBody>
          </Table>
        </DndContext>
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
