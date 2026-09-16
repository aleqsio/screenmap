import { useRouter } from 'solid-navigation'
import { openAlbum } from '../../utils/album-navigation'

export default function Browse() {
  const router = useRouter()
  return (
    <page>
      <stacklayout>
        <label text="Browse" />
        <button text="Open album" on:tap={() => openAlbum(router, 'a2')} />
      </stacklayout>
    </page>
  )
}
