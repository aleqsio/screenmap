import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createNavigation } from './navigation.js'

function browser(initial) {
  let entries = [{ url: initial, state: null }], index = 0
  const listeners = new Set()
  const window = {
    location: { href: initial, search: new URL(initial).search },
    addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn),
    history: {
      get state() { return entries[index].state },
      pushState(state, _, url) { entries = entries.slice(0, index + 1); entries.push({ state, url: String(url) }); index++; sync() },
      replaceState(state, _, url) { entries[index] = { state, url: String(url) }; sync() },
      go(delta) { const next = index + delta; if (next < 0 || next >= entries.length) return; index = next; sync(); listeners.forEach((fn) => fn()) },
    },
  }
  function sync() { window.location.href = entries[index].url; window.location.search = new URL(entries[index].url).search }
  return window
}

test('in-page Back then browser Back returns through consecutive visits', () => {
  const window = browser('http://localhost/?mode=prototype&screen=A')
  const nav = createNavigation(window)
  let current = nav.read()
  const unsubscribe = nav.subscribe((next) => { current = next })
  nav.visit('B')
  nav.visit('C')
  nav.back()
  assert.equal(current.screen, 'B')
  window.history.go(-1)
  assert.equal(current.screen, 'A')
  assert.equal(current.canBack, false)
  unsubscribe()
})

test('visits and option history restore through in-page Back, browser Back, reload and replacement', () => {
  const window = browser('http://localhost/?map=demo&mode=prototype&screen=A#keep')
  const nav = createNavigation(window)
  let current = nav.read()
  let unsubscribe = nav.subscribe((next) => { current = next })
  assert.equal(current.canBack, false)
  nav.visit('B'); nav.change({ highlights: 'hover' }); nav.visit('C', 'menu')
  assert.equal(current.state, 'menu')
  nav.back()
  assert.equal(current.screen, 'B')
  assert.equal(current.highlights, 'hover')
  window.history.go(-1)
  assert.equal(current.screen, 'B')
  assert.equal(current.highlights, null)
  nav.back()
  assert.equal(current.screen, 'A')
  assert.equal(current.canBack, false)
  window.history.go(1)
  unsubscribe()
  const reload = createNavigation(window)
  current = reload.read()
  unsubscribe = reload.subscribe((next) => { current = next })
  assert.equal(current.screen, 'B')
  assert.equal(current.canBack, true)
  reload.change({ variant: 'ar-dark' })
  reload.back()
  assert.equal(current.screen, 'A')
  reload.reset()
  assert.equal(current.canBack, false)
  assert.equal(current.screen, null)
  assert.equal(new URL(window.location.href).searchParams.get('map'), 'demo')
  assert.equal(new URL(window.location.href).hash, '#keep')
  unsubscribe()
})

test('Back uses history before fallback and replaces a directly opened screen without losing URL options', () => {
  const window = browser('http://localhost/?map=demo&mode=prototype&screen=credits&state=menu&variant=ar-dark&highlights=hover#keep')
  const nav = createNavigation(window)
  let current = nav.read()
  const unsubscribe = nav.subscribe((next) => { current = next })
  nav.back({ nativeEvent: {} })
  assert.equal(current.screen, 'credits')
  nav.back('home')
  assert.equal(current.screen, 'home')
  assert.equal(current.state, null)
  assert.equal(current.canBack, false)
  assert.equal(current.variant, 'ar-dark')
  assert.equal(current.highlights, 'hover')
  assert.equal(new URL(window.location.href).searchParams.get('map'), 'demo')
  assert.equal(new URL(window.location.href).hash, '#keep')
  window.history.go(-1)
  assert.equal(current.screen, 'home')
  nav.visit('studio')
  nav.visit('credits')
  nav.back('home')
  assert.equal(current.screen, 'studio')
  nav.back()
  assert.equal(current.screen, 'home')
  nav.back()
  assert.equal(current.screen, 'home')
  unsubscribe()
})


test('Close leaves the screen across menu states while Back visits the previous state', () => {
  const window = browser('http://localhost/?map=demo&mode=prototype&screen=studio&variant=ar')
  const nav = createNavigation(window)
  nav.visit('player')
  nav.visit('player', 'menu')
  nav.change({ highlights: 'hover' })
  nav.back('home', 'screen')
  assert.equal(nav.read().screen, 'studio')
  assert.equal(nav.read().state, null)
  window.history.go(1)
  nav.visit('player', 'menu')
  nav.back()
  assert.equal(nav.read().screen, 'player')
  assert.equal(nav.read().state, null)
  const direct = createNavigation(browser('http://localhost/?mode=prototype&screen=player&state=menu'))
  direct.visit('player', 'details')
  assert.equal(direct.read().canBack, true)
  assert.equal(direct.read().canClose, false)
  direct.back('home', 'screen')
  assert.equal(direct.read().screen, 'home')
  assert.equal(direct.read().state, null)
})

test('comparison selections persist through shared Visits, in-page Close, reload and browser option history', () => {
  const window = browser('http://localhost/?map=demo&mode=prototype&screen=home&keep=1#review')
  const nav = createNavigation(window)
  let unsubscribe = nav.subscribe(() => {})
  const panes = JSON.stringify([
    { platform: 'ios', osVersion: '18', language: 'en', appearance: 'light' },
    { platform: 'android', osVersion: '16', language: 'ar', appearance: 'dark' },
  ])
  nav.change({ compare: '1', panes, language: 'ar', appearance: 'light', osVersion: '27', platform: 'ios' })
  nav.visit('details')
  nav.visit('details', 'menu')
  nav.change({ highlights: 'hover' })
  nav.back('home', 'screen')
  assert.equal(nav.read().screen, 'home')
  assert.equal(nav.read().state, null)
  assert.equal(nav.read().panes, panes)
  assert.equal(nav.read().compare, '1')
  assert.equal(nav.read().language, 'ar')
  assert.equal(nav.read().osVersion, '27')
  unsubscribe()
  const reload = createNavigation(window)
  unsubscribe = reload.subscribe(() => {})
  assert.equal(reload.read().panes, panes)
  reload.change({ appearance: 'dark' })
  window.history.go(-1)
  assert.equal(reload.read().appearance, 'light')
  window.history.go(1)
  assert.equal(reload.read().appearance, 'dark')
  assert.equal(new URL(window.location.href).searchParams.get('keep'), '1')
  assert.equal(new URL(window.location.href).hash, '#review')
  unsubscribe()
})

test('gallery mode, selected capture and speed restore from shared URL and browser history', () => {
  const window = browser('http://localhost/?map=demo&mode=gallery&screen=home&variant=en-light&speed=2&keep=1')
  const nav = createNavigation(window)
  const unsubscribe = nav.subscribe(() => {})
  assert.equal(nav.read().mode, 'gallery')
  assert.equal(nav.read().speed, '2')
  nav.visit('home', 'menu')
  nav.change({ speed: '10' })
  window.history.go(-1)
  assert.equal(nav.read().speed, '2')
  assert.equal(nav.read().state, 'menu')
  window.history.go(1)
  const reloaded = createNavigation(window).read()
  assert.equal(reloaded.mode, 'gallery')
  assert.equal(reloaded.speed, '10')
  assert.equal(reloaded.screen, 'home')
  assert.equal(reloaded.state, 'menu')
  assert.equal(new URL(window.location.href).searchParams.get('keep'), '1')
  unsubscribe()
})
