'use client';

import AdminAuthGuard from '@/components/AdminAuthGuard';
import AdminSidebar from '@/components/AdminSidebar';
import TopbarClient from '@/components/TopbarClient';
import { Toaster } from '@/components/ui/toast';
import { useTema } from '@/components/ThemeProvider';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { organisasjonNavn } = useTema();
  return (
    <>
      <AdminAuthGuard>
        <div className="flex h-screen overflow-hidden">
          <AdminSidebar />
          <div className="flex flex-col flex-1 min-w-0">
            <header
              className="h-14 shrink-0 flex items-center justify-between px-6"
              style={{
                background: 'rgba(10,22,40,0.50)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                borderBottom: '1px solid var(--glass-bg)',
              }}
            >
              <div className="flex items-center gap-2.5">
                <span style={{
                  fontFamily: 'Barlow Condensed, sans-serif',
                  fontWeight: 700,
                  fontSize: 15,
                  letterSpacing: '0.06em',
                  color: 'var(--text-primary)',
                }}>
                  {organisasjonNavn} Dataportal
                </span>
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider"
                  style={{
                    background: 'var(--glass-gold-bg)',
                    border: '1px solid var(--glass-gold-border)',
                    color: 'var(--gold)',
                  }}
                >
                  Admin
                </span>
              </div>
              <TopbarClient />
            </header>
            <main className="flex-1 overflow-auto">{children}</main>
          </div>
        </div>
      </AdminAuthGuard>
      <Toaster />
    </>
  );
}
