import { forwardRef } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  [
    'inline-flex select-none items-center justify-center font-medium outline-none',
    'transition-[transform,background-color,color,box-shadow,border-color] duration-200',
    'focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]',
    'disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-[var(--primary)] text-[var(--primary-foreground)] shadow-md hover:brightness-105 hover:shadow-lg',
        gold: 'bg-[var(--secondary-container)] text-[var(--secondary-container-foreground)] shadow-md hover:brightness-105 hover:shadow-lg',
        secondary: 'bg-[var(--accent)] text-[var(--accent-foreground)] hover:brightness-[0.98]',
        ghost: 'text-[var(--foreground)] hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]',
        danger: 'bg-[var(--destructive)] text-[var(--destructive-foreground)] shadow-md hover:brightness-105',
        outline: 'border border-[var(--border)] bg-transparent text-[var(--foreground)] hover:bg-[var(--accent)]',
      },
      size: {
        sm: 'h-8 gap-1.5 rounded-xl px-3.5 text-xs',
        md: 'h-10 gap-2 rounded-2xl px-5 text-sm',
        lg: 'h-12 gap-2.5 rounded-2xl px-7 text-base',
        xl: 'h-14 gap-3 rounded-[1.25rem] px-9 text-base',
        icon: 'h-10 w-10 rounded-2xl',
        'icon-sm': 'h-8 w-8 rounded-xl',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export const Button = forwardRef(function Button(
  {
    className, variant = 'primary', size = 'md', loading = false,
    disabled, children, asChild = false, type, ...props
  },
  ref,
) {
  const Component = asChild ? Slot : 'button'
  return (
    <Component
      ref={ref}
      type={asChild ? undefined : (type || 'button')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </Component>
  )
})
