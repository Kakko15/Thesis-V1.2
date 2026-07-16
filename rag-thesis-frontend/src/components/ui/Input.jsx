import { Children, cloneElement, forwardRef, isValidElement, useId } from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { cn } from '../../lib/utils'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'

const baseField =
  'w-full rounded-2xl border border-[var(--input)] bg-[var(--surface-1)] px-4 text-sm text-[var(--foreground)] ' +
  'placeholder:text-[var(--muted-foreground)] transition-[border-color,box-shadow,background-color] duration-200 outline-none ' +
  'focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--ring)]/20'

export const Input = forwardRef(function Input({ className, error, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(baseField, 'h-11', error && 'border-[var(--destructive)] focus:border-[var(--destructive)]', className)}
      {...props}
    />
  )
})

export const Textarea = forwardRef(function Textarea({ className, error, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(baseField, 'min-h-24 resize-y py-3', error && 'border-[var(--destructive)]', className)}
      {...props}
    />
  )
})

export const Select = forwardRef(function Select(
  {
    className,
    contentClassName,
    error,
    children,
    value,
    defaultValue,
    onChange,
    onValueChange,
    disabled,
    name,
    required,
    placeholder,
    id,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    ...triggerProps
  },
  ref,
) {
  const options = Children.toArray(children).filter(
    (child) => isValidElement(child) && child.type === 'option',
  )
  const placeholderOption = options.find((option) => String(option.props.value ?? '') === '')
  const selectableOptions = options.filter((option) => String(option.props.value ?? '') !== '')
  const resolvedPlaceholder = placeholder || placeholderOption?.props.children || 'Select an option'

  const handleValueChange = (nextValue) => {
    onValueChange?.(nextValue)
    onChange?.({
      target: { name, value: nextValue },
      currentTarget: { name, value: nextValue },
    })
  }

  return (
    <SelectPrimitive.Root
      value={value == null ? undefined : String(value)}
      defaultValue={defaultValue == null ? undefined : String(defaultValue)}
      onValueChange={handleValueChange}
      disabled={disabled}
      name={name}
      required={required}
    >
      <SelectPrimitive.Trigger
        ref={ref}
        id={id}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-invalid={error ? 'true' : undefined}
        className={cn(
          'group inline-flex h-11 w-full select-none items-center justify-between gap-3 rounded-2xl border border-[var(--input)] bg-[var(--surface-1)] px-4 text-left text-sm text-[var(--foreground)] outline-none',
          'transition-[border-color,box-shadow,background-color] duration-200 hover:bg-[var(--surface-2)]',
          'focus-visible:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]/20',
          'data-[placeholder]:text-[var(--muted-foreground)] data-[state=open]:border-[var(--primary)] data-[state=open]:bg-[var(--surface-2)] data-[state=open]:ring-2 data-[state=open]:ring-[var(--ring)]/20',
          'disabled:cursor-not-allowed disabled:opacity-50',
          error && 'border-[var(--destructive)] focus-visible:border-[var(--destructive)]',
          className,
        )}
        {...triggerProps}
      >
        <SelectPrimitive.Value placeholder={resolvedPlaceholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown
            size={16}
            className="shrink-0 opacity-55 transition-transform duration-200 group-data-[state=open]:rotate-180"
            aria-hidden="true"
          />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          collisionPadding={12}
          className={cn(
            'm3-select-content z-[140] max-h-[min(22rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] isolate overflow-hidden rounded-[1.35rem] border border-[var(--border)] bg-[var(--popover)] p-1.5 text-[var(--popover-foreground)] shadow-2xl',
            contentClassName,
          )}
        >
          <SelectPrimitive.ScrollUpButton className="flex h-7 items-center justify-center text-[var(--muted-foreground)]">
            <ChevronUp size={15} aria-hidden="true" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport>
            {selectableOptions.length > 0 ? selectableOptions.map((option) => {
              const optionValue = String(option.props.value)
              return (
                <SelectPrimitive.Item
                  key={option.key || optionValue}
                  value={optionValue}
                  disabled={option.props.disabled}
                  className={cn(
                    'relative flex min-h-10 cursor-default select-none items-center rounded-xl py-2 pl-9 pr-3 text-sm outline-none',
                    'text-[var(--popover-foreground)] data-[highlighted]:bg-[var(--accent)] data-[highlighted]:text-[var(--accent-foreground)]',
                    'data-[state=checked]:bg-[var(--primary-container)] data-[state=checked]:font-semibold data-[state=checked]:text-[var(--primary-container-foreground)]',
                    'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
                  )}
                >
                  <SelectPrimitive.ItemIndicator className="absolute left-3 inline-flex items-center justify-center">
                    <Check size={15} aria-hidden="true" />
                  </SelectPrimitive.ItemIndicator>
                  <SelectPrimitive.ItemText>{option.props.children}</SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              )
            }) : (
              <div className="px-3 py-2 text-sm text-[var(--muted-foreground)]">
                {resolvedPlaceholder}
              </div>
            )}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex h-7 items-center justify-center text-[var(--muted-foreground)]">
            <ChevronDown size={15} aria-hidden="true" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
})

export function Field({ label, hint, error, children, required }) {
  const generatedId = useId()
  const labelId = `${generatedId}-label`
  const descriptionId = `${generatedId}-description`
  const isSelectField = isValidElement(children) && children.type === Select

  if (isSelectField) {
    const labelledSelect = cloneElement(children, {
      'aria-labelledby': children.props['aria-labelledby'] || labelId,
      'aria-describedby': (error || hint) ? descriptionId : children.props['aria-describedby'],
    })
    return (
      <div className="block">
        {label && (
          <span id={labelId} className="mb-1.5 block text-xs font-semibold uppercase tracking-wider opacity-70">
            {label}
            {required && <span className="ml-1 text-flame-500">*</span>}
          </span>
        )}
        {labelledSelect}
        {error ? (
          <span id={descriptionId} className="mt-1.5 block text-xs font-medium text-flame-500">{error}</span>
        ) : hint ? (
          <span id={descriptionId} className="mt-1.5 block text-xs opacity-50">{hint}</span>
        ) : null}
      </div>
    )
  }

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
