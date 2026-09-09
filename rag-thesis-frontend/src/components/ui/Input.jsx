import { Children, cloneElement, forwardRef, isValidElement, useId } from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '../../lib/utils'

const FLOAT_EASE = 'ease-[cubic-bezier(0.2,0,0,1)]'

const baseField =
  'w-full rounded-2xl border bg-[var(--surface-0)] px-4 text-sm font-medium text-[var(--foreground)] ' +
  'placeholder:text-[var(--muted-foreground)] caret-[var(--primary)] outline-none ' +
  `transition-[border-color,box-shadow,background-color] duration-300 ${FLOAT_EASE} ` +
  'hover:border-forest-900/40 dark:hover:border-white/30 ' +
  'focus:border-[var(--primary)] focus:shadow-[inset_0_0_0_1px_var(--primary)]'

function FieldErrorHint({ error, hint, id }) {
  if (!error && !hint) return null
  return (
    <span
      id={id}
      role={error ? 'alert' : undefined}
      className={cn(
        'block pt-1.5 text-xs',
        error ? 'font-medium text-flame-500' : 'text-ink-faint',
      )}
    >
      {error || hint}
    </span>
  )
}

function FloatingLabel({ label, htmlFor, id, error, required, isTextarea, isAsteriskSuppressed, ariaHidden }) {
  return (
    <label
      htmlFor={htmlFor}
      id={id}
      aria-hidden={ariaHidden}
      className={cn(
        'pointer-events-none absolute left-4 origin-left select-none truncate text-sm sm:text-base text-[var(--muted-foreground)] will-change-transform',
        `transition-[translate,scale,color] duration-300 ${FLOAT_EASE}`,
        isTextarea
          ? 'top-5 -translate-y-1/2 peer-focus:-translate-y-[calc(50%_+_0.4rem)] peer-focus:scale-75 peer-[:not(:placeholder-shown)]:-translate-y-[calc(50%_+_0.4rem)] peer-[:not(:placeholder-shown)]:scale-75'
          : 'top-1/2 -translate-y-1/2 max-w-[calc(100%-2rem)] peer-focus:-translate-y-[calc(50%_+_0.75rem)] peer-focus:scale-75 peer-[:not(:placeholder-shown)]:-translate-y-[calc(50%_+_0.75rem)] peer-[:not(:placeholder-shown)]:scale-75',
        error
          ? 'peer-focus:text-flame-600 dark:peer-focus:text-flame-400'
          : 'peer-focus:text-forest-700 dark:peer-focus:text-forest-300',
      )}
    >
      {label}
      {required && !isAsteriskSuppressed && <span className="text-flame-500"> *</span>}
    </label>
  )
}

