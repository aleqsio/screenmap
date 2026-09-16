import { Component, NO_ERRORS_SCHEMA, inject } from '@angular/core';
import { NativeScriptCommonModule, RouterExtensions } from '@nativescript/angular';

@Component({
  selector: 'ns-settings',
  templateUrl: './settings.component.html',
  imports: [NativeScriptCommonModule],
  schemas: [NO_ERRORS_SCHEMA]
})
export class SettingsComponent {
  private router = inject(RouterExtensions);

  account() {
    this.router.navigate(['/account']);
  }

  signOut() {
    this.router.router.navigateByUrl('/login');
  }

  search() {
    this.router.navigate(['/home', { outlets: { searchTab: ['search'] } }]);
  }
}
