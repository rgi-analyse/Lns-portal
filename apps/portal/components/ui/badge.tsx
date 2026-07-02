import { cn } from '@/lib/utils';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'secondary' | 'outline';
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        // D2 · Gruppe 2: Azure-badge — token-farger, semibold, subtil radius.
        'inline-flex items-center rounded-medium px-2 py-0.5 text-xs font-semibold',
        variant === 'default' && 'bg-[color:var(--glass-bg)] text-[color:var(--gold)]',
        variant === 'secondary' && 'bg-[color:var(--glass-bg)] text-[color:var(--text-secondary)]',
        variant === 'outline' && 'border border-[color:var(--glass-border)] text-[color:var(--text-secondary)]',
        className
      )}
      {...props}
    />
  );
}
