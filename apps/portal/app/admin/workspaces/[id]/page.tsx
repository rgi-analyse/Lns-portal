'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/apiClient';

interface Workspace {
  id: string;
  navn: string;
  beskrivelse: string | null;
}

interface FormErrors {
  navn?: string;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function RedigerWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [navn, setNavn] = useState('');
  const [beskrivelse, setBeskrivelse] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      console.log('[RedigerWorkspacePage] API URL:', process.env.NEXT_PUBLIC_API_URL);
      console.log('[RedigerWorkspacePage] Henter workspace:', `/api/workspaces/${id}`);
      try {
        const r = await apiFetch(`/api/workspaces/${id}`);
        console.log('[RedigerWorkspacePage] Response status:', r.status);
        if (!r.ok) {
          const body = await r.text();
          console.error('[RedigerWorkspacePage] Feil fra API:', body);
          throw new Error(`HTTP ${r.status}`);
        }
        const ws = await r.json() as Workspace;
        setNavn(ws.navn);
        setBeskrivelse(ws.beskrivelse ?? '');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Ukjent feil';
        console.error('[RedigerWorkspacePage] feil ved henting av workspace:', msg);
        toast({ title: 'Workspace ikke funnet', description: msg, variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const validate = (): boolean => {
    const e: FormErrors = {};
    if (!navn.trim()) e.navn = 'Navn er påkrevd.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const r = await apiFetch(`/api/workspaces/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          navn: navn.trim(),
          beskrivelse: beskrivelse.trim() || null,
        }),
      });
      if (!r.ok) {
        const data = await r.json() as { error?: string };
        throw new Error(data.error ?? `HTTP ${r.status}`);
      }
      toast({ title: 'Workspace oppdatert', variant: 'success' });
      router.push('/admin/workspaces');
    } catch (err) {
      toast({
        title: 'Kunne ikke lagre endringer',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-8 max-w-xl">
      <Link
        href="/admin/workspaces"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-6"
      >
        <ArrowLeft className="w-4 h-4" /> Tilbake til workspaces
      </Link>

      <h1 className="text-2xl font-bold text-gray-900 mb-1">Rediger workspace</h1>
      <p className="text-sm text-gray-500 mb-6">Oppdater informasjonen om workspacet.</p>

      {loading ? (
        <div className="space-y-5 rounded-xl p-6" style={{ background: 'rgba(17,29,51,0.65)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-5 rounded-xl p-6" style={{ background: 'rgba(17,29,51,0.65)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div>
            <Label htmlFor="navn">Navn <span className="text-red-500">*</span></Label>
            <Input
              id="navn"
              value={navn}
              onChange={(e) => { setNavn(e.target.value); setErrors((p) => ({ ...p, navn: undefined })); }}
            />
            {errors.navn && <p className="mt-1 text-xs text-red-600">{errors.navn}</p>}
          </div>

          <div>
            <Label htmlFor="beskrivelse">Beskrivelse</Label>
            <Textarea
              id="beskrivelse"
              value={beskrivelse}
              onChange={(e) => setBeskrivelse(e.target.value)}
            />
          </div>


          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => router.push('/admin/workspaces')}>
              Avbryt
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Lagrer...' : 'Lagre endringer'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
