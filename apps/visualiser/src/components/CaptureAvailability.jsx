import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { selectionOf, resolveProfile, availabilityCombinations } from '../lib/captureSelection'

const labels = { ios: 'iOS', android: 'Android', en: 'English', ar: 'Arabic', light: 'Light', dark: 'Dark', system: 'System' }

export default function CaptureAvailability({ availability, selection, onSelect, hasCurrentScreen = true, compact = false, defaultOpen = false }) {
  const [expanded, setExpanded] = useState(defaultOpen)
  const selected = resolveProfile(availability, selection)
  const rows = availabilityCombinations(availability)
  const groups = [...new Map(rows.map((profile) => [JSON.stringify([profile.platform, profile.osVersion]), { platform: profile.platform, osVersion: profile.osVersion }])).entries()]
  return <details open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)} className={compact ? 'w-full text-xs' : 'mt-4 border-t pt-4 text-sm'}>
    <summary className="cursor-pointer font-semibold">Available captures · {selected?.currentAvailable ? 'Captured' : 'Not captured'}</summary>
    <p className="mt-2 text-xs text-muted-foreground">{hasCurrentScreen ? 'Status is for the current screen and state.' : 'Status is for all saved images in this bundle.'} Counts show saved base screens and named states. Missing combinations have zero images.</p>
    <div className="mt-2 max-h-72 space-y-3 overflow-auto">
      {groups.map(([key, group]) => <section key={key}>
        <h3 className="mb-2 text-xs font-medium">{labels[group.platform] ?? group.platform} · {group.osVersion || 'OS unspecified'}</h3>
        <div className="grid grid-cols-2 gap-2">
          {rows.filter((profile) => profile.platform === group.platform && profile.osVersion === group.osVersion).map((profile) => <Button key={profile.id} variant={selected?.id === profile.id ? 'secondary' : 'outline'} className="h-auto min-w-0 flex-col items-start gap-1 whitespace-normal px-2 py-2 text-left text-xs" onClick={() => onSelect({ ...selectionOf(profile), ...(profile.unconfigured ? { variant: '' } : {}) })}>
            <span className="font-medium">{[profile.language || 'Language unspecified', profile.appearance || 'Appearance unspecified'].map((part) => labels[part] ?? part).join(' · ')}</span>
            <span className="text-muted-foreground">{profile.baseCount} screens · {profile.stateCount} states</span>
            <span className={profile.currentAvailable ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}>{profile.currentAvailable ? 'Captured here' : 'Not captured here'}</span>
            {availability.filter((item) => item.platform === profile.platform && item.osVersion === profile.osVersion && item.language === profile.language && item.appearance === profile.appearance).length > 1 && <span>{profile.label}</span>}
          </Button>)}
        </div>
      </section>)}
    </div>
  </details>
}
