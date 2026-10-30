import { Button } from '@/components/ui/button'
import { selectionOf, resolveProfile, availabilityCombinations } from '../lib/captureSelection'

const labels = { ios: 'iOS', android: 'Android', en: 'English', ar: 'Arabic', light: 'Light', dark: 'Dark', system: 'System' }

export default function CaptureAvailability({ availability, selection, onSelect, compact = false }) {
  const selected = resolveProfile(availability, selection)
  const rows = availabilityCombinations(availability)
  return <details className={compact ? 'w-full text-xs' : 'mt-4 border-t pt-4 text-sm'}>
    <summary className="cursor-pointer font-semibold">Available captures · {selected?.currentAvailable ? 'Captured' : 'Not captured'}</summary>
    <p className="mt-2 text-xs text-muted-foreground">Status is for the current screen and state. Counts show saved base screens and named states. Missing combinations have zero images.</p>
    <div className="mt-2 flex max-h-64 flex-col gap-2 overflow-auto">
      {rows.map((profile) => <Button key={profile.id} variant={selected?.id === profile.id ? 'secondary' : 'outline'} className="h-auto w-full flex-col items-start gap-1 whitespace-normal px-3 py-2 text-left text-xs" onClick={() => onSelect({ ...selectionOf(profile), ...(profile.unconfigured ? { variant: '' } : {}) })}>
        <span>{[profile.platform, profile.osVersion || 'OS unspecified', profile.language || 'Language unspecified', profile.appearance || 'Appearance unspecified'].map((part) => labels[part] ?? part).join(' · ')}</span>
        <span className="text-muted-foreground">{profile.currentAvailable ? 'Captured' : 'Not captured'} here · {profile.baseCount} screens · {profile.stateCount} states</span>
        {availability.filter((item) => item.platform === profile.platform && item.osVersion === profile.osVersion && item.language === profile.language && item.appearance === profile.appearance).length > 1 && <span>{profile.label}</span>}
      </Button>)}
    </div>
  </details>
}
