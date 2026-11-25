/** Visual-only action for the authorized, explicitly read-only presentation. */
export function PresentationCopyButton() {
  return (
    <button
      type="button"
      className="qx-copy-preview"
      onClick={(event) => event.stopPropagation()}
    >
      Копировать бота
    </button>
  );
}
