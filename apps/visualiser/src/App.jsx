import { ReactFlowProvider } from '@xyflow/react'
import { useBundles } from './lib/useBundles'
import Landing from './components/Landing'
import Graph from './components/Graph'
import Prototype from './components/Prototype'
import Gallery from './components/Gallery'

export default function App() {
  const b = useBundles()
  if (!b.bundle) {
    return <Landing onOpenBuffer={b.open} onLoadDemo={b.loadDemo} demoAvailable={b.demoAvailable} busy={b.busy} error={b.error} />
  }
  if (b.mode === 'gallery') return <Gallery {...b} />
  if (b.mode === 'prototype') return <Prototype {...b} />
  // remount on bundle load or mode switch: clean selection, fresh layout
  return (
    <ReactFlowProvider key={`${b.gen}-${b.mode}`}>
      <Graph
        bundle={b.bundle}
        mode={b.mode}
        setMode={b.setMode}
        hasChanges={b.hasChanges}
        overlaid={b.overlaid}
        platforms={b.platforms}
        platform={b.platform}
        setPlatform={b.setPlatform}
        availability={b.availability}
        profiles={b.profiles}
        selection={b.selection}
        setCaptureAxis={b.setCaptureAxis}
        variants={b.variants}
        variant={b.variant}
        setVariant={b.setVariant}
        onOpenBuffer={b.open}
        onCloseChanges={b.closeChanges}
        screen={b.screen}
        setScreen={b.setScreen}
      />
    </ReactFlowProvider>
  )
}
