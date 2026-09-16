import { Component, Input, NO_ERRORS_SCHEMA, inject } from '@angular/core';
import { NativeScriptCommonModule, NativeScriptRouterModule, RouterExtensions } from '@nativescript/angular';

@Component({
  selector: 'ns-feed-item',
  template: `
    <GridLayout columns="*, auto">
      <Label col="0" [text]="item.title" [nsRouterLink]="['/details', item.id]"></Label>
      <Button col="1" text="Reply" (tap)="reply()"></Button>
    </GridLayout>
  `,
  imports: [NativeScriptCommonModule, NativeScriptRouterModule],
  schemas: [NO_ERRORS_SCHEMA]
})
export class FeedItemComponent {
  @Input() item: { id: number; title: string };
  private router = inject(RouterExtensions);

  reply() {
    this.router.navigate(['/compose'], { queryParams: { replyTo: this.item.id } });
  }
}
