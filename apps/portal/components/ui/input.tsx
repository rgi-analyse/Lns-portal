import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        // D2 · Gruppe 2: Azure-tetthet + 4px radius + dark tokens (farge/fokus styres
        // globalt av native-form-regelen i globals.css).
        'flex h-8 w-full rounded-medium border border-[color:var(--glass-border)] bg-white/5 px-3 py-1 text-[13px] text-[color:var(--text-primary)] transition-colors placeholder:text-[color:var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[color:var(--gold)] focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export { Input };
