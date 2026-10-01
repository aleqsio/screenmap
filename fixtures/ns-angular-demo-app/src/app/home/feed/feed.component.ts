import { Component, NO_ERRORS_SCHEMA, inject } from '@angular/core';
import { NativeScriptCommonModule, NativeScriptRouterModule, RouterExtensions } from '@nativescript/angular';
import { FeedItemComponent } from './feed-item.component';

@Component({
  selector: 'ns-feed',
  templateUrl: './feed.component.html',
  imports: [NativeScriptCommonModule, NativeScriptRouterModule, FeedItemComponent],
  schemas: [NO_ERRORS_SCHEMA]
})
export class FeedComponent {
  private router = inject(RouterExtensions);
  items = [{ id: 1, title: 'First' }, { id: 2, title: 'Second' }];

  openSettings() {
    this.router.router.navigateByUrl('/settings');
  }
}
