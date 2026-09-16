import { Application, Page } from "@nativescript/core";
import { renderNativeScriptApp } from "@nativescript-community/octane";
import "./elements";
import { App } from "./app";

Application.run({
  create: () => {
    const page = new Page();
    page.actionBarHidden = true;
    renderNativeScriptApp(page, App);
    return page;
  },
});
