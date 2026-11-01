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
