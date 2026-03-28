import { cn } from '@/lib/utils';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'secondary' | 'outline';
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        variant === 'default' && 'bg-brand-100 text-brand-700',
        variant === 'secondary' && 'bg-gray-100 text-gray-600',
        variant === 'outline' && 'border border-gray-200 text-gray-600',
        className
      )}
      {...props}
    />
  );
}
