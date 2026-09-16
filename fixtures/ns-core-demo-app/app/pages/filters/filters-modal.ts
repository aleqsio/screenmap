import { EventData, View } from '@nativescript/core';

export function onShownModally(_args: EventData) {}

export function onDone(args: EventData) {
  (<View>args.object).closeModal();
}
