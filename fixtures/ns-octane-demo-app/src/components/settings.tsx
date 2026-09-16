import { GridLayout, type View } from "@nativescript/core";
import { renderNativeScriptApp } from "@nativescript-community/octane";

function SettingsSheet({ close }: { close: () => void }) {
  return (
    <gridlayout rows="auto, *">
      <label row={0} text="Close" onTap={close} />
      <stacklayout row={1}>
        <label text="Appearance" />
      </stacklayout>
    </gridlayout>
  );
}

/** Present settings as a native page sheet hosting its own Octane root. */
export function openSettings(host: View): void {
  const container = new GridLayout();
  const root = renderNativeScriptApp(container, SettingsSheet, {
    close: () => container.closeModal(),
  });
  host.showModal(container, {
    context: {},
    animated: true,
    closeCallback: () => root.unmount(),
  });
}
