import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        // D2 · Gruppe 2: Azure-stil (farge/fokus fra globals.css native-form-regel).
        'flex w-full rounded-medium border border-[color:var(--glass-border)] bg-white/5 px-3 py-2 text-[13px] text-[color:var(--text-primary)] placeholder:text-[color:var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[color:var(--gold)] focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50 min-h-[80px] resize-y',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export { Textarea };
