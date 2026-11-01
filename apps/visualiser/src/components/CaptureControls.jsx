import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const names = { platform: 'Platform', osVersion: 'OS version', language: 'Language', appearance: 'Appearance' }
const labels = { ios: 'iOS', android: 'Android', en: 'English', ar: 'Arabic', light: 'Light', dark: 'Dark', system: 'System' }

export default function CaptureControls({ profiles, selection, onChange, compact = false }) {
  const matches = profiles.filter((profile) => Object.keys(names).every((key) => (profile[key] ?? '') === (selection[key] ?? '')))
  return <div className={`flex flex-wrap items-end gap-3 ${compact ? 'text-xs' : 'text-sm'}`}>
    {Object.keys(names).map((key) => {
      const available = key === 'osVersion' ? profiles.filter((p) => (p.platform ?? '') === selection.platform) : profiles
      const values = [...new Set(available.map((p) => p[key] ?? ''))]
      if (!values.includes(selection[key] ?? '')) values.push(selection[key] ?? '')
      const options = values.map((value) => ({ value, label: labels[value] ?? (value || 'Unspecified') }))
      return <div key={key} className="min-w-0"><div className="mb-1 text-[11px] font-medium text-muted-foreground">{names[key]}</div>
        {options.length <= 3 && key !== 'osVersion' ? <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={selection[key] || '$unspecified'} onValueChange={(value) => { if (value) onChange(key, value === '$unspecified' ? '' : value) }} aria-label={names[key]}>
          {options.map((option) => <ToggleGroupItem key={option.value} value={option.value || '$unspecified'} className="h-8 px-2 text-xs data-[state=on]:bg-foreground data-[state=on]:text-background">{option.label}</ToggleGroupItem>)}
        </ToggleGroup> : <select aria-label={names[key]} value={selection[key] ?? ''} onChange={(event) => onChange(key, event.target.value)} className="h-8 max-w-40 rounded-md border bg-background px-2 text-xs">
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>}
      </div>
    })}
    {matches.length > 1 && <label className="text-[11px] text-muted-foreground">Capture<select aria-label="Capture" className="mt-1 block h-8 rounded-md border bg-background px-2 text-xs text-foreground" value={selection.variant ?? ''} onChange={(event) => onChange('variant', event.target.value)}><option value="" disabled>Select capture</option>{matches.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></label>}
  </div>
}
