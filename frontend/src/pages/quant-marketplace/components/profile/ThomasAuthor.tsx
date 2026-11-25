import { useEffect, useState } from "react";
import { ExternalLink, Globe, PencilLine } from "lucide-react";
import {
  SiTelegram,
  SiInstagram,
  SiX,
  SiYoutube,
  SiVk,
  SiFacebook,
  SiThreads,
} from "@icons-pack/react-simple-icons";
import { ApiError, request } from "../../../../lib/api";
import {
  SOCIAL_NAMES,
  type AuthorInfo,
  type Network,
} from "../../../../../../src/shared/thomasAuthor";

const networks = Object.keys(SOCIAL_NAMES) as Network[];
const logos = {
  telegram: SiTelegram,
  instagram: SiInstagram,
  x: SiX,
  youtube: SiYoutube,
  vk: SiVk,
  facebook: SiFacebook,
  threads: SiThreads,
  website: Globe,
};
function SocialIcon({ network }: { network: Network }) {
  const Icon = logos[network];
  return <Icon size={17} aria-hidden="true" />;
}
const endpoint = "/trading-bots/range/author";
export function ThomasAuthor() {
  const [profile, setProfile] = useState<AuthorInfo | null>(null),
    [draft, setDraft] = useState<AuthorInfo | null>(null);
  const [message, setMessage] = useState(""),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    request<AuthorInfo>(endpoint, { signal: c.signal })
      .then((v) => {
        if (!c.signal.aborted) setProfile(v);
      })
      .catch(() => {
        if (!c.signal.aborted) setMessage("Данные автора временно недоступны.");
      });
    return () => c.abort();
  }, []);
  async function save() {
    if (!draft || saving) return;
    setSaving(true);
    setMessage("");
    try {
      const value = await request<AuthorInfo>(endpoint, {
        method: "PUT",
        body: JSON.stringify({
          bio: draft.bio,
          links: draft.links,
          revision: draft.revision,
        }),
      });
      setProfile(value);
      setDraft(null);
      setMessage("Профиль сохранён.");
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 0;
      const messages: Record<number, string> = {
        400: "Проверьте описание и адреса ссылок.",
        403: "У вас нет прав на редактирование профиля.",
        409: "Профиль уже изменён. Обновите страницу перед повторным сохранением.",
      };
      setMessage(messages[status] ?? "Не удалось сохранить профиль. Попробуйте ещё раз.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="th-author">
      <h3>Автор стратегии</h3>
      {profile && !draft && (
        <>
          {profile.bio && <p>{profile.bio}</p>}
          <div className="th-socials">
            {networks
              .filter((n) => profile.links[n])
              .map((n) => (
                <a
                  key={n}
                  href={profile.links[n]}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <SocialIcon network={n} />
                  {SOCIAL_NAMES[n]}
                  <ExternalLink size={12} />
                </a>
              ))}
          </div>
          {profile.canEdit && (
            <button
              className="th-action"
              onClick={() => {
                setDraft({ ...profile, links: { ...profile.links } });
                setMessage("");
              }}
            >
              <PencilLine size={15} />
              Редактировать профиль автора
            </button>
          )}
        </>
      )}
      {draft && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label>
            Описание автора
            <textarea
              maxLength={600}
              value={draft.bio}
              onChange={(e) => setDraft({ ...draft, bio: e.target.value })}
            />
          </label>
          <div className="th-form-grid">
            {networks.map((n) => (
              <label key={n}>
                {SOCIAL_NAMES[n]}
                <input
                  type="text"
                  inputMode="url"
                  maxLength={512}
                  value={draft.links[n] ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      links: { ...draft.links, [n]: e.target.value },
                    })
                  }
                />
              </label>
            ))}
          </div>
          <div className="th-options">
            <button type="submit" disabled={saving}>
              Сохранить
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setDraft(null);
                setMessage("");
              }}
            >
              Отмена
            </button>
          </div>
        </form>
      )}
      <div role="status">{message}</div>
    </section>
  );
}
