import { useNavigate } from "react-router-dom";

/** Navigate to the supported copy-trading workflow; never imply a subscription was created. */
export function PresentationCopyButton({ strategyId }: { strategyId?: string }) {
  const navigate = useNavigate();
  const thomasUnavailable = strategyId === "range";
  return (
    <button
      type="button"
      className="qx-copy-preview"
      aria-label={thomasUnavailable ? "Открыть доступные стратегии копитрейдинга. Thomas Quant AI пока не поддерживается." : "Открыть копитрейдинг"}
      title={thomasUnavailable ? "Копирование Thomas Quant AI пока не подключено" : "Открыть настройки копитрейдинга"}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        navigate("/copy-trading");
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <span>Копировать бота</span>
      <span className="qx-copy-availability">
        {thomasUnavailable
          ? "Thomas пока недоступен · выбрать другие стратегии"
          : "Открыть настройки копитрейдинга"}
      </span>
    </button>
  );
}
