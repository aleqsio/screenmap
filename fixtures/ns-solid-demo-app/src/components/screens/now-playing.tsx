import { render } from '@nativescript-community/solid-js'
import { Frame, type Page } from '@nativescript/core'
import { document } from 'dominative'

export function NowPlaying(props: { close: () => void }) {
  return (
    <gridlayout rows="auto, *">
      <label row={0} text="Close" on:tap={props.close} />
      <label row={1} text="Now Playing" />
    </gridlayout>
  )
}

export function openNowPlaying() {
  const launcher = Frame.topmost()?.currentPage
  if (!launcher) return
  const modalPage = document.createElement('Page') as unknown as Page
  const dispose = render(
    () => <NowPlaying close={() => modalPage.closeModal()} />,
    modalPage as any,
  )
  launcher.showModal(modalPage, { context: {}, fullscreen: true, closeCallback: () => dispose?.() })
}
