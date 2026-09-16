import { EventData, Page } from '@nativescript/core';
import { HelloWorldModel } from './main-view-model';

export function onNavigatingTo(args: EventData) {
  const page = <Page>args.object;
  page.bindingContext = new HelloWorldModel();
}

export function onOpenDetails(args: EventData) {
  const page = (<any>args.object).page as Page;
  page.frame.navigate({ moduleName: 'pages/details/details-page', context: { id: 42 } });
}

export function onOpenFilters(args: EventData) {
  const page = (<any>args.object).page as Page;
  page.showModal('pages/filters/filters-modal', { context: {}, closeCallback: () => undefined, fullscreen: false });
}
