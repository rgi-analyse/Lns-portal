'use client';

import { useEffect, useState } from 'react';
import { useMsal } from '@azure/msal-react';
import { useRouter } from 'next/navigation';

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

    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? '';
    fetch(`${apiUrl}/api/me`, {
      headers: {
        'x-tenant-id': 'lns',
        'x-entra-object-id': account.localAccountId,
      },
    })
      .then(async (r) => {
        console.log('[AdminAuthGuard] /api/me status:', r.status);
        if (!r.ok) { setStatus('denied'); return; }
        const bruker = await r.json() as { rolle: string };
        console.log('[AdminAuthGuard] bruker rolle:', bruker.rolle);
        const adminRoller = ['admin', 'tenantadmin'];
        setStatus(adminRoller.includes(bruker.rolle) ? 'ok' : 'denied');
      })
      .catch(() => setStatus('denied'));
  }, [initialized, account, router]);

  useEffect(() => {
    if (status === 'denied') router.replace('/dashboard');
  }, [status, router]);

  if (!initialized || !account || status !== 'ok') return null;

  return <>{children}</>;
}
