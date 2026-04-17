'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * AI-chat er nå en global floating widget i dashboard-layouten.
 * Denne siden eksisterer ikke lenger — redirect til dashboard.
 */
export default function AiChatPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard');
  }, [router]);

  return null;
}
