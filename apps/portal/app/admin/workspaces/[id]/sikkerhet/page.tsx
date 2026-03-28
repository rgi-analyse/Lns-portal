'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import TilgangStyring from '@/components/TilgangStyring';

interface Workspace {
  id: string;
  navn: string;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function SikkerhetPage() {
  const { id } = useParams<{ id: string }>();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      console.log('[SikkerhetPage] API URL:', process.env.NEXT_PUBLIC_API_URL);
      const url = `${API}/api/workspaces/${id}`;
      console.log('[SikkerhetPage] Henter workspace:', url);
      try {
        const r = await fetch(url);
        console.log('[SikkerhetPage] Response status:', r.status);
        if (!r.ok) {
          const body = await r.text();
          console.error('[SikkerhetPage] Feil fra API:', body);
          throw new Error(`HTTP ${r.status}`);
        }
        setWorkspace(await r.json() as Workspace);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Ukjent feil';
        console.error('[SikkerhetPage] feil ved henting av workspace:', msg);
        setError(msg);
        toast({ title: 'Workspace ikke funnet', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  return (
    <div className="p-8 max-w-3xl">

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-400 mb-6" aria-label="Brødsmule">
        <Link href="/admin" className="hover:text-gray-700 transition-colors">Admin</Link>
        <span>/</span>
        <Link href="/admin/workspaces" className="hover:text-gray-700 transition-colors">Workspaces</Link>
        <span>/</span>
        {loading ? (
          <Skeleton className="h-4 w-24 inline-block" />
        ) : (
          <Link href={`/admin/workspaces/${id}`} className="hover:text-gray-700 transition-colors">
            {workspace?.navn}
          </Link>
        )}
        <span>/</span>
        <span className="text-gray-600 font-medium">Sikkerhet</span>
      </nav>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Tilgangsstyring
          {!loading && workspace && (
            <span className="text-gray-400 font-normal"> – {workspace.navn}</span>
          )}
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Administrer hvem som har tilgang til dette workspacet via Entra ID-grupper og brukere.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          Kunne ikke laste workspace: {error}
        </div>
      )}
      {!error && id && (
        <TilgangStyring
          entityType="workspace"
          entityId={id}
          entityNavn={workspace?.navn ?? ''}
        />
      )}
    </div>
  );
}
