import { Route, StackRouter } from 'solid-navigation'
import Home from './components/home'
import AlbumDetail from './components/screens/album-detail'

const App = () => {
  return (
    <StackRouter initialRouteName="Home" defaultRouteOptions={{ noHeader: true }} useTopMostFrame={true}>
      <Route name="Home" component={Home} />
      <Route name="Album" component={AlbumDetail} />
    </StackRouter>
  )
}

export { App }
