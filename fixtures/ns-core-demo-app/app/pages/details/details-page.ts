import { EventData, Frame } from '@nativescript/core';

export function onSettings(_args: EventData) {
  Frame.topmost().navigate('pages/settings/settings-page');
}
