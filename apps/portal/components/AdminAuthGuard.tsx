'use client';

import { useEffect, useState } from 'react';
import { useMsal } from '@azure/msal-react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/apiClient';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function AdminAuthGuard({ children }: { children: React.ReactNode }) {
  const { accounts, inProgress } = useMsal();
  const router = useRouter();

  const [status, setStatus] = useState<'loading' | 'ok' | 'denied'>('loading');

  const initialized = inProgress === 'none';
  const account = accounts[0];

  useEffect(() => {
    if (!initialized) return;

    if (!account) {
      router.replace('/');
      return;
    }

    apiFetch('/api/me', {
      headers: { 'X-Entra-Object-Id': account.localAccountId },
    })
      .then(async (r) => {
        if (!r.ok) { setStatus('denied'); return; }
        const bruker = await r.json() as { rolle: string };
        setStatus(bruker.rolle === 'admin' ? 'ok' : 'denied');
      })
      .catch(() => setStatus('denied'));
  }, [initialized, account, router]);

  useEffect(() => {
    if (status === 'denied') router.replace('/dashboard');
  }, [status, router]);

  if (!initialized || !account || status !== 'ok') return null;

  return <>{children}</>;
}
