import * as Dialog from '@radix-ui/react-dialog'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '../../lib/utils'

export function Sheet({ open, onClose, title, children, className, responsiveClass = 'md:hidden' }) {
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
                className={cn('fixed inset-0 z-50 bg-[var(--scrim)]', responsiveClass)}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount>
              <motion.aside
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', stiffness: 380, damping: 38 }}
                className={cn(
                  'surface-glass fixed bottom-3 right-3 top-3 z-[51] w-[min(22rem,calc(100%-1.5rem))] overflow-y-auto rounded-[2rem] p-5',
                  responsiveClass,
                  className,
                )}
              >
                <Dialog.Title className="sr-only">{title}</Dialog.Title>
                <Dialog.Description className="sr-only">
                  Navigate the thesis library and manage account settings.
                </Dialog.Description>
                {children}
              </motion.aside>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}
