import { useEffect, useMemo } from 'react'
import { ArrowLeft, RotateCcw, Columns2, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import TopBar from './TopBar'
import CaptureControls from './CaptureControls'
import CaptureAvailability from './CaptureAvailability'
import PrototypeCapture from './PrototypeCapture'
import { resolveProfile, captureForProfile } from '../lib/captureSelection'
import { flowResolution } from '../lib/loadBundle'
import { nodeLabel } from '../lib/label'

export default function Prototype({ sourceBundle, profiles, selection, setCaptureAxis, setCaptureSelection, availability, comparing, setComparing, panes, setPanes, bundle, mode, setMode, hasChanges, overlaid, platforms, platform, setPlatform, variants, variant, setVariant, screen, setScreen, state, setState, highlights, setHighlights, canBack, canClose, visit, back, open, closeChanges }) {
  const { manifest, map, images } = bundle
  const nodes = useMemo(() => new Map(map.nodes.map((n) => [n.id, n])), [map])
  const start = map.nodes.find((n) => n.urlPath === '/' && n.capture.prototype?.links?.length)?.id
    ?? map.nodes.find((n) => n.capture.prototype?.links?.length)?.id
    ?? map.nodes.find((n) => n.urlPath === '/' && n.capture.screenshot && (n.capture.status ?? 'ok') === 'ok')?.id
    ?? map.nodes.find((n) => n.capture.screenshot && (n.capture.status ?? 'ok') === 'ok')?.id
    ?? map.nodes[0]?.id
  const current = nodes.get(screen) ?? nodes.get(start)
  const hoverOnly = highlights === 'hover'
  useEffect(() => {
    if (current && screen !== current.id) setScreen(current.id, true)
  }, [current, screen, setScreen])
  const connections = useMemo(() => {
    if (!current) return []
    const ids = new Set(map.edges.filter((edge) => edge.from === current.id && edge.to && edge.to !== current.id).map((edge) => edge.to))
    const { paths } = flowResolution(map)
    for (const path of Object.values(paths)) {
      path.forEach((id, index) => {
        if (id === current.id && path[index + 1] && path[index + 1] !== id) ids.add(path[index + 1])
      })
    }
    return [...ids].map((id) => nodes.get(id)).filter(Boolean)
  }, [current, map, nodes])
  const navigate = (id, targetState = null) => {
    if (!nodes.has(id) || (id === current?.id && targetState === state)) return
    visit(id, targetState)
  }
  const stats = { screens: map.nodes.length, captured: map.nodes.filter((n) => n.capture.screenshot && (n.capture.status ?? 'ok') === 'ok').length, flows: map.flows.length }
  const rawNode = sourceBundle?.map.nodes.find((node) => node.id === current?.id) ?? current
  const panelSelections = comparing ? panes : [selection]
  const panelCaptures = panelSelections.map((item) => {
    const profile = resolveProfile(profiles, item)
    return { selection: item, profile, capture: captureForProfile(rawNode, profile), displayed: captureForProfile(rawNode, profile, state) }
  })
  const displayed = panelCaptures[0]?.displayed
  const interactionReport = displayed?.interactions
  const unresolvedControls = interactionReport?.controls?.filter((control) => control.status !== 'linked') ?? []
  const captureStates = [...new Set(panelCaptures.flatMap((item) => item.capture?.states?.map((entry) => entry.name) ?? []))].map((name) => ({ name }))
  if (state && !captureStates.some((item) => item.name === state)) captureStates.push({ name: state })
  return (
    <div className="relative h-full overflow-auto bg-background">
      <TopBar screen={screen} availability={availability} manifest={manifest} mode={mode} setMode={setMode} hasChanges={hasChanges} overlaid={overlaid} stats={stats} platforms={comparing ? [] : platforms} platform={platform} setPlatform={setPlatform} variants={comparing ? [] : variants} variant={variant} setVariant={setVariant} profiles={comparing ? undefined : profiles} selection={selection} setCaptureAxis={setCaptureAxis} inFlow onOpenBuffer={open} onCloseChanges={closeChanges} />
      <main className="mx-auto flex max-w-[1800px] flex-wrap items-start justify-center gap-6 px-4 pb-6 pt-6">
        <section className="flex min-w-0 flex-1 flex-col items-center gap-3">
          <div className="flex w-full max-w-md items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => back()} disabled={!canBack}><ArrowLeft /> Back</Button>
            <Button variant="outline" size="sm" onClick={() => { if (start) visit(start) }} disabled={!start}><RotateCcw /> Start</Button>
            <Button variant={comparing ? "default" : "outline"} size="sm" onClick={() => setComparing(!comparing)} aria-pressed={comparing}><Columns2 /> Compare</Button>
            <strong className="min-w-0 truncate text-sm">{current ? nodeLabel(current) : 'No screens'}</strong>
          </div>
          {comparing && <p className="text-xs text-muted-foreground">Navigation is linked. An action in any panel updates all panels.</p>}
          <div className={`flex w-full items-start justify-center gap-4 ${comparing ? 'flex-wrap' : ''}`}>
            {panelCaptures.map((item, index) => <section key={index} aria-label={`Capture panel ${index + 1}`} className={`flex min-w-0 flex-col items-center gap-3 ${comparing ? 'w-full flex-1 basis-64 rounded-lg border bg-card/50 p-3' : 'w-full'}`}>
              {comparing && <div className="w-full">
                <div className="mb-3 flex items-center justify-between"><strong className="text-xs">Panel {index + 1}{item.profile?.device ? ` · ${item.profile.device}` : ''}</strong>{panes.length > 2 && <Button variant="ghost" size="icon-sm" aria-label={`Remove panel ${index + 1}`} onClick={() => setPanes(panes.filter((_, i) => i !== index))}><X /></Button>}</div>
                <CaptureControls availability={availability} profiles={profiles} selection={item.selection} compact onChange={(key, value) => setPanes(panes.map((pane, i) => i === index ? { ...pane, [key]: value } : pane))} />
                <div className="mt-1"><CaptureAvailability availability={availability} selection={item.selection} compact onSelect={(value) => setPanes(panes.map((pane, i) => i === index ? value : pane))} /></div>
              </div>}
              {item.capture && ((item.capture.status ?? 'ok') !== 'ok' || item.capture.needsNavigation || item.capture.note) && <p className="max-w-sm rounded border bg-muted p-2 text-xs" role="status">{item.capture.status === 'auth-wall' ? 'Authentication state differs' : (item.capture.status ?? 'ok') !== 'ok' ? item.capture.status : 'Capture note'}{item.capture.note ? `: ${item.capture.note}` : item.capture.needsNavigation ? ': requires navigation' : ''}</p>}
              {comparing && <p className="text-xs text-muted-foreground">Navigation coverage · {item.displayed?.interactions?.status === 'complete' ? 'Complete' : item.displayed?.interactions?.status === 'partial' ? 'Partial' : 'Not inventoried'}</p>}
              <PrototypeCapture node={current} capture={item.capture} displayed={item.displayed} images={images} state={state} setState={setState} comparing={comparing} highlights={highlights} canBack={canBack} canClose={canClose} back={back} navigate={navigate} />
            </section>)}
          </div>
          {comparing && panes.length < 4 && <Button variant="outline" size="sm" onClick={() => setPanes([...panes, { ...selection }])}><Plus /> Add panel</Button>}

        </section>
        <aside className="w-full max-w-xs rounded-lg border bg-card p-4 text-sm">
          <label className="block font-semibold" htmlFor="prototype-screen">Screen</label>
          <select id="prototype-screen" value={current?.id ?? ''} onChange={(event) => navigate(event.target.value)} className="mt-2 w-full rounded border bg-background p-2">
            {map.nodes.map((node) => <option key={node.id} value={node.id}>{nodeLabel(node)}</option>)}
          </select>
          {captureStates.length > 0 && <div className="mt-4">
            <div className="text-xs text-muted-foreground">State</div>
            {captureStates.length <= 3 ? (
              <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={state ?? '$base'} onValueChange={(value) => { if (value) setState(value === '$base' ? null : value) }} aria-label="State" className="mt-2 flex w-full flex-wrap">
                <ToggleGroupItem value="$base" className="h-8 flex-1 text-xs data-[state=on]:bg-foreground data-[state=on]:text-background">Base</ToggleGroupItem>
                {captureStates.map((item) => <ToggleGroupItem key={item.name} value={item.name} className="h-8 flex-1 text-xs capitalize data-[state=on]:bg-foreground data-[state=on]:text-background">{item.name}</ToggleGroupItem>)}
              </ToggleGroup>
            ) : (
              <select aria-label="State" value={state ?? ''} onChange={(event) => setState(event.target.value || null)} className="mt-2 w-full rounded border bg-background p-2">
                <option value="">Base</option>
                {captureStates.map((item) => <option key={item.name} value={item.name} className="capitalize">{item.name}</option>)}
              </select>
            )}
          </div>}
          {!comparing && <CaptureAvailability availability={availability} selection={selection} onSelect={setCaptureSelection} />}
          <div className="mt-4 border-t pt-4">
            <div className="text-xs text-muted-foreground">Highlights</div>
            <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={hoverOnly ? 'hover' : 'always'} onValueChange={setHighlights} aria-label="Highlights" className="mt-2 flex w-full">
              <ToggleGroupItem value="always" className="h-8 flex-1 text-xs data-[state=on]:bg-foreground data-[state=on]:text-background">Always</ToggleGroupItem>
              <ToggleGroupItem value="hover" className="h-8 flex-1 text-xs data-[state=on]:bg-foreground data-[state=on]:text-background">On hover</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <h2 className="mt-5 font-semibold">Connected screens</h2>
          <p className="mt-1 text-xs text-muted-foreground">Routes found in the map and recorded flows.</p>
          <div className="mt-2 flex max-h-[45vh] flex-col gap-1 overflow-auto">
            {connections.map((node) => <Button key={node.id} variant="ghost" size="sm" className="h-auto justify-start whitespace-normal text-left" onClick={() => navigate(node.id)}>{nodeLabel(node)}</Button>)}
            {!connections.length && <p className="py-2 text-muted-foreground">No connected screens recorded.</p>}
          </div>
          <details className="mt-4 border-t pt-4">
            <summary className="cursor-pointer font-semibold">{comparing ? 'Panel 1 navigation coverage' : 'Navigation coverage'} · {interactionReport?.status === 'complete' ? 'Complete' : interactionReport?.status === 'partial' ? 'Partial' : 'Not inventoried'}</summary>
            <p className="mt-2 text-xs text-muted-foreground">{interactionReport ? `${interactionReport.controls.filter((control) => control.status === 'linked').length} linked · ${unresolvedControls.length} unresolved controls` : 'This capture has no control inventory. Its visible buttons may need capture work.'}</p>
            {interactionReport?.reason && <p className="mt-2 text-xs text-muted-foreground">{interactionReport.reason}</p>}
            {unresolvedControls.length > 0 && <ul className="mt-2 space-y-2 text-xs">{unresolvedControls.map((control, index) => <li key={`${control.id}-${index}`}><strong>{control.label || 'Unlabeled control'}</strong>: {control.reason}</li>)}</ul>}
            {map.interactionCoverage && <p className="mt-3 text-xs text-muted-foreground">Whole map: {map.interactionCoverage.complete}/{map.interactionCoverage.captures} captures with complete navigation coverage.</p>}
          </details>
        </aside>
      </main>
    </div>
  )
}
