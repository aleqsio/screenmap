import { useEffect, useRef, useState } from 'react'
import { nodeLabel } from '../lib/label'

export default function PrototypeCapture({ node, capture, displayed, images, state, setState, comparing, highlights, canBack, canClose, back, navigate }) {
  const phone = useRef(null)
  const touchStart = useRef(null)
  const scrollTime = useRef(0)
  const [aspect, setAspect] = useState(0.46)
  const img = displayed?.screenshot ? images.get(displayed.screenshot) : null
  const viewport = displayed?.prototype?.viewport ?? capture?.prototype?.viewport
  const frameAspect = viewport ? viewport.width / viewport.height : aspect
  const reservedHeight = comparing ? 400 : 280
  const scroll = displayed?.prototype?.scroll
  const hoverOnly = highlights === 'hover'
  useEffect(() => {
    if (!img) return
    const image = new Image()
    image.onload = () => setAspect(image.naturalWidth / image.naturalHeight)
    image.src = img
    return () => { image.onload = null }
  }, [img])
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
  if (!img) return <div role="status" className="flex min-h-64 w-full max-w-sm items-center justify-center rounded-xl border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">Not captured{state ? `: ${state}` : ''} for this selection.</div>
  return <>
    <div ref={phone} className="max-w-full overflow-y-auto overscroll-contain rounded-xl border bg-card" style={{ width: `min(100%, max(${frameAspect * 160}px, calc(${frameAspect * 100}vh - ${frameAspect * reservedHeight}px)))`, maxHeight: `max(160px, calc(100vh - ${reservedHeight}px))` }} onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientY }} onTouchEnd={(event) => { const delta = touchStart.current - event.changedTouches[0]?.clientY; if (Math.abs(delta) > 30) moveScroll(delta > 0 ? 'next' : 'previous') }}>
      <div className="relative leading-none">
        <img src={img} alt={`Capture: ${nodeLabel(node)}${state ? ` · ${state}` : ''}`} className="block h-auto w-full" />
        {(displayed.prototype?.links ?? []).map((link, i) => {
          const [x, y, w, h] = link.rect
          return <button key={`${link.to}-${i}`} type="button" disabled={link.action === 'back' && !(link.scope === 'screen' ? canClose : canBack) && !link.fallbackTo} aria-label={link.label} title={link.label} onClick={() => link.action === 'back' ? back(link.fallbackTo, link.scope) : navigate(link.to, link.targetState ?? null)} className={`absolute rounded border-2 disabled:opacity-30 hover:border-primary/60 hover:bg-primary/25 focus-visible:border-primary/60 focus-visible:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${hoverOnly ? 'border-transparent bg-transparent' : 'border-primary/60 bg-primary/10'}`} style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }} />
        })}
      </div>
    </div>
    <p className="text-center text-xs text-muted-foreground">{scroll ? 'Scroll to move all panels to the recorded position.' : 'Captured prototype.'} {hoverOnly ? 'Hover to reveal links.' : 'Highlights show saved navigation.'}</p>
  </>
}
