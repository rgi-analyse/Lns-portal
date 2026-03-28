'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  side?: 'right' | 'top' | 'bottom' | 'left';
}

export function Tooltip({ content, children, side = 'right' }: TooltipProps) {
  const [visible, setVisible] = useState(false);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span
          className={cn(
            'absolute z-50 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white shadow-md pointer-events-none',
            side === 'right' && 'left-full ml-2 top-1/2 -translate-y-1/2',
            side === 'left' && 'right-full mr-2 top-1/2 -translate-y-1/2',
            side === 'top' && 'bottom-full mb-2 left-1/2 -translate-x-1/2',
            side === 'bottom' && 'top-full mt-2 left-1/2 -translate-x-1/2',
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
