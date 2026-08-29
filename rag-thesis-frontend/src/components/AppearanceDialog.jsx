import { usePreferences } from '../context/PreferencesContext'
import { Button } from './ui/Button'
import { AppearanceControls } from './ui/AppearanceControls'
import { Modal } from './ui/Modal'

/**
 * Lightweight appearance dialog for public pages (landing), where /settings is
 * not reachable. Signed-in users get the same controls in Settings → Appearance.
 */
export function AppearanceDialog({ open, onClose }) {
  const { resetPreferences } = usePreferences()

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Appearance and energy"
      description="Personalize the interface without changing research content or access permissions."
    >
      <AppearanceControls />
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={resetPreferences}>Reset</Button>
        <Button onClick={onClose}>Done</Button>
      </div>
    </Modal>
  )
}
