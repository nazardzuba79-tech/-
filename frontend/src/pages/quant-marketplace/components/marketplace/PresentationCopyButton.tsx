import { useId } from "react";
import { useNavigate } from "react-router-dom";

/** Navigate to the supported copy-trading workflow; never imply a subscription was created. */
export function PresentationCopyButton({ strategyId }: { strategyId?: string }) {
  const navigate = useNavigate();
  const descriptionId = useId();
  const thomasUnavailable = strategyId === "range";
  return (
    <button
      type="button"
      className="qx-copy-preview"
      aria-label="Копировать бота"
      aria-describedby={descriptionId}
      title={thomasUnavailable ? "Копирование Thomas Quant AI пока не подключено" : "Открыть настройки копитрейдинга"}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        navigate("/copy-trading");
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <span>Копировать бота</span>
      <span id={descriptionId} className="qx-copy-availability">
        {thomasUnavailable
          ? "Thomas пока недоступен · выбрать другие стратегии"
          : "Открыть настройки копитрейдинга"}
      </span>
    </button>
  );
}
