'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/apiClient';

interface FormState {
  navn: string;
  beskrivelse: string;
}

interface FormErrors {
  navn?: string;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function NyttWorkspacePage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({ navn: '', beskrivelse: '' });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const validate = (): boolean => {
    const e: FormErrors = {};
    if (!form.navn.trim()) e.navn = 'Navn er påkrevd.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const r = await apiFetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          navn: form.navn.trim(),
          beskrivelse: form.beskrivelse.trim() || undefined,
        }),
      });
      if (!r.ok) {
        const data = await r.json() as { error?: string };
        throw new Error(data.error ?? `HTTP ${r.status}`);
      }
      toast({ title: 'Workspace opprettet', variant: 'success' });
      router.push('/admin/workspaces');
    } catch (err) {
      toast({
        title: 'Kunne ikke opprette workspace',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const field = (key: keyof FormState) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm((prev) => ({ ...prev, [key]: e.target.value }));
      if (errors[key as keyof FormErrors]) setErrors((prev) => ({ ...prev, [key]: undefined }));
    },
  });

  return (
    <div className="p-8 max-w-xl">
      <Link
        href="/admin/workspaces"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-6"
      >
        <ArrowLeft className="w-4 h-4" /> Tilbake til workspaces
      </Link>

      <h1 className="text-2xl font-bold text-gray-900 mb-1">Nytt workspace</h1>
      <p className="text-sm text-gray-500 mb-6">Opprett en organisatorisk mappe for rapporter.</p>

      <form onSubmit={handleSubmit} noValidate className="space-y-5 rounded-xl p-6" style={{ background: 'rgba(17,29,51,0.65)', backdropFilter: 'blur(20px)', border: '1px solid var(--glass-bg-hover)' }}>
        <div>
          <Label htmlFor="navn">Navn <span className="text-red-500">*</span></Label>
          <Input id="navn" placeholder="Workspace-navn" {...field('navn')} />
          {errors.navn && <p className="mt-1 text-xs text-red-600">{errors.navn}</p>}
        </div>

        <div>
          <Label htmlFor="beskrivelse">Beskrivelse</Label>
          <Textarea id="beskrivelse" placeholder="Valgfri beskrivelse..." {...field('beskrivelse')} />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => router.push('/admin/workspaces')}>
            Avbryt
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Oppretter...' : 'Opprett workspace'}
          </Button>
        </div>
      </form>
    </div>
  );
}