export const Input = forwardRef(function Input(
  {
    className,
    containerClassName,
    label,
    error,
    hint,
    required,
    endAdornment,
    id,
    placeholder,
    value,
    defaultValue,
    'aria-label': ariaLabel,
    nameFromLabel = true,
    ...props
  },
  ref,
) {
  const generatedId = useId()
  const fieldId = id || generatedId
  const descriptionId = `${fieldId}-desc`

  if (label) {
    const hasAsterisk = (typeof label === 'string' && label.includes('*')) || isValidElement(label)
    const resolvedPlaceholder = placeholder || ' '

    return (
      <div className={cn('w-full', containerClassName)}>
        <div className="group relative">
          <input
            ref={ref}
            id={fieldId}
            value={value}
            defaultValue={defaultValue}
            placeholder={resolvedPlaceholder}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={(error || hint) ? descriptionId : undefined}
            aria-label={ariaLabel}
            className={cn(
              'peer h-14 w-full rounded-2xl border bg-[var(--surface-0)] px-4 pb-2 pt-6 text-sm sm:text-base text-[var(--foreground)] caret-[var(--primary)] outline-none',
              `transition-[border-color,box-shadow,background-color] duration-300 ${FLOAT_EASE}`,
              'placeholder:text-transparent focus:placeholder:text-[var(--muted-foreground)]',
              endAdornment && 'pr-11',
              error
                ? 'border-[var(--destructive)] focus:shadow-[inset_0_0_0_1px_var(--destructive)]'
                : 'border-[var(--input)] hover:border-forest-900/40 focus:border-[var(--primary)] focus:shadow-[inset_0_0_0_1px_var(--primary)] dark:hover:border-white/30',
              className,
            )}
            {...props}
          />
          <FloatingLabel
            label={label}
            htmlFor={fieldId}
            error={error}
            required={required}
            isAsteriskSuppressed={hasAsterisk}
            ariaHidden={!nameFromLabel || Boolean(ariaLabel)}
          />
          {endAdornment && (
            <div className="absolute right-4 top-1/2 -translate-y-1/2">
              {endAdornment}
            </div>
          )}
        </div>
        <FieldErrorHint error={error} hint={hint} id={descriptionId} />
      </div>
    )
  }

  return (
    <input
      ref={ref}
      id={id}
      value={value}
      defaultValue={defaultValue}
      placeholder={placeholder === ' ' ? undefined : placeholder}
      aria-invalid={error ? 'true' : undefined}
      aria-label={ariaLabel}
      className={cn(
        baseField,
        'h-11',
        error
          ? 'border-[var(--destructive)] focus:shadow-[inset_0_0_0_1px_var(--destructive)]'
          : 'border-[var(--input)]',
        className,
      )}
      {...props}
    />
  )
})

export const Textarea = forwardRef(function Textarea(
  {
    className,
    containerClassName,
    label,
    error,
    hint,
    required,
    id,
    placeholder,
    value,
    defaultValue,
    'aria-label': ariaLabel,
    nameFromLabel = true,
    ...props
  },
  ref,
) {
  const generatedId = useId()
  const fieldId = id || generatedId
  const descriptionId = `${fieldId}-desc`

  if (label) {
    const hasAsterisk = (typeof label === 'string' && label.includes('*')) || isValidElement(label)
    const resolvedPlaceholder = placeholder || ' '

    return (
      <div className={cn('w-full', containerClassName)}>
        <div className="group relative">
          <textarea
            ref={ref}
            id={fieldId}
            value={value}
            defaultValue={defaultValue}
            placeholder={resolvedPlaceholder}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={(error || hint) ? descriptionId : undefined}
            aria-label={ariaLabel}
            className={cn(
              'peer min-h-24 w-full resize-y rounded-2xl border bg-[var(--surface-0)] px-4 pb-2 pt-7 text-sm sm:text-base text-[var(--foreground)] caret-[var(--primary)] outline-none',
              `transition-[border-color,box-shadow,background-color] duration-300 ${FLOAT_EASE}`,
              'placeholder:text-transparent focus:placeholder:text-[var(--muted-foreground)]',
              error
                ? 'border-[var(--destructive)] focus:shadow-[inset_0_0_0_1px_var(--destructive)]'
                : 'border-[var(--input)] hover:border-forest-900/40 focus:border-[var(--primary)] focus:shadow-[inset_0_0_0_1px_var(--primary)] dark:hover:border-white/30',
              className,
            )}
            {...props}
          />
          <FloatingLabel
            label={label}
            htmlFor={fieldId}
            error={error}
            required={required}
            isTextarea
            isAsteriskSuppressed={hasAsterisk}
            ariaHidden={!nameFromLabel || Boolean(ariaLabel)}
          />
        </div>
        <FieldErrorHint error={error} hint={hint} id={descriptionId} />
      </div>
    )
  }

  return (
    <textarea
      ref={ref}
      id={id}
      value={value}
      defaultValue={defaultValue}
      placeholder={placeholder === ' ' ? undefined : placeholder}
      aria-invalid={error ? 'true' : undefined}
      aria-label={ariaLabel}
      className={cn(
        baseField,
        'min-h-24 resize-y py-3',
        error
          ? 'border-[var(--destructive)] focus:shadow-[inset_0_0_0_1px_var(--destructive)]'
          : 'border-[var(--input)]',
        className,
      )}
      {...props}
    />
  )
})

