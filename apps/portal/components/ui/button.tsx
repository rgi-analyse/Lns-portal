import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        // D2 · Gruppe 2: Azure-stil — Segoe (arvet font-sans), 2px radius, semibold,
        // kompakt tetthet, subtil transition, ingen soft-shadow.
        'inline-flex items-center justify-center gap-1.5 rounded-small font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--gold)] disabled:opacity-50 disabled:cursor-not-allowed',
        variant === 'default'      && 'bg-[color:var(--gold)] text-[color:var(--primary-text)] hover:brightness-95',
        variant === 'destructive'  && 'bg-danger text-white hover:brightness-95',
        variant === 'outline'      && 'border border-[color:var(--glass-border)] bg-transparent text-[color:var(--text-primary)] hover:bg-white/5',
        variant === 'ghost'        && 'text-[color:var(--text-primary)] hover:bg-white/5',
        variant === 'link'         && 'text-info underline-offset-4 hover:underline p-0 h-auto',
        size === 'default'  && 'h-8 px-3.5 py-1 text-[13px]',
        size === 'sm'       && 'h-7 px-2.5 text-xs',
        size === 'lg'       && 'h-10 px-5 text-sm',
        size === 'icon'     && 'h-8 w-8 p-0',
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'Button';

export { Button };
