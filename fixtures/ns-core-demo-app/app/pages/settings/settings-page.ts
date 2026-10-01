import { EventData, Frame } from '@nativescript/core';

export function onBack(_args: EventData) {
  Frame.topmost().goBack();
}
