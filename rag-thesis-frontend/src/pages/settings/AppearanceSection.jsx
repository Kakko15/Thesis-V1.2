import { Palette } from 'lucide-react'
import { toast } from 'sonner'
import { usePreferences } from '../../context/PreferencesContext'
import { Button } from '../../components/ui/Button'
import { AppearanceControls } from '../../components/ui/AppearanceControls'
import { SectionCard } from './SectionCard'

export function AppearanceSection() {
  const { resetPreferences } = usePreferences()

  const handleReset = () => {
    resetPreferences()
    toast.success('Appearance reset to defaults')
  }

  return (
    <div className="space-y-5">
      <SectionCard
        icon={Palette}
        title="Appearance"
        description="Personalize the interface without changing research content or access permissions."
        tone="gold"
        actions={<Button variant="ghost" size="sm" onClick={handleReset}>Reset</Button>}
      >
        <AppearanceControls />
      </SectionCard>
    </div>
  )
}
