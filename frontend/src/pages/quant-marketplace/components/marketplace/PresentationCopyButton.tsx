import { useId } from "react";

/** The copy UI is a prototype; no subscription or trade is created. */
export function PresentationCopyButton() {
  const descriptionId = useId();
  return (
    <button
      type="button"
      className="qx-copy-preview"
      aria-label="Копировать бота"
      aria-describedby={descriptionId}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <span>Копировать бота</span>
      <span id={descriptionId} className="qx-copy-availability">Предпросмотр · не подключено</span>
    </button>
  );
}
