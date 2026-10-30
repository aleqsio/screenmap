import { useEffect, useMemo, useState, useRef } from 'react'
import { ArrowLeft, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import TopBar from './TopBar'
import { flowResolution } from '../lib/loadBundle'
import { nodeLabel } from '../lib/label'

export default function Prototype({ bundle, mode, setMode, hasChanges, overlaid, platforms, platform, setPlatform, variants, variant, setVariant, screen, setScreen, state, setState, highlights, setHighlights, canBack, visit, back, open, closeChanges }) {
  const { manifest, map, images } = bundle
  const nodes = useMemo(() => new Map(map.nodes.map((n) => [n.id, n])), [map])
  const start = map.nodes.find((n) => n.urlPath === '/' && n.capture.prototype?.links?.length)?.id
    ?? map.nodes.find((n) => n.capture.prototype?.links?.length)?.id
    ?? map.nodes.find((n) => n.urlPath === '/' && n.capture.screenshot && (n.capture.status ?? 'ok') === 'ok')?.id
    ?? map.nodes.find((n) => n.capture.screenshot && (n.capture.status ?? 'ok') === 'ok')?.id
    ?? map.nodes[0]?.id
  const current = nodes.get(screen) ?? nodes.get(start)
  const hoverOnly = highlights === 'hover'
  const touchStart = useRef(null)
  const phone = useRef(null)
  const scrollTime = useRef(0)
  const [aspect, setAspect] = useState(0.46)
  const baseImage = current?.capture?.screenshot ? images.get(current.capture.screenshot) : null
  useEffect(() => {
    if (!baseImage) return
    const image = new Image()
    image.onload = () => setAspect(image.naturalWidth / image.naturalHeight)
    image.src = baseImage
    return () => { image.onload = null }
  }, [baseImage])
  useEffect(() => {
    if (current && screen !== current.id) setScreen(current.id, true)
  }, [current, screen, setScreen])
  useEffect(() => {
    if (state && current && !(current.capture.states ?? []).some((s) => s.name === state)) setScreen(current.id, true)
  }, [state, current, setScreen])
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
  const capture = current?.capture
  const displayed = state ? capture?.states?.find((s) => s.name === state) ?? capture : capture
  const img = displayed?.screenshot ? images.get(displayed.screenshot) : null
  const links = displayed?.prototype?.links ?? []
  const viewport = displayed?.prototype?.viewport ?? capture?.prototype?.viewport
  const frameAspect = viewport ? viewport.width / viewport.height : aspect
  const scroll = displayed?.prototype?.scroll
  useEffect(() => {
    const element = phone.current
    if (!element) return
    const wheel = (event) => {
      const next = scroll?.[event.deltaY > 0 ? 'next' : 'previous']
      if (!next || Math.abs(event.deltaY) <= 10) return
      event.preventDefault()
      if (Date.now() - scrollTime.current < 450) return
      scrollTime.current = Date.now()
      setState(next === '$base' ? null : next)
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [img, scroll, setState])
  const moveScroll = (direction) => {
    const next = scroll?.[direction]
    if (!next || Date.now() - scrollTime.current < 450) return
    scrollTime.current = Date.now()
    setState(next === '$base' ? null : next)
  }
  return (
    <div className="relative h-full overflow-auto bg-background">
      <TopBar manifest={manifest} mode={mode} setMode={setMode} hasChanges={hasChanges} overlaid={overlaid} stats={stats} platforms={platforms} platform={platform} setPlatform={setPlatform} variants={variants} variant={variant} setVariant={setVariant} onOpenBuffer={open} onCloseChanges={closeChanges} />
      <main className="mx-auto flex max-w-6xl flex-wrap items-start justify-center gap-6 px-4 pb-6 pt-36">
        <section className="flex min-w-0 flex-1 flex-col items-center gap-3">
          <div className="flex w-full max-w-md items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => back()} disabled={!canBack}><ArrowLeft /> Back</Button>
            <Button variant="outline" size="sm" onClick={() => { if (start) visit(start) }} disabled={!start}><RotateCcw /> Start</Button>
            <strong className="min-w-0 truncate text-sm">{current ? nodeLabel(current) : 'No screens'}</strong>
          </div>
          {capture && (capture.status !== 'ok' || capture.needsNavigation || capture.note) && (
            <p className="w-full max-w-md rounded-md border bg-muted px-3 py-2 text-sm" role="status">
              {capture.status === 'auth-wall' ? 'Authentication state differs' : capture.status !== 'ok' ? capture.status : 'Capture note'}{capture.note ? `: ${capture.note}` : capture.needsNavigation ? ': requires navigation' : ''}
            </p>
          )}
          {img ? (
            <div ref={phone} className="max-w-full overflow-y-auto overscroll-contain rounded-xl border" style={{ width: `min(100%, calc(${frameAspect * 100}vh - ${frameAspect * 300}px))`, maxHeight: 'calc(100vh - 300px)' }} onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientY }} onTouchEnd={(event) => { const delta = touchStart.current - event.changedTouches[0]?.clientY; if (Math.abs(delta) > 30) moveScroll(delta > 0 ? 'next' : 'previous') }}>
              <div className="relative leading-none">
              <img src={img} alt={`Capture: ${nodeLabel(current)}`} className="block h-auto w-full" />
              {links.map((link, i) => {
                const [x, y, w, h] = link.rect
                return <button key={`${link.to}-${i}`} type="button" disabled={link.action === 'back' && !canBack && !link.fallbackTo} aria-label={link.label} title={link.label} onClick={() => link.action === 'back' ? back(link.fallbackTo) : navigate(link.to, link.targetState ?? null)} className={`absolute rounded border-2 disabled:opacity-30 hover:border-primary/60 hover:bg-primary/25 focus-visible:border-primary/60 focus-visible:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${hoverOnly ? 'border-transparent bg-transparent' : 'border-primary/60 bg-primary/10'}`} style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }} />
              })}
              </div>
            </div>
          ) : <p className="rounded-md border px-4 py-8 text-sm text-muted-foreground">No capture for this screen.</p>}
          <p className="text-center text-xs text-muted-foreground">Captured prototype. {hoverOnly ? 'Hover over links to reveal them.' : 'Highlighted links open saved screens.'}{scroll ? ' Scroll inside the phone to view recorded positions.' : viewport ? ' Scroll inside the phone.' : ''}</p>
        </section>
        <aside className="w-full max-w-xs rounded-lg border bg-card p-4 text-sm">
          <label className="block font-semibold" htmlFor="prototype-screen">Screen</label>
          <select id="prototype-screen" value={current?.id ?? ''} onChange={(event) => navigate(event.target.value)} className="mt-2 w-full rounded border bg-background p-2">
            {map.nodes.map((node) => <option key={node.id} value={node.id}>{nodeLabel(node)}</option>)}
          </select>
          {(capture?.states ?? []).length > 0 && <div className="mt-4">
            <div className="text-xs text-muted-foreground">State</div>
            {capture.states.length <= 3 ? (
              <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={state ?? '$base'} onValueChange={(value) => { if (value) setState(value === '$base' ? null : value) }} aria-label="State" className="mt-2 flex w-full flex-wrap">
                <ToggleGroupItem value="$base" className="h-8 flex-1 text-xs data-[state=on]:bg-foreground data-[state=on]:text-background">Base</ToggleGroupItem>
                {capture.states.map((item) => <ToggleGroupItem key={item.name} value={item.name} className="h-8 flex-1 text-xs capitalize data-[state=on]:bg-foreground data-[state=on]:text-background">{item.name}</ToggleGroupItem>)}
              </ToggleGroup>
            ) : (
              <select aria-label="State" value={state ?? ''} onChange={(event) => setState(event.target.value || null)} className="mt-2 w-full rounded border bg-background p-2">
                <option value="">Base</option>
                {capture.states.map((item) => <option key={item.name} value={item.name} className="capitalize">{item.name}</option>)}
              </select>
            )}
          </div>}
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
