import { ArrowUpRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

/** Opens the existing copy-trading area without creating a subscription. */
export function PresentationCopyButton({ strategyId: _strategyId }: { strategyId?: string }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="qx-copy-preview"
      aria-label="Копировать бота"
      title="Открыть раздел копитрейдинга"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        navigate("/copy-trading");
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <span>Копировать бота</span>
      <ArrowUpRight size={17} aria-hidden="true" />
    </button>
  );
}
