import { bootstrapApplication, provideNativeScriptRouter, runNativeScriptAngularApp } from '@nativescript/angular';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';

runNativeScriptAngularApp({
  appModuleBootstrap: () =>
    bootstrapApplication(AppComponent, {
      providers: [provideNativeScriptRouter(routes)]
    })
});
