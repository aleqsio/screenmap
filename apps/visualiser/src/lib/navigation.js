const keys = ['mode', 'screen', 'state', 'variant', 'platform', 'highlights', 'language', 'appearance', 'osVersion', 'compare', 'panes', 'speed']

export function createNavigation(window) {
  const listeners = new Set()
  let token = window.history.state?.screenmap?.token ?? `${Date.now()}-${Math.random()}`
  const read = () => {
    const params = new URLSearchParams(window.location.search)
    const values = Object.fromEntries(keys.map((key) => [key, params.get(key)]))
    return { ...values, mode: ['map', 'changes', 'prototype', 'gallery'].includes(values.mode) ? values.mode : 'map', canBack: window.history.state?.screenmap?.token === token && (window.history.state.screenmap.backSteps ?? 0) > 0, canClose: window.history.state?.screenmap?.token === token && (window.history.state.screenmap.closeSteps ?? 0) > 0 }
  }
  const notify = () => listeners.forEach((listener) => listener(read()))
  const change = (values, { replace = false, visit = false } = {}) => {
    const url = new URL(window.location.href)
    for (const [key, value] of Object.entries(values)) {
      if (value) url.searchParams.set(key, value)
      else url.searchParams.delete(key)
    }
    const prior = window.history.state?.screenmap
    const backSteps = prior?.token === token ? prior.backSteps ?? 0 : 0
    const closeSteps = prior?.token === token ? prior.closeSteps ?? 0 : 0
    const newMode = values.mode && values.mode !== read().mode
    const nextSteps = newMode ? 0 : replace ? backSteps : visit ? 1 : backSteps ? backSteps + 1 : 0
    const nextCloseSteps = newMode ? 0 : replace ? closeSteps : visit && values.screen !== read().screen ? 1 : closeSteps ? closeSteps + 1 : 0
    window.history[replace ? 'replaceState' : 'pushState']({ ...window.history.state, screenmap: { token, backSteps: nextSteps, closeSteps: nextCloseSteps } }, '', url)
    notify()
  }
  let pendingOptions = null
  const onPop = () => {
    if (pendingOptions) {
      const values = pendingOptions
      pendingOptions = null
      change(values, { replace: true })
    } else notify()
  }
  return {
    read,
    subscribe(listener) { if (!listeners.size) window.addEventListener('popstate', onPop); listeners.add(listener); return () => { listeners.delete(listener); if (!listeners.size) window.removeEventListener('popstate', onPop) } },
    change,
    visit(screen, state = null) { change({ screen, state }, { visit: true }) },
    back(fallbackTo, scope = 'visit') {
      const info = window.history.state?.screenmap
      const steps = scope === 'screen' ? info?.closeSteps : info?.backSteps
      if (info?.token === token && steps > 0) {
        const current = read()
        pendingOptions = Object.fromEntries(['variant', 'platform', 'language', 'appearance', 'osVersion', 'compare', 'panes', 'highlights', 'speed'].map((key) => [key, current[key]]))
        window.history.go(-steps)
      }
      else if (typeof fallbackTo === 'string' && fallbackTo) change({ screen: fallbackTo, state: null }, { replace: true })
    },
    reset() { token = `${Date.now()}-${Math.random()}`; change({ screen: null, state: null }, { replace: true }) },
  }
}