function SelectDropdownPortal({ options, resolvedPlaceholder, contentClassName }) {
  return (
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
          {options.length > 0 ? options.map((option) => {
            const optionValue = String(option.props.value)
            return (
              <SelectPrimitive.Item
                key={option.key || optionValue}
                value={optionValue}
                disabled={option.props.disabled}
                className={cn(
                  'relative flex min-h-10 cursor-default select-none items-center justify-start rounded-xl px-3.5 py-2 text-left text-sm outline-none',
                  'text-[var(--popover-foreground)] data-[highlighted]:bg-[var(--accent)] data-[highlighted]:text-[var(--accent-foreground)]',
                  'data-[state=checked]:bg-[var(--accent)] data-[state=checked]:font-semibold data-[state=checked]:text-[var(--accent-foreground)]',
                  'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
                )}
              >
                <SelectPrimitive.ItemText>
                  <span className="block w-full max-w-[min(28rem,calc(100vw-5rem))] truncate text-left">
                    {option.props.children}
                  </span>
                </SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            )
          }) : (
            <div className="px-3.5 py-2 text-left text-sm text-[var(--muted-foreground)]">
              {resolvedPlaceholder}
            </div>
          )}
        </SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex h-7 items-center justify-center text-[var(--muted-foreground)]">
          <ChevronDown size={15} aria-hidden="true" />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectFloatingLabel({ label, labelId, error, required, nameFromLabel, ariaLabel }) {
  if (!label) return null
  const hasAsterisk = (typeof label === 'string' && label.includes('*')) || isValidElement(label)
  return (
    <span
      id={labelId}
      aria-hidden={!nameFromLabel || Boolean(ariaLabel)}
      className={cn(
        'pointer-events-none absolute left-4 top-1/2 origin-left select-none truncate text-sm sm:text-base text-[var(--muted-foreground)] will-change-transform',
        `transition-[translate,scale,color] duration-300 ${FLOAT_EASE}`,
        '-translate-y-[calc(50%_+_0.75rem)] scale-75 font-medium',
        error
          ? 'group-focus-visible:text-flame-600 dark:group-focus-visible:text-flame-400 group-data-[state=open]:text-flame-600'
          : 'group-focus-visible:text-forest-700 dark:group-focus-visible:text-forest-300 group-data-[state=open]:text-forest-700 dark:group-data-[state=open]:text-forest-300',
      )}
    >
      {label}
      {required && !hasAsterisk && <span className="text-flame-500"> *</span>}
    </span>
  )
}

export const Select = forwardRef(function Select(
  {
    className,
    containerClassName,
    contentClassName,
    label,
    error,
    hint,
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
    nameFromLabel = true,
    ...triggerProps
  },
  ref,
) {
  const generatedId = useId()
  const fieldId = id || generatedId
  const labelId = `${fieldId}-label`
  const descriptionId = `${fieldId}-desc`
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

  const trigger = (
    <SelectPrimitive.Trigger
      ref={ref}
      id={fieldId}
      aria-label={ariaLabel}
      aria-labelledby={nameFromLabel && label ? labelId : ariaLabelledBy}
      aria-describedby={(error || hint) ? descriptionId : undefined}
      aria-invalid={error ? 'true' : undefined}
      className={cn(
        'group inline-flex w-full select-none items-center justify-between gap-3 rounded-2xl border bg-[var(--surface-0)] text-left outline-none',
        `transition-[border-color,box-shadow,background-color] duration-300 ${FLOAT_EASE}`,
        'hover:border-forest-900/40 dark:hover:border-white/30',
        'focus-visible:border-[var(--primary)] focus-visible:shadow-[inset_0_0_0_1px_var(--primary)]',
        'data-[state=open]:border-[var(--primary)] data-[state=open]:shadow-[inset_0_0_0_1px_var(--primary)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        error
          ? 'border-[var(--destructive)] focus-visible:shadow-[inset_0_0_0_1px_var(--destructive)]'
          : 'border-[var(--input)]',
        label
          ? 'relative h-14 px-4 pb-2 pt-6 text-sm sm:text-base'
          : 'h-11 px-4 text-sm font-medium',
        className,
      )}
      {...triggerProps}
    >
      <SelectFloatingLabel
        label={label}
        labelId={labelId}
        error={error}
        required={required}
        nameFromLabel={nameFromLabel}
        ariaLabel={ariaLabel}
      />
      <SelectPrimitive.Value
        placeholder={resolvedPlaceholder}
        className={cn(
          'min-w-0 flex-1 truncate font-medium text-left text-sm sm:text-base text-[var(--foreground)]',
          label && 'pt-0.5',
        )}
      />
      <SelectPrimitive.Icon asChild>
        <ChevronDown
          size={16}
          className="shrink-0 opacity-55 transition-transform duration-200 group-data-[state=open]:rotate-180"
          aria-hidden="true"
        />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )

  const content = (
    <SelectPrimitive.Root
      value={value == null ? undefined : String(value)}
      defaultValue={defaultValue == null ? undefined : String(defaultValue)}
      onValueChange={handleValueChange}
      disabled={disabled}
      name={name}
      required={required}
    >
      {trigger}
      <SelectDropdownPortal
        options={selectableOptions}
        resolvedPlaceholder={resolvedPlaceholder}
        contentClassName={contentClassName}
      />
    </SelectPrimitive.Root>
  )

  if (label || error || hint) {
    return (
      <div className={cn('w-full', containerClassName)}>
        {content}
        <FieldErrorHint error={error} hint={hint} id={descriptionId} />
      </div>
    )
  }

  return content
})

export function Field({
  label,
  hint,
  error,
  children,
  required,
  nameFromLabel = true,
  className,
}) {
  const generatedId = useId()
  const labelId = `${generatedId}-label`
  const descriptionId = `${generatedId}-desc`

  if (isValidElement(children)) {
    if (typeof children.type === 'function' || typeof children.type === 'object') {
      return cloneElement(children, {
        label: children.props.label !== undefined ? children.props.label : label,
        hint: children.props.hint !== undefined ? children.props.hint : hint,
        error: children.props.error !== undefined ? children.props.error : error,
        required: children.props.required !== undefined ? children.props.required : required,
        nameFromLabel: children.props.nameFromLabel !== undefined ? children.props.nameFromLabel : nameFromLabel,
        containerClassName: cn(className, children.props.containerClassName),
        id: children.props.id || generatedId,
      })
    }
  }

  const hasAsterisk = (typeof label === 'string' && label.includes('*')) || isValidElement(label)

  return (
    <div className={cn('w-full', className)}>
      <div
        className={cn(
          'group relative flex min-h-14 w-full flex-col justify-center rounded-2xl border bg-[var(--surface-0)] px-4 pb-2 pt-6',
          `transition-[border-color,box-shadow,background-color] duration-300 ${FLOAT_EASE}`,
          error
            ? 'border-[var(--destructive)] focus-within:shadow-[inset_0_0_0_1px_var(--destructive)]'
            : 'border-[var(--input)] hover:border-forest-900/40 focus-within:border-[var(--primary)] focus-within:shadow-[inset_0_0_0_1px_var(--primary)] dark:hover:border-white/30',
        )}
      >
        {label && (
          <span
            id={labelId}
            className="pointer-events-none absolute left-4 top-2 select-none text-[11px] font-semibold uppercase tracking-wider text-ink-muted transition-colors duration-300 group-focus-within:text-forest-700 dark:group-focus-within:text-forest-300"
          >
            {label}
            {required && !hasAsterisk && <span className="ml-0.5 text-flame-500">*</span>}
          </span>
        )}
        {children}
      </div>
      <FieldErrorHint error={error} hint={hint} id={descriptionId} />
    </div>
  )
}

