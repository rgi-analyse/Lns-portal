import { cn } from '@/lib/utils';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('block text-[13px] font-semibold text-[color:var(--text-secondary)] mb-1', className)}
      {...props}
    />
  );
}
