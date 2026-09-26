/** Kept free of imports so tests can load it without the browser API client. */

/** Plain words for a stored failure category. */
export const SUPPORT_FAILURE_TEXT: Record<string, string> = {
  NOT_CONFIGURED: 'почта не настроена',
  AUTH: 'SMTP отклонил логин или пароль',
  CONNECTION: 'нет соединения с SMTP-сервером',
  RECIPIENT_REJECTED: 'адрес получателя отклонён',
  MESSAGE_REJECTED: 'письмо отклонено сервером',
  TEMPORARY: 'временная ошибка SMTP',
  UNKNOWN: 'неизвестная ошибка отправки',
  RATE_LIMITED: 'слишком много тестовых писем, попробуйте позже',
};

export function failureText(category: string | null | undefined, code?: number | null): string {
  if (!category) return '';
  const text = SUPPORT_FAILURE_TEXT[category] ?? category;
  return code ? `${text} (код ${code})` : text;
}
