import * as React from 'react';
import type { GridLayout } from '@nativescript/core';

export function HomeScreen() {
  const ref = React.useRef<GridLayout>(null);
  const share = () => {
    ref.current?.showModal(ShareSheetComponent, { context: {}, closeCallback: () => undefined });
  };
  return (
    <gridLayout ref={ref} rows="auto, *">
      <label row={0} text="Home" />
      <button row={1} text="Share" onTap={share} />
    </gridLayout>
  );
}

declare const ShareSheetComponent: any;
