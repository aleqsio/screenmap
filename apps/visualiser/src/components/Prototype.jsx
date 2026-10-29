import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import TopBar from './TopBar'
import { flowResolution } from '../lib/loadBundle'
import { nodeLabel } from '../lib/label'

export default function Prototype({ bundle, mode, setMode, hasChanges, overlaid, platforms, platform, setPlatform, variants, variant, setVariant, screen, setScreen, open, closeChanges }) {
  const { manifest, map, images } = bundle
  const nodes = useMemo(() => new Map(map.nodes.map((n) => [n.id, n])), [map])
  const start = map.nodes.find((n) => n.urlPath === '/' && n.capture.prototype?.links?.length)?.id
    ?? map.nodes.find((n) => n.capture.prototype?.links?.length)?.id
    ?? map.nodes.find((n) => n.urlPath === '/' && n.capture.screenshot && (n.capture.status ?? 'ok') === 'ok')?.id
    ?? map.nodes.find((n) => n.capture.screenshot && (n.capture.status ?? 'ok') === 'ok')?.id
    ?? map.nodes[0]?.id
  const current = nodes.get(screen) ?? nodes.get(start)
  const [history, setHistory] = useState([])
  const [hoverOnly, setHoverOnly] = useState(() => new URLSearchParams(window.location.search).get('highlights') === 'hover')
  useEffect(() => {
    const restore = () => setHoverOnly(new URLSearchParams(window.location.search).get('highlights') === 'hover')
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [])
  const setHighlights = (value) => {
    if (!value) return
    const next = value === 'hover'
    const url = new URL(window.location.href)
    if (next) url.searchParams.set('highlights', 'hover')
    else url.searchParams.delete('highlights')
    window.history.pushState(window.history.state, '', url)
    setHoverOnly(next)
  }
  useEffect(() => {
    const reset = () => setHistory([])
    window.addEventListener('popstate', reset)
    return () => window.removeEventListener('popstate', reset)
  }, [])
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
  const navigate = (id) => {
    if (!nodes.has(id) || id === current?.id) return
    setHistory((previous) => [...previous, current.id])
    setScreen(id)
  }
  const back = () => {
    if (!history.length) return
    setScreen(history[history.length - 1])
    setHistory((previous) => previous.slice(0, -1))
  }
  const stats = { screens: map.nodes.length, captured: map.nodes.filter((n) => n.capture.screenshot && (n.capture.status ?? 'ok') === 'ok').length, flows: map.flows.length }
  const capture = current?.capture
  const img = capture?.screenshot ? images.get(capture.screenshot) : null
  const links = Array.isArray(capture?.prototype?.links) ? capture.prototype.links.filter((link) =>
    typeof link?.label === 'string' && nodes.has(link.to) && Array.isArray(link.rect) && link.rect.length === 4 &&
    link.rect.every(Number.isFinite) && link.rect[0] >= 0 && link.rect[1] >= 0 && link.rect[2] > 0 && link.rect[3] > 0 &&
    link.rect[0] + link.rect[2] <= 1 && link.rect[1] + link.rect[3] <= 1
  ) : []
  return (
    <div className="relative h-full overflow-auto bg-background">
      <TopBar manifest={manifest} mode={mode} setMode={setMode} hasChanges={hasChanges} overlaid={overlaid} stats={stats} platforms={platforms} platform={platform} setPlatform={setPlatform} variants={variants} variant={variant} setVariant={setVariant} onOpenBuffer={open} onCloseChanges={closeChanges} />
      <main className="mx-auto flex max-w-6xl flex-wrap items-start justify-center gap-6 px-4 pb-6 pt-36">
        <section className="flex min-w-0 flex-1 flex-col items-center gap-3">
          <div className="flex w-full max-w-md items-center gap-2">
            <Button variant="outline" size="sm" onClick={back} disabled={!history.length}><ArrowLeft /> Back</Button>
            <Button variant="outline" size="sm" onClick={() => { setHistory([]); if (start) setScreen(start) }} disabled={!start}><RotateCcw /> Start</Button>
            <strong className="min-w-0 truncate text-sm">{current ? nodeLabel(current) : 'No screens'}</strong>
          </div>
          {capture && (capture.status !== 'ok' || capture.needsNavigation || capture.note) && (
            <p className="w-full max-w-md rounded-md border bg-muted px-3 py-2 text-sm" role="status">
              {capture.status === 'auth-wall' ? 'Authentication state differs' : capture.status !== 'ok' ? capture.status : 'Capture note'}{capture.note ? `: ${capture.note}` : capture.needsNavigation ? ': requires navigation' : ''}
            </p>
          )}
          {img ? (
            <div className="relative inline-block max-w-full leading-none">
              <img src={img} alt={`Capture: ${nodeLabel(current)}`} className="block h-auto max-h-[calc(100vh-300px)] max-w-full rounded-xl border object-contain" />
              {links.map((link, i) => {
                const [x, y, w, h] = link.rect
                return <button key={`${link.to}-${i}`} type="button" aria-label={link.label} title={link.label} onClick={() => navigate(link.to)} className={`absolute rounded border-2 hover:border-primary/60 hover:bg-primary/25 focus-visible:border-primary/60 focus-visible:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${hoverOnly ? 'border-transparent bg-transparent' : 'border-primary/60 bg-primary/10'}`} style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }} />
              })}
            </div>
          ) : <p className="rounded-md border px-4 py-8 text-sm text-muted-foreground">No capture for this screen.</p>}
          <p className="text-center text-xs text-muted-foreground">Captured prototype. {hoverOnly ? 'Hover over links to reveal them.' : 'Highlighted links open saved screens.'}</p>
        </section>
        <aside className="w-full max-w-xs rounded-lg border bg-card p-4 text-sm">
          <label className="block font-semibold" htmlFor="prototype-screen">Screen</label>
          <select id="prototype-screen" value={current?.id ?? ''} onChange={(event) => navigate(event.target.value)} className="mt-2 w-full rounded border bg-background p-2">
            {map.nodes.map((node) => <option key={node.id} value={node.id}>{nodeLabel(node)}</option>)}
          </select>
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
        </aside>
      </main>
    </div>
  )
}
