import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        // D2 · Gruppe 2: Azure-tetthet (farge/fokus fra globals.css native-form-regel).
        'flex h-8 rounded-medium border border-[color:var(--glass-border)] bg-white/5 px-3 py-1 text-[13px] text-[color:var(--text-primary)] transition-colors focus:outline-none focus:ring-2 focus:ring-[color:var(--gold)] focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';

export { Select };
