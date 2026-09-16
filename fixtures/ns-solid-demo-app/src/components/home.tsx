import ListenNow from './screens/listen-now'
import Browse from './screens/browse'

export default function Home() {
  return (
    <tabview tabTextFontSize="11">
      <tabviewitem title="Home">
        <frame><ListenNow /></frame>
      </tabviewitem>
      <tabviewitem title="New">
        <frame><Browse /></frame>
      </tabviewitem>
    </tabview>
  )
}
