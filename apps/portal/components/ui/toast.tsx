'use client';

import { useState, useEffect } from 'react';
import { X, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToastVariant = 'default' | 'success' | 'destructive';

interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
}

// Module-level state — works without React context
let items: ToastItem[] = [];
const listeners = new Set<(t: ToastItem[]) => void>();

function notify() {
  listeners.forEach((l) => l([...items]));
}

export function toast(options: Omit<ToastItem, 'id'>) {
  const id = Math.random().toString(36).slice(2, 9);
  items = [...items, { ...options, id }];
  notify();
  setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    notify();
  }, 4500);
}

function dismiss(id: string) {
  items = items.filter((t) => t.id !== id);
  notify();
}

export function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    listeners.add(setToasts);
    return () => { listeners.delete(setToasts); };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-80 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'flex items-start gap-3 p-4 rounded-lg shadow-lg border text-sm pointer-events-auto animate-in slide-in-from-bottom-2',
            t.variant === 'destructive' && 'bg-red-50 border-red-200 text-red-800',
            t.variant === 'success'     && 'bg-green-50 border-green-200 text-green-800',
            (!t.variant || t.variant === 'default') && 'bg-white border-gray-200 text-gray-800',
          )}
        >
          {t.variant === 'destructive' && <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />}
          {t.variant === 'success'     && <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-green-500" />}
          {(!t.variant || t.variant === 'default') && <Info className="w-4 h-4 shrink-0 mt-0.5 text-brand-500" />}
          <div className="flex-1 min-w-0">
            <p className="font-medium">{t.title}</p>
            {t.description && <p className="mt-0.5 text-xs opacity-75">{t.description}</p>}
          </div>
          <button
            onClick={() => dismiss(t.id)}
            className="shrink-0 opacity-50 hover:opacity-100 transition-opacity"
            aria-label="Lukk"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
