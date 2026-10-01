import { Component, NO_ERRORS_SCHEMA, inject } from '@angular/core';
import { NativeScriptCommonModule, NativeScriptRouterModule, RouterExtensions } from '@nativescript/angular';

@Component({
  selector: 'ns-login',
  templateUrl: './login.component.html',
  imports: [NativeScriptCommonModule, NativeScriptRouterModule],
  schemas: [NO_ERRORS_SCHEMA]
})
export class LoginComponent {
  private router = inject(RouterExtensions);

  signIn() {
    this.router.navigate(['/home', { outlets: { feedTab: ['feed'] } }], { clearHistory: true, transition: { name: 'fade' } });
  }
}
