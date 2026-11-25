import { normalizeStrategySocial } from "./copyStrategySocials";

export const SOCIAL_NAMES = {
  telegram: "Telegram",
  instagram: "Instagram",
  x: "X / Twitter",
  youtube: "YouTube",
  vk: "VK",
  facebook: "Facebook",
  threads: "Threads",
  website: "Сайт",
} as const;
export type Network = keyof typeof SOCIAL_NAMES;
export type AuthorInfo = {
  bio: string;
  links: Partial<Record<Network, string>>;
  revision: number;
  canEdit: boolean;
};
const accounts: Record<
  Exclude<Network, "x" | "telegram" | "website">,
  [string[], RegExp]
> = {
  instagram: [["instagram.com"], /^\/[a-z0-9_.]{1,30}\/?$/i],
  youtube: [
    ["youtube.com"],
    /^\/(?:@[\p{L}\p{N}._-]{3,30}|channel\/UC[\w-]{22}|(?:user|c)\/[\w.-]+)\/?$/u,
  ],
  vk: [["vk.com", "vk.ru"], /^\/[a-z0-9_.]{2,80}\/?$/i],
  facebook: [["facebook.com"], /^\/[a-z0-9.]{1,90}\/?$/i],
  threads: [["threads.com", "threads.net"], /^\/@[a-z0-9_.]{1,30}\/?$/i],
};
export function authorUrl(key: Network, input: string): string {
  if (key === "x" || key === "telegram") {
    const value = normalizeStrategySocial(
      key === "x" ? "xUrl" : "telegramUrl",
      input,
    );
    if (!value) throw Error("Укажите профиль");
    return value;
  }
  if (!input || input.length > 512 || /[\s\\\u0000-\u001f\u007f]/.test(input))
    throw Error("Проверьте URL");
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    throw Error("Нужна публичная HTTPS-ссылка");
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (key === "website") {
    if (
      !/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/i.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example)$/.test(
        host,
      )
    )
      throw Error("Укажите публичный домен");
    return url.href;
  }
  const [hosts, profile] = accounts[key];
  if (
    !hosts.includes(host) ||
    url.search ||
    url.hash ||
    !profile.test(decodeURI(url.pathname)) ||
    /^\/(?:login|share|sharer.php|reel|reels|accounts|pages|groups|stories|messages|settings|feed|explore|away.php|watch|events|marketplace)\/?$/i.test(
      url.pathname,
    )
  )
    throw Error("Нужна ссылка на профиль выбранной сети");
  return "https://" + host + url.pathname.replace(/\/$/, "");
}
