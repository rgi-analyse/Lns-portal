'use client';

import { useEffect, useRef } from 'react';
import { X } from '@/components/ikoner';
import { cn } from '@/lib/utils';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}

export function Dialog({ open, onClose, title, children, className }: DialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className={cn(
        // D2 · Gruppe 2: Azure-modal — mørk flate, 8px radius, subtil kant, Segoe.
        'rounded-large shadow-xl w-full max-w-md border border-[color:var(--glass-border)] bg-[color:var(--navy-dark)]',
        className,
      )}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[color:var(--glass-border)]">
          <h2 className="text-base font-semibold text-[color:var(--text-primary)]">{title}</h2>
          <button
            onClick={onClose}
            className="text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition-colors rounded p-0.5"
            aria-label="Lukk"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex justify-end gap-2 pt-4 border-t border-[color:var(--glass-border)] mt-4', className)}
      {...props}
    />
  );
}
