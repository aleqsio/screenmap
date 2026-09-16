import { Component, NO_ERRORS_SCHEMA } from '@angular/core';
import { NativeScriptCommonModule, NativeScriptRouterModule } from '@nativescript/angular';

@Component({
  selector: 'ns-not-found',
  template: '<StackLayout><Label text="Not found"></Label><Button text="Home" nsRouterLink="/home"></Button></StackLayout>',
  imports: [NativeScriptCommonModule, NativeScriptRouterModule],
  schemas: [NO_ERRORS_SCHEMA]
})
export class NotFoundComponent {}
