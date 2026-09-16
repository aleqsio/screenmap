import type { useRouter } from 'solid-navigation'

type Router = ReturnType<typeof useRouter>

export function openAlbum(router: Router, albumId: string) {
  router.navigate('Album', { params: { albumId } })
}
