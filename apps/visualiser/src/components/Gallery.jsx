import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Play, Pause } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import TopBar from './TopBar'
import CaptureAvailability from './CaptureAvailability'
import { resolveProfile } from '../lib/captureSelection'
import { galleryFrames } from '../lib/gallery'
import { nodeLabel } from '../lib/label'

export default function Gallery(props) {
  const { sourceBundle, bundle, profiles, selection, availability, setCaptureAxis, setCaptureSelection, screen, state, visit, gallerySpeed, setGallerySpeed, open, closeChanges } = props
  const [playing, setPlaying] = useState(false)
  const profile = resolveProfile(profiles, selection)
  const frames = useMemo(() => galleryFrames(sourceBundle, profile), [sourceBundle, profile])
  const found = frames.findIndex((frame) => frame.screen === screen && frame.state === state)
  const index = found < 0 ? 0 : found
  const frame = frames[index]
  const selectionKey = JSON.stringify(selection)
  useEffect(() => { setPlaying(false) }, [selectionKey])
  useEffect(() => {
    if (found < 0 && frames.length) visit(frames[0].screen, frames[0].state, true)
  }, [found, frames, visit])
  const move = (delta) => {
    setPlaying(false)
    if (!frames.length) return
    const next = frames[(index + delta + frames.length) % frames.length]
    visit(next.screen, next.state)
  }
  useEffect(() => {
    const keydown = (event) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.target?.closest?.('input, select, textarea, [contenteditable="true"]')) return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        move(event.key === 'ArrowRight' ? 1 : -1)
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  })
  useEffect(() => {
    const pause = () => setPlaying(false)
    const visibility = () => { if (document.hidden) pause() }
    window.addEventListener('popstate', pause)
    document.addEventListener('visibilitychange', visibility)
    return () => { window.removeEventListener('popstate', pause); document.removeEventListener('visibilitychange', visibility) }
  }, [])
  useEffect(() => {
    if (!playing || frames.length < 2) return
    const timer = setTimeout(() => {
      const next = frames[(index + 1) % frames.length]
      visit(next.screen, next.state)
    }, gallerySpeed * 1000)
    return () => clearTimeout(timer)
  }, [playing, frames, index, gallerySpeed, visit])
  const stats = { screens: bundle.map.nodes.length, captured: availability.find((item) => item.id === profile?.id)?.baseCount ?? 0, flows: bundle.map.flows.length }
  return <div className="relative h-full overflow-auto bg-background">
    <TopBar {...props} stats={stats} inFlow onOpenBuffer={open} onCloseChanges={closeChanges} setCaptureAxis={(key, value) => { setPlaying(false); setCaptureAxis(key, value) }} manifest={bundle.manifest} />
    <main className="mx-auto flex max-w-6xl flex-wrap items-start justify-center gap-6 px-4 pb-6 pt-6">
      <section className="flex min-w-0 flex-1 flex-col items-center gap-3">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={!frames.length} onClick={() => move(-1)} aria-label="Previous capture"><ChevronLeft /> Previous</Button>
          <Button variant={playing ? 'default' : 'outline'} size="sm" disabled={frames.length < 2} onClick={() => setPlaying(!playing)}>{playing ? <Pause /> : <Play />}{playing ? 'Pause' : 'Play'}</Button>
          <Button variant="outline" size="sm" disabled={!frames.length} onClick={() => move(1)} aria-label="Next capture">Next <ChevronRight /></Button>
          <ToggleGroup type="single" variant="outline" size="sm" spacing={0} value={String(gallerySpeed)} onValueChange={(value) => { if (value) { setPlaying(false); setGallerySpeed(value) } }} aria-label="Gallery speed">
            {[2, 5, 10].map((seconds) => <ToggleGroupItem key={seconds} value={String(seconds)} className="data-[state=on]:bg-foreground data-[state=on]:text-background">{seconds}s</ToggleGroupItem>)}
          </ToggleGroup>
        </div>
        <div className="text-center text-sm" aria-live="polite"><strong>{frame ? `${index + 1} / ${frames.length} · ${nodeLabel(frame.node)}` : '0 / 0 · No saved captures'}</strong>{frame && <div className="mt-1 text-xs text-muted-foreground">{frame.state ?? 'Base'} · {playing ? `Playing every ${gallerySpeed} seconds` : 'Paused'} · ← / → to browse</div>}</div>
        {frame ? <>
          {((frame.capture.status ?? 'ok') !== 'ok' || frame.capture.note) && <p role="status" className="max-w-lg rounded border bg-muted px-3 py-2 text-xs">{frame.capture.status ?? 'Capture note'}{frame.capture.note ? `: ${frame.capture.note}` : ''}</p>}
          <img src={sourceBundle.images.get(frame.capture.screenshot)} alt={`Gallery capture: ${nodeLabel(frame.node)} · ${frame.state ?? 'Base'}`} className="block max-h-[max(160px,calc(100vh-330px))] max-w-full rounded-xl border object-contain" />
          <p className="text-xs text-muted-foreground">Saved screenshot · navigation is inactive in Gallery · wraps after the last capture.</p>
        </> : <p role="status" className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No captures for this exact platform, OS, language and appearance. Select a captured combination.</p>}
      </section>
      <aside className="w-full max-w-xs rounded-lg border bg-card p-4 text-sm">
        <h2 className="font-semibold">Capture gallery</h2>
        <p className="mt-2 text-xs text-muted-foreground">All saved screens and named states for the selected combination. Autoplay starts paused and stops when the tab is hidden.</p>
        <CaptureAvailability defaultOpen availability={availability} selection={selection} onSelect={(value) => { setPlaying(false); setCaptureSelection(value) }} />
      </aside>
    </main>
  </div>
}
