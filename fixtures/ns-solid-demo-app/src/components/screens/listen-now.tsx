import { useRouter } from 'solid-navigation'
import { openAlbum } from '../../utils/album-navigation'
import { openNowPlaying } from './now-playing'

export default function ListenNow() {
  const router = useRouter()
  return (
    <page>
      <stacklayout>
        <label text="Listen Now" />
        <button text="Open album" on:tap={() => openAlbum(router, 'a1')} />
        <button text="Now playing" on:tap={() => openNowPlaying()} />
      </stacklayout>
    </page>
  )
}
