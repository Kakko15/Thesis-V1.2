import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { forwardRef } from 'react'
import { cn } from '../../lib/utils'

export function TooltipProvider(props) {
  return <TooltipPrimitive.Provider {...props} />
}

export function Tooltip(props) {
  return <TooltipPrimitive.Root {...props} />
}

export function TooltipTrigger(props) {
  return <TooltipPrimitive.Trigger {...props} />
}

export const TooltipContent = forwardRef(function TooltipContent(
  { className, sideOffset = 8, ...props },
  ref,
) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          'z-[100] max-w-xs rounded-xl bg-[var(--popover)] px-3 py-2 text-xs text-[var(--popover-foreground)] shadow-xl ring-1 ring-[var(--border)]',
          'data-[state=delayed-open]:animate-in data-[state=closed]:animate-out',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  )
})
