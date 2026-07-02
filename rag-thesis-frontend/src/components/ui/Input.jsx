import { forwardRef } from 'react'
import { cn } from '../../lib/utils'

const baseField =
  'w-full rounded-2xl border bg-white/60 dark:bg-white/[0.05] backdrop-blur-xl px-4 text-sm ' +
  'border-forest-900/15 dark:border-white/12 placeholder:opacity-45 ' +
  'transition-all duration-300 outline-none ' +
  'focus:border-forest-600 dark:focus:border-forest-400 focus:ring-4 focus:ring-forest-600/10 dark:focus:ring-forest-400/10'

export const Input = forwardRef(function Input({ className, error, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(baseField, 'h-11', error && 'border-flame-500 focus:border-flame-500 focus:ring-flame-500/10', className)}
      {...props}
    />
  )
})

export const Textarea = forwardRef(function Textarea({ className, error, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(baseField, 'min-h-24 py-3 resize-y', error && 'border-flame-500', className)}
      {...props}
    />
  )
})

export const Select = forwardRef(function Select({ className, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(baseField, 'h-11 appearance-none pr-10 dark:[&>option]:bg-canvas-900', className)}
      {...props}
    >
      {children}
    </select>
  )
})

export function Field({ label, hint, error, children, required }) {
  return (
    <label className="block">
      {label && (
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider opacity-70">
          {label}
          {required && <span className="ml-1 text-flame-500">*</span>}
        </span>
      )}
      {children}
      {error ? (
        <span className="mt-1.5 block text-xs font-medium text-flame-500">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-xs opacity-50">{hint}</span>
      ) : null}
    </label>
  )
}
