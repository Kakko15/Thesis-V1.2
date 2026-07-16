import * as Dialog from '@radix-ui/react-dialog'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from './Button'

export function Modal({ open, onClose, title, description, children, className, size = 'md' }) {
  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose?.()}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-[80] bg-[var(--scrim)] backdrop-blur-sm"
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount onOpenAutoFocus={(event) => {
              const autofocus = event.currentTarget.querySelector('[data-autofocus]')
              if (autofocus) {
                event.preventDefault()
                autofocus.focus()
              }
            }}>
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 10 }}
                transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                className={cn(
                  'surface-glass fixed left-1/2 top-1/2 z-[81] max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[1.75rem] p-6 sm:p-8',
                  sizes[size],
                  className,
                )}
              >
                <Dialog.Close asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Close dialog" className="absolute right-4 top-4">
                    <X size={16} />
                  </Button>
                </Dialog.Close>
                <Dialog.Title className={cn('font-display pr-8 text-xl font-bold tracking-tight', !title && 'sr-only')}>
                  {title || 'Dialog'}
                </Dialog.Title>
                <Dialog.Description className={cn('mt-1 text-sm opacity-70', !description && 'sr-only')}>
                  {description || 'Dialog content'}
                </Dialog.Description>
                <div className={cn((title || description) && 'mt-5')}>{children}</div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', danger = false, loading = false }) {
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !next && !loading && onClose?.()}>
      <AnimatePresence>
        {open && (
          <AlertDialog.Portal forceMount>
            <AlertDialog.Overlay asChild forceMount>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[90] bg-[var(--scrim)] backdrop-blur-sm"
              />
            </AlertDialog.Overlay>
            <AlertDialog.Content asChild forceMount>
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 18 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 8 }}
                transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                className="surface-glass fixed left-1/2 top-1/2 z-[91] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[1.75rem] p-6 sm:p-8"
              >
                <AlertDialog.Title className="font-display text-xl font-bold tracking-tight">
                  {title}
                </AlertDialog.Title>
                <AlertDialog.Description className="mt-3 text-sm leading-relaxed opacity-75">
                  {message}
                </AlertDialog.Description>
                <div className="mt-6 flex justify-end gap-3">
                  <AlertDialog.Cancel asChild>
                    <Button variant="ghost" disabled={loading}>Cancel</Button>
                  </AlertDialog.Cancel>
                  <AlertDialog.Action asChild>
                    <Button
                      variant={danger ? 'danger' : 'primary'}
                      loading={loading}
                      onClick={(event) => {
                        event.preventDefault()
                        onConfirm?.()
                      }}
                    >
                      {confirmLabel}
                    </Button>
                  </AlertDialog.Action>
                </div>
              </motion.div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        )}
      </AnimatePresence>
    </AlertDialog.Root>
  )
}
