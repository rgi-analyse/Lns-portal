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
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50 disabled:cursor-not-allowed',
        variant === 'default'      && 'bg-brand-600 text-white hover:bg-brand-700',
        variant === 'destructive'  && 'bg-red-500 text-white hover:bg-red-600',
        variant === 'outline'      && 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
        variant === 'ghost'        && 'text-gray-700 hover:bg-gray-100',
        variant === 'link'         && 'text-brand-600 underline-offset-4 hover:underline p-0 h-auto',
        size === 'default'  && 'h-9 px-4 py-2 text-sm',
        size === 'sm'       && 'h-7 px-3 text-xs rounded',
        size === 'lg'       && 'h-11 px-6 text-base',
        size === 'icon'     && 'h-8 w-8 p-0',
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'Button';

export { Button };
