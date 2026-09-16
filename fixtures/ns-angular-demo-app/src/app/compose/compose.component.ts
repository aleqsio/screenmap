import { Component, NO_ERRORS_SCHEMA, inject } from '@angular/core';
import { NativeScriptCommonModule, RouterExtensions } from '@nativescript/angular';

@Component({
  selector: 'ns-compose',
  template: '<StackLayout><TextView hint="Say something"></TextView><Button text="Post" (tap)="post()"></Button></StackLayout>',
  imports: [NativeScriptCommonModule],
  schemas: [NO_ERRORS_SCHEMA]
})
export class ComposeComponent {
  private router = inject(RouterExtensions);

  post() {
    this.router.navigate(['/home'], { clearHistory: true });
  }
}
