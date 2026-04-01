'use client';

import { useEffect, useState } from 'react';
import { useMsal } from '@azure/msal-react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/apiClient';

export default function TenantsLayout({ children }: { children: React.ReactNode }) {
  const { accounts } = useMsal();
  const router = useRouter();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    const account = accounts[0];
    if (!account) { router.replace('/dashboard'); return; }
    apiFetch('/api/me', {
      headers: { 'X-Entra-Object-Id': account.localAccountId },
    })
      .then(r => r.json())
      .then((b: { rolle?: string }) => {
        if (b.rolle === 'tenantadmin') setOk(true);
        else router.replace('/admin');
      })
      .catch(() => router.replace('/admin'));
  }, [accounts, router]);

  if (!ok) return null;
  return <>{children}</>;
}
