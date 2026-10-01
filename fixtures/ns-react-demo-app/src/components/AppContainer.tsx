import * as React from 'react';
import { HomeScreen } from './HomeScreen';

export function AppContainer() {
  return (
    <frame>
      <page actionBarHidden={true}>
        <HomeScreen />
      </page>
    </frame>
  );
}
