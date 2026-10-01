export interface DrawerPanelProps {
  onClose: () => void;
  onSettings: () => void;
}

export function DrawerPanel({ onClose, onSettings }: DrawerPanelProps) {
  return (
    <gridlayout rows="auto, *, auto">
      <label row={0} text="Octane" />
      <stacklayout row={1}>
        <label text="Recents" onTap={onClose} />
      </stacklayout>
      <label row={2} text="Settings" onTap={onSettings} />
    </gridlayout>
  );
}
