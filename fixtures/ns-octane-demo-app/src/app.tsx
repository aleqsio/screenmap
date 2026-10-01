import type { GridLayout } from "@nativescript/core";
import type { Drawer as UiDrawer } from "@nativescript-community/ui-drawer";
import { useRef } from "octane";
import { ChatScreen } from "./components/chat-screen";
import { DrawerPanel } from "./components/drawer";
import { openSettings } from "./components/settings";

export function App() {
  const drawerRef = useRef<UiDrawer | null>(null);
  const mainRef = useRef<GridLayout | null>(null);
  return (
    <drawer ref={drawerRef} leftDrawerMode="under">
      <gridlayout hostSlot="mainContent" ref={mainRef}>
        <ChatScreen onMenu={() => drawerRef.current?.open("left")} />
      </gridlayout>
      <gridlayout hostSlot="leftDrawer" width={280}>
        <DrawerPanel
          onClose={() => drawerRef.current?.close()}
          onSettings={() => {
            const host = mainRef.current;
            if (host) openSettings(host);
          }}
        />
      </gridlayout>
    </drawer>
  );
}
