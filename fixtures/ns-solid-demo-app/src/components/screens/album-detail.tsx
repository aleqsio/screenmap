import { useParams } from 'solid-navigation'

export default function AlbumDetail() {
  const params = useParams<{ albumId: string }>()
  return (
    <page>
      <stacklayout>
        <label text={'Album ' + params.albumId} contextMenu={[{ name: 'Share', action: () => undefined }]} />
      </stacklayout>
    </page>
  )
}
