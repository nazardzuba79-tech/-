import { useEffect, useState, type FormEvent } from "react";
import { ArrowUpRight, Pencil, X as CloseIcon } from "lucide-react";
import { SiTelegram, SiX } from "@icons-pack/react-simple-icons";
import { ApiError, getToken, onSessionChange, request } from "../../../../lib/api";
import type { AuthorInfo } from "../../../../../../src/shared/thomasAuthor";

const endpoint = "/trading-bots/range/author";

/**
 * Public X/Telegram profile links plus the existing server-authorized editor.
 * Only the strategy owner or an admin receives canEdit=true from the API.
 */
export function ThomasSocialLinks({ readOnly = false }: { readOnly?: boolean }) {
  const [session, setSession] = useState(getToken);
  const [profile, setProfile] = useState<AuthorInfo | null>(null);
  const [editing, setEditing] = useState(false);
  const [x, setX] = useState("");
  const [telegram, setTelegram] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => onSessionChange(() => {
    setSession(getToken());
    setProfile(null);
    setEditing(false);
    setMessage("");
  }), []);

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    request<AuthorInfo>(endpoint, { signal: controller.signal, cache: "no-store" })
      .then(value => {
        if (!controller.signal.aborted && getToken() === session) {
          setProfile(value);
          setX(value.links?.x ?? "");
          setTelegram(value.links?.telegram ?? "");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setProfile(null);
      });
    return () => controller.abort();
  }, [session]);

  if (!profile) return null;
  const hasLinks = !!(profile.links?.x || profile.links?.telegram);
  if (!hasLinks && !profile.canEdit) return null;

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !profile.canEdit) return;
    setSaving(true);
    setMessage("");
    const activeSession = getToken();
    try {
      const updated = await request<AuthorInfo>(endpoint, {
        method: "PUT",
        body: JSON.stringify({
          bio: profile.bio,
          revision: profile.revision,
          links: { ...profile.links, x: x.trim(), telegram: telegram.trim() },
        }),
      });
      if (getToken() !== activeSession) return;
      setProfile(updated);
      setX(updated.links?.x ?? "");
      setTelegram(updated.links?.telegram ?? "");
      setEditing(false);
      setMessage("Ссылки сохранены");
    } catch (error) {
      if (getToken() !== activeSession) return;
      const status = error instanceof ApiError ? error.status : 0;
      setMessage(status === 409
        ? "Ссылки изменились. Обновите страницу."
        : status === 403
          ? "Недостаточно прав для редактирования."
          : "Не удалось сохранить. Проверьте адреса профилей.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="th-social-compact" onClick={event => event.stopPropagation()}>
      <div className="th-social-compact-row">
        {profile.links?.x && (
          <a href={profile.links.x} target="_blank" rel="noopener noreferrer"
            className="th-social-pill" aria-label="Thomas в X (Twitter)" title="X (Twitter)">
            <SiX size={16} aria-hidden="true" /><span>X</span><ArrowUpRight size={12} aria-hidden="true" />
          </a>
        )}
        {profile.links?.telegram && (
          <a href={profile.links.telegram} target="_blank" rel="noopener noreferrer"
            className="th-social-pill" aria-label="Thomas в Telegram" title="Telegram">
            <SiTelegram size={17} aria-hidden="true" /><span>Telegram</span><ArrowUpRight size={12} aria-hidden="true" />
          </a>
        )}
        {profile.canEdit && (
          <button type="button" className="th-social-edit"
            aria-expanded={editing} onClick={() => {
              setEditing(!editing);
              setMessage("");
              setX(profile.links?.x ?? "");
              setTelegram(profile.links?.telegram ?? "");
            }}>
            {editing ? <CloseIcon size={13} /> : <Pencil size={13} />}
            {editing ? "Закрыть" : hasLinks ? "Изменить ссылки" : "Добавить X и Telegram"}
          </button>
        )}
      </div>
      {editing && profile.canEdit && (
        <form className="th-social-editor" onSubmit={event => { void save(event); }}>
          <label>X (Twitter)
            <input type="text" value={x} maxLength={255} disabled={saving}
              autoComplete="off" placeholder="@username или https://x.com/username"
              onChange={event => setX(event.target.value)} />
          </label>
          <label>Telegram
            <input type="text" value={telegram} maxLength={255} disabled={saving}
              autoComplete="off" placeholder="@username или https://t.me/username"
              onChange={event => setTelegram(event.target.value)} />
          </label>
          <button type="submit" disabled={saving} className="th-social-save">
            {saving ? "Сохранение…" : "Сохранить ссылки"}
          </button>
        </form>
      )}
      {message && <p role="status" className="th-social-message">{message}</p>}
    </div>
  );
}
