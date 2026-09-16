import { render } from "@nativescript-community/solid-js";
import { Application, Frame } from "@nativescript/core";
import { document } from "dominative";
import { startSolidApp } from "@nativescript/vite/solid-bootstrap";
import { App } from "./app";

startSolidApp({
  Application,
  render,
  document,
  Frame,
  root: App,
  rootModule: "/src/app",
});
