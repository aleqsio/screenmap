import { Component, NO_ERRORS_SCHEMA } from '@angular/core';
import { PageRouterOutlet } from '@nativescript/angular';

@Component({
  selector: 'ns-home',
  templateUrl: './home.component.html',
  imports: [PageRouterOutlet],
  schemas: [NO_ERRORS_SCHEMA]
})
export class HomeComponent {}
