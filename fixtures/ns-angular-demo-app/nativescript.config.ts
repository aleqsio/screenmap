import { NativeScriptConfig } from '@nativescript/core';

export default {
  id: 'org.screenmap.nsdemo',
  appPath: 'src',
  appResourcesPath: 'App_Resources',
  ios: { discardUncaughtJsExceptions: false }
} as NativeScriptConfig;
