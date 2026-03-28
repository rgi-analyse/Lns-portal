'use client';

import { createContext, useContext } from 'react';
import { cn } from '@/lib/utils';

interface TabsCtxValue {
  value: string;
  onValueChange: (v: string) => void;
}

const TabsCtx = createContext<TabsCtxValue | null>(null);

function useTabsCtx() {
  const ctx = useContext(TabsCtx);
  if (!ctx) throw new Error('Tabs-komponenter må brukes innenfor <Tabs>');
  return ctx;
}

export function Tabs({
  value,
  onValueChange,
  children,
  className,
}: {
  value: string;
  onValueChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <TabsCtx.Provider value={{ value, onValueChange }}>
      <div className={className}>{children}</div>
    </TabsCtx.Provider>
  );
}

export function TabsList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('inline-flex h-9 items-center rounded-lg bg-gray-100 p-1 gap-0.5', className)}>
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  children,
}: {
  value: string;
  children: React.ReactNode;
}) {
  const { value: active, onValueChange } = useTabsCtx();
  return (
    <button
      type="button"
      onClick={() => onValueChange(value)}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 px-3 h-7 rounded-md text-sm font-medium transition-all',
        active === value
          ? 'bg-white text-gray-900 shadow-sm'
          : 'text-gray-500 hover:text-gray-700',
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  children,
}: {
  value: string;
  children: React.ReactNode;
}) {
  const { value: active } = useTabsCtx();
  if (active !== value) return null;
  return <div>{children}</div>;
}
