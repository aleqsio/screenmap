import { useState } from "octane";

export interface ChatScreenProps {
  onMenu: () => void;
}

export function ChatScreen({ onMenu }: ChatScreenProps) {
  const [messages, setMessages] = useState<string[]>([]);
  const chatMenu = [{ name: "Share", icon: "square.and.arrow.up", action: () => undefined }];
  return (
    <gridlayout rows="auto, *, auto">
      <gridlayout row={0} columns="auto, *, auto">
        <label col={0} text="☰" onTap={onMenu} />
        <label col={2} text="…" menu={chatMenu} />
      </gridlayout>
      <scrollview row={1}>
        <stacklayout>
          {messages.map((m) => (
            <label key={m} text={m} textWrap={true} />
          ))}
        </stacklayout>
      </scrollview>
      <textview row={2} hint="Message" onReturnPress={(e) => setMessages([...messages, String(e)])} />
    </gridlayout>
  );
}
