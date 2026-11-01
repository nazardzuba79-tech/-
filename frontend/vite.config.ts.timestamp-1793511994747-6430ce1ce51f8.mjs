// vite.config.ts
import { defineConfig } from "file:///home/user/-/frontend/node_modules/vite/dist/node/index.js";
import react from "file:///home/user/-/frontend/node_modules/@vitejs/plugin-react/dist/index.js";

// src/lib/depositCatalogueEdge.ts
function resolveCatalogueEdge(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    const loopback = url.protocol === "http:" && url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !loopback || url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

// contentPlugin.ts
import fs from "node:fs";
import path from "node:path";

// src/lib/content/compile.ts
import { Marked } from "file:///home/user/-/frontend/node_modules/marked/lib/marked.esm.js";

// src/lib/seo/site.ts
var SITE_ORIGIN = "https://voltextech.net";
var OG_IMAGE_URL = `${SITE_ORIGIN}/og-image.png`;
var PRIVATE_ROUTES = [
  "/trade",
  "/futures",
  "/markets",
  "/banking",
  "/earn",
  "/settings",
  "/card",
  "/wallet",
  "/otc",
  "/dashboard",
  "/copy-trading",
  "/arbitrage",
  "/tools",
  "/trading-bots",
  "/analytics",
  "/stocks",
  "/admin"
];
var ADMIN_PAGES = ["wallets", "users", "kyc", "withdrawals", "otc", "deposits", "audit-log", "listings"];
var UTILITY_ROUTES = ["/login", "/register"];
var UNPROMOTED_ROUTES = ["/legal/licenses"];
var LEGACY_HELP = {
  "/help": "/academy/faq",
  "/help/faq": "/academy/faq",
  "/help/fees": "/academy/knowledge",
  "/help/rules": "/academy/knowledge"
};
var LEGAL_DOCS = ["terms", "privacy", "risk", "about", "support"];
var ROBOTS_PRIVATE = "noindex, nofollow";
var ROBOTS_UNLISTED = "noindex, follow";
function normalizePath(pathname) {
  const path2 = `/${pathname.split(/[?#]/)[0]}`.replace(/\/{2,}/g, "/");
  return path2.length > 1 ? path2.replace(/\/+$/, "") : "/";
}
var within = (path2, base) => path2 === base || path2.startsWith(`${base}/`);
function robotsFor(pathname) {
  const path2 = normalizePath(pathname).toLowerCase();
  if (PRIVATE_ROUTES.some((route) => within(path2, route)) || UNPROMOTED_ROUTES.includes(path2)) return ROBOTS_PRIVATE;
  if (UTILITY_ROUTES.includes(path2)) return ROBOTS_UNLISTED;
  return null;
}
function canonicalFor(pathname) {
  if (robotsFor(pathname)) return null;
  const path2 = normalizePath(pathname).toLowerCase();
  if (path2 === "/") return `${SITE_ORIGIN}/`;
  if (LEGACY_HELP[path2]) return SITE_ORIGIN + LEGACY_HELP[path2];
  if (path2.startsWith("/help/")) return SITE_ORIGIN + (path2 === "/help/status" ? path2 : "/academy/faq");
  if (within(path2, "/academy")) return SITE_ORIGIN + path2;
  const legal = /^\/legal\/([a-z-]+)$/.exec(path2);
  if (legal && LEGAL_DOCS.includes(legal[1])) return SITE_ORIGIN + path2;
  return null;
}

// src/lib/content/compile.ts
function parseFrontmatter(source) {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  if (!match) return { data: {}, body: source };
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (field) data[field[1]] = frontmatterValue(field[2].trim());
  }
  return { data, body: source.slice(match[0].length) };
}
function unquote(value) {
  return /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value;
}
function frontmatterValue(raw) {
  if (/^\[.*\]$/.test(raw)) {
    return raw.slice(1, -1).split(",").map((item) => unquote(item.trim())).filter(Boolean);
  }
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return unquote(raw);
}
var escapeHtml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
var plainText = (markdown) => markdown.replace(/[*_`]/g, "").trim();
function renderMarkdown(source) {
  const toc = [];
  const marked = new Marked({ gfm: true, breaks: true });
  marked.use({
    renderer: {
      heading(token) {
        const inner = this.parser.parseInline(token.tokens);
        if (token.depth !== 2) return `<h${token.depth}>${inner}</h${token.depth}>
`;
        const id = `section-${toc.length + 1}`;
        toc.push({ id, title: plainText(token.text) });
        return `<h2 id="${id}">${inner}</h2>
`;
      },
      html(token) {
        return escapeHtml(token.text);
      }
    }
  });
  const withoutComments = source.replace(/<!--[\s\S]*?-->/g, "");
  const html = marked.parse(withoutComments, { async: false }).replace(/<table>/g, '<div class="vx-md-table"><table>').replace(/<\/table>/g, "</table></div>");
  return { html, toc };
}
function withoutNotes(value) {
  if (Array.isArray(value)) return value.map(withoutNotes);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).filter(([key]) => !key.startsWith("_")).map(([key, item]) => [key, withoutNotes(item)])
    );
  }
  return value;
}
function readJson(files, path2, problems) {
  if (!(path2 in files)) return void 0;
  try {
    return withoutNotes(JSON.parse(files[path2]));
  } catch (error) {
    problems.push(`${path2}: \u0444\u0430\u0439\u043B \u043D\u0435 \u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044F \u043A\u0430\u043A JSON (${error.message})`);
    return void 0;
  }
}
var str = (value, fallback = "") => typeof value === "string" ? value : typeof value === "number" ? String(value) : fallback;
var num = (value, fallback) => typeof value === "number" ? value : Number(value) || fallback;
function compileAcademy(lang, files, problems) {
  const root = `${lang}/academy/`;
  const sectionsFile = `${root}_sections.json`;
  const rawSections = readJson(files, sectionsFile, problems);
  if (!rawSections) return void 0;
  const sections = rawSections.map((s) => ({ id: str(s.id), title: str(s.title), description: str(s.description), order: num(s.order, 999) })).sort((a, b) => a.order - b.order);
  const sectionIds = new Set(sections.map((s) => s.id));
  const articles = [];
  for (const [path2, source] of Object.entries(files)) {
    const parts = /^([^/]+)\/academy\/([^/]+)\/([^/]+)\.md$/.exec(path2);
    if (!parts || parts[1] !== lang) continue;
    const { data, body } = parseFrontmatter(source);
    const article = {
      slug: str(data.slug, parts[3]),
      section: str(data.section, parts[2]),
      title: str(data.title, parts[3]),
      order: num(data.order, 999),
      level: str(data.level),
      readTime: num(data.readTime, 0),
      summary: str(data.summary),
      related: Array.isArray(data.related) ? data.related : [],
      html: renderMarkdown(body).html
    };
    if (!sectionIds.has(article.section)) problems.push(`${path2}: \u0440\u0430\u0437\u0434\u0435\u043B \xAB${article.section}\xBB \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u0432 _sections.json`);
    if (articles.some((a) => a.slug === article.slug)) problems.push(`${path2}: slug \xAB${article.slug}\xBB \u0443\u0436\u0435 \u0437\u0430\u043D\u044F\u0442 \u0434\u0440\u0443\u0433\u043E\u0439 \u0441\u0442\u0430\u0442\u044C\u0451\u0439`);
    articles.push(article);
  }
  articles.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, "ru"));
  const glossary = (readJson(files, `${root}glossary.json`, problems) ?? []).map((g) => ({ term: str(g.term), def: str(g.def), ...g.link ? { link: str(g.link) } : {} }));
  const slugs = new Set(articles.map((a) => a.slug));
  for (const article of articles) {
    for (const slug of article.related) {
      if (!slugs.has(slug)) problems.push(`${lang}/academy/${article.section}/${article.slug}.md: \u0432 related \u0443\u043A\u0430\u0437\u0430\u043D\u0430 \u043D\u0435\u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u044E\u0449\u0430\u044F \u0441\u0442\u0430\u0442\u044C\u044F \xAB${slug}\xBB`);
    }
  }
  for (const term of glossary) {
    if (term.link && !slugs.has(term.link)) problems.push(`${root}glossary.json: \u0442\u0435\u0440\u043C\u0438\u043D \xAB${term.term}\xBB \u0441\u0441\u044B\u043B\u0430\u0435\u0442\u0441\u044F \u043D\u0430 \u043D\u0435\u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u044E\u0449\u0443\u044E \u0441\u0442\u0430\u0442\u044C\u044E \xAB${term.link}\xBB`);
  }
  return { sections, articles, glossary };
}
function compileHelp(lang, files, problems) {
  const root = `${lang}/help/`;
  if (!Object.keys(files).some((path2) => path2.startsWith(root))) return void 0;
  const faq = (readJson(files, `${root}faq.json`, problems) ?? []).map((item) => ({ group: str(item.group), q: str(item.q), a: str(item.a) }));
  const fees = readJson(files, `${root}fees.json`, problems) ?? {};
  const feesHtml = files[`${root}fees.md`] ? renderMarkdown(parseFrontmatter(files[`${root}fees.md`]).body).html : "";
  const rules = files[`${root}rules.md`] ? renderMarkdown(parseFrontmatter(files[`${root}rules.md`]).body) : { html: "", toc: [] };
  const status = readJson(files, `${root}incidents.json`, problems) ?? {};
  return {
    faq,
    fees,
    feesHtml,
    rulesHtml: rules.html,
    rulesToc: rules.toc,
    components: (status.components ?? []).map((c) => ({ id: str(c.id), name: str(c.name) })),
    incidents: status.incidents ?? []
  };
}
function compileContent(files) {
  const problems = [];
  const langs = [...new Set(Object.keys(files).map((path2) => path2.split("/")[0]))].sort();
  const academy = {};
  const help = {};
  for (const lang of langs) {
    const a = compileAcademy(lang, files, problems);
    if (a) academy[lang] = a;
    const h = compileHelp(lang, files, problems);
    if (h) help[lang] = h;
  }
  if (!academy.ru) problems.push("\u041D\u0435\u0442 ru/academy/_sections.json \u2014 \u0410\u043A\u0430\u0434\u0435\u043C\u0438\u044F \u0431\u0435\u0437 \u0440\u0443\u0441\u0441\u043A\u043E\u0433\u043E \u0442\u0435\u043A\u0441\u0442\u0430 \u043D\u0435 \u0441\u043E\u0431\u0438\u0440\u0430\u0435\u0442\u0441\u044F");
  if (!help.ru) problems.push("\u041D\u0435\u0442 \u043F\u0430\u043F\u043A\u0438 ru/help \u2014 \u041F\u043E\u043C\u043E\u0449\u044C \u0431\u0435\u0437 \u0440\u0443\u0441\u0441\u043A\u043E\u0433\u043E \u0442\u0435\u043A\u0441\u0442\u0430 \u043D\u0435 \u0441\u043E\u0431\u0438\u0440\u0430\u0435\u0442\u0441\u044F");
  return {
    academy: { ...academy, ru: academy.ru ?? { sections: [], articles: [], glossary: [] } },
    help: { ...help, ru: help.ru ?? { faq: [], fees: {}, feesHtml: "", rulesHtml: "", rulesToc: [], components: [], incidents: [] } },
    problems
  };
}
var ACADEMY_TITLE = "\u0410\u043A\u0430\u0434\u0435\u043C\u0438\u044F VOLTEX";
var ACADEMY_DESCRIPTION = "\u0411\u0435\u0441\u043F\u043B\u0430\u0442\u043D\u044B\u0435 \u0441\u0442\u0430\u0442\u044C\u0438 \u043E \u043A\u0440\u0438\u043F\u0442\u043E\u0432\u0430\u043B\u044E\u0442\u0435, \u0444\u044C\u044E\u0447\u0435\u0440\u0441\u0430\u0445, \u0440\u0438\u0441\u043A\u0430\u0445 \u0438 \u0431\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E\u0441\u0442\u0438 \u2014 \u043F\u0440\u043E\u0441\u0442\u044B\u043C \u044F\u0437\u044B\u043A\u043E\u043C.";
var HELP_TITLE = "\u041F\u043E\u043C\u043E\u0449\u044C VOLTEX";
var FAQ_DESCRIPTION = "\u041E\u0442\u0432\u0435\u0442\u044B \u043D\u0430 \u0447\u0430\u0441\u0442\u044B\u0435 \u0432\u043E\u043F\u0440\u043E\u0441\u044B \u043E\u0431 \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0435, \u043F\u043E\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u0438, \u0442\u043E\u0440\u0433\u043E\u0432\u043B\u0435 \u0438 \u0432\u044B\u0432\u043E\u0434\u0435 \u043D\u0430 VOLTEX.";
var KNOWLEDGE_DESCRIPTION = "\u041F\u0440\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u0438\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u044F \u043E \u043A\u043E\u043C\u0438\u0441\u0441\u0438\u044F\u0445 \u0438 \u043F\u0440\u0430\u0432\u0438\u043B\u0430\u0445 \u0442\u043E\u0440\u0433\u043E\u0432\u043B\u0438 \u043D\u0430 VOLTEX.";
function seoPages(content) {
  const { sections, articles } = content.academy.ru;
  const pages = [
    { path: "academy", title: ACADEMY_TITLE, description: ACADEMY_DESCRIPTION },
    { path: "academy/learn", title: `\u041E\u0431\u0443\u0447\u0435\u043D\u0438\u0435 \u2014 ${ACADEMY_TITLE}`, description: ACADEMY_DESCRIPTION },
    { path: "academy/knowledge", title: `\u0411\u0430\u0437\u0430 \u0437\u043D\u0430\u043D\u0438\u0439 \u2014 ${ACADEMY_TITLE}`, description: KNOWLEDGE_DESCRIPTION },
    { path: "academy/faq", title: `\u0412\u043E\u043F\u0440\u043E\u0441\u044B \u0438 \u043E\u0442\u0432\u0435\u0442\u044B \u2014 ${ACADEMY_TITLE}`, description: FAQ_DESCRIPTION },
    { path: "academy/glossary", title: `\u0413\u043B\u043E\u0441\u0441\u0430\u0440\u0438\u0439 \u2014 ${ACADEMY_TITLE}`, description: "\u041A\u043E\u0440\u043E\u0442\u043A\u0438\u0435 \u043E\u043F\u0440\u0435\u0434\u0435\u043B\u0435\u043D\u0438\u044F \u043E\u0441\u043D\u043E\u0432\u043D\u044B\u0445 \u0442\u0435\u0440\u043C\u0438\u043D\u043E\u0432 \u043A\u0440\u0438\u043F\u0442\u043E\u0432\u0430\u043B\u044E\u0442\u043D\u043E\u0439 \u0442\u043E\u0440\u0433\u043E\u0432\u043B\u0438." }
  ];
  for (const section of sections) {
    if (section.id === "glossary") continue;
    pages.push({ path: `academy/${section.id}`, title: `${section.title} \u2014 ${ACADEMY_TITLE}`, description: section.description });
  }
  for (const article of articles) {
    pages.push({ path: `academy/${article.section}/${article.slug}`, title: `${article.title} \u2014 ${ACADEMY_TITLE}`, description: article.summary });
  }
  const help = [
    ["help", "\u0412\u043E\u043F\u0440\u043E\u0441\u044B \u0438 \u043E\u0442\u0432\u0435\u0442\u044B", FAQ_DESCRIPTION, "academy/faq"],
    ["help/faq", "\u0412\u043E\u043F\u0440\u043E\u0441\u044B \u0438 \u043E\u0442\u0432\u0435\u0442\u044B", FAQ_DESCRIPTION, "academy/faq"],
    ["help/fees", "\u041A\u043E\u043C\u0438\u0441\u0441\u0438\u0438", "\u0422\u043E\u0440\u0433\u043E\u0432\u044B\u0435 \u043A\u043E\u043C\u0438\u0441\u0441\u0438\u0438, \u043F\u043E\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u0435 \u0438 \u0432\u044B\u0432\u043E\u0434 \u043D\u0430 VOLTEX.", "academy/knowledge"],
    ["help/rules", "\u041F\u0440\u0430\u0432\u0438\u043B\u0430 \u0442\u043E\u0440\u0433\u043E\u0432\u043B\u0438", "\u041A\u0430\u043A \u0440\u0430\u0431\u043E\u0442\u0430\u044E\u0442 \u043E\u0440\u0434\u0435\u0440\u0430, \u043C\u0430\u0440\u0436\u0430, \u043B\u0438\u043A\u0432\u0438\u0434\u0430\u0446\u0438\u044F \u0438 \u0441\u0442\u0430\u0432\u043A\u0430 \u0444\u0438\u043D\u0430\u043D\u0441\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u044F \u043D\u0430 VOLTEX.", "academy/knowledge"]
  ];
  for (const [path2, title, description, target] of help) pages.push({ path: path2, title: `${title} \u2014 ${HELP_TITLE}`, description, canonical: `${SITE_ORIGIN}/${target}` });
  pages.push({ path: "help/status", title: `\u0421\u0442\u0430\u0442\u0443\u0441 \u0441\u0438\u0441\u0442\u0435\u043C\u044B \u2014 ${ACADEMY_TITLE}`, description: "\u041E\u0442\u0432\u0435\u0447\u0430\u044E\u0442 \u043B\u0438 \u0441\u0435\u0440\u0432\u0435\u0440 VOLTEX \u0438 \u0440\u044B\u043D\u043E\u0447\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435; \u043E\u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u043D\u043D\u044B\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F \u043E \u0441\u0431\u043E\u044F\u0445." });
  return pages;
}
function withPageHead(indexHtml, page) {
  const title = escapeHtml(page.title);
  const description = escapeHtml(page.description);
  const canonical = escapeHtml(page.canonical ?? `${SITE_ORIGIN}/${page.path}`);
  return indexHtml.replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`).replace(/(<meta name="description" content=")[^"]*(")/, `$1${description}$2`).replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${canonical}$2`).replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${canonical}$2`).replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${title}$2`).replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${description}$2`).replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${title}$2`).replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${description}$2`);
}

// src/lib/legalContent.ts
var RU_TERMS = {
  title: "\u0423\u0441\u043B\u043E\u0432\u0438\u044F \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D\u0438\u044F",
  updated: "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0435 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0435: 22 \u0430\u0432\u0433\u0443\u0441\u0442\u0430 2026 \u0433.",
  intro: "\u042D\u0442\u0438 \u0443\u0441\u043B\u043E\u0432\u0438\u044F \u0440\u0435\u0433\u0443\u043B\u0438\u0440\u0443\u044E\u0442 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D\u0438\u0435 \u043F\u043B\u0430\u0442\u0444\u043E\u0440\u043C\u044B VOLTEX. \u0420\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u0443\u044F\u0441\u044C \u0438\u043B\u0438 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u044F \u0441\u0435\u0440\u0432\u0438\u0441, \u0442\u044B \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0430\u0435\u0448\u044C, \u0447\u0442\u043E \u043F\u0440\u043E\u0447\u0438\u0442\u0430\u043B(\u0430) \u0438 \u0441\u043E\u0433\u043B\u0430\u0441\u0435\u043D(\u043D\u0430) \u0441 \u0438\u0437\u043B\u043E\u0436\u0435\u043D\u043D\u044B\u043C \u043D\u0438\u0436\u0435.",
  sections: [
    {
      heading: "1. \u041E \u0441\u0435\u0440\u0432\u0438\u0441\u0435",
      body: [
        "VOLTEX \u2014 \u043F\u043B\u0430\u0442\u0444\u043E\u0440\u043C\u0430 \u0434\u043B\u044F \u0442\u043E\u0440\u0433\u043E\u0432\u043B\u0438 \u043A\u0440\u0438\u043F\u0442\u043E\u0432\u0430\u043B\u044E\u0442\u0430\u043C\u0438, \u043F\u043E\u0437\u0432\u043E\u043B\u044F\u044E\u0449\u0430\u044F \u0440\u0430\u0437\u043C\u0435\u0449\u0430\u0442\u044C \u043B\u0438\u043C\u0438\u0442\u043D\u044B\u0435 \u0438 \u0440\u044B\u043D\u043E\u0447\u043D\u044B\u0435 \u043E\u0440\u0434\u0435\u0440\u0430, \u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0430\u043A\u0442\u0438\u0432\u044B \u0432\u043E \u0432\u043D\u0443\u0442\u0440\u0435\u043D\u043D\u0435\u043C \u043A\u043E\u0448\u0435\u043B\u044C\u043A\u0435 \u0438 \u0441\u043E\u0432\u0435\u0440\u0448\u0430\u0442\u044C \u0434\u0435\u043F\u043E\u0437\u0438\u0442\u044B/\u0432\u044B\u0432\u043E\u0434\u044B \u0432 \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u043C\u044B\u0445 \u0441\u0435\u0442\u044F\u0445."
      ]
    },
    {
      heading: "2. \u041F\u0440\u0430\u0432\u043E \u043D\u0430 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D\u0438\u0435",
      body: [
        "\u0421\u0435\u0440\u0432\u0438\u0441\u043E\u043C \u043C\u043E\u0433\u0443\u0442 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u0435\u0435\u0441\u043F\u043E\u0441\u043E\u0431\u043D\u044B\u0435 \u043B\u0438\u0446\u0430 \u0441\u0442\u0430\u0440\u0448\u0435 18 \u043B\u0435\u0442. \u0420\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u0443\u044F\u0441\u044C, \u0442\u044B \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0430\u0435\u0448\u044C, \u0447\u0442\u043E \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D\u0438\u0435 \u043A\u0440\u0438\u043F\u0442\u043E\u0432\u0430\u043B\u044E\u0442\u043D\u044B\u0445 \u0441\u0435\u0440\u0432\u0438\u0441\u043E\u0432 \u043D\u0435 \u0437\u0430\u043F\u0440\u0435\u0449\u0435\u043D\u043E \u0432 \u0442\u0432\u043E\u0435\u0439 \u044E\u0440\u0438\u0441\u0434\u0438\u043A\u0446\u0438\u0438."
      ]
    },
    {
      heading: "3. \u0410\u043A\u043A\u0430\u0443\u043D\u0442 \u0438 \u0431\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E\u0441\u0442\u044C",
      body: [
        "\u0422\u044B \u043D\u0435\u0441\u0451\u0448\u044C \u043E\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0435\u043D\u043D\u043E\u0441\u0442\u044C \u0437\u0430 \u043A\u043E\u043D\u0444\u0438\u0434\u0435\u043D\u0446\u0438\u0430\u043B\u044C\u043D\u043E\u0441\u0442\u044C \u043F\u0430\u0440\u043E\u043B\u044F \u0438, \u043F\u0440\u0438 \u0432\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0438, \u043A\u043B\u044E\u0447\u0435\u0439 \u0434\u0432\u0443\u0445\u0444\u0430\u043A\u0442\u043E\u0440\u043D\u043E\u0439 \u0430\u0443\u0442\u0435\u043D\u0442\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u0438. \u041C\u044B \u043D\u0430\u0441\u0442\u043E\u044F\u0442\u0435\u043B\u044C\u043D\u043E \u0440\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u0443\u0435\u043C \u0432\u043A\u043B\u044E\u0447\u0438\u0442\u044C 2FA \u0432 \u0440\u0430\u0437\u0434\u0435\u043B\u0435 \xAB\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u2192 \u0411\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E\u0441\u0442\u044C\xBB.",
        "\u0421\u043E\u043E\u0431\u0449\u0438 \u043D\u0430\u043C \u043D\u0435\u043C\u0435\u0434\u043B\u0435\u043D\u043D\u043E \u043F\u0440\u0438 \u043F\u043E\u0434\u043E\u0437\u0440\u0435\u043D\u0438\u0438 \u043D\u0430 \u043D\u0435\u0441\u0430\u043D\u043A\u0446\u0438\u043E\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0439 \u0434\u043E\u0441\u0442\u0443\u043F \u043A \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0443."
      ]
    },
    {
      heading: "4. \u041E\u0440\u0434\u0435\u0440\u0430 \u0438 \u0438\u0441\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u0435",
      body: [
        "\u041E\u0440\u0434\u0435\u0440\u0430 \u0438\u0441\u043F\u043E\u043B\u043D\u044F\u044E\u0442\u0441\u044F \u0442\u043E\u0440\u0433\u043E\u0432\u044B\u043C \u0434\u0432\u0438\u0436\u043A\u043E\u043C \u043F\u043E \u043F\u0440\u0438\u043D\u0446\u0438\u043F\u0443 \u0446\u0435\u043D\u0430-\u0432\u0440\u0435\u043C\u044F \u0432 \u043F\u043E\u0440\u044F\u0434\u043A\u0435 \u043F\u043E\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u044F. \u0420\u044B\u043D\u043E\u0447\u043D\u044B\u0435 \u043E\u0440\u0434\u0435\u0440\u0430 \u0438\u0441\u043F\u043E\u043B\u043D\u044F\u044E\u0442\u0441\u044F \u043F\u043E \u043B\u0443\u0447\u0448\u0435\u0439 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E\u0439 \u0446\u0435\u043D\u0435 \u0432 \u0441\u0442\u0430\u043A\u0430\u043D\u0435 \u043D\u0430 \u043C\u043E\u043C\u0435\u043D\u0442 \u0440\u0430\u0437\u043C\u0435\u0449\u0435\u043D\u0438\u044F \u0438 \u043C\u043E\u0433\u0443\u0442 \u0431\u044B\u0442\u044C \u043F\u043E\u0434\u0432\u0435\u0440\u0436\u0435\u043D\u044B \u043F\u0440\u043E\u0441\u043A\u0430\u043B\u044C\u0437\u044B\u0432\u0430\u043D\u0438\u044E \u043F\u0440\u0438 \u043D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E\u0439 \u043B\u0438\u043A\u0432\u0438\u0434\u043D\u043E\u0441\u0442\u0438."
      ]
    },
    {
      heading: "5. \u041A\u043E\u043C\u0438\u0441\u0441\u0438\u0438",
      body: [
        "\u0414\u0435\u0439\u0441\u0442\u0432\u0443\u044E\u0449\u0438\u0435 \u0442\u043E\u0440\u0433\u043E\u0432\u044B\u0435 \u043A\u043E\u043C\u0438\u0441\u0441\u0438\u0438 \u043E\u0442\u043E\u0431\u0440\u0430\u0436\u0430\u044E\u0442\u0441\u044F \u0432 \u0438\u043D\u0442\u0435\u0440\u0444\u0435\u0439\u0441\u0435 \u043F\u0435\u0440\u0435\u0434 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u0435\u043C \u0441\u0434\u0435\u043B\u043A\u0438. \u041C\u044B \u0432\u043F\u0440\u0430\u0432\u0435 \u0438\u0437\u043C\u0435\u043D\u044F\u0442\u044C \u0440\u0430\u0437\u043C\u0435\u0440 \u043A\u043E\u043C\u0438\u0441\u0441\u0438\u0439, \u0443\u0432\u0435\u0434\u043E\u043C\u0438\u0432 \u043E\u0431 \u044D\u0442\u043E\u043C \u0432 \u0441\u0435\u0440\u0432\u0438\u0441\u0435 \u0437\u0430\u0440\u0430\u043D\u0435\u0435."
      ]
    },
    {
      heading: "6. \u0417\u0430\u043F\u0440\u0435\u0449\u0451\u043D\u043D\u043E\u0435 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D\u0438\u0435",
      body: [
        "\u0417\u0430\u043F\u0440\u0435\u0449\u0430\u0435\u0442\u0441\u044F \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C \u0441\u0435\u0440\u0432\u0438\u0441 \u0434\u043B\u044F \u043E\u0442\u043C\u044B\u0432\u0430\u043D\u0438\u044F \u0434\u0435\u043D\u0435\u0433, \u0444\u0438\u043D\u0430\u043D\u0441\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u044F \u0437\u0430\u043F\u0440\u0435\u0449\u0451\u043D\u043D\u043E\u0439 \u0434\u0435\u044F\u0442\u0435\u043B\u044C\u043D\u043E\u0441\u0442\u0438, \u043C\u0430\u043D\u0438\u043F\u0443\u043B\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u044F \u0440\u044B\u043D\u043A\u043E\u043C (\u0441\u043F\u0443\u0444\u0438\u043D\u0433, \u0432\u043E\u0448\u0438\u043D\u0433-\u0442\u0440\u0435\u0439\u0434\u0438\u043D\u0433) \u0438\u043B\u0438 \u043F\u043E\u043F\u044B\u0442\u043E\u043A \u043E\u0431\u043E\u0439\u0442\u0438 \u0442\u0435\u0445\u043D\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D\u0438\u044F \u043F\u043B\u0430\u0442\u0444\u043E\u0440\u043C\u044B."
      ]
    },
    {
      heading: "7. \u041F\u0440\u0438\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0430 \u0438 \u043F\u0440\u0435\u043A\u0440\u0430\u0449\u0435\u043D\u0438\u0435",
      body: [
        "\u041C\u044B \u0432\u043F\u0440\u0430\u0432\u0435 \u043F\u0440\u0438\u043E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u0438\u043B\u0438 \u0437\u0430\u043A\u0440\u044B\u0442\u044C \u0430\u043A\u043A\u0430\u0443\u043D\u0442 \u043F\u0440\u0438 \u043D\u0430\u0440\u0443\u0448\u0435\u043D\u0438\u0438 \u043D\u0430\u0441\u0442\u043E\u044F\u0449\u0438\u0445 \u0443\u0441\u043B\u043E\u0432\u0438\u0439, \u043F\u043E \u0442\u0440\u0435\u0431\u043E\u0432\u0430\u043D\u0438\u044E \u0437\u0430\u043A\u043E\u043D\u0430 \u0438\u043B\u0438 \u043F\u0440\u0438 \u043F\u043E\u0434\u043E\u0437\u0440\u0435\u043D\u0438\u0438 \u043D\u0430 \u043C\u043E\u0448\u0435\u043D\u043D\u0438\u0447\u0435\u0441\u0442\u0432\u043E, \u0443\u0432\u0435\u0434\u043E\u043C\u0438\u0432 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F, \u0433\u0434\u0435 \u044D\u0442\u043E \u0432\u043E\u0437\u043C\u043E\u0436\u043D\u043E."
      ]
    },
    {
      heading: "8. \u041E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D\u0438\u0435 \u043E\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0435\u043D\u043D\u043E\u0441\u0442\u0438",
      body: [
        "\u0421\u0435\u0440\u0432\u0438\u0441 \u043F\u0440\u0435\u0434\u043E\u0441\u0442\u0430\u0432\u043B\u044F\u0435\u0442\u0441\u044F \xAB\u043A\u0430\u043A \u0435\u0441\u0442\u044C\xBB. \u041C\u044B \u043D\u0435 \u0433\u0430\u0440\u0430\u043D\u0442\u0438\u0440\u0443\u0435\u043C \u0431\u0435\u0441\u043F\u0435\u0440\u0435\u0431\u043E\u0439\u043D\u0443\u044E \u0440\u0430\u0431\u043E\u0442\u0443 \u0438 \u043D\u0435 \u043D\u0435\u0441\u0451\u043C \u043E\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0435\u043D\u043D\u043E\u0441\u0442\u0438 \u0437\u0430 \u0443\u0431\u044B\u0442\u043A\u0438, \u0432\u043E\u0437\u043D\u0438\u043A\u0448\u0438\u0435 \u0438\u0437-\u0437\u0430 \u0440\u044B\u043D\u043E\u0447\u043D\u043E\u0439 \u0432\u043E\u043B\u0430\u0442\u0438\u043B\u044C\u043D\u043E\u0441\u0442\u0438, \u0441\u0431\u043E\u0435\u0432 \u0441\u0435\u0442\u0438 \u0438\u043B\u0438 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0439 \u0442\u0440\u0435\u0442\u044C\u0438\u0445 \u0441\u0442\u043E\u0440\u043E\u043D."
      ]
    },
    {
      heading: "9. \u0418\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F \u0443\u0441\u043B\u043E\u0432\u0438\u0439",
      body: [
        "\u041C\u044B \u043C\u043E\u0436\u0435\u043C \u043E\u0431\u043D\u043E\u0432\u043B\u044F\u0442\u044C \u044D\u0442\u0438 \u0443\u0441\u043B\u043E\u0432\u0438\u044F. \u0421\u0443\u0449\u0435\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0435 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F \u0431\u0443\u0434\u0443\u0442 \u0430\u043D\u043E\u043D\u0441\u0438\u0440\u043E\u0432\u0430\u043D\u044B \u0432 \u0441\u0435\u0440\u0432\u0438\u0441\u0435 \u043D\u0435 \u043C\u0435\u043D\u0435\u0435 \u0447\u0435\u043C \u0437\u0430 7 \u0434\u043D\u0435\u0439 \u0434\u043E \u0432\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u044F \u0432 \u0441\u0438\u043B\u0443."
      ]
    }
  ]
};
var RU_PRIVACY = {
  title: "\u041F\u043E\u043B\u0438\u0442\u0438\u043A\u0430 \u043A\u043E\u043D\u0444\u0438\u0434\u0435\u043D\u0446\u0438\u0430\u043B\u044C\u043D\u043E\u0441\u0442\u0438",
  updated: "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0435 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0435: 22 \u0430\u0432\u0433\u0443\u0441\u0442\u0430 2026 \u0433.",
  intro: "\u042D\u0442\u043E\u0442 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442 \u043E\u043F\u0438\u0441\u044B\u0432\u0430\u0435\u0442, \u043A\u0430\u043A\u0438\u0435 \u0434\u0430\u043D\u043D\u044B\u0435 \u043C\u044B \u0441\u043E\u0431\u0438\u0440\u0430\u0435\u043C, \u0437\u0430\u0447\u0435\u043C \u0438 \u043A\u0430\u043A \u0438\u0445 \u0437\u0430\u0449\u0438\u0449\u0430\u0435\u043C.",
  sections: [
    {
      heading: "1. \u041A\u0430\u043A\u0438\u0435 \u0434\u0430\u043D\u043D\u044B\u0435 \u043C\u044B \u0441\u043E\u0431\u0438\u0440\u0430\u0435\u043C",
      body: [
        "\u0420\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u043E\u043D\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435 (email, \u0445\u0435\u0448\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0439 \u043F\u0430\u0440\u043E\u043B\u044C), \u0434\u0430\u043D\u043D\u044B\u0435 \u0432\u0435\u0440\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u0438 (KYC): \u0438\u043C\u044F, \u0441\u0442\u0440\u0430\u043D\u0430, \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442, \u0443\u0434\u043E\u0441\u0442\u043E\u0432\u0435\u0440\u044F\u044E\u0449\u0438\u0439 \u043B\u0438\u0447\u043D\u043E\u0441\u0442\u044C, \u0438\u0441\u0442\u043E\u0440\u0438\u044F \u0442\u043E\u0440\u0433\u043E\u0432 \u0438 \u0442\u0440\u0430\u043D\u0437\u0430\u043A\u0446\u0438\u0439, \u0442\u0435\u0445\u043D\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u0438\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u044F (IP-\u0430\u0434\u0440\u0435\u0441, \u0442\u0438\u043F \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0430) \u0434\u043B\u044F \u0446\u0435\u043B\u0435\u0439 \u0431\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E\u0441\u0442\u0438."
      ]
    },
    {
      heading: "2. \u041A\u0430\u043A \u043C\u044B \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u043C \u0434\u0430\u043D\u043D\u044B\u0435",
      body: [
        "\u0414\u043B\u044F \u043F\u0440\u0435\u0434\u043E\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u0438\u044F \u0441\u0435\u0440\u0432\u0438\u0441\u0430, \u0438\u0441\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u044F \u043E\u0440\u0434\u0435\u0440\u043E\u0432, \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0438 \u0434\u0435\u043F\u043E\u0437\u0438\u0442\u043E\u0432/\u0432\u044B\u0432\u043E\u0434\u043E\u0432, \u043F\u0440\u0435\u0434\u043E\u0442\u0432\u0440\u0430\u0449\u0435\u043D\u0438\u044F \u043C\u043E\u0448\u0435\u043D\u043D\u0438\u0447\u0435\u0441\u0442\u0432\u0430 \u0438 \u0441\u043E\u0431\u043B\u044E\u0434\u0435\u043D\u0438\u044F \u0442\u0440\u0435\u0431\u043E\u0432\u0430\u043D\u0438\u0439 \u0437\u0430\u043A\u043E\u043D\u043E\u0434\u0430\u0442\u0435\u043B\u044C\u0441\u0442\u0432\u0430 \u043E \u043F\u0440\u043E\u0442\u0438\u0432\u043E\u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0438 \u043E\u0442\u043C\u044B\u0432\u0430\u043D\u0438\u044E \u0434\u0435\u043D\u0435\u0433 (AML/KYC)."
      ]
    },
    {
      heading: "3. \u0414\u0430\u043D\u043D\u044B\u0435 \u0432\u0435\u0440\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u0438 (KYC)",
      body: [
        "\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u044B, \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u043D\u044B\u0435 \u0434\u043B\u044F \u0432\u0435\u0440\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u0438 \u043B\u0438\u0447\u043D\u043E\u0441\u0442\u0438, \u0445\u0440\u0430\u043D\u044F\u0442\u0441\u044F \u0432 \u0437\u0430\u0448\u0438\u0444\u0440\u043E\u0432\u0430\u043D\u043D\u043E\u043C \u0432\u0438\u0434\u0435 \u0438 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B \u0442\u043E\u043B\u044C\u043A\u043E \u0443\u043F\u043E\u043B\u043D\u043E\u043C\u043E\u0447\u0435\u043D\u043D\u043E\u043C\u0443 \u043F\u0435\u0440\u0441\u043E\u043D\u0430\u043B\u0443 \u0434\u043B\u044F \u0446\u0435\u043B\u0435\u0439 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438 \u0438 \u0441\u043E\u043E\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0438\u044F \u0442\u0440\u0435\u0431\u043E\u0432\u0430\u043D\u0438\u044F\u043C \u0440\u0435\u0433\u0443\u043B\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u044F."
      ]
    },
    {
      heading: "4. \u041F\u0435\u0440\u0435\u0434\u0430\u0447\u0430 \u0434\u0430\u043D\u043D\u044B\u0445 \u0442\u0440\u0435\u0442\u044C\u0438\u043C \u043B\u0438\u0446\u0430\u043C",
      body: [
        "\u041C\u044B \u043D\u0435 \u043F\u0440\u043E\u0434\u0430\u0451\u043C \u043F\u0435\u0440\u0441\u043E\u043D\u0430\u043B\u044C\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435. \u0414\u0430\u043D\u043D\u044B\u0435 \u043C\u043E\u0433\u0443\u0442 \u043F\u0435\u0440\u0435\u0434\u0430\u0432\u0430\u0442\u044C\u0441\u044F \u043F\u043E\u0441\u0442\u0430\u0432\u0449\u0438\u043A\u0430\u043C \u0438\u043D\u0444\u0440\u0430\u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u044B (\u0445\u043E\u0441\u0442\u0438\u043D\u0433, \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0430 \u043F\u043B\u0430\u0442\u0435\u0436\u0435\u0439) \u0438\u0441\u043A\u043B\u044E\u0447\u0438\u0442\u0435\u043B\u044C\u043D\u043E \u0432 \u043E\u0431\u044A\u0451\u043C\u0435, \u043D\u0435\u043E\u0431\u0445\u043E\u0434\u0438\u043C\u043E\u043C \u0434\u043B\u044F \u0440\u0430\u0431\u043E\u0442\u044B \u0441\u0435\u0440\u0432\u0438\u0441\u0430, \u0430 \u0442\u0430\u043A\u0436\u0435 \u043F\u043E \u0437\u0430\u043A\u043E\u043D\u043D\u043E\u043C\u0443 \u0442\u0440\u0435\u0431\u043E\u0432\u0430\u043D\u0438\u044E \u0433\u043E\u0441\u0443\u0434\u0430\u0440\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0445 \u043E\u0440\u0433\u0430\u043D\u043E\u0432."
      ]
    },
    {
      heading: "5. \u0411\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E\u0441\u0442\u044C \u0434\u0430\u043D\u043D\u044B\u0445",
      body: [
        "\u041F\u0430\u0440\u043E\u043B\u0438 \u0445\u0440\u0430\u043D\u044F\u0442\u0441\u044F \u0432 \u0432\u0438\u0434\u0435 \u043D\u0435\u043E\u0431\u0440\u0430\u0442\u0438\u043C\u044B\u0445 \u043A\u0440\u0438\u043F\u0442\u043E\u0433\u0440\u0430\u0444\u0438\u0447\u0435\u0441\u043A\u0438\u0445 \u0445\u0435\u0448\u0435\u0439. \u0421\u0435\u043A\u0440\u0435\u0442\u044B API-\u043A\u043B\u044E\u0447\u0435\u0439 \u0448\u0438\u0444\u0440\u0443\u044E\u0442\u0441\u044F \u043F\u0440\u0438 \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0438. \u041C\u044B \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u043C \u0434\u0432\u0443\u0445\u0444\u0430\u043A\u0442\u043E\u0440\u043D\u0443\u044E \u0430\u0443\u0442\u0435\u043D\u0442\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044E \u0434\u043B\u044F \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0439 \u0437\u0430\u0449\u0438\u0442\u044B \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0430."
      ]
    },
    {
      heading: "6. \u0422\u0432\u043E\u0438 \u043F\u0440\u0430\u0432\u0430",
      body: [
        "\u0422\u044B \u043C\u043E\u0436\u0435\u0448\u044C \u0437\u0430\u043F\u0440\u043E\u0441\u0438\u0442\u044C \u043A\u043E\u043F\u0438\u044E \u0441\u0432\u043E\u0438\u0445 \u0434\u0430\u043D\u043D\u044B\u0445 \u0438\u043B\u0438 \u0438\u0445 \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u0435, \u0437\u0430 \u0438\u0441\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435\u043C \u0438\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u0438, \u043A\u043E\u0442\u043E\u0440\u0443\u044E \u043C\u044B \u043E\u0431\u044F\u0437\u0430\u043D\u044B \u0445\u0440\u0430\u043D\u0438\u0442\u044C \u043F\u043E \u0437\u0430\u043A\u043E\u043D\u0443 (\u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440, \u0437\u0430\u043F\u0438\u0441\u0438 KYC/AML \u0432 \u0442\u0435\u0447\u0435\u043D\u0438\u0435 \u0443\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u043D\u043E\u0433\u043E \u0441\u0440\u043E\u043A\u0430)."
      ]
    },
    {
      heading: "7. \u0425\u0440\u0430\u043D\u0435\u043D\u0438\u0435 \u0434\u0430\u043D\u043D\u044B\u0445",
      body: [
        "\u0414\u0430\u043D\u043D\u044B\u0435 \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0430 \u0445\u0440\u0430\u043D\u044F\u0442\u0441\u044F, \u043F\u043E\u043A\u0430 \u0430\u043A\u043A\u0430\u0443\u043D\u0442 \u0430\u043A\u0442\u0438\u0432\u0435\u043D. \u041F\u043E\u0441\u043B\u0435 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u044F \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0430 \u0434\u0430\u043D\u043D\u044B\u0435, \u0442\u0440\u0435\u0431\u0443\u0435\u043C\u044B\u0435 \u0437\u0430\u043A\u043E\u043D\u043E\u043C (\u0442\u0440\u0430\u043D\u0437\u0430\u043A\u0446\u0438\u0438, KYC), \u0445\u0440\u0430\u043D\u044F\u0442\u0441\u044F \u0443\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u043D\u044B\u0439 \u0440\u0435\u0433\u0443\u043B\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435\u043C \u0441\u0440\u043E\u043A, \u043E\u0441\u0442\u0430\u043B\u044C\u043D\u044B\u0435 \u2014 \u0443\u0434\u0430\u043B\u044F\u044E\u0442\u0441\u044F."
      ]
    },
    {
      heading: "8. \u0421\u0432\u044F\u0437\u044C \u0441 \u043D\u0430\u043C\u0438",
      body: [
        "\u0412\u043E\u043F\u0440\u043E\u0441\u044B \u043E \u0434\u0430\u043D\u043D\u044B\u0445 \u0438 \u043A\u043E\u043D\u0444\u0438\u0434\u0435\u043D\u0446\u0438\u0430\u043B\u044C\u043D\u043E\u0441\u0442\u0438 \u043C\u043E\u0436\u043D\u043E \u043D\u0430\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0447\u0435\u0440\u0435\u0437 \u0440\u0430\u0437\u0434\u0435\u043B \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u043A\u0438 \u0432 \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0435."
      ]
    }
  ]
};
var RU_ABOUT = {
  title: "\u041E \u043D\u0430\u0441",
  updated: "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0435 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0435: 22 \u0430\u0432\u0433\u0443\u0441\u0442\u0430 2026 \u0433.",
  intro: "VOLTEX \u2014 \u043F\u043B\u0430\u0442\u0444\u043E\u0440\u043C\u0430 \u0434\u043B\u044F \u0442\u043E\u0440\u0433\u043E\u0432\u043B\u0438 \u043A\u0440\u0438\u043F\u0442\u043E\u0432\u0430\u043B\u044E\u0442\u0430\u043C\u0438: \u0441\u043F\u043E\u0442 \u0438 \u0444\u044C\u044E\u0447\u0435\u0440\u0441\u044B \u0441 \u043C\u0430\u0440\u0436\u0438\u043D\u0430\u043B\u044C\u043D\u043E\u0439 \u0442\u043E\u0440\u0433\u043E\u0432\u043B\u0435\u0439, \u043B\u0438\u043C\u0438\u0442\u043D\u044B\u0435, \u0440\u044B\u043D\u043E\u0447\u043D\u044B\u0435, \u0441\u0442\u043E\u043F- \u0438 \u0442\u0435\u0439\u043A-\u043F\u0440\u043E\u0444\u0438\u0442 \u043E\u0440\u0434\u0435\u0440\u0430, \u0432\u044B\u0432\u043E\u0434 \u0438 \u0434\u0435\u043F\u043E\u0437\u0438\u0442 \u0432 \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u043C\u044B\u0445 \u0441\u0435\u0442\u044F\u0445.",
  sections: [
    {
      heading: "\u0422\u043E\u0440\u0433\u043E\u0432\u044B\u0439 \u0434\u0432\u0438\u0436\u043E\u043A",
      body: [
        "\u041E\u0440\u0434\u0435\u0440\u0430 \u0441\u043E\u043F\u043E\u0441\u0442\u0430\u0432\u043B\u044F\u044E\u0442\u0441\u044F \u0441\u043E\u0431\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u043C \u0442\u043E\u0440\u0433\u043E\u0432\u044B\u043C \u0434\u0432\u0438\u0436\u043A\u043E\u043C \u043F\u043E \u043F\u0440\u0438\u043D\u0446\u0438\u043F\u0443 \u0446\u0435\u043D\u0430-\u0432\u0440\u0435\u043C\u044F. \u0420\u044B\u043D\u043E\u0447\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435 \u2014 \u0446\u0435\u043D\u044B, \u0441\u0432\u0435\u0447\u0438 \u0438 \u0441\u0442\u0430\u043A\u0430\u043D \u2014 \u043F\u043E\u0441\u0442\u0443\u043F\u0430\u044E\u0442 \u0441 \u0431\u0438\u0440\u0436\u0435\u0432\u044B\u0445 \u043F\u043B\u043E\u0449\u0430\u0434\u043E\u043A \u0432 \u0440\u0435\u0430\u043B\u044C\u043D\u043E\u043C \u0432\u0440\u0435\u043C\u0435\u043D\u0438."
      ]
    },
    {
      heading: "\u0411\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E\u0441\u0442\u044C \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0430",
      body: [
        "\u041F\u0430\u0440\u043E\u043B\u0438 \u0445\u0440\u0430\u043D\u044F\u0442\u0441\u044F \u0432 \u0432\u0438\u0434\u0435 \u043D\u0435\u043E\u0431\u0440\u0430\u0442\u0438\u043C\u044B\u0445 \u043A\u0440\u0438\u043F\u0442\u043E\u0433\u0440\u0430\u0444\u0438\u0447\u0435\u0441\u043A\u0438\u0445 \u0445\u0435\u0448\u0435\u0439, \u0441\u0435\u043A\u0440\u0435\u0442\u044B API-\u043A\u043B\u044E\u0447\u0435\u0439 \u0448\u0438\u0444\u0440\u0443\u044E\u0442\u0441\u044F \u043F\u0440\u0438 \u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0438. \u0414\u0432\u0443\u0445\u0444\u0430\u043A\u0442\u043E\u0440\u043D\u0430\u044F \u0430\u0443\u0442\u0435\u043D\u0442\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F \u0438 \u0436\u0443\u0440\u043D\u0430\u043B \u0432\u0445\u043E\u0434\u043E\u0432 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B \u0432 \u0440\u0430\u0437\u0434\u0435\u043B\u0435 \xAB\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u2192 \u0411\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E\u0441\u0442\u044C\xBB."
      ]
    },
    {
      heading: "\u0424\u044C\u044E\u0447\u0435\u0440\u0441\u044B \u0438 \u0440\u0438\u0441\u043A-\u043C\u0435\u043D\u0435\u0434\u0436\u043C\u0435\u043D\u0442",
      body: [
        "\u041C\u0430\u0440\u0436\u0438\u043D\u0430\u043B\u044C\u043D\u0430\u044F \u0442\u043E\u0440\u0433\u043E\u0432\u043B\u044F \u0441 \u0438\u0437\u043E\u043B\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u043E\u0439 \u0438 \u043A\u0440\u043E\u0441\u0441-\u043C\u0430\u0440\u0436\u043E\u0439, \u043C\u043D\u043E\u0433\u043E\u0443\u0440\u043E\u0432\u043D\u0435\u0432\u043E\u0435 \u043F\u043B\u0435\u0447\u043E, \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0430\u044F \u043B\u0438\u043A\u0432\u0438\u0434\u0430\u0446\u0438\u044F \u043F\u043E \u0440\u0435\u0430\u043B\u044C\u043D\u043E\u0439 mark-price \u0438 \u0441\u0442\u0440\u0430\u0445\u043E\u0432\u043E\u0439 \u0444\u043E\u043D\u0434 \u043D\u0430 \u0441\u043B\u0443\u0447\u0430\u0439 \u0434\u0435\u0444\u0438\u0446\u0438\u0442\u0430 \u043F\u0440\u0438 \u043B\u0438\u043A\u0432\u0438\u0434\u0430\u0446\u0438\u0438."
      ]
    },
    {
      heading: "\u041F\u0440\u043E\u0437\u0440\u0430\u0447\u043D\u043E\u0441\u0442\u044C",
      body: [
        "\u041C\u044B \u043D\u0435 \u043F\u0443\u0431\u043B\u0438\u043A\u0443\u0435\u043C \u043D\u0435\u043F\u0440\u043E\u0432\u0435\u0440\u044F\u0435\u043C\u044B\u0435 \u043E\u0431\u0435\u0449\u0430\u043D\u0438\u044F \u043E \u0434\u043E\u0445\u043E\u0434\u043D\u043E\u0441\u0442\u0438 \u0438\u043B\u0438 \u043E\u0431\u044A\u0451\u043C\u0430\u0445 \u0442\u043E\u0440\u0433\u043E\u0432. \u041A\u043E\u043C\u0438\u0441\u0441\u0438\u0438, \u043B\u0438\u043C\u0438\u0442\u044B \u0438 \u0443\u0441\u043B\u043E\u0432\u0438\u044F \u043E\u0442\u043E\u0431\u0440\u0430\u0436\u0430\u044E\u0442\u0441\u044F \u0432 \u0438\u043D\u0442\u0435\u0440\u0444\u0435\u0439\u0441\u0435 \u0442\u0430\u043C, \u0433\u0434\u0435 \u043E\u043D\u0438 \u043F\u0440\u0438\u043C\u0435\u043D\u044F\u044E\u0442\u0441\u044F \u2014 \u0434\u043E \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u044F \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F, \u0430 \u043D\u0435 \u043C\u0435\u043B\u043A\u0438\u043C \u0448\u0440\u0438\u0444\u0442\u043E\u043C."
      ]
    }
  ]
};
var RU_SUPPORT = {
  title: "\u041F\u043E\u0434\u0434\u0435\u0440\u0436\u043A\u0430",
  updated: "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0435 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0435: 22 \u0430\u0432\u0433\u0443\u0441\u0442\u0430 2026 \u0433.",
  intro: "\u041E\u0442\u0432\u0435\u0442\u044B \u043D\u0430 \u0447\u0430\u0441\u0442\u044B\u0435 \u0432\u043E\u043F\u0440\u043E\u0441\u044B. \u0414\u043B\u044F \u0432\u043E\u043F\u0440\u043E\u0441\u043E\u0432 \u043F\u043E \u043A\u043E\u043D\u043A\u0440\u0435\u0442\u043D\u043E\u043C\u0443 \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0443 \u0432 \u043F\u0435\u0440\u0432\u0443\u044E \u043E\u0447\u0435\u0440\u0435\u0434\u044C \u0437\u0430\u0433\u043B\u044F\u043D\u0438 \u0432 \xAB\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438\xBB.",
  sections: [
    {
      heading: "\u041A\u0430\u043A \u043F\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u044C \u0431\u0430\u043B\u0430\u043D\u0441",
      body: [
        "\u041E\u0442\u043A\u0440\u043E\u0439 \xAB\u041F\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u044C\xBB \u2192 \u0432\u044B\u0431\u0435\u0440\u0438 \u0441\u0435\u0442\u044C \u2192 \u043E\u0442\u043F\u0440\u0430\u0432\u044C \u0441\u0440\u0435\u0434\u0441\u0442\u0432\u0430 \u043D\u0430 \u043F\u043E\u043A\u0430\u0437\u0430\u043D\u043D\u044B\u0439 \u0430\u0434\u0440\u0435\u0441 \u2192 \u0432\u0441\u0442\u0430\u0432\u044C \u0445\u0435\u0448 \u0442\u0440\u0430\u043D\u0437\u0430\u043A\u0446\u0438\u0438 \u0434\u043B\u044F \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438. \u0410\u043A\u0442\u0443\u0430\u043B\u044C\u043D\u0430\u044F \u043C\u0438\u043D\u0438\u043C\u0430\u043B\u044C\u043D\u0430\u044F \u0441\u0443\u043C\u043C\u0430 \u0432 USD \u0443\u043A\u0430\u0437\u0430\u043D\u0430 \u0432 \u0444\u043E\u0440\u043C\u0435 \u043F\u043E\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u044F; \u0441\u0443\u043C\u043C\u0430 \u043D\u0438\u0436\u0435 \u043C\u0438\u043D\u0438\u043C\u0443\u043C\u0430 \u043D\u0435 \u0431\u0443\u0434\u0435\u0442 \u0437\u0430\u0447\u0438\u0441\u043B\u0435\u043D\u0430."
      ]
    },
    {
      heading: "\u041E\u0440\u0434\u0435\u0440 \u043D\u0435 \u0438\u0441\u043F\u043E\u043B\u043D\u044F\u0435\u0442\u0441\u044F",
      body: [
        "\u041F\u0440\u043E\u0432\u0435\u0440\u044C, \u0447\u0442\u043E \u0442\u0440\u0438\u0433\u0433\u0435\u0440\u043D\u0430\u044F \u0446\u0435\u043D\u0430 \u0441\u0442\u043E\u043F/\u0442\u0435\u0439\u043A-\u043F\u0440\u043E\u0444\u0438\u0442 \u043E\u0440\u0434\u0435\u0440\u0430 \u0440\u0430\u0441\u043F\u043E\u043B\u043E\u0436\u0435\u043D\u0430 \u043F\u043E \u043F\u0440\u0430\u0432\u0438\u043B\u044C\u043D\u0443\u044E \u0441\u0442\u043E\u0440\u043E\u043D\u0443 \u043E\u0442 \u0442\u0435\u043A\u0443\u0449\u0435\u0439 \u0440\u044B\u043D\u043E\u0447\u043D\u043E\u0439 \u0446\u0435\u043D\u044B \u2014 \u0438\u043D\u0442\u0435\u0440\u0444\u0435\u0439\u0441 \u043F\u043E\u0434\u0441\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u0442 \u043D\u0443\u0436\u043D\u043E\u0435 \u043D\u0430\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u043F\u0440\u044F\u043C\u043E \u0432 \u0444\u043E\u0440\u043C\u0435 \u043E\u0440\u0434\u0435\u0440\u0430. \u041E\u0442\u043A\u0440\u044B\u0442\u044B\u0435 \u0443\u0441\u043B\u043E\u0432\u043D\u044B\u0435 \u043E\u0440\u0434\u0435\u0440\u0430 \u0436\u0434\u0443\u0442 \u0441\u0440\u0430\u0431\u0430\u0442\u044B\u0432\u0430\u043D\u0438\u044F \u0442\u0440\u0438\u0433\u0433\u0435\u0440\u0430 \u0438 \u043E\u0442\u043E\u0431\u0440\u0430\u0436\u0430\u044E\u0442\u0441\u044F \u0441\u043E \u0441\u0442\u0430\u0442\u0443\u0441\u043E\u043C \xAB\u041E\u0436\u0438\u0434\u0430\u0435\u0442\xBB."
      ]
    },
    {
      heading: "\u0411\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E\u0441\u0442\u044C \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0430",
      body: [
        "\u0412\u043A\u043B\u044E\u0447\u0438 \u0434\u0432\u0443\u0445\u0444\u0430\u043A\u0442\u043E\u0440\u043D\u0443\u044E \u0430\u0443\u0442\u0435\u043D\u0442\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044E \u0438 \u043F\u0435\u0440\u0438\u043E\u0434\u0438\u0447\u0435\u0441\u043A\u0438 \u043F\u0440\u043E\u0432\u0435\u0440\u044F\u0439 \u0436\u0443\u0440\u043D\u0430\u043B \u0432\u0445\u043E\u0434\u043E\u0432 \u0432 \xAB\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u2192 \u0411\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E\u0441\u0442\u044C\xBB \u2014 \u0442\u0430\u043C \u0432\u0438\u0434\u043D\u043E \u043A\u0430\u0436\u0434\u044B\u0439 \u0432\u0445\u043E\u0434 \u0432 \u0430\u043A\u043A\u0430\u0443\u043D\u0442."
      ]
    },
    {
      heading: "\u0412\u0435\u0440\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F (KYC)",
      body: ["\u0421\u0442\u0430\u0442\u0443\u0441 \u0438 \u0442\u0440\u0435\u0431\u0443\u0435\u043C\u044B\u0435 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u044B \u0434\u043B\u044F \u0432\u0435\u0440\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u0438 \u043E\u0442\u043E\u0431\u0440\u0430\u0436\u0430\u044E\u0442\u0441\u044F \u0432 \u0440\u0430\u0437\u0434\u0435\u043B\u0435 \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0430, \u043E\u0442\u0432\u0435\u0447\u0430\u044E\u0449\u0435\u043C \u0437\u0430 \u0432\u0435\u0440\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044E."]
    },
    {
      heading: "\u041E\u0441\u0442\u0430\u043B\u0438\u0441\u044C \u0432\u043E\u043F\u0440\u043E\u0441\u044B",
      body: [
        "\u041F\u0440\u044F\u043C\u043E\u0433\u043E \u043A\u0430\u043D\u0430\u043B\u0430 \u0436\u0438\u0432\u043E\u0439 \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u043A\u0438 \u0432 \u044D\u0442\u043E\u0439 \u0432\u0435\u0440\u0441\u0438\u0438 \u043F\u043B\u0430\u0442\u0444\u043E\u0440\u043C\u044B \u043F\u043E\u043A\u0430 \u043D\u0435\u0442 \u2014 \u0440\u0430\u0437\u0434\u0435\u043B \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u043A\u0438 \u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D \u044D\u0442\u043E\u0439 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435\u0439 \u0441 \u043E\u0442\u0432\u0435\u0442\u0430\u043C\u0438 \u043D\u0430 \u0447\u0430\u0441\u0442\u044B\u0435 \u0432\u043E\u043F\u0440\u043E\u0441\u044B."
      ]
    }
  ]
};
var RU_RISK = {
  title: "\u0420\u0430\u0441\u043A\u0440\u044B\u0442\u0438\u0435 \u0440\u0438\u0441\u043A\u043E\u0432",
  updated: "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0435 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0435: 22 \u0430\u0432\u0433\u0443\u0441\u0442\u0430 2026 \u0433.",
  intro: "\u0422\u043E\u0440\u0433\u043E\u0432\u043B\u044F \u043A\u0440\u0438\u043F\u0442\u043E\u0432\u0430\u043B\u044E\u0442\u0430\u043C\u0438 \u0441\u043E\u043F\u0440\u044F\u0436\u0435\u043D\u0430 \u0441\u043E \u0437\u043D\u0430\u0447\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u043C \u0440\u0438\u0441\u043A\u043E\u043C. \u041F\u0440\u0435\u0436\u0434\u0435 \u0447\u0435\u043C \u0442\u043E\u0440\u0433\u043E\u0432\u0430\u0442\u044C, \u0443\u0431\u0435\u0434\u0438\u0441\u044C, \u0447\u0442\u043E \u043F\u043E\u043D\u0438\u043C\u0430\u0435\u0448\u044C \u0438 \u043F\u0440\u0438\u043D\u0438\u043C\u0430\u0435\u0448\u044C \u043F\u0435\u0440\u0435\u0447\u0438\u0441\u043B\u0435\u043D\u043D\u044B\u0435 \u043D\u0438\u0436\u0435 \u0440\u0438\u0441\u043A\u0438.",
  sections: [
    {
      heading: "1. \u0412\u043E\u043B\u0430\u0442\u0438\u043B\u044C\u043D\u043E\u0441\u0442\u044C",
      body: [
        "\u0426\u0435\u043D\u044B \u043D\u0430 \u043A\u0440\u0438\u043F\u0442\u043E\u0432\u0430\u043B\u044E\u0442\u044B \u043C\u043E\u0433\u0443\u0442 \u0440\u0435\u0437\u043A\u043E \u043C\u0435\u043D\u044F\u0442\u044C\u0441\u044F \u0432 \u0442\u0435\u0447\u0435\u043D\u0438\u0435 \u043A\u043E\u0440\u043E\u0442\u043A\u0438\u0445 \u043F\u0440\u043E\u043C\u0435\u0436\u0443\u0442\u043A\u043E\u0432 \u0432\u0440\u0435\u043C\u0435\u043D\u0438. \u0421\u0442\u043E\u0438\u043C\u043E\u0441\u0442\u044C \u0430\u043A\u0442\u0438\u0432\u043E\u0432 \u043C\u043E\u0436\u0435\u0442 \u043A\u0430\u043A \u0432\u044B\u0440\u0430\u0441\u0442\u0438, \u0442\u0430\u043A \u0438 \u043F\u043E\u043B\u043D\u043E\u0441\u0442\u044C\u044E \u043E\u0431\u043D\u0443\u043B\u0438\u0442\u044C\u0441\u044F."
      ]
    },
    {
      heading: "2. \u041E\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0438\u0435 \u0433\u0430\u0440\u0430\u043D\u0442\u0438\u0439",
      body: ["\u041F\u0440\u043E\u0448\u043B\u044B\u0435 \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442\u044B \u043D\u0435 \u0433\u0430\u0440\u0430\u043D\u0442\u0438\u0440\u0443\u044E\u0442 \u0431\u0443\u0434\u0443\u0449\u0443\u044E \u0434\u043E\u0445\u043E\u0434\u043D\u043E\u0441\u0442\u044C. VOLTEX \u043D\u0435 \u0433\u0430\u0440\u0430\u043D\u0442\u0438\u0440\u0443\u0435\u0442 \u043F\u0440\u0438\u0431\u044B\u043B\u044C \u043E\u0442 \u0442\u043E\u0440\u0433\u043E\u0432\u043B\u0438."]
    },
    {
      heading: "3. \u042D\u0442\u043E \u043D\u0435 \u0438\u043D\u0432\u0435\u0441\u0442\u0438\u0446\u0438\u043E\u043D\u043D\u0430\u044F \u043A\u043E\u043D\u0441\u0443\u043B\u044C\u0442\u0430\u0446\u0438\u044F",
      body: [
        "\u0418\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u044F \u043D\u0430 \u043F\u043B\u0430\u0442\u0444\u043E\u0440\u043C\u0435 (\u0446\u0435\u043D\u044B, \u0433\u0440\u0430\u0444\u0438\u043A\u0438, \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430) \u043F\u0440\u0435\u0434\u043E\u0441\u0442\u0430\u0432\u043B\u044F\u0435\u0442\u0441\u044F \u0432 \u0438\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u043E\u043D\u043D\u044B\u0445 \u0446\u0435\u043B\u044F\u0445 \u0438 \u043D\u0435 \u044F\u0432\u043B\u044F\u0435\u0442\u0441\u044F \u0438\u043D\u0432\u0435\u0441\u0442\u0438\u0446\u0438\u043E\u043D\u043D\u043E\u0439, \u043D\u0430\u043B\u043E\u0433\u043E\u0432\u043E\u0439 \u0438\u043B\u0438 \u044E\u0440\u0438\u0434\u0438\u0447\u0435\u0441\u043A\u043E\u0439 \u043A\u043E\u043D\u0441\u0443\u043B\u044C\u0442\u0430\u0446\u0438\u0435\u0439."
      ]
    },
    {
      heading: "4. \u0420\u0438\u0441\u043A \u043E\u0440\u0434\u0435\u0440\u043E\u0432 \u043F\u043E \u0440\u044B\u043D\u043A\u0443",
      body: [
        "\u0420\u044B\u043D\u043E\u0447\u043D\u044B\u0435 \u043E\u0440\u0434\u0435\u0440\u0430 \u0438\u0441\u043F\u043E\u043B\u043D\u044F\u044E\u0442\u0441\u044F \u043F\u043E \u043B\u0443\u0447\u0448\u0435\u0439 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E\u0439 \u0446\u0435\u043D\u0435 \u0438 \u043C\u043E\u0433\u0443\u0442 \u0431\u044B\u0442\u044C \u043F\u043E\u0434\u0432\u0435\u0440\u0436\u0435\u043D\u044B \u043F\u0440\u043E\u0441\u043A\u0430\u043B\u044C\u0437\u044B\u0432\u0430\u043D\u0438\u044E, \u043E\u0441\u043E\u0431\u0435\u043D\u043D\u043E \u043F\u0440\u0438 \u043D\u0438\u0437\u043A\u043E\u0439 \u043B\u0438\u043A\u0432\u0438\u0434\u043D\u043E\u0441\u0442\u0438 \u0438\u043B\u0438 \u0432\u044B\u0441\u043E\u043A\u043E\u0439 \u0432\u043E\u043B\u0430\u0442\u0438\u043B\u044C\u043D\u043E\u0441\u0442\u0438."
      ]
    },
    {
      heading: "5. \u0422\u0435\u0445\u043D\u043E\u043B\u043E\u0433\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u0440\u0438\u0441\u043A",
      body: [
        "\u0421\u0431\u043E\u0438 \u0441\u0435\u0442\u0438, \u0437\u0430\u0434\u0435\u0440\u0436\u043A\u0438 \u0431\u043B\u043E\u043A\u0447\u0435\u0439\u043D\u0430 \u0438\u043B\u0438 \u0442\u0435\u0445\u043D\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u043D\u0435\u043F\u043E\u043B\u0430\u0434\u043A\u0438 \u043C\u043E\u0433\u0443\u0442 \u043F\u043E\u0432\u043B\u0438\u044F\u0442\u044C \u043D\u0430 \u0438\u0441\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u0435 \u043E\u0440\u0434\u0435\u0440\u043E\u0432 \u0438\u043B\u0438 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E\u0441\u0442\u044C \u0441\u0435\u0440\u0432\u0438\u0441\u0430."
      ]
    },
    {
      heading: "6. \u0420\u0435\u0433\u0443\u043B\u044F\u0442\u043E\u0440\u043D\u044B\u0439 \u0440\u0438\u0441\u043A",
      body: [
        "\u041F\u0440\u0430\u0432\u043E\u0432\u043E\u0439 \u0441\u0442\u0430\u0442\u0443\u0441 \u043A\u0440\u0438\u043F\u0442\u043E\u0432\u0430\u043B\u044E\u0442 \u0440\u0430\u0437\u043B\u0438\u0447\u0430\u0435\u0442\u0441\u044F \u0432 \u0437\u0430\u0432\u0438\u0441\u0438\u043C\u043E\u0441\u0442\u0438 \u043E\u0442 \u044E\u0440\u0438\u0441\u0434\u0438\u043A\u0446\u0438\u0438 \u0438 \u043C\u043E\u0436\u0435\u0442 \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u044C\u0441\u044F, \u0447\u0442\u043E \u0441\u043F\u043E\u0441\u043E\u0431\u043D\u043E \u043F\u043E\u0432\u043B\u0438\u044F\u0442\u044C \u043D\u0430 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E\u0441\u0442\u044C \u0441\u0435\u0440\u0432\u0438\u0441\u0430."
      ]
    },
    {
      heading: "7. \u041D\u0435\u043E\u0431\u0440\u0430\u0442\u0438\u043C\u043E\u0441\u0442\u044C \u0442\u0440\u0430\u043D\u0437\u0430\u043A\u0446\u0438\u0439",
      body: [
        "\u041F\u0435\u0440\u0435\u0432\u043E\u0434\u044B \u0432 \u0431\u043B\u043E\u043A\u0447\u0435\u0439\u043D-\u0441\u0435\u0442\u044F\u0445, \u043A\u0430\u043A \u043F\u0440\u0430\u0432\u0438\u043B\u043E, \u043D\u0435\u043E\u0431\u0440\u0430\u0442\u0438\u043C\u044B. \u0412\u043D\u0438\u043C\u0430\u0442\u0435\u043B\u044C\u043D\u043E \u043F\u0440\u043E\u0432\u0435\u0440\u044F\u0439 \u0430\u0434\u0440\u0435\u0441 \u0438 \u0441\u0435\u0442\u044C \u043F\u0435\u0440\u0435\u0434 \u0432\u044B\u0432\u043E\u0434\u043E\u043C \u0441\u0440\u0435\u0434\u0441\u0442\u0432."
      ]
    },
    {
      heading: "8. \u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u0435",
      body: [
        "\u0418\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u044F VOLTEX \u0434\u043B\u044F \u0442\u043E\u0440\u0433\u043E\u0432\u043B\u0438, \u0442\u044B \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0430\u0435\u0448\u044C, \u0447\u0442\u043E \u043E\u0441\u043E\u0437\u043D\u0430\u0451\u0448\u044C \u043F\u0435\u0440\u0435\u0447\u0438\u0441\u043B\u0435\u043D\u043D\u044B\u0435 \u0440\u0438\u0441\u043A\u0438 \u0438 \u0442\u043E\u0440\u0433\u0443\u0435\u0448\u044C \u043D\u0430 \u0441\u043E\u0431\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0439 \u0441\u0442\u0440\u0430\u0445 \u0438 \u0440\u0438\u0441\u043A."
      ]
    }
  ]
};
var EN_TERMS = {
  title: "Terms of Service",
  updated: "Last updated: August 22, 2026",
  intro: "These terms govern your use of the VOLTEX platform. By registering or using the service, you confirm that you have read and agree to the following.",
  sections: [
    {
      heading: "1. About the service",
      body: [
        "VOLTEX is a cryptocurrency trading platform that lets you place limit and market orders, hold assets in an internal wallet, and deposit/withdraw on supported networks."
      ]
    },
    {
      heading: "2. Eligibility",
      body: [
        "The service is available only to persons with legal capacity who are 18 or older. By registering, you confirm that using cryptocurrency services is not prohibited in your jurisdiction."
      ]
    },
    {
      heading: "3. Account and security",
      body: [
        "You are responsible for keeping your password confidential, and your two-factor authentication credentials once enabled. We strongly recommend enabling 2FA under Settings \u2192 Security.",
        "Notify us immediately if you suspect unauthorized access to your account."
      ]
    },
    {
      heading: "4. Orders and execution",
      body: [
        "Orders are matched by the trading engine on a price-time priority basis. Market orders fill at the best available price on the order book at the time of placement and may be subject to slippage when liquidity is thin."
      ]
    },
    {
      heading: "5. Fees",
      body: [
        "Current trading fees are shown in the interface before you confirm a trade. We may change fees with advance notice within the service."
      ]
    },
    {
      heading: "6. Prohibited use",
      body: [
        "You may not use the service for money laundering, financing prohibited activity, market manipulation (spoofing, wash trading), or attempting to circumvent the platform's technical safeguards."
      ]
    },
    {
      heading: "7. Suspension and termination",
      body: [
        "We may suspend or close an account for violating these terms, to comply with law, or on suspicion of fraud, notifying the user where possible."
      ]
    },
    {
      heading: "8. Limitation of liability",
      body: [
        'The service is provided "as is". We do not guarantee uninterrupted operation and are not liable for losses arising from market volatility, network outages, or third-party actions.'
      ]
    },
    {
      heading: "9. Changes to these terms",
      body: ["We may update these terms. Material changes will be announced in the service at least 7 days before taking effect."]
    }
  ]
};
var EN_PRIVACY = {
  title: "Privacy Policy",
  updated: "Last updated: August 22, 2026",
  intro: "This document explains what data we collect, why, and how we protect it.",
  sections: [
    {
      heading: "1. Data we collect",
      body: [
        "Registration data (email, hashed password), verification (KYC) data \u2014 name, country, identity document \u2014 trading and transaction history, and technical data (IP address, device type) for security purposes."
      ]
    },
    {
      heading: "2. How we use it",
      body: [
        "To provide the service, execute orders, process deposits/withdrawals, prevent fraud, and comply with anti-money-laundering (AML/KYC) requirements."
      ]
    },
    {
      heading: "3. Verification (KYC) data",
      body: [
        "Documents uploaded for identity verification are stored encrypted and accessible only to authorized staff for review and regulatory compliance purposes."
      ]
    },
    {
      heading: "4. Sharing with third parties",
      body: [
        "We do not sell personal data. Data may be shared with infrastructure providers (hosting, payment processing) only to the extent needed to operate the service, and with authorities upon lawful request."
      ]
    },
    {
      heading: "5. Data security",
      body: [
        "Passwords are stored as irreversible cryptographic hashes. API key secrets are encrypted at rest. We support two-factor authentication for additional account protection."
      ]
    },
    {
      heading: "6. Your rights",
      body: [
        "You may request a copy of your data or its deletion, except for information we are legally required to retain (e.g. KYC/AML records for the mandated period)."
      ]
    },
    {
      heading: "7. Data retention",
      body: [
        "Account data is retained while the account is active. After closure, data required by law (transactions, KYC) is kept for the regulated period; the rest is deleted."
      ]
    },
    {
      heading: "8. Contact",
      body: ["Questions about data and privacy can be sent through the support section in your account."]
    }
  ]
};
var EN_ABOUT = {
  title: "About us",
  updated: "Last updated: August 22, 2026",
  intro: "VOLTEX is a cryptocurrency trading platform: spot and margin futures trading, limit, market, stop, and take-profit orders, deposits and withdrawals on supported networks.",
  sections: [
    {
      heading: "Matching engine",
      body: [
        "Orders are matched by our own price-time matching engine. Market data \u2014 prices, candles and order book \u2014 comes from live exchange venues in real time."
      ]
    },
    {
      heading: "Account security",
      body: [
        "Passwords are stored as irreversible cryptographic hashes, and API key secrets are encrypted at rest. Two-factor authentication and a login history are available under Settings \u2192 Security."
      ]
    },
    {
      heading: "Futures and risk management",
      body: [
        "Margin trading with isolated and cross margin, tiered leverage, automatic liquidation against a real mark price, and an insurance fund for shortfalls at liquidation."
      ]
    },
    {
      heading: "Transparency",
      body: [
        "We don't publish unverifiable claims about returns or trading volume. Fees, limits, and terms are shown in the interface where they apply \u2014 before you confirm an action, not in fine print."
      ]
    }
  ]
};
var EN_SUPPORT = {
  title: "Support",
  updated: "Last updated: August 22, 2026",
  intro: "Answers to common questions. For anything account-specific, check Settings first.",
  sections: [
    {
      heading: "How to deposit",
      body: [
        'Open "Deposit" \u2192 pick a network \u2192 send funds to the address shown \u2192 paste the transaction hash to verify it. The current USD-equivalent minimum is shown in the deposit form; anything below that will not be credited.'
      ]
    },
    {
      heading: "My order isn\u2019t executing",
      body: [
        'Check that a stop/take-profit trigger price sits on the correct side of the current market price \u2014 the order form shows the required direction inline. Pending conditional orders wait for their trigger and show a "Pending" status.'
      ]
    },
    {
      heading: "Account security",
      body: [
        "Turn on two-factor authentication and periodically review the login history under Settings \u2192 Security \u2014 every sign-in to your account shows up there."
      ]
    },
    {
      heading: "Verification (KYC)",
      body: ["Your verification status and the documents required are shown in the account\u2019s verification section."]
    },
    {
      heading: "Still have questions",
      body: ["This version of the platform doesn't have a live support channel yet \u2014 the support section is limited to this FAQ page."]
    }
  ]
};
var EN_RISK = {
  title: "Risk Disclosure",
  updated: "Last updated: August 22, 2026",
  intro: "Trading cryptocurrency carries significant risk. Before you trade, make sure you understand and accept the risks below.",
  sections: [
    {
      heading: "1. Volatility",
      body: ["Cryptocurrency prices can move sharply over short periods. Asset value can rise significantly or fall to zero."]
    },
    {
      heading: "2. No guarantees",
      body: ["Past performance does not guarantee future results. VOLTEX does not guarantee trading profit."]
    },
    {
      heading: "3. Not investment advice",
      body: [
        "Information on the platform (prices, charts, statistics) is provided for informational purposes only and is not investment, tax, or legal advice."
      ]
    },
    {
      heading: "4. Market order risk",
      body: ["Market orders fill at the best available price and may be subject to slippage, especially under thin liquidity or high volatility."]
    },
    {
      heading: "5. Technology risk",
      body: ["Network outages, blockchain delays, or technical faults can affect order execution or service availability."]
    },
    {
      heading: "6. Regulatory risk",
      body: ["The legal status of cryptocurrency varies by jurisdiction and can change, which may affect service availability."]
    },
    {
      heading: "7. Irreversibility of transactions",
      body: ["On-chain transfers are generally irreversible. Double-check the address and network before withdrawing funds."]
    },
    {
      heading: "8. Acknowledgement",
      body: ["By using VOLTEX to trade, you confirm you understand the risks listed above and trade at your own risk."]
    }
  ]
};
var ZH_TERMS = {
  title: "\u670D\u52A1\u6761\u6B3E",
  updated: "\u6700\u540E\u66F4\u65B0:2026\u5E748\u670822\u65E5",
  intro: "\u672C\u6761\u6B3E\u89C4\u8303\u4F60\u5BF9 VOLTEX \u5E73\u53F0\u7684\u4F7F\u7528\u3002\u6CE8\u518C\u6216\u4F7F\u7528\u672C\u670D\u52A1\u5373\u8868\u793A\u4F60\u5DF2\u9605\u8BFB\u5E76\u540C\u610F\u4EE5\u4E0B\u5185\u5BB9\u3002",
  sections: [
    {
      heading: "1. \u5173\u4E8E\u670D\u52A1",
      body: ["VOLTEX \u662F\u4E00\u4E2A\u52A0\u5BC6\u8D27\u5E01\u4EA4\u6613\u5E73\u53F0,\u652F\u6301\u9650\u4EF7\u5355\u548C\u5E02\u4EF7\u5355\u3001\u5185\u90E8\u94B1\u5305\u8D44\u4EA7\u5B58\u50A8,\u4EE5\u53CA\u5728\u652F\u6301\u7684\u7F51\u7EDC\u4E0A\u8FDB\u884C\u5145\u503C/\u63D0\u73B0\u3002"]
    },
    {
      heading: "2. \u4F7F\u7528\u8D44\u683C",
      body: ["\u4EC5\u9650\u5177\u6709\u5B8C\u5168\u6C11\u4E8B\u884C\u4E3A\u80FD\u529B\u4E14\u5E74\u6EE118\u5468\u5C81\u7684\u4EBA\u58EB\u4F7F\u7528\u672C\u670D\u52A1\u3002\u6CE8\u518C\u5373\u8868\u793A\u4F60\u786E\u8BA4\u5728\u6240\u5728\u53F8\u6CD5\u8F96\u533A\u4F7F\u7528\u52A0\u5BC6\u8D27\u5E01\u670D\u52A1\u4E0D\u53D7\u7981\u6B62\u3002"]
    },
    {
      heading: "3. \u8D26\u6237\u4E0E\u5B89\u5168",
      body: [
        '\u4F60\u6709\u8D23\u4EFB\u4FDD\u7BA1\u597D\u5BC6\u7801,\u4EE5\u53CA\u542F\u7528\u540E\u7684\u53CC\u91CD\u9A8C\u8BC1\u51ED\u636E\u3002\u6211\u4EEC\u5F3A\u70C8\u5EFA\u8BAE\u5728"\u8BBE\u7F6E \u2192 \u5B89\u5168"\u4E2D\u542F\u7528\u53CC\u91CD\u9A8C\u8BC1\u3002',
        "\u5982\u6000\u7591\u8D26\u6237\u88AB\u672A\u7ECF\u6388\u6743\u8BBF\u95EE,\u8BF7\u7ACB\u5373\u901A\u77E5\u6211\u4EEC\u3002"
      ]
    },
    {
      heading: "4. \u8BA2\u5355\u4E0E\u6267\u884C",
      body: ["\u8BA2\u5355\u7531\u4EA4\u6613\u5F15\u64CE\u6309\u4EF7\u683C-\u65F6\u95F4\u4F18\u5148\u539F\u5219\u64AE\u5408\u3002\u5E02\u4EF7\u5355\u6309\u4E0B\u5355\u65F6\u8BA2\u5355\u7C3F\u4E0A\u7684\u6700\u4F18\u53EF\u7528\u4EF7\u683C\u6210\u4EA4,\u6D41\u52A8\u6027\u4E0D\u8DB3\u65F6\u53EF\u80FD\u51FA\u73B0\u6ED1\u70B9\u3002"]
    },
    {
      heading: "5. \u8D39\u7528",
      body: ["\u5F53\u524D\u4EA4\u6613\u8D39\u7528\u4F1A\u5728\u4F60\u786E\u8BA4\u4EA4\u6613\u524D\u663E\u793A\u5728\u754C\u9762\u4E2D\u3002\u6211\u4EEC\u53EF\u80FD\u8C03\u6574\u8D39\u7528,\u5E76\u4F1A\u63D0\u524D\u5728\u670D\u52A1\u5185\u901A\u77E5\u3002"]
    },
    {
      heading: "6. \u7981\u6B62\u884C\u4E3A",
      body: ["\u7981\u6B62\u5C06\u672C\u670D\u52A1\u7528\u4E8E\u6D17\u94B1\u3001\u8D44\u52A9\u8FDD\u6CD5\u6D3B\u52A8\u3001\u64CD\u7EB5\u5E02\u573A(\u5E4C\u9A97\u3001\u5BF9\u6572\u4EA4\u6613)\u6216\u8BD5\u56FE\u89C4\u907F\u5E73\u53F0\u7684\u6280\u672F\u4FDD\u62A4\u63AA\u65BD\u3002"]
    },
    {
      heading: "7. \u6682\u505C\u4E0E\u7EC8\u6B62",
      body: ["\u5982\u8FDD\u53CD\u672C\u6761\u6B3E\u3001\u4F9D\u6CD5\u5F8B\u8981\u6C42\u6216\u6D89\u5ACC\u6B3A\u8BC8,\u6211\u4EEC\u53EF\u6682\u505C\u6216\u5173\u95ED\u8D26\u6237,\u5E76\u5728\u53EF\u80FD\u7684\u60C5\u51B5\u4E0B\u901A\u77E5\u7528\u6237\u3002"]
    },
    {
      heading: "8. \u8D23\u4EFB\u9650\u5236",
      body: ['\u672C\u670D\u52A1\u6309"\u73B0\u72B6"\u63D0\u4F9B\u3002\u6211\u4EEC\u4E0D\u4FDD\u8BC1\u670D\u52A1\u4E0D\u4E2D\u65AD,\u4E5F\u4E0D\u5BF9\u56E0\u5E02\u573A\u6CE2\u52A8\u3001\u7F51\u7EDC\u6545\u969C\u6216\u7B2C\u4E09\u65B9\u884C\u4E3A\u9020\u6210\u7684\u635F\u5931\u627F\u62C5\u8D23\u4EFB\u3002']
    },
    {
      heading: "9. \u6761\u6B3E\u53D8\u66F4",
      body: ["\u6211\u4EEC\u53EF\u80FD\u66F4\u65B0\u672C\u6761\u6B3E\u3002\u91CD\u5927\u53D8\u66F4\u5C06\u5728\u751F\u6548\u524D\u81F3\u5C117\u5929\u5728\u670D\u52A1\u5185\u516C\u5E03\u3002"]
    }
  ]
};
var ZH_PRIVACY = {
  title: "\u9690\u79C1\u653F\u7B56",
  updated: "\u6700\u540E\u66F4\u65B0:2026\u5E748\u670822\u65E5",
  intro: "\u672C\u6587\u4EF6\u8BF4\u660E\u6211\u4EEC\u6536\u96C6\u54EA\u4E9B\u6570\u636E\u3001\u539F\u56E0,\u4EE5\u53CA\u5982\u4F55\u4FDD\u62A4\u8FD9\u4E9B\u6570\u636E\u3002",
  sections: [
    {
      heading: "1. \u6211\u4EEC\u6536\u96C6\u7684\u6570\u636E",
      body: ["\u6CE8\u518C\u4FE1\u606F(\u90AE\u7BB1\u3001\u52A0\u5BC6\u540E\u7684\u5BC6\u7801)\u3001\u8EAB\u4EFD\u9A8C\u8BC1(KYC)\u4FE1\u606F(\u59D3\u540D\u3001\u56FD\u5BB6\u3001\u8EAB\u4EFD\u8BC1\u4EF6)\u3001\u4EA4\u6613\u548C\u8F6C\u8D26\u8BB0\u5F55,\u4EE5\u53CA\u7528\u4E8E\u5B89\u5168\u76EE\u7684\u7684\u6280\u672F\u4FE1\u606F(IP\u5730\u5740\u3001\u8BBE\u5907\u7C7B\u578B)\u3002"]
    },
    {
      heading: "2. \u6570\u636E\u7528\u9014",
      body: ["\u7528\u4E8E\u63D0\u4F9B\u670D\u52A1\u3001\u6267\u884C\u8BA2\u5355\u3001\u5904\u7406\u5145\u503C/\u63D0\u73B0\u3001\u9884\u9632\u6B3A\u8BC8,\u4EE5\u53CA\u9075\u5B88\u53CD\u6D17\u94B1(AML/KYC)\u76F8\u5173\u6CD5\u89C4\u8981\u6C42\u3002"]
    },
    {
      heading: "3. \u8EAB\u4EFD\u9A8C\u8BC1(KYC)\u6570\u636E",
      body: ["\u4E3A\u8EAB\u4EFD\u9A8C\u8BC1\u4E0A\u4F20\u7684\u8BC1\u4EF6\u4EE5\u52A0\u5BC6\u65B9\u5F0F\u5B58\u50A8,\u4EC5\u6388\u6743\u4EBA\u5458\u53EF\u8BBF\u95EE,\u7528\u4E8E\u5BA1\u6838\u53CA\u5408\u89C4\u76EE\u7684\u3002"]
    },
    {
      heading: "4. \u4E0E\u7B2C\u4E09\u65B9\u5171\u4EAB",
      body: ["\u6211\u4EEC\u4E0D\u4F1A\u51FA\u552E\u4E2A\u4EBA\u6570\u636E\u3002\u6570\u636E\u53EF\u80FD\u4EC5\u5728\u8FD0\u8425\u670D\u52A1\u6240\u9700\u8303\u56F4\u5185\u4E0E\u57FA\u7840\u8BBE\u65BD\u63D0\u4F9B\u5546(\u6258\u7BA1\u3001\u652F\u4ED8\u5904\u7406)\u5171\u4EAB,\u6216\u4F9D\u6CD5\u5E94\u653F\u5E9C\u90E8\u95E8\u8981\u6C42\u63D0\u4F9B\u3002"]
    },
    {
      heading: "5. \u6570\u636E\u5B89\u5168",
      body: ["\u5BC6\u7801\u4EE5\u4E0D\u53EF\u9006\u7684\u52A0\u5BC6\u54C8\u5E0C\u5F62\u5F0F\u5B58\u50A8\u3002API \u5BC6\u94A5\u5728\u5B58\u50A8\u65F6\u4F1A\u88AB\u52A0\u5BC6\u3002\u6211\u4EEC\u652F\u6301\u53CC\u91CD\u9A8C\u8BC1\u4EE5\u589E\u5F3A\u8D26\u6237\u4FDD\u62A4\u3002"]
    },
    {
      heading: "6. \u4F60\u7684\u6743\u5229",
      body: ["\u4F60\u53EF\u4EE5\u7533\u8BF7\u83B7\u53D6\u4F60\u7684\u6570\u636E\u526F\u672C\u6216\u8981\u6C42\u5220\u9664\u6570\u636E,\u4F46\u6211\u4EEC\u4F9D\u6CD5\u5FC5\u987B\u4FDD\u7559\u7684\u4FE1\u606F(\u5982\u6CD5\u5B9A\u671F\u9650\u5185\u7684KYC/AML\u8BB0\u5F55)\u9664\u5916\u3002"]
    },
    {
      heading: "7. \u6570\u636E\u4FDD\u7559",
      body: ["\u8D26\u6237\u5904\u4E8E\u6D3B\u8DC3\u72B6\u6001\u671F\u95F4,\u6211\u4EEC\u4F1A\u4FDD\u7559\u8D26\u6237\u6570\u636E\u3002\u8D26\u6237\u5173\u95ED\u540E,\u6CD5\u5F8B\u8981\u6C42\u4FDD\u7559\u7684\u6570\u636E(\u4EA4\u6613\u8BB0\u5F55\u3001KYC)\u5C06\u6309\u76D1\u7BA1\u89C4\u5B9A\u671F\u9650\u4FDD\u7559,\u5176\u4F59\u6570\u636E\u5C06\u88AB\u5220\u9664\u3002"]
    },
    {
      heading: "8. \u8054\u7CFB\u6211\u4EEC",
      body: ["\u6709\u5173\u6570\u636E\u548C\u9690\u79C1\u7684\u95EE\u9898,\u53EF\u901A\u8FC7\u8D26\u6237\u5185\u7684\u652F\u6301\u677F\u5757\u4E0E\u6211\u4EEC\u8054\u7CFB\u3002"]
    }
  ]
};
var ZH_ABOUT = {
  title: "\u5173\u4E8E\u6211\u4EEC",
  updated: "\u6700\u540E\u66F4\u65B0:2026\u5E748\u670822\u65E5",
  intro: "VOLTEX \u662F\u4E00\u4E2A\u52A0\u5BC6\u8D27\u5E01\u4EA4\u6613\u5E73\u53F0:\u73B0\u8D27\u4E0E\u4FDD\u8BC1\u91D1\u5408\u7EA6\u4EA4\u6613\u3001\u9650\u4EF7/\u5E02\u4EF7/\u6B62\u635F/\u6B62\u76C8\u8BA2\u5355,\u4EE5\u53CA\u5728\u652F\u6301\u7684\u7F51\u7EDC\u4E0A\u5145\u503C\u548C\u63D0\u73B0\u3002",
  sections: [
    {
      heading: "\u64AE\u5408\u5F15\u64CE",
      body: ["\u8BA2\u5355\u7531\u6211\u4EEC\u81EA\u6709\u7684\u4EF7\u683C-\u65F6\u95F4\u4F18\u5148\u64AE\u5408\u5F15\u64CE\u5904\u7406\u3002\u884C\u60C5\u6570\u636E(\u4EF7\u683C\u3001K\u7EBF\u3001\u8BA2\u5355\u7C3F)\u5B9E\u65F6\u6765\u81EA\u771F\u5B9E\u4EA4\u6613\u6240\u3002"]
    },
    {
      heading: "\u8D26\u6237\u5B89\u5168",
      body: ['\u5BC6\u7801\u4EE5\u4E0D\u53EF\u9006\u7684\u52A0\u5BC6\u54C8\u5E0C\u5B58\u50A8,API \u5BC6\u94A5\u5BC6\u6587\u52A0\u5BC6\u4FDD\u5B58\u3002\u53CC\u91CD\u9A8C\u8BC1\u4E0E\u767B\u5F55\u5386\u53F2\u53EF\u5728"\u8BBE\u7F6E \u2192 \u5B89\u5168"\u4E2D\u67E5\u770B\u3002']
    },
    {
      heading: "\u5408\u7EA6\u4E0E\u98CE\u9669\u7BA1\u7406",
      body: ["\u652F\u6301\u9010\u4ED3\u4E0E\u5168\u4ED3\u4FDD\u8BC1\u91D1\u3001\u5206\u5C42\u6760\u6746\u3001\u57FA\u4E8E\u771F\u5B9E\u6807\u8BB0\u4EF7\u683C\u7684\u81EA\u52A8\u5F3A\u5E73,\u4EE5\u53CA\u7528\u4E8E\u8986\u76D6\u5F3A\u5E73\u7F3A\u53E3\u7684\u98CE\u9669\u51C6\u5907\u91D1\u3002"]
    },
    {
      heading: "\u900F\u660E\u5EA6",
      body: ["\u6211\u4EEC\u4E0D\u4F1A\u53D1\u5E03\u65E0\u6CD5\u9A8C\u8BC1\u7684\u6536\u76CA\u6216\u4EA4\u6613\u91CF\u627F\u8BFA\u3002\u624B\u7EED\u8D39\u3001\u9650\u989D\u548C\u6761\u6B3E\u4F1A\u5728\u5B9E\u9645\u9002\u7528\u7684\u754C\u9762\u4F4D\u7F6E\u5C55\u793A\u2014\u2014\u5728\u4F60\u786E\u8BA4\u64CD\u4F5C\u4E4B\u524D,\u800C\u4E0D\u662F\u85CF\u5728\u7EC6\u5219\u91CC\u3002"]
    }
  ]
};
var ZH_SUPPORT = {
  title: "\u5E2E\u52A9\u4E0E\u652F\u6301",
  updated: "\u6700\u540E\u66F4\u65B0:2026\u5E748\u670822\u65E5",
  intro: '\u5E38\u89C1\u95EE\u9898\u89E3\u7B54\u3002\u4E0E\u8D26\u6237\u76F8\u5173\u7684\u95EE\u9898\u8BF7\u5148\u67E5\u770B"\u8BBE\u7F6E"\u3002',
  sections: [
    {
      heading: "\u5982\u4F55\u5145\u503C",
      body: ['\u6253\u5F00"\u5145\u503C" \u2192 \u9009\u62E9\u7F51\u7EDC \u2192 \u5C06\u8D44\u91D1\u53D1\u9001\u5230\u663E\u793A\u7684\u5730\u5740 \u2192 \u7C98\u8D34\u4EA4\u6613\u54C8\u5E0C\u8FDB\u884C\u9A8C\u8BC1\u3002\u5F53\u524D\u4EE5\u7F8E\u5143\u7B49\u503C\u8BA1\u7B97\u7684\u6700\u4F4E\u5145\u503C\u91D1\u989D\u663E\u793A\u5728\u5145\u503C\u8868\u5355\u4E2D\uFF0C\u4F4E\u4E8E\u8BE5\u91D1\u989D\u7684\u5145\u503C\u4E0D\u4F1A\u5165\u8D26\u3002']
    },
    {
      heading: "\u8BA2\u5355\u672A\u6210\u4EA4",
      body: ['\u8BF7\u68C0\u67E5\u6B62\u635F/\u6B62\u76C8\u89E6\u53D1\u4EF7\u683C\u662F\u5426\u4F4D\u4E8E\u5F53\u524D\u5E02\u573A\u4EF7\u683C\u7684\u6B63\u786E\u4E00\u4FA7\u2014\u2014\u4E0B\u5355\u8868\u5355\u4F1A\u76F4\u63A5\u63D0\u793A\u6240\u9700\u65B9\u5411\u3002\u5F85\u89E6\u53D1\u7684\u6761\u4EF6\u8BA2\u5355\u4F1A\u663E\u793A"\u7B49\u5F85"\u72B6\u6001\u3002']
    },
    {
      heading: "\u8D26\u6237\u5B89\u5168",
      body: ['\u5728"\u8BBE\u7F6E \u2192 \u5B89\u5168"\u4E2D\u5F00\u542F\u53CC\u91CD\u9A8C\u8BC1,\u5E76\u5B9A\u671F\u67E5\u770B\u767B\u5F55\u5386\u53F2\u2014\u2014\u6BCF\u4E00\u6B21\u767B\u5F55\u90FD\u4F1A\u8BB0\u5F55\u5728\u90A3\u91CC\u3002']
    },
    {
      heading: "\u8EAB\u4EFD\u9A8C\u8BC1(KYC)",
      body: ["\u4F60\u7684\u9A8C\u8BC1\u72B6\u6001\u548C\u6240\u9700\u6587\u4EF6\u4F1A\u5728\u8D26\u6237\u7684\u9A8C\u8BC1\u677F\u5757\u4E2D\u663E\u793A\u3002"]
    },
    {
      heading: "\u4ECD\u6709\u7591\u95EE",
      body: ["\u5F53\u524D\u7248\u672C\u7684\u5E73\u53F0\u6682\u672A\u63D0\u4F9B\u5B9E\u65F6\u4EBA\u5DE5\u652F\u6301\u6E20\u9053\u2014\u2014\u652F\u6301\u677F\u5757\u76EE\u524D\u4EC5\u9650\u4E8E\u672C\u5E38\u89C1\u95EE\u9898\u9875\u9762\u3002"]
    }
  ]
};
var ZH_RISK = {
  title: "\u98CE\u9669\u62AB\u9732",
  updated: "\u6700\u540E\u66F4\u65B0:2026\u5E748\u670822\u65E5",
  intro: "\u52A0\u5BC6\u8D27\u5E01\u4EA4\u6613\u5B58\u5728\u91CD\u5927\u98CE\u9669\u3002\u5728\u5F00\u59CB\u4EA4\u6613\u524D,\u8BF7\u786E\u4FDD\u4F60\u7406\u89E3\u5E76\u63A5\u53D7\u4EE5\u4E0B\u98CE\u9669\u3002",
  sections: [
    { heading: "1. \u6CE2\u52A8\u6027", body: ["\u52A0\u5BC6\u8D27\u5E01\u4EF7\u683C\u53EF\u80FD\u5728\u77ED\u65F6\u95F4\u5185\u5267\u70C8\u6CE2\u52A8,\u8D44\u4EA7\u4EF7\u503C\u65E2\u53EF\u80FD\u5927\u5E45\u4E0A\u6DA8,\u4E5F\u53EF\u80FD\u5F52\u96F6\u3002"] },
    { heading: "2. \u65E0\u4FDD\u8BC1", body: ["\u8FC7\u5F80\u8868\u73B0\u4E0D\u4EE3\u8868\u672A\u6765\u6536\u76CA\u3002VOLTEX \u4E0D\u4FDD\u8BC1\u4EA4\u6613\u76C8\u5229\u3002"] },
    {
      heading: "3. \u975E\u6295\u8D44\u5EFA\u8BAE",
      body: ["\u5E73\u53F0\u4E0A\u7684\u4FE1\u606F(\u4EF7\u683C\u3001\u56FE\u8868\u3001\u7EDF\u8BA1\u6570\u636E)\u4EC5\u4F9B\u53C2\u8003,\u4E0D\u6784\u6210\u6295\u8D44\u3001\u7A0E\u52A1\u6216\u6CD5\u5F8B\u5EFA\u8BAE\u3002"]
    },
    { heading: "4. \u5E02\u4EF7\u5355\u98CE\u9669", body: ["\u5E02\u4EF7\u5355\u6309\u6700\u4F18\u53EF\u7528\u4EF7\u683C\u6210\u4EA4,\u5728\u6D41\u52A8\u6027\u4E0D\u8DB3\u6216\u6CE2\u52A8\u5267\u70C8\u65F6\u53EF\u80FD\u51FA\u73B0\u6ED1\u70B9\u3002"] },
    { heading: "5. \u6280\u672F\u98CE\u9669", body: ["\u7F51\u7EDC\u6545\u969C\u3001\u533A\u5757\u94FE\u5EF6\u8FDF\u6216\u6280\u672F\u95EE\u9898\u53EF\u80FD\u5F71\u54CD\u8BA2\u5355\u6267\u884C\u6216\u670D\u52A1\u53EF\u7528\u6027\u3002"] },
    { heading: "6. \u76D1\u7BA1\u98CE\u9669", body: ["\u52A0\u5BC6\u8D27\u5E01\u7684\u6CD5\u5F8B\u5730\u4F4D\u56E0\u53F8\u6CD5\u8F96\u533A\u800C\u5F02,\u4E14\u53EF\u80FD\u53D1\u751F\u53D8\u5316,\u8FDB\u800C\u5F71\u54CD\u670D\u52A1\u7684\u53EF\u7528\u6027\u3002"] },
    { heading: "7. \u4EA4\u6613\u4E0D\u53EF\u9006", body: ["\u94FE\u4E0A\u8F6C\u8D26\u901A\u5E38\u4E0D\u53EF\u9006\u3002\u63D0\u73B0\u524D\u8BF7\u4ED4\u7EC6\u6838\u5BF9\u5730\u5740\u548C\u7F51\u7EDC\u3002"] },
    { heading: "8. \u786E\u8BA4", body: ["\u4F7F\u7528 VOLTEX \u8FDB\u884C\u4EA4\u6613\u5373\u8868\u793A\u4F60\u5DF2\u4E86\u89E3\u4E0A\u8FF0\u98CE\u9669,\u5E76\u81EA\u884C\u627F\u62C5\u4EA4\u6613\u98CE\u9669\u3002"] }
  ]
};
var ES_TERMS = {
  title: "T\xE9rminos de servicio",
  updated: "\xDAltima actualizaci\xF3n: 22 de agosto de 2026",
  intro: "Estos t\xE9rminos rigen tu uso de la plataforma VOLTEX. Al registrarte o usar el servicio, confirmas que has le\xEDdo y aceptas lo siguiente.",
  sections: [
    {
      heading: "1. Sobre el servicio",
      body: [
        "VOLTEX es una plataforma de trading de criptomonedas que te permite colocar \xF3rdenes l\xEDmite y de mercado, mantener activos en una billetera interna, y depositar/retirar en las redes admitidas."
      ]
    },
    {
      heading: "2. Elegibilidad",
      body: [
        "El servicio est\xE1 disponible solo para personas con capacidad legal de 18 a\xF1os o m\xE1s. Al registrarte, confirmas que el uso de servicios de criptomonedas no est\xE1 prohibido en tu jurisdicci\xF3n."
      ]
    },
    {
      heading: "3. Cuenta y seguridad",
      body: [
        "Eres responsable de mantener tu contrase\xF1a confidencial, y tus credenciales de autenticaci\xF3n de dos factores una vez activada. Recomendamos encarecidamente activar 2FA en Configuraci\xF3n \u2192 Seguridad.",
        "Notif\xEDcanos de inmediato si sospechas de un acceso no autorizado a tu cuenta."
      ]
    },
    {
      heading: "4. \xD3rdenes y ejecuci\xF3n",
      body: [
        "Las \xF3rdenes se emparejan mediante el motor de trading seg\xFAn prioridad de precio-tiempo. Las \xF3rdenes de mercado se ejecutan al mejor precio disponible en el libro de \xF3rdenes en el momento de colocarse, y pueden sufrir deslizamiento (slippage) cuando la liquidez es baja."
      ]
    },
    {
      heading: "5. Comisiones",
      body: [
        "Las comisiones de trading actuales se muestran en la interfaz antes de confirmar una operaci\xF3n. Podemos modificar las comisiones con aviso previo dentro del servicio."
      ]
    },
    {
      heading: "6. Uso prohibido",
      body: [
        "No puedes usar el servicio para lavado de dinero, financiamiento de actividades prohibidas, manipulaci\xF3n del mercado (spoofing, wash trading), ni intentar eludir las salvaguardas t\xE9cnicas de la plataforma."
      ]
    },
    {
      heading: "7. Suspensi\xF3n y cierre",
      body: [
        "Podemos suspender o cerrar una cuenta por incumplir estos t\xE9rminos, para cumplir con la ley, o ante sospecha de fraude, notificando al usuario cuando sea posible."
      ]
    },
    {
      heading: "8. Limitaci\xF3n de responsabilidad",
      body: [
        'El servicio se ofrece "tal cual". No garantizamos un funcionamiento ininterrumpido y no somos responsables de p\xE9rdidas derivadas de la volatilidad del mercado, interrupciones de red, o acciones de terceros.'
      ]
    },
    {
      heading: "9. Cambios en estos t\xE9rminos",
      body: ["Podemos actualizar estos t\xE9rminos. Los cambios importantes se anunciar\xE1n en el servicio al menos 7 d\xEDas antes de entrar en vigor."]
    }
  ]
};
var ES_PRIVACY = {
  title: "Pol\xEDtica de privacidad",
  updated: "\xDAltima actualizaci\xF3n: 22 de agosto de 2026",
  intro: "Este documento explica qu\xE9 datos recopilamos, por qu\xE9, y c\xF3mo los protegemos.",
  sections: [
    {
      heading: "1. Datos que recopilamos",
      body: [
        "Datos de registro (correo, contrase\xF1a con hash), datos de verificaci\xF3n (KYC) \u2014 nombre, pa\xEDs, documento de identidad \u2014 historial de trading y transacciones, y datos t\xE9cnicos (direcci\xF3n IP, tipo de dispositivo) por motivos de seguridad."
      ]
    },
    {
      heading: "2. C\xF3mo los usamos",
      body: [
        "Para prestar el servicio, ejecutar \xF3rdenes, procesar dep\xF3sitos/retiros, prevenir fraude, y cumplir con los requisitos de prevenci\xF3n de lavado de dinero (AML/KYC)."
      ]
    },
    {
      heading: "3. Datos de verificaci\xF3n (KYC)",
      body: [
        "Los documentos subidos para verificaci\xF3n de identidad se almacenan encriptados y son accesibles solo para el personal autorizado, para fines de revisi\xF3n y cumplimiento regulatorio."
      ]
    },
    {
      heading: "4. Compartir con terceros",
      body: [
        "No vendemos datos personales. Los datos pueden compartirse con proveedores de infraestructura (hosting, procesamiento de pagos) solo en la medida necesaria para operar el servicio, y con autoridades ante una solicitud legal."
      ]
    },
    {
      heading: "5. Seguridad de los datos",
      body: [
        "Las contrase\xF1as se almacenan como hashes criptogr\xE1ficos irreversibles. Los secretos de las claves API se encriptan en reposo. Ofrecemos autenticaci\xF3n de dos factores para protecci\xF3n adicional de la cuenta."
      ]
    },
    {
      heading: "6. Tus derechos",
      body: [
        "Puedes solicitar una copia de tus datos o su eliminaci\xF3n, excepto la informaci\xF3n que estamos legalmente obligados a conservar (por ejemplo, registros KYC/AML durante el per\xEDodo exigido)."
      ]
    },
    {
      heading: "7. Retenci\xF3n de datos",
      body: [
        "Los datos de la cuenta se conservan mientras est\xE9 activa. Tras el cierre, los datos exigidos por ley (transacciones, KYC) se guardan durante el per\xEDodo regulado; el resto se elimina."
      ]
    },
    {
      heading: "8. Contacto",
      body: ["Las preguntas sobre datos y privacidad pueden enviarse a trav\xE9s de la secci\xF3n de soporte de tu cuenta."]
    }
  ]
};
var ES_ABOUT = {
  title: "Sobre nosotros",
  updated: "\xDAltima actualizaci\xF3n: 22 de agosto de 2026",
  intro: "VOLTEX es una plataforma de trading de criptomonedas: trading spot y de futuros con margen, \xF3rdenes l\xEDmite, de mercado, stop y take-profit, dep\xF3sitos y retiros en las redes admitidas.",
  sections: [
    {
      heading: "Motor de emparejamiento",
      body: [
        "Las \xF3rdenes se emparejan mediante nuestro propio motor de emparejamiento por precio-tiempo. Los datos de mercado (precios, velas, libro de \xF3rdenes) provienen de mercados reales en tiempo real."
      ]
    },
    {
      heading: "Seguridad de la cuenta",
      body: [
        "Las contrase\xF1as se almacenan como hashes criptogr\xE1ficos irreversibles, y los secretos de las claves API se encriptan en reposo. La autenticaci\xF3n de dos factores y un historial de inicios de sesi\xF3n est\xE1n disponibles en Configuraci\xF3n \u2192 Seguridad."
      ]
    },
    {
      heading: "Futuros y gesti\xF3n de riesgo",
      body: [
        "Trading con margen aislado y cruzado, apalancamiento por niveles, liquidaci\xF3n autom\xE1tica contra un precio de referencia real, y un fondo de seguro para d\xE9ficits en la liquidaci\xF3n."
      ]
    },
    {
      heading: "Transparencia",
      body: [
        "No publicamos afirmaciones no verificables sobre rendimientos o volumen de trading. Las comisiones, l\xEDmites y t\xE9rminos se muestran en la interfaz donde aplican \u2014 antes de confirmar una acci\xF3n, no en letra peque\xF1a."
      ]
    }
  ]
};
var ES_SUPPORT = {
  title: "Soporte",
  updated: "\xDAltima actualizaci\xF3n: 22 de agosto de 2026",
  intro: "Respuestas a preguntas comunes. Para algo espec\xEDfico de tu cuenta, revisa primero Configuraci\xF3n.",
  sections: [
    {
      heading: "C\xF3mo depositar",
      body: [
        'Abre "Depositar" \u2192 elige una red \u2192 env\xEDa los fondos a la direcci\xF3n mostrada \u2192 pega el hash de la transacci\xF3n para verificarla. El m\xEDnimo actual equivalente en USD se muestra en el formulario de dep\xF3sito; cualquier cantidad menor no ser\xE1 acreditada.'
      ]
    },
    {
      heading: "Mi orden no se ejecuta",
      body: [
        'Verifica que el precio de activaci\xF3n de una orden stop/take-profit est\xE9 en el lado correcto del precio de mercado actual \u2014 el formulario de orden muestra la direcci\xF3n requerida en l\xEDnea. Las \xF3rdenes condicionales pendientes esperan su activaci\xF3n y muestran el estado "Pendiente".'
      ]
    },
    {
      heading: "Seguridad de la cuenta",
      body: [
        "Activa la autenticaci\xF3n de dos factores y revisa peri\xF3dicamente el historial de inicios de sesi\xF3n en Configuraci\xF3n \u2192 Seguridad \u2014 cada inicio de sesi\xF3n en tu cuenta aparece ah\xED."
      ]
    },
    {
      heading: "Verificaci\xF3n (KYC)",
      body: ["Tu estado de verificaci\xF3n y los documentos requeridos se muestran en la secci\xF3n de verificaci\xF3n de tu cuenta."]
    },
    {
      heading: "A\xFAn tienes preguntas",
      body: ["Esta versi\xF3n de la plataforma a\xFAn no tiene un canal de soporte en vivo \u2014 la secci\xF3n de soporte se limita a esta p\xE1gina de preguntas frecuentes."]
    }
  ]
};
var ES_RISK = {
  title: "Divulgaci\xF3n de riesgos",
  updated: "\xDAltima actualizaci\xF3n: 22 de agosto de 2026",
  intro: "El trading de criptomonedas conlleva un riesgo significativo. Antes de operar, aseg\xFArate de entender y aceptar los siguientes riesgos.",
  sections: [
    {
      heading: "1. Volatilidad",
      body: ["Los precios de las criptomonedas pueden moverse bruscamente en periodos cortos. El valor de un activo puede subir significativamente o caer a cero."]
    },
    {
      heading: "2. Sin garant\xEDas",
      body: ["El rendimiento pasado no garantiza resultados futuros. VOLTEX no garantiza ganancias en el trading."]
    },
    {
      heading: "3. No es asesor\xEDa de inversi\xF3n",
      body: [
        "La informaci\xF3n en la plataforma (precios, gr\xE1ficos, estad\xEDsticas) se proporciona solo con fines informativos y no constituye asesor\xEDa de inversi\xF3n, fiscal o legal."
      ]
    },
    {
      heading: "4. Riesgo de las \xF3rdenes de mercado",
      body: ["Las \xF3rdenes de mercado se ejecutan al mejor precio disponible y pueden sufrir deslizamiento, especialmente con baja liquidez o alta volatilidad."]
    },
    {
      heading: "5. Riesgo tecnol\xF3gico",
      body: ["Las interrupciones de red, retrasos de la blockchain o fallas t\xE9cnicas pueden afectar la ejecuci\xF3n de \xF3rdenes o la disponibilidad del servicio."]
    },
    {
      heading: "6. Riesgo regulatorio",
      body: ["El estatus legal de las criptomonedas var\xEDa seg\xFAn la jurisdicci\xF3n y puede cambiar, lo que puede afectar la disponibilidad del servicio."]
    },
    {
      heading: "7. Irreversibilidad de las transacciones",
      body: ["Las transferencias en cadena generalmente son irreversibles. Verifica cuidadosamente la direcci\xF3n y la red antes de retirar fondos."]
    },
    {
      heading: "8. Reconocimiento",
      body: ["Al usar VOLTEX para operar, confirmas que entiendes los riesgos enumerados anteriormente y operas bajo tu propio riesgo."]
    }
  ]
};
var HI_TERMS = {
  title: "\u0938\u0947\u0935\u093E \u0915\u0940 \u0936\u0930\u094D\u0924\u0947\u0902",
  updated: "\u0906\u0916\u093F\u0930\u0940 \u092C\u093E\u0930 \u0905\u092A\u0921\u0947\u091F \u0915\u093F\u092F\u093E \u0917\u092F\u093E: 22 \u0905\u0917\u0938\u094D\u0924, 2026",
  intro: "\u092F\u0947 \u0936\u0930\u094D\u0924\u0947\u0902 VOLTEX \u092A\u094D\u0932\u0947\u091F\u092B\u093C\u0949\u0930\u094D\u092E \u0915\u0947 \u0906\u092A\u0915\u0947 \u0909\u092A\u092F\u094B\u0917 \u0915\u094B \u0928\u093F\u092F\u0902\u0924\u094D\u0930\u093F\u0924 \u0915\u0930\u0924\u0940 \u0939\u0948\u0902\u0964 \u0930\u091C\u093F\u0938\u094D\u091F\u0930 \u0915\u0930\u0915\u0947 \u092F\u093E \u0938\u0947\u0935\u093E \u0915\u093E \u0909\u092A\u092F\u094B\u0917 \u0915\u0930\u0915\u0947, \u0906\u092A \u092A\u0941\u0937\u094D\u091F\u093F \u0915\u0930\u0924\u0947 \u0939\u0948\u0902 \u0915\u093F \u0906\u092A\u0928\u0947 \u0928\u093F\u092E\u094D\u0928\u0932\u093F\u0916\u093F\u0924 \u0915\u094B \u092A\u0922\u093C\u093E \u0939\u0948 \u0914\u0930 \u0909\u0938\u0938\u0947 \u0938\u0939\u092E\u0924 \u0939\u0948\u0902\u0964",
  sections: [
    {
      heading: "1. \u0938\u0947\u0935\u093E \u0915\u0947 \u092C\u093E\u0930\u0947 \u092E\u0947\u0902",
      body: [
        "VOLTEX \u090F\u0915 \u0915\u094D\u0930\u093F\u092A\u094D\u091F\u094B\u0915\u0930\u0947\u0902\u0938\u0940 \u091F\u094D\u0930\u0947\u0921\u093F\u0902\u0917 \u092A\u094D\u0932\u0947\u091F\u092B\u093C\u0949\u0930\u094D\u092E \u0939\u0948 \u091C\u094B \u0906\u092A\u0915\u094B \u0932\u093F\u092E\u093F\u091F \u0914\u0930 \u092E\u093E\u0930\u094D\u0915\u0947\u091F \u0911\u0930\u094D\u0921\u0930 \u0926\u0947\u0928\u0947, \u0907\u0902\u091F\u0930\u0928\u0932 \u0935\u0949\u0932\u0947\u091F \u092E\u0947\u0902 \u090F\u0938\u0947\u091F\u094D\u0938 \u0930\u0916\u0928\u0947, \u0914\u0930 \u0938\u092E\u0930\u094D\u0925\u093F\u0924 \u0928\u0947\u091F\u0935\u0930\u094D\u0915 \u092A\u0930 \u0921\u093F\u092A\u0949\u091C\u093C\u093F\u091F/\u0928\u093F\u0915\u093E\u0938\u0940 \u0915\u0930\u0928\u0947 \u0926\u0947\u0924\u093E \u0939\u0948\u0964"
      ]
    },
    {
      heading: "2. \u092A\u093E\u0924\u094D\u0930\u0924\u093E",
      body: [
        "\u092F\u0939 \u0938\u0947\u0935\u093E \u0915\u0947\u0935\u0932 18 \u0935\u0930\u094D\u0937 \u092F\u093E \u0909\u0938\u0938\u0947 \u0905\u0927\u093F\u0915 \u0909\u092E\u094D\u0930 \u0915\u0947 \u0915\u093E\u0928\u0942\u0928\u0940 \u0915\u094D\u0937\u092E\u0924\u093E \u0935\u093E\u0932\u0947 \u0935\u094D\u092F\u0915\u094D\u0924\u093F\u092F\u094B\u0902 \u0915\u0947 \u0932\u093F\u090F \u0909\u092A\u0932\u092C\u094D\u0927 \u0939\u0948\u0964 \u0930\u091C\u093F\u0938\u094D\u091F\u0930 \u0915\u0930\u0915\u0947, \u0906\u092A \u092A\u0941\u0937\u094D\u091F\u093F \u0915\u0930\u0924\u0947 \u0939\u0948\u0902 \u0915\u093F \u0906\u092A\u0915\u0947 \u0915\u094D\u0937\u0947\u0924\u094D\u0930\u093E\u0927\u093F\u0915\u093E\u0930 \u092E\u0947\u0902 \u0915\u094D\u0930\u093F\u092A\u094D\u091F\u094B\u0915\u0930\u0947\u0902\u0938\u0940 \u0938\u0947\u0935\u093E\u0913\u0902 \u0915\u093E \u0909\u092A\u092F\u094B\u0917 \u092A\u094D\u0930\u0924\u093F\u092C\u0902\u0927\u093F\u0924 \u0928\u0939\u0940\u0902 \u0939\u0948\u0964"
      ]
    },
    {
      heading: "3. \u0905\u0915\u093E\u0909\u0902\u091F \u0914\u0930 \u0938\u0941\u0930\u0915\u094D\u0937\u093E",
      body: [
        "\u0905\u092A\u0928\u0947 \u092A\u093E\u0938\u0935\u0930\u094D\u0921 \u0915\u094B \u0917\u094B\u092A\u0928\u0940\u092F \u0930\u0916\u0928\u093E, \u0914\u0930 \u0938\u0915\u094D\u0937\u092E \u0939\u094B\u0928\u0947 \u092A\u0930 \u0905\u092A\u0928\u0947 \u0926\u094B-\u091A\u0930\u0923\u0940\u092F \u092A\u094D\u0930\u092E\u093E\u0923\u0940\u0915\u0930\u0923 \u0915\u094D\u0930\u0947\u0921\u0947\u0902\u0936\u093F\u092F\u0932\u094D\u0938 \u0915\u094B \u0938\u0941\u0930\u0915\u094D\u0937\u093F\u0924 \u0930\u0916\u0928\u093E \u0906\u092A\u0915\u0940 \u091C\u093C\u093F\u092E\u094D\u092E\u0947\u0926\u093E\u0930\u0940 \u0939\u0948\u0964 \u0939\u092E \u0926\u0943\u0922\u093C\u0924\u093E \u0938\u0947 \u0938\u0932\u093E\u0939 \u0926\u0947\u0924\u0947 \u0939\u0948\u0902 \u0915\u093F \u0906\u092A \u0938\u0947\u091F\u093F\u0902\u0917\u094D\u0938 \u2192 \u0938\u0941\u0930\u0915\u094D\u0937\u093E \u092E\u0947\u0902 2FA \u0938\u0915\u094D\u0937\u092E \u0915\u0930\u0947\u0902\u0964",
        "\u092F\u0926\u093F \u0906\u092A\u0915\u094B \u0905\u092A\u0928\u0947 \u0905\u0915\u093E\u0909\u0902\u091F \u092E\u0947\u0902 \u0905\u0928\u0927\u093F\u0915\u0943\u0924 \u092A\u0939\u0941\u0902\u091A \u0915\u093E \u0938\u0902\u0926\u0947\u0939 \u0939\u094B \u0924\u094B \u0924\u0941\u0930\u0902\u0924 \u0939\u092E\u0947\u0902 \u0938\u0942\u091A\u093F\u0924 \u0915\u0930\u0947\u0902\u0964"
      ]
    },
    {
      heading: "4. \u0911\u0930\u094D\u0921\u0930 \u0914\u0930 \u0928\u093F\u0937\u094D\u092A\u093E\u0926\u0928",
      body: [
        "\u0911\u0930\u094D\u0921\u0930 \u091F\u094D\u0930\u0947\u0921\u093F\u0902\u0917 \u0907\u0902\u091C\u0928 \u0926\u094D\u0935\u093E\u0930\u093E \u092A\u094D\u0930\u093E\u0907\u0938-\u091F\u093E\u0907\u092E \u092A\u094D\u0930\u093E\u0925\u092E\u093F\u0915\u0924\u093E \u0915\u0947 \u0906\u0927\u093E\u0930 \u092A\u0930 \u092E\u0948\u091A \u0915\u093F\u090F \u091C\u093E\u0924\u0947 \u0939\u0948\u0902\u0964 \u092E\u093E\u0930\u094D\u0915\u0947\u091F \u0911\u0930\u094D\u0921\u0930, \u0926\u093F\u090F \u091C\u093E\u0928\u0947 \u0915\u0947 \u0938\u092E\u092F \u0911\u0930\u094D\u0921\u0930 \u092C\u0941\u0915 \u092E\u0947\u0902 \u0909\u092A\u0932\u092C\u094D\u0927 \u0938\u0930\u094D\u0935\u094B\u0924\u094D\u0924\u092E \u0915\u0940\u092E\u0924 \u092A\u0930 \u092A\u0942\u0930\u0947 \u0939\u094B\u0924\u0947 \u0939\u0948\u0902 \u0914\u0930 \u0915\u092E \u0932\u093F\u0915\u094D\u0935\u093F\u0921\u093F\u091F\u0940 \u0939\u094B\u0928\u0947 \u092A\u0930 \u0938\u094D\u0932\u093F\u092A\u0947\u091C \u0915\u0947 \u0905\u0927\u0940\u0928 \u0939\u094B \u0938\u0915\u0924\u0947 \u0939\u0948\u0902\u0964"
      ]
    },
    {
      heading: "5. \u092B\u0940\u0938",
      body: [
        "\u0935\u0930\u094D\u0924\u092E\u093E\u0928 \u091F\u094D\u0930\u0947\u0921\u093F\u0902\u0917 \u092B\u0940\u0938 \u091F\u094D\u0930\u0947\u0921 \u0915\u0928\u094D\u092B\u0930\u094D\u092E \u0915\u0930\u0928\u0947 \u0938\u0947 \u092A\u0939\u0932\u0947 \u0907\u0902\u091F\u0930\u092B\u093C\u0947\u0938 \u092E\u0947\u0902 \u0926\u093F\u0916\u093E\u0908 \u091C\u093E\u0924\u0940 \u0939\u0948\u0964 \u0939\u092E \u0938\u0947\u0935\u093E \u0915\u0947 \u092D\u0940\u0924\u0930 \u0905\u0917\u094D\u0930\u093F\u092E \u0938\u0942\u091A\u0928\u093E \u0915\u0947 \u0938\u093E\u0925 \u092B\u0940\u0938 \u092C\u0926\u0932 \u0938\u0915\u0924\u0947 \u0939\u0948\u0902\u0964"
      ]
    },
    {
      heading: "6. \u0928\u093F\u0937\u093F\u0926\u094D\u0927 \u0909\u092A\u092F\u094B\u0917",
      body: [
        "\u0906\u092A \u0938\u0947\u0935\u093E \u0915\u093E \u0909\u092A\u092F\u094B\u0917 \u092E\u0928\u0940 \u0932\u0949\u0928\u094D\u0921\u094D\u0930\u093F\u0902\u0917, \u0928\u093F\u0937\u093F\u0926\u094D\u0927 \u0917\u0924\u093F\u0935\u093F\u0927\u093F \u0915\u0947 \u0935\u093F\u0924\u094D\u0924\u092A\u094B\u0937\u0923, \u092E\u093E\u0930\u094D\u0915\u0947\u091F \u092E\u0948\u0928\u093F\u092A\u0941\u0932\u0947\u0936\u0928 (\u0938\u094D\u092A\u0942\u092B\u093F\u0902\u0917, \u0935\u0949\u0936 \u091F\u094D\u0930\u0947\u0921\u093F\u0902\u0917), \u092F\u093E \u092A\u094D\u0932\u0947\u091F\u092B\u093C\u0949\u0930\u094D\u092E \u0915\u0940 \u0924\u0915\u0928\u0940\u0915\u0940 \u0938\u0941\u0930\u0915\u094D\u0937\u093E \u0915\u094B \u0926\u0930\u0915\u093F\u0928\u093E\u0930 \u0915\u0930\u0928\u0947 \u0915\u0940 \u0915\u094B\u0936\u093F\u0936 \u0915\u0947 \u0932\u093F\u090F \u0928\u0939\u0940\u0902 \u0915\u0930 \u0938\u0915\u0924\u0947\u0964"
      ]
    },
    {
      heading: "7. \u0928\u093F\u0932\u0902\u092C\u0928 \u0914\u0930 \u0938\u092E\u093E\u092A\u094D\u0924\u093F",
      body: [
        "\u0939\u092E \u0907\u0928 \u0936\u0930\u094D\u0924\u094B\u0902 \u0915\u0947 \u0909\u0932\u094D\u0932\u0902\u0918\u0928, \u0915\u093E\u0928\u0942\u0928 \u0915\u093E \u092A\u093E\u0932\u0928 \u0915\u0930\u0928\u0947, \u092F\u093E \u0927\u094B\u0916\u093E\u0927\u0921\u093C\u0940 \u0915\u0947 \u0938\u0902\u0926\u0947\u0939 \u092A\u0930 \u090F\u0915 \u0905\u0915\u093E\u0909\u0902\u091F \u0915\u094B \u0928\u093F\u0932\u0902\u092C\u093F\u0924 \u092F\u093E \u092C\u0902\u0926 \u0915\u0930 \u0938\u0915\u0924\u0947 \u0939\u0948\u0902, \u091C\u0939\u093E\u0902 \u0938\u0902\u092D\u0935 \u0939\u094B \u092F\u0942\u091C\u093C\u0930 \u0915\u094B \u0938\u0942\u091A\u093F\u0924 \u0915\u0930\u0924\u0947 \u0939\u0941\u090F\u0964"
      ]
    },
    {
      heading: "8. \u0926\u093E\u092F\u093F\u0924\u094D\u0935 \u0915\u0940 \u0938\u0940\u092E\u093E",
      body: [
        '\u0938\u0947\u0935\u093E "\u091C\u0948\u0938\u0940 \u0939\u0948 \u0935\u0948\u0938\u0940" \u092A\u094D\u0930\u0926\u093E\u0928 \u0915\u0940 \u091C\u093E\u0924\u0940 \u0939\u0948\u0964 \u0939\u092E \u0928\u093F\u0930\u094D\u092C\u093E\u0927 \u0938\u0902\u091A\u093E\u0932\u0928 \u0915\u0940 \u0917\u093E\u0930\u0902\u091F\u0940 \u0928\u0939\u0940\u0902 \u0926\u0947\u0924\u0947 \u0914\u0930 \u092E\u093E\u0930\u094D\u0915\u0947\u091F \u0905\u0938\u094D\u0925\u093F\u0930\u0924\u093E, \u0928\u0947\u091F\u0935\u0930\u094D\u0915 \u0906\u0909\u091F\u0947\u091C, \u092F\u093E \u0924\u0940\u0938\u0930\u0947 \u092A\u0915\u094D\u0937 \u0915\u0940 \u0915\u093E\u0930\u094D\u0930\u0935\u093E\u0907\u092F\u094B\u0902 \u0938\u0947 \u0939\u094B\u0928\u0947 \u0935\u093E\u0932\u0947 \u0928\u0941\u0915\u0938\u093E\u0928 \u0915\u0947 \u0932\u093F\u090F \u0909\u0924\u094D\u0924\u0930\u0926\u093E\u092F\u0940 \u0928\u0939\u0940\u0902 \u0939\u0948\u0902\u0964'
      ]
    },
    {
      heading: "9. \u0907\u0928 \u0936\u0930\u094D\u0924\u094B\u0902 \u092E\u0947\u0902 \u092C\u0926\u0932\u093E\u0935",
      body: ["\u0939\u092E \u0907\u0928 \u0936\u0930\u094D\u0924\u094B\u0902 \u0915\u094B \u0905\u092A\u0921\u0947\u091F \u0915\u0930 \u0938\u0915\u0924\u0947 \u0939\u0948\u0902\u0964 \u092E\u0939\u0924\u094D\u0935\u092A\u0942\u0930\u094D\u0923 \u092C\u0926\u0932\u093E\u0935 \u092A\u094D\u0930\u092D\u093E\u0935\u0940 \u0939\u094B\u0928\u0947 \u0938\u0947 \u0915\u092E \u0938\u0947 \u0915\u092E 7 \u0926\u093F\u0928 \u092A\u0939\u0932\u0947 \u0938\u0947\u0935\u093E \u092E\u0947\u0902 \u0918\u094B\u0937\u093F\u0924 \u0915\u093F\u090F \u091C\u093E\u090F\u0902\u0917\u0947\u0964"]
    }
  ]
};
var HI_PRIVACY = {
  title: "\u0917\u094B\u092A\u0928\u0940\u092F\u0924\u093E \u0928\u0940\u0924\u093F",
  updated: "\u0906\u0916\u093F\u0930\u0940 \u092C\u093E\u0930 \u0905\u092A\u0921\u0947\u091F \u0915\u093F\u092F\u093E \u0917\u092F\u093E: 22 \u0905\u0917\u0938\u094D\u0924, 2026",
  intro: "\u092F\u0939 \u0926\u0938\u094D\u0924\u093E\u0935\u0947\u091C\u093C \u092C\u0924\u093E\u0924\u093E \u0939\u0948 \u0915\u093F \u0939\u092E \u0915\u094C\u0928 \u0938\u093E \u0921\u0947\u091F\u093E \u090F\u0915\u0924\u094D\u0930 \u0915\u0930\u0924\u0947 \u0939\u0948\u0902, \u0915\u094D\u092F\u094B\u0902, \u0914\u0930 \u0939\u092E \u0907\u0938\u0947 \u0915\u0948\u0938\u0947 \u0938\u0941\u0930\u0915\u094D\u0937\u093F\u0924 \u0930\u0916\u0924\u0947 \u0939\u0948\u0902\u0964",
  sections: [
    {
      heading: "1. \u0939\u092E \u091C\u094B \u0921\u0947\u091F\u093E \u090F\u0915\u0924\u094D\u0930 \u0915\u0930\u0924\u0947 \u0939\u0948\u0902",
      body: [
        "\u0930\u091C\u093F\u0938\u094D\u091F\u094D\u0930\u0947\u0936\u0928 \u0921\u0947\u091F\u093E (\u0908\u092E\u0947\u0932, \u0939\u0948\u0936 \u0915\u093F\u092F\u093E \u0917\u092F\u093E \u092A\u093E\u0938\u0935\u0930\u094D\u0921), \u0938\u0924\u094D\u092F\u093E\u092A\u0928 (KYC) \u0921\u0947\u091F\u093E \u2014 \u0928\u093E\u092E, \u0926\u0947\u0936, \u092A\u0939\u091A\u093E\u0928 \u0926\u0938\u094D\u0924\u093E\u0935\u0947\u091C\u093C \u2014 \u091F\u094D\u0930\u0947\u0921\u093F\u0902\u0917 \u0914\u0930 \u091F\u094D\u0930\u093E\u0902\u091C\u093C\u0948\u0915\u094D\u0936\u0928 \u0907\u0924\u093F\u0939\u093E\u0938, \u0914\u0930 \u0938\u0941\u0930\u0915\u094D\u0937\u093E \u0909\u0926\u094D\u0926\u0947\u0936\u094D\u092F\u094B\u0902 \u0915\u0947 \u0932\u093F\u090F \u0924\u0915\u0928\u0940\u0915\u0940 \u0921\u0947\u091F\u093E (IP \u090F\u0921\u094D\u0930\u0947\u0938, \u0921\u093F\u0935\u093E\u0907\u0938 \u092A\u094D\u0930\u0915\u093E\u0930)\u0964"
      ]
    },
    {
      heading: "2. \u0939\u092E \u0907\u0938\u0915\u093E \u0909\u092A\u092F\u094B\u0917 \u0915\u0948\u0938\u0947 \u0915\u0930\u0924\u0947 \u0939\u0948\u0902",
      body: [
        "\u0938\u0947\u0935\u093E \u092A\u094D\u0930\u0926\u093E\u0928 \u0915\u0930\u0928\u0947, \u0911\u0930\u094D\u0921\u0930 \u0928\u093F\u0937\u094D\u092A\u093E\u0926\u093F\u0924 \u0915\u0930\u0928\u0947, \u0921\u093F\u092A\u0949\u091C\u093C\u093F\u091F/\u0928\u093F\u0915\u093E\u0938\u0940 \u092A\u094D\u0930\u094B\u0938\u0947\u0938 \u0915\u0930\u0928\u0947, \u0927\u094B\u0916\u093E\u0927\u0921\u093C\u0940 \u0930\u094B\u0915\u0928\u0947, \u0914\u0930 \u092E\u0928\u0940 \u0932\u0949\u0928\u094D\u0921\u094D\u0930\u093F\u0902\u0917-\u0935\u093F\u0930\u094B\u0927\u0940 (AML/KYC) \u0906\u0935\u0936\u094D\u092F\u0915\u0924\u093E\u0913\u0902 \u0915\u093E \u092A\u093E\u0932\u0928 \u0915\u0930\u0928\u0947 \u0915\u0947 \u0932\u093F\u090F\u0964"
      ]
    },
    {
      heading: "3. \u0938\u0924\u094D\u092F\u093E\u092A\u0928 (KYC) \u0921\u0947\u091F\u093E",
      body: [
        "\u092A\u0939\u091A\u093E\u0928 \u0938\u0924\u094D\u092F\u093E\u092A\u0928 \u0915\u0947 \u0932\u093F\u090F \u0905\u092A\u0932\u094B\u0921 \u0915\u093F\u090F \u0917\u090F \u0926\u0938\u094D\u0924\u093E\u0935\u0947\u091C\u093C \u090F\u0928\u094D\u0915\u094D\u0930\u093F\u092A\u094D\u091F\u0947\u0921 \u0930\u0942\u092A \u092E\u0947\u0902 \u0938\u0902\u0917\u094D\u0930\u0939\u0940\u0924 \u0939\u094B\u0924\u0947 \u0939\u0948\u0902 \u0914\u0930 \u0938\u092E\u0940\u0915\u094D\u0937\u093E \u0914\u0930 \u0928\u093F\u092F\u093E\u092E\u0915 \u0905\u0928\u0941\u092A\u093E\u0932\u0928 \u0909\u0926\u094D\u0926\u0947\u0936\u094D\u092F\u094B\u0902 \u0915\u0947 \u0932\u093F\u090F \u0915\u0947\u0935\u0932 \u0905\u0927\u093F\u0915\u0943\u0924 \u0938\u094D\u091F\u093E\u092B \u0915\u0947 \u0932\u093F\u090F \u0938\u0941\u0932\u092D \u0939\u094B\u0924\u0947 \u0939\u0948\u0902\u0964"
      ]
    },
    {
      heading: "4. \u0924\u0940\u0938\u0930\u0947 \u092A\u0915\u094D\u0937 \u0915\u0947 \u0938\u093E\u0925 \u0938\u093E\u091D\u093E\u0915\u0930\u0923",
      body: [
        "\u0939\u092E \u0935\u094D\u092F\u0915\u094D\u0924\u093F\u0917\u0924 \u0921\u0947\u091F\u093E \u0928\u0939\u0940\u0902 \u092C\u0947\u091A\u0924\u0947\u0964 \u0921\u0947\u091F\u093E \u0915\u094B \u0907\u0902\u092B\u094D\u0930\u093E\u0938\u094D\u091F\u094D\u0930\u0915\u094D\u091A\u0930 \u092A\u094D\u0930\u0926\u093E\u0924\u093E\u0913\u0902 (\u0939\u094B\u0938\u094D\u091F\u093F\u0902\u0917, \u092A\u0947\u092E\u0947\u0902\u091F \u092A\u094D\u0930\u094B\u0938\u0947\u0938\u093F\u0902\u0917) \u0915\u0947 \u0938\u093E\u0925 \u0915\u0947\u0935\u0932 \u0938\u0947\u0935\u093E \u0938\u0902\u091A\u093E\u0932\u093F\u0924 \u0915\u0930\u0928\u0947 \u0915\u0947 \u0932\u093F\u090F \u0906\u0935\u0936\u094D\u092F\u0915 \u0938\u0940\u092E\u093E \u0924\u0915 \u0938\u093E\u091D\u093E \u0915\u093F\u092F\u093E \u091C\u093E \u0938\u0915\u0924\u093E \u0939\u0948, \u0914\u0930 \u0915\u093E\u0928\u0942\u0928\u0940 \u0905\u0928\u0941\u0930\u094B\u0927 \u092A\u0930 \u0905\u0927\u093F\u0915\u093E\u0930\u093F\u092F\u094B\u0902 \u0915\u0947 \u0938\u093E\u0925\u0964"
      ]
    },
    {
      heading: "5. \u0921\u0947\u091F\u093E \u0938\u0941\u0930\u0915\u094D\u0937\u093E",
      body: [
        "\u092A\u093E\u0938\u0935\u0930\u094D\u0921 \u0905\u092A\u0930\u093F\u0935\u0930\u094D\u0924\u0928\u0940\u092F \u0915\u094D\u0930\u093F\u092A\u094D\u091F\u094B\u0917\u094D\u0930\u093E\u092B\u093C\u093F\u0915 \u0939\u0948\u0936 \u0915\u0947 \u0930\u0942\u092A \u092E\u0947\u0902 \u0938\u0902\u0917\u094D\u0930\u0939\u0940\u0924 \u0915\u093F\u090F \u091C\u093E\u0924\u0947 \u0939\u0948\u0902\u0964 API \u0915\u0941\u0902\u091C\u0940 \u0938\u0940\u0915\u094D\u0930\u0947\u091F\u094D\u0938 \u0906\u0930\u093E\u092E \u0915\u0947 \u0938\u092E\u092F \u090F\u0928\u094D\u0915\u094D\u0930\u093F\u092A\u094D\u091F\u0947\u0921 \u0939\u094B\u0924\u0947 \u0939\u0948\u0902\u0964 \u0939\u092E \u0905\u0924\u093F\u0930\u093F\u0915\u094D\u0924 \u0905\u0915\u093E\u0909\u0902\u091F \u0938\u0941\u0930\u0915\u094D\u0937\u093E \u0915\u0947 \u0932\u093F\u090F \u0926\u094B-\u091A\u0930\u0923\u0940\u092F \u092A\u094D\u0930\u092E\u093E\u0923\u0940\u0915\u0930\u0923 \u0915\u093E \u0938\u092E\u0930\u094D\u0925\u0928 \u0915\u0930\u0924\u0947 \u0939\u0948\u0902\u0964"
      ]
    },
    {
      heading: "6. \u0906\u092A\u0915\u0947 \u0905\u0927\u093F\u0915\u093E\u0930",
      body: [
        "\u0906\u092A \u0905\u092A\u0928\u0947 \u0921\u0947\u091F\u093E \u0915\u0940 \u090F\u0915 \u092A\u094D\u0930\u0924\u093F \u092F\u093E \u0909\u0938\u0947 \u0939\u091F\u093E\u0928\u0947 \u0915\u093E \u0905\u0928\u0941\u0930\u094B\u0927 \u0915\u0930 \u0938\u0915\u0924\u0947 \u0939\u0948\u0902, \u0909\u0938 \u091C\u093E\u0928\u0915\u093E\u0930\u0940 \u0915\u094B \u091B\u094B\u0921\u093C\u0915\u0930 \u091C\u093F\u0938\u0947 \u0939\u092E \u0915\u093E\u0928\u0942\u0928\u0940 \u0930\u0942\u092A \u0938\u0947 \u092C\u0928\u093E\u090F \u0930\u0916\u0928\u0947 \u0915\u0947 \u0932\u093F\u090F \u092C\u093E\u0927\u094D\u092F \u0939\u0948\u0902 (\u091C\u0948\u0938\u0947 \u0905\u0928\u093F\u0935\u093E\u0930\u094D\u092F \u0905\u0935\u0927\u093F \u0915\u0947 \u0932\u093F\u090F KYC/AML \u0930\u093F\u0915\u0949\u0930\u094D\u0921)\u0964"
      ]
    },
    {
      heading: "7. \u0921\u0947\u091F\u093E \u092A\u094D\u0930\u0924\u093F\u0927\u093E\u0930\u0923",
      body: [
        "\u0905\u0915\u093E\u0909\u0902\u091F \u0921\u0947\u091F\u093E \u0924\u092C \u0924\u0915 \u092C\u0928\u093E\u090F \u0930\u0916\u093E \u091C\u093E\u0924\u093E \u0939\u0948 \u091C\u092C \u0924\u0915 \u0905\u0915\u093E\u0909\u0902\u091F \u0938\u0915\u094D\u0930\u093F\u092F \u0939\u0948\u0964 \u092C\u0902\u0926 \u0939\u094B\u0928\u0947 \u0915\u0947 \u092C\u093E\u0926, \u0915\u093E\u0928\u0942\u0928 \u0926\u094D\u0935\u093E\u0930\u093E \u0906\u0935\u0936\u094D\u092F\u0915 \u0921\u0947\u091F\u093E (\u091F\u094D\u0930\u093E\u0902\u091C\u093C\u0948\u0915\u094D\u0936\u0928, KYC) \u0928\u093F\u092F\u092E\u093F\u0924 \u0905\u0935\u0927\u093F \u0915\u0947 \u0932\u093F\u090F \u0930\u0916\u093E \u091C\u093E\u0924\u093E \u0939\u0948; \u092C\u093E\u0915\u0940 \u0939\u091F\u093E \u0926\u093F\u092F\u093E \u091C\u093E\u0924\u093E \u0939\u0948\u0964"
      ]
    },
    {
      heading: "8. \u0938\u0902\u092A\u0930\u094D\u0915",
      body: ["\u0921\u0947\u091F\u093E \u0914\u0930 \u0917\u094B\u092A\u0928\u0940\u092F\u0924\u093E \u0915\u0947 \u092C\u093E\u0930\u0947 \u092E\u0947\u0902 \u092A\u094D\u0930\u0936\u094D\u0928 \u0906\u092A\u0915\u0947 \u0905\u0915\u093E\u0909\u0902\u091F \u092E\u0947\u0902 \u0938\u092A\u094B\u0930\u094D\u091F \u0938\u0947\u0915\u094D\u0936\u0928 \u0915\u0947 \u092E\u093E\u0927\u094D\u092F\u092E \u0938\u0947 \u092D\u0947\u091C\u0947 \u091C\u093E \u0938\u0915\u0924\u0947 \u0939\u0948\u0902\u0964"]
    }
  ]
};
var HI_ABOUT = {
  title: "\u0939\u092E\u093E\u0930\u0947 \u092C\u093E\u0930\u0947 \u092E\u0947\u0902",
  updated: "\u0906\u0916\u093F\u0930\u0940 \u092C\u093E\u0930 \u0905\u092A\u0921\u0947\u091F \u0915\u093F\u092F\u093E \u0917\u092F\u093E: 22 \u0905\u0917\u0938\u094D\u0924, 2026",
  intro: "VOLTEX \u090F\u0915 \u0915\u094D\u0930\u093F\u092A\u094D\u091F\u094B\u0915\u0930\u0947\u0902\u0938\u0940 \u091F\u094D\u0930\u0947\u0921\u093F\u0902\u0917 \u092A\u094D\u0932\u0947\u091F\u092B\u093C\u0949\u0930\u094D\u092E \u0939\u0948: \u0938\u094D\u092A\u0949\u091F \u0914\u0930 \u092E\u093E\u0930\u094D\u091C\u093F\u0928 \u092B\u094D\u092F\u0942\u091A\u0930\u094D\u0938 \u091F\u094D\u0930\u0947\u0921\u093F\u0902\u0917, \u0932\u093F\u092E\u093F\u091F, \u092E\u093E\u0930\u094D\u0915\u0947\u091F, \u0938\u094D\u091F\u0949\u092A, \u0914\u0930 \u091F\u0947\u0915-\u092A\u094D\u0930\u0949\u092B\u093F\u091F \u0911\u0930\u094D\u0921\u0930, \u0938\u092E\u0930\u094D\u0925\u093F\u0924 \u0928\u0947\u091F\u0935\u0930\u094D\u0915 \u092A\u0930 \u0921\u093F\u092A\u0949\u091C\u093C\u093F\u091F \u0914\u0930 \u0928\u093F\u0915\u093E\u0938\u0940\u0964",
  sections: [
    {
      heading: "\u092E\u0948\u091A\u093F\u0902\u0917 \u0907\u0902\u091C\u0928",
      body: [
        "\u0911\u0930\u094D\u0921\u0930 \u0939\u092E\u093E\u0930\u0947 \u0905\u092A\u0928\u0947 \u092A\u094D\u0930\u093E\u0907\u0938-\u091F\u093E\u0907\u092E \u092E\u0948\u091A\u093F\u0902\u0917 \u0907\u0902\u091C\u0928 \u0926\u094D\u0935\u093E\u0930\u093E \u092E\u0948\u091A \u0915\u093F\u090F \u091C\u093E\u0924\u0947 \u0939\u0948\u0902\u0964 \u092E\u093E\u0930\u094D\u0915\u0947\u091F \u0921\u0947\u091F\u093E (\u0915\u0940\u092E\u0924\u0947\u0902, \u0915\u0948\u0902\u0921\u0932\u094D\u0938, \u0911\u0930\u094D\u0921\u0930 \u092C\u0941\u0915) \u0935\u093E\u0938\u094D\u0924\u0935\u093F\u0915 \u090F\u0915\u094D\u0938\u091A\u0947\u0902\u091C\u094B\u0902 \u0938\u0947 \u0930\u0940\u092F\u0932 \u091F\u093E\u0907\u092E \u092E\u0947\u0902 \u0906\u0924\u093E \u0939\u0948\u0964"
      ]
    },
    {
      heading: "\u0905\u0915\u093E\u0909\u0902\u091F \u0938\u0941\u0930\u0915\u094D\u0937\u093E",
      body: [
        "\u092A\u093E\u0938\u0935\u0930\u094D\u0921 \u0905\u092A\u0930\u093F\u0935\u0930\u094D\u0924\u0928\u0940\u092F \u0915\u094D\u0930\u093F\u092A\u094D\u091F\u094B\u0917\u094D\u0930\u093E\u092B\u093C\u093F\u0915 \u0939\u0948\u0936 \u0915\u0947 \u0930\u0942\u092A \u092E\u0947\u0902 \u0938\u0902\u0917\u094D\u0930\u0939\u0940\u0924 \u0915\u093F\u090F \u091C\u093E\u0924\u0947 \u0939\u0948\u0902, \u0914\u0930 API \u0915\u0941\u0902\u091C\u0940 \u0938\u0940\u0915\u094D\u0930\u0947\u091F\u094D\u0938 \u0906\u0930\u093E\u092E \u0915\u0947 \u0938\u092E\u092F \u090F\u0928\u094D\u0915\u094D\u0930\u093F\u092A\u094D\u091F\u0947\u0921 \u0939\u094B\u0924\u0947 \u0939\u0948\u0902\u0964 \u0926\u094B-\u091A\u0930\u0923\u0940\u092F \u092A\u094D\u0930\u092E\u093E\u0923\u0940\u0915\u0930\u0923 \u0914\u0930 \u0932\u0949\u0917\u093F\u0928 \u0907\u0924\u093F\u0939\u093E\u0938 \u0938\u0947\u091F\u093F\u0902\u0917\u094D\u0938 \u2192 \u0938\u0941\u0930\u0915\u094D\u0937\u093E \u092E\u0947\u0902 \u0909\u092A\u0932\u092C\u094D\u0927 \u0939\u0948\u0902\u0964"
      ]
    },
    {
      heading: "\u092B\u094D\u092F\u0942\u091A\u0930\u094D\u0938 \u0914\u0930 \u091C\u094B\u0916\u093F\u092E \u092A\u094D\u0930\u092C\u0902\u0927\u0928",
      body: [
        "\u0906\u0907\u0938\u094B\u0932\u0947\u091F\u0947\u0921 \u0914\u0930 \u0915\u094D\u0930\u0949\u0938 \u092E\u093E\u0930\u094D\u091C\u093F\u0928 \u0915\u0947 \u0938\u093E\u0925 \u092E\u093E\u0930\u094D\u091C\u093F\u0928 \u091F\u094D\u0930\u0947\u0921\u093F\u0902\u0917, \u091F\u093F\u092F\u0930\u094D\u0921 \u0932\u0940\u0935\u0930\u0947\u091C, \u0935\u093E\u0938\u094D\u0924\u0935\u093F\u0915 \u092E\u093E\u0930\u094D\u0915 \u092A\u094D\u0930\u093E\u0907\u0938 \u0915\u0947 \u0916\u093F\u0932\u093E\u092B \u0938\u094D\u0935\u091A\u093E\u0932\u093F\u0924 \u0932\u093F\u0915\u094D\u0935\u093F\u0921\u0947\u0936\u0928, \u0914\u0930 \u0932\u093F\u0915\u094D\u0935\u093F\u0921\u0947\u0936\u0928 \u092A\u0930 \u0915\u092E\u0940 \u0915\u0947 \u0932\u093F\u090F \u090F\u0915 \u0907\u0902\u0936\u094D\u092F\u094B\u0930\u0947\u0902\u0938 \u092B\u0902\u0921\u0964"
      ]
    },
    {
      heading: "\u092A\u093E\u0930\u0926\u0930\u094D\u0936\u093F\u0924\u093E",
      body: [
        "\u0939\u092E \u0930\u093F\u091F\u0930\u094D\u0928 \u092F\u093E \u091F\u094D\u0930\u0947\u0921\u093F\u0902\u0917 \u0935\u0949\u0932\u094D\u092F\u0942\u092E \u0915\u0947 \u092C\u093E\u0930\u0947 \u092E\u0947\u0902 \u0905\u0938\u0924\u094D\u092F\u093E\u092A\u093F\u0924 \u0926\u093E\u0935\u0947 \u092A\u094D\u0930\u0915\u093E\u0936\u093F\u0924 \u0928\u0939\u0940\u0902 \u0915\u0930\u0924\u0947\u0964 \u092B\u0940\u0938, \u0938\u0940\u092E\u093E\u090F\u0902, \u0914\u0930 \u0936\u0930\u094D\u0924\u0947\u0902 \u0935\u0939\u0940\u0902 \u0907\u0902\u091F\u0930\u092B\u093C\u0947\u0938 \u092E\u0947\u0902 \u0926\u093F\u0916\u093E\u0908 \u091C\u093E\u0924\u0940 \u0939\u0948\u0902 \u091C\u0939\u093E\u0902 \u0935\u0947 \u0932\u093E\u0917\u0942 \u0939\u094B\u0924\u0940 \u0939\u0948\u0902 \u2014 \u0915\u093F\u0938\u0940 \u0915\u093E\u0930\u094D\u0930\u0935\u093E\u0908 \u0915\u0940 \u092A\u0941\u0937\u094D\u091F\u093F \u0915\u0930\u0928\u0947 \u0938\u0947 \u092A\u0939\u0932\u0947, \u092C\u093E\u0930\u0940\u0915 \u092A\u094D\u0930\u093F\u0902\u091F \u092E\u0947\u0902 \u0928\u0939\u0940\u0902\u0964"
      ]
    }
  ]
};
var HI_SUPPORT = {
  title: "\u0938\u092A\u094B\u0930\u094D\u091F",
  updated: "\u0906\u0916\u093F\u0930\u0940 \u092C\u093E\u0930 \u0905\u092A\u0921\u0947\u091F \u0915\u093F\u092F\u093E \u0917\u092F\u093E: 22 \u0905\u0917\u0938\u094D\u0924, 2026",
  intro: "\u0938\u093E\u092E\u093E\u0928\u094D\u092F \u092A\u094D\u0930\u0936\u094D\u0928\u094B\u0902 \u0915\u0947 \u0909\u0924\u094D\u0924\u0930\u0964 \u0905\u0915\u093E\u0909\u0902\u091F-\u0935\u093F\u0936\u093F\u0937\u094D\u091F \u0915\u093F\u0938\u0940 \u092D\u0940 \u091A\u0940\u091C\u093C \u0915\u0947 \u0932\u093F\u090F, \u092A\u0939\u0932\u0947 \u0938\u0947\u091F\u093F\u0902\u0917\u094D\u0938 \u091C\u093E\u0902\u091A\u0947\u0902\u0964",
  sections: [
    {
      heading: "\u0921\u093F\u092A\u0949\u091C\u093C\u093F\u091F \u0915\u0948\u0938\u0947 \u0915\u0930\u0947\u0902",
      body: [
        '"\u0921\u093F\u092A\u0949\u091C\u093C\u093F\u091F" \u0916\u094B\u0932\u0947\u0902 \u2192 \u090F\u0915 \u0928\u0947\u091F\u0935\u0930\u094D\u0915 \u091A\u0941\u0928\u0947\u0902 \u2192 \u0926\u093F\u0916\u093E\u090F \u0917\u090F \u090F\u0921\u094D\u0930\u0947\u0938 \u092A\u0930 \u092B\u0902\u0921 \u092D\u0947\u091C\u0947\u0902 \u2192 \u0907\u0938\u0947 \u0935\u0947\u0930\u093F\u092B\u093C\u093E\u0908 \u0915\u0930\u0928\u0947 \u0915\u0947 \u0932\u093F\u090F \u091F\u094D\u0930\u093E\u0902\u091C\u093C\u0948\u0915\u094D\u0936\u0928 \u0939\u0948\u0936 \u092A\u0947\u0938\u094D\u091F \u0915\u0930\u0947\u0902\u0964 USD \u0915\u0947 \u092C\u0930\u093E\u092C\u0930 \u0935\u0930\u094D\u0924\u092E\u093E\u0928 \u0928\u094D\u092F\u0942\u0928\u0924\u092E \u0930\u093E\u0936\u093F \u0921\u093F\u092A\u0949\u091C\u093C\u093F\u091F \u092B\u093C\u0949\u0930\u094D\u092E \u092E\u0947\u0902 \u0926\u093F\u0916\u093E\u0908 \u091C\u093E\u0924\u0940 \u0939\u0948; \u0907\u0938\u0938\u0947 \u0915\u092E \u0930\u093E\u0936\u093F \u091C\u092E\u093E \u0928\u0939\u0940\u0902 \u0915\u0940 \u091C\u093E\u090F\u0917\u0940\u0964'
      ]
    },
    {
      heading: "\u092E\u0947\u0930\u093E \u0911\u0930\u094D\u0921\u0930 \u0928\u093F\u0937\u094D\u092A\u093E\u0926\u093F\u0924 \u0928\u0939\u0940\u0902 \u0939\u094B \u0930\u0939\u093E",
      body: [
        '\u091C\u093E\u0902\u091A\u0947\u0902 \u0915\u093F \u0938\u094D\u091F\u0949\u092A/\u091F\u0947\u0915-\u092A\u094D\u0930\u0949\u092B\u093F\u091F \u091F\u094D\u0930\u093F\u0917\u0930 \u0915\u0940\u092E\u0924 \u0935\u0930\u094D\u0924\u092E\u093E\u0928 \u092E\u093E\u0930\u094D\u0915\u0947\u091F \u0915\u0940\u092E\u0924 \u0915\u0947 \u0938\u0939\u0940 \u0924\u0930\u092B \u0939\u0948 \u2014 \u0911\u0930\u094D\u0921\u0930 \u092B\u0949\u0930\u094D\u092E \u0906\u0935\u0936\u094D\u092F\u0915 \u0926\u093F\u0936\u093E \u0907\u0928\u0932\u093E\u0907\u0928 \u0926\u093F\u0916\u093E\u0924\u093E \u0939\u0948\u0964 \u0932\u0902\u092C\u093F\u0924 \u0915\u0902\u0921\u0940\u0936\u0928\u0932 \u0911\u0930\u094D\u0921\u0930 \u0905\u092A\u0928\u0947 \u091F\u094D\u0930\u093F\u0917\u0930 \u0915\u0940 \u092A\u094D\u0930\u0924\u0940\u0915\u094D\u0937\u093E \u0915\u0930\u0924\u0947 \u0939\u0948\u0902 \u0914\u0930 "\u0932\u0902\u092C\u093F\u0924" \u0938\u094D\u0925\u093F\u0924\u093F \u0926\u093F\u0916\u093E\u0924\u0947 \u0939\u0948\u0902\u0964'
      ]
    },
    {
      heading: "\u0905\u0915\u093E\u0909\u0902\u091F \u0938\u0941\u0930\u0915\u094D\u0937\u093E",
      body: [
        "\u0926\u094B-\u091A\u0930\u0923\u0940\u092F \u092A\u094D\u0930\u092E\u093E\u0923\u0940\u0915\u0930\u0923 \u091A\u093E\u0932\u0942 \u0915\u0930\u0947\u0902 \u0914\u0930 \u0938\u092E\u092F-\u0938\u092E\u092F \u092A\u0930 \u0938\u0947\u091F\u093F\u0902\u0917\u094D\u0938 \u2192 \u0938\u0941\u0930\u0915\u094D\u0937\u093E \u092E\u0947\u0902 \u0932\u0949\u0917\u093F\u0928 \u0907\u0924\u093F\u0939\u093E\u0938 \u0915\u0940 \u0938\u092E\u0940\u0915\u094D\u0937\u093E \u0915\u0930\u0947\u0902 \u2014 \u0906\u092A\u0915\u0947 \u0905\u0915\u093E\u0909\u0902\u091F \u092E\u0947\u0902 \u0939\u0930 \u0938\u093E\u0907\u0928-\u0907\u0928 \u0935\u0939\u093E\u0902 \u0926\u093F\u0916\u093E\u0908 \u0926\u0947\u0924\u093E \u0939\u0948\u0964"
      ]
    },
    {
      heading: "\u0938\u0924\u094D\u092F\u093E\u092A\u0928 (KYC)",
      body: ["\u0906\u092A\u0915\u0940 \u0938\u0924\u094D\u092F\u093E\u092A\u0928 \u0938\u094D\u0925\u093F\u0924\u093F \u0914\u0930 \u0906\u0935\u0936\u094D\u092F\u0915 \u0926\u0938\u094D\u0924\u093E\u0935\u0947\u091C\u093C \u0906\u092A\u0915\u0947 \u0905\u0915\u093E\u0909\u0902\u091F \u0915\u0947 \u0938\u0924\u094D\u092F\u093E\u092A\u0928 \u0938\u0947\u0915\u094D\u0936\u0928 \u092E\u0947\u0902 \u0926\u093F\u0916\u093E\u090F \u091C\u093E\u0924\u0947 \u0939\u0948\u0902\u0964"]
    },
    {
      heading: "\u0905\u092D\u0940 \u092D\u0940 \u0938\u0935\u093E\u0932 \u0939\u0948\u0902",
      body: ["\u092A\u094D\u0932\u0947\u091F\u092B\u093C\u0949\u0930\u094D\u092E \u0915\u0947 \u0907\u0938 \u0938\u0902\u0938\u094D\u0915\u0930\u0923 \u092E\u0947\u0902 \u0905\u092D\u0940 \u0924\u0915 \u0915\u094B\u0908 \u0932\u093E\u0907\u0935 \u0938\u092A\u094B\u0930\u094D\u091F \u091A\u0948\u0928\u0932 \u0928\u0939\u0940\u0902 \u0939\u0948 \u2014 \u0938\u092A\u094B\u0930\u094D\u091F \u0938\u0947\u0915\u094D\u0936\u0928 \u0907\u0938 FAQ \u092A\u0947\u091C \u0924\u0915 \u0938\u0940\u092E\u093F\u0924 \u0939\u0948\u0964"]
    }
  ]
};
var HI_RISK = {
  title: "\u091C\u094B\u0916\u093F\u092E \u092A\u094D\u0930\u0915\u091F\u0940\u0915\u0930\u0923",
  updated: "\u0906\u0916\u093F\u0930\u0940 \u092C\u093E\u0930 \u0905\u092A\u0921\u0947\u091F \u0915\u093F\u092F\u093E \u0917\u092F\u093E: 22 \u0905\u0917\u0938\u094D\u0924, 2026",
  intro: "\u0915\u094D\u0930\u093F\u092A\u094D\u091F\u094B\u0915\u0930\u0947\u0902\u0938\u0940 \u091F\u094D\u0930\u0947\u0921\u093F\u0902\u0917 \u092E\u0947\u0902 \u092E\u0939\u0924\u094D\u0935\u092A\u0942\u0930\u094D\u0923 \u091C\u094B\u0916\u093F\u092E \u0939\u0948\u0964 \u091F\u094D\u0930\u0947\u0921 \u0915\u0930\u0928\u0947 \u0938\u0947 \u092A\u0939\u0932\u0947, \u0938\u0941\u0928\u093F\u0936\u094D\u091A\u093F\u0924 \u0915\u0930\u0947\u0902 \u0915\u093F \u0906\u092A \u0928\u0940\u091A\u0947 \u0926\u093F\u090F \u0917\u090F \u091C\u094B\u0916\u093F\u092E\u094B\u0902 \u0915\u094B \u0938\u092E\u091D\u0924\u0947 \u0939\u0948\u0902 \u0914\u0930 \u0938\u094D\u0935\u0940\u0915\u093E\u0930 \u0915\u0930\u0924\u0947 \u0939\u0948\u0902\u0964",
  sections: [
    {
      heading: "1. \u0905\u0938\u094D\u0925\u093F\u0930\u0924\u093E",
      body: ["\u0915\u094D\u0930\u093F\u092A\u094D\u091F\u094B\u0915\u0930\u0947\u0902\u0938\u0940 \u0915\u0940 \u0915\u0940\u092E\u0924\u0947\u0902 \u0915\u092E \u0938\u092E\u092F \u092E\u0947\u0902 \u0924\u0947\u091C\u093C\u0940 \u0938\u0947 \u092C\u0926\u0932 \u0938\u0915\u0924\u0940 \u0939\u0948\u0902\u0964 \u090F\u0938\u0947\u091F \u0915\u093E \u092E\u0942\u0932\u094D\u092F \u0915\u093E\u092B\u0940 \u092C\u0922\u093C \u0938\u0915\u0924\u093E \u0939\u0948 \u092F\u093E \u0936\u0942\u0928\u094D\u092F \u0924\u0915 \u0917\u093F\u0930 \u0938\u0915\u0924\u093E \u0939\u0948\u0964"]
    },
    {
      heading: "2. \u0915\u094B\u0908 \u0917\u093E\u0930\u0902\u091F\u0940 \u0928\u0939\u0940\u0902",
      body: ["\u092A\u093F\u091B\u0932\u093E \u092A\u094D\u0930\u0926\u0930\u094D\u0936\u0928 \u092D\u0935\u093F\u0937\u094D\u092F \u0915\u0947 \u092A\u0930\u093F\u0923\u093E\u092E\u094B\u0902 \u0915\u0940 \u0917\u093E\u0930\u0902\u091F\u0940 \u0928\u0939\u0940\u0902 \u0926\u0947\u0924\u093E\u0964 VOLTEX \u091F\u094D\u0930\u0947\u0921\u093F\u0902\u0917 \u092E\u0941\u0928\u093E\u092B\u0947 \u0915\u0940 \u0917\u093E\u0930\u0902\u091F\u0940 \u0928\u0939\u0940\u0902 \u0926\u0947\u0924\u093E\u0964"]
    },
    {
      heading: "3. \u0928\u093F\u0935\u0947\u0936 \u0938\u0932\u093E\u0939 \u0928\u0939\u0940\u0902",
      body: [
        "\u092A\u094D\u0932\u0947\u091F\u092B\u093C\u0949\u0930\u094D\u092E \u092A\u0930 \u091C\u093E\u0928\u0915\u093E\u0930\u0940 (\u0915\u0940\u092E\u0924\u0947\u0902, \u091A\u093E\u0930\u094D\u091F, \u0906\u0902\u0915\u0921\u093C\u0947) \u0915\u0947\u0935\u0932 \u0938\u0942\u091A\u0928\u093E\u0924\u094D\u092E\u0915 \u0909\u0926\u094D\u0926\u0947\u0936\u094D\u092F\u094B\u0902 \u0915\u0947 \u0932\u093F\u090F \u092A\u094D\u0930\u0926\u093E\u0928 \u0915\u0940 \u091C\u093E\u0924\u0940 \u0939\u0948 \u0914\u0930 \u092F\u0939 \u0928\u093F\u0935\u0947\u0936, \u0915\u0930, \u092F\u093E \u0915\u093E\u0928\u0942\u0928\u0940 \u0938\u0932\u093E\u0939 \u0928\u0939\u0940\u0902 \u0939\u0948\u0964"
      ]
    },
    {
      heading: "4. \u092E\u093E\u0930\u094D\u0915\u0947\u091F \u0911\u0930\u094D\u0921\u0930 \u091C\u094B\u0916\u093F\u092E",
      body: ["\u092E\u093E\u0930\u094D\u0915\u0947\u091F \u0911\u0930\u094D\u0921\u0930 \u0938\u0930\u094D\u0935\u094B\u0924\u094D\u0924\u092E \u0909\u092A\u0932\u092C\u094D\u0927 \u0915\u0940\u092E\u0924 \u092A\u0930 \u092A\u0942\u0930\u0947 \u0939\u094B\u0924\u0947 \u0939\u0948\u0902 \u0914\u0930 \u0935\u093F\u0936\u0947\u0937 \u0930\u0942\u092A \u0938\u0947 \u0915\u092E \u0932\u093F\u0915\u094D\u0935\u093F\u0921\u093F\u091F\u0940 \u092F\u093E \u0909\u091A\u094D\u091A \u0905\u0938\u094D\u0925\u093F\u0930\u0924\u093E \u0915\u0947 \u0924\u0939\u0924 \u0938\u094D\u0932\u093F\u092A\u0947\u091C \u0915\u0947 \u0905\u0927\u0940\u0928 \u0939\u094B \u0938\u0915\u0924\u0947 \u0939\u0948\u0902\u0964"]
    },
    {
      heading: "5. \u0924\u0915\u0928\u0940\u0915\u0940 \u091C\u094B\u0916\u093F\u092E",
      body: ["\u0928\u0947\u091F\u0935\u0930\u094D\u0915 \u0906\u0909\u091F\u0947\u091C, \u092C\u094D\u0932\u0949\u0915\u091A\u0947\u0928 \u0926\u0947\u0930\u0940, \u092F\u093E \u0924\u0915\u0928\u0940\u0915\u0940 \u0916\u0930\u093E\u092C\u0940 \u0911\u0930\u094D\u0921\u0930 \u0928\u093F\u0937\u094D\u092A\u093E\u0926\u0928 \u092F\u093E \u0938\u0947\u0935\u093E \u0909\u092A\u0932\u092C\u094D\u0927\u0924\u093E \u0915\u094B \u092A\u094D\u0930\u092D\u093E\u0935\u093F\u0924 \u0915\u0930 \u0938\u0915\u0924\u0940 \u0939\u0948\u0964"]
    },
    {
      heading: "6. \u0928\u093F\u092F\u093E\u092E\u0915 \u091C\u094B\u0916\u093F\u092E",
      body: ["\u0915\u094D\u0930\u093F\u092A\u094D\u091F\u094B\u0915\u0930\u0947\u0902\u0938\u0940 \u0915\u0940 \u0915\u093E\u0928\u0942\u0928\u0940 \u0938\u094D\u0925\u093F\u0924\u093F \u0915\u094D\u0937\u0947\u0924\u094D\u0930\u093E\u0927\u093F\u0915\u093E\u0930 \u0915\u0947 \u0905\u0928\u0941\u0938\u093E\u0930 \u0905\u0932\u0917-\u0905\u0932\u0917 \u0939\u094B\u0924\u0940 \u0939\u0948 \u0914\u0930 \u092C\u0926\u0932 \u0938\u0915\u0924\u0940 \u0939\u0948, \u091C\u094B \u0938\u0947\u0935\u093E \u0909\u092A\u0932\u092C\u094D\u0927\u0924\u093E \u0915\u094B \u092A\u094D\u0930\u092D\u093E\u0935\u093F\u0924 \u0915\u0930 \u0938\u0915\u0924\u0940 \u0939\u0948\u0964"]
    },
    {
      heading: "7. \u091F\u094D\u0930\u093E\u0902\u091C\u093C\u0948\u0915\u094D\u0936\u0928 \u0915\u0940 \u0905\u092A\u0930\u093F\u0935\u0930\u094D\u0924\u0928\u0940\u092F\u0924\u093E",
      body: ["\u0911\u0928-\u091A\u0947\u0928 \u091F\u094D\u0930\u093E\u0902\u0938\u092B\u0930 \u0906\u092E\u0924\u094C\u0930 \u092A\u0930 \u0905\u092A\u0930\u093F\u0935\u0930\u094D\u0924\u0928\u0940\u092F \u0939\u094B\u0924\u0947 \u0939\u0948\u0902\u0964 \u092B\u0902\u0921 \u0928\u093F\u0915\u093E\u0932\u0928\u0947 \u0938\u0947 \u092A\u0939\u0932\u0947 \u090F\u0921\u094D\u0930\u0947\u0938 \u0914\u0930 \u0928\u0947\u091F\u0935\u0930\u094D\u0915 \u0915\u0940 \u0926\u094B\u092C\u093E\u0930\u093E \u091C\u093E\u0902\u091A \u0915\u0930\u0947\u0902\u0964"]
    },
    {
      heading: "8. \u0938\u094D\u0935\u0940\u0915\u0943\u0924\u093F",
      body: ["\u091F\u094D\u0930\u0947\u0921 \u0915\u0930\u0928\u0947 \u0915\u0947 \u0932\u093F\u090F VOLTEX \u0915\u093E \u0909\u092A\u092F\u094B\u0917 \u0915\u0930\u0915\u0947, \u0906\u092A \u092A\u0941\u0937\u094D\u091F\u093F \u0915\u0930\u0924\u0947 \u0939\u0948\u0902 \u0915\u093F \u0906\u092A \u090A\u092A\u0930 \u0938\u0942\u091A\u0940\u092C\u0926\u094D\u0927 \u091C\u094B\u0916\u093F\u092E\u094B\u0902 \u0915\u094B \u0938\u092E\u091D\u0924\u0947 \u0939\u0948\u0902 \u0914\u0930 \u0905\u092A\u0928\u0947 \u091C\u094B\u0916\u093F\u092E \u092A\u0930 \u091F\u094D\u0930\u0947\u0921 \u0915\u0930\u0924\u0947 \u0939\u0948\u0902\u0964"]
    }
  ]
};
var JA_TERMS = {
  title: "\u5229\u7528\u898F\u7D04",
  updated: "\u6700\u7D42\u66F4\u65B0\u65E5: 2026\u5E748\u670822\u65E5",
  intro: "\u672C\u898F\u7D04\u306F\u3001VOLTEX\u30D7\u30E9\u30C3\u30C8\u30D5\u30A9\u30FC\u30E0\u306E\u3054\u5229\u7528\u306B\u3064\u3044\u3066\u5B9A\u3081\u308B\u3082\u306E\u3067\u3059\u3002\u767B\u9332\u307E\u305F\u306F\u30B5\u30FC\u30D3\u30B9\u306E\u5229\u7528\u306B\u3088\u308A\u3001\u4EE5\u4E0B\u306E\u5185\u5BB9\u3092\u8AAD\u307F\u3001\u540C\u610F\u3057\u305F\u3082\u306E\u3068\u307F\u306A\u3055\u308C\u307E\u3059\u3002",
  sections: [
    {
      heading: "1. \u30B5\u30FC\u30D3\u30B9\u306B\u3064\u3044\u3066",
      body: [
        "VOLTEX\u306F\u3001\u6307\u5024\u6CE8\u6587\u304A\u3088\u3073\u6210\u884C\u6CE8\u6587\u306E\u767A\u6CE8\u3001\u5185\u90E8\u30A6\u30A9\u30EC\u30C3\u30C8\u3067\u306E\u8CC7\u7523\u4FDD\u6709\u3001\u5BFE\u5FDC\u30CD\u30C3\u30C8\u30EF\u30FC\u30AF\u3067\u306E\u5165\u51FA\u91D1\u304C\u53EF\u80FD\u306A\u6697\u53F7\u8CC7\u7523\u53D6\u5F15\u30D7\u30E9\u30C3\u30C8\u30D5\u30A9\u30FC\u30E0\u3067\u3059\u3002"
      ]
    },
    {
      heading: "2. \u5229\u7528\u8CC7\u683C",
      body: [
        "\u672C\u30B5\u30FC\u30D3\u30B9\u306F\u300118\u6B73\u4EE5\u4E0A\u3067\u6CD5\u7684\u884C\u70BA\u80FD\u529B\u3092\u6709\u3059\u308B\u65B9\u306E\u307F\u3054\u5229\u7528\u3044\u305F\u3060\u3051\u307E\u3059\u3002\u767B\u9332\u3059\u308B\u3053\u3068\u306B\u3088\u308A\u3001\u304A\u5BA2\u69D8\u306E\u7BA1\u8F44\u533A\u57DF\u306B\u304A\u3044\u3066\u6697\u53F7\u8CC7\u7523\u30B5\u30FC\u30D3\u30B9\u306E\u5229\u7528\u304C\u7981\u6B62\u3055\u308C\u3066\u3044\u306A\u3044\u3053\u3068\u3092\u78BA\u8A8D\u3057\u305F\u3082\u306E\u3068\u307F\u306A\u3055\u308C\u307E\u3059\u3002"
      ]
    },
    {
      heading: "3. \u30A2\u30AB\u30A6\u30F3\u30C8\u3068\u30BB\u30AD\u30E5\u30EA\u30C6\u30A3",
      body: [
        "\u30D1\u30B9\u30EF\u30FC\u30C9\u3092\u79D8\u5BC6\u306B\u4FDD\u3064\u3053\u3068\u3001\u304A\u3088\u3073\u6709\u52B9\u5316\u3057\u305F\u5834\u5408\u306F\u4E8C\u6BB5\u968E\u8A8D\u8A3C\u60C5\u5831\u3092\u4FDD\u8B77\u3059\u308B\u3053\u3068\u306F\u3001\u304A\u5BA2\u69D8\u306E\u8CAC\u4EFB\u3067\u3059\u3002\u8A2D\u5B9A \u2192 \u30BB\u30AD\u30E5\u30EA\u30C6\u30A3\u30672FA\u3092\u6709\u52B9\u306B\u3059\u308B\u3053\u3068\u3092\u5F37\u304F\u304A\u52E7\u3081\u3057\u307E\u3059\u3002",
        "\u30A2\u30AB\u30A6\u30F3\u30C8\u3078\u306E\u4E0D\u6B63\u30A2\u30AF\u30BB\u30B9\u306E\u7591\u3044\u304C\u3042\u308B\u5834\u5408\u306F\u3001\u76F4\u3061\u306B\u5F53\u793E\u306B\u3054\u9023\u7D61\u304F\u3060\u3055\u3044\u3002"
      ]
    },
    {
      heading: "4. \u6CE8\u6587\u3068\u57F7\u884C",
      body: [
        "\u6CE8\u6587\u306F\u4FA1\u683C\u30FB\u6642\u9593\u512A\u5148\u306E\u539F\u5247\u306B\u57FA\u3065\u304D\u53D6\u5F15\u30A8\u30F3\u30B8\u30F3\u306B\u3088\u3063\u3066\u30DE\u30C3\u30C1\u30F3\u30B0\u3055\u308C\u307E\u3059\u3002\u6210\u884C\u6CE8\u6587\u306F\u767A\u6CE8\u6642\u70B9\u3067\u677F\u60C5\u5831\u306B\u3042\u308B\u6700\u826F\u4FA1\u683C\u3067\u57F7\u884C\u3055\u308C\u3001\u6D41\u52D5\u6027\u304C\u8584\u3044\u5834\u5408\u306F\u30B9\u30EA\u30C3\u30DA\u30FC\u30B8\u304C\u767A\u751F\u3059\u308B\u3053\u3068\u304C\u3042\u308A\u307E\u3059\u3002"
      ]
    },
    {
      heading: "5. \u624B\u6570\u6599",
      body: [
        "\u73FE\u5728\u306E\u53D6\u5F15\u624B\u6570\u6599\u306F\u3001\u53D6\u5F15\u3092\u78BA\u5B9A\u3059\u308B\u524D\u306B\u30A4\u30F3\u30BF\u30FC\u30D5\u30A7\u30FC\u30B9\u4E0A\u306B\u8868\u793A\u3055\u308C\u307E\u3059\u3002\u5F53\u793E\u306F\u30B5\u30FC\u30D3\u30B9\u5185\u3067\u306E\u4E8B\u524D\u901A\u77E5\u3092\u3082\u3063\u3066\u624B\u6570\u6599\u3092\u5909\u66F4\u3059\u308B\u3053\u3068\u304C\u3042\u308A\u307E\u3059\u3002"
      ]
    },
    {
      heading: "6. \u7981\u6B62\u4E8B\u9805",
      body: [
        "\u30DE\u30CD\u30FC\u30ED\u30F3\u30C0\u30EA\u30F3\u30B0\u3001\u7981\u6B62\u3055\u308C\u3066\u3044\u308B\u6D3B\u52D5\u3078\u306E\u8CC7\u91D1\u4F9B\u4E0E\u3001\u5E02\u5834\u64CD\u4F5C\uFF08\u30B9\u30D7\u30FC\u30D5\u30A3\u30F3\u30B0\u3001\u4EEE\u88C5\u58F2\u8CB7\uFF09\u3001\u307E\u305F\u306F\u30D7\u30E9\u30C3\u30C8\u30D5\u30A9\u30FC\u30E0\u306E\u6280\u8853\u7684\u4FDD\u8B77\u63AA\u7F6E\u3092\u56DE\u907F\u3057\u3088\u3046\u3068\u3059\u308B\u884C\u70BA\u306B\u672C\u30B5\u30FC\u30D3\u30B9\u3092\u5229\u7528\u3059\u308B\u3053\u3068\u306F\u3067\u304D\u307E\u305B\u3093\u3002"
      ]
    },
    {
      heading: "7. \u505C\u6B62\u304A\u3088\u3073\u89E3\u7D04",
      body: [
        "\u5F53\u793E\u306F\u3001\u672C\u898F\u7D04\u3078\u306E\u9055\u53CD\u3001\u6CD5\u4EE4\u9075\u5B88\u3001\u307E\u305F\u306F\u4E0D\u6B63\u306E\u7591\u3044\u304C\u3042\u308B\u5834\u5408\u3001\u53EF\u80FD\u306A\u9650\u308A\u30E6\u30FC\u30B6\u30FC\u306B\u901A\u77E5\u3057\u305F\u4E0A\u3067\u3001\u30A2\u30AB\u30A6\u30F3\u30C8\u3092\u505C\u6B62\u307E\u305F\u306F\u9589\u9396\u3059\u308B\u3053\u3068\u304C\u3042\u308A\u307E\u3059\u3002"
      ]
    },
    {
      heading: "8. \u8CAC\u4EFB\u306E\u5236\u9650",
      body: [
        "\u672C\u30B5\u30FC\u30D3\u30B9\u306F\u300C\u73FE\u72B6\u6709\u59FF\u300D\u3067\u63D0\u4F9B\u3055\u308C\u307E\u3059\u3002\u5F53\u793E\u306F\u7D99\u7D9A\u7684\u306A\u7A3C\u50CD\u3092\u4FDD\u8A3C\u305B\u305A\u3001\u5E02\u5834\u306E\u30DC\u30E9\u30C6\u30A3\u30EA\u30C6\u30A3\u3001\u30CD\u30C3\u30C8\u30EF\u30FC\u30AF\u969C\u5BB3\u3001\u7B2C\u4E09\u8005\u306E\u884C\u70BA\u306B\u8D77\u56E0\u3059\u308B\u640D\u5931\u306B\u3064\u3044\u3066\u8CAC\u4EFB\u3092\u8CA0\u3044\u307E\u305B\u3093\u3002"
      ]
    },
    {
      heading: "9. \u672C\u898F\u7D04\u306E\u5909\u66F4",
      body: ["\u5F53\u793E\u306F\u672C\u898F\u7D04\u3092\u66F4\u65B0\u3059\u308B\u3053\u3068\u304C\u3042\u308A\u307E\u3059\u3002\u91CD\u8981\u306A\u5909\u66F4\u306F\u3001\u767A\u52B9\u306E\u5C11\u306A\u304F\u3068\u30827\u65E5\u524D\u306B\u30B5\u30FC\u30D3\u30B9\u5185\u3067\u544A\u77E5\u3055\u308C\u307E\u3059\u3002"]
    }
  ]
};
var JA_PRIVACY = {
  title: "\u30D7\u30E9\u30A4\u30D0\u30B7\u30FC\u30DD\u30EA\u30B7\u30FC",
  updated: "\u6700\u7D42\u66F4\u65B0\u65E5: 2026\u5E748\u670822\u65E5",
  intro: "\u672C\u30C9\u30AD\u30E5\u30E1\u30F3\u30C8\u3067\u306F\u3001\u5F53\u793E\u304C\u53CE\u96C6\u3059\u308B\u30C7\u30FC\u30BF\u3001\u305D\u306E\u7406\u7531\u3001\u304A\u3088\u3073\u4FDD\u8B77\u65B9\u6CD5\u306B\u3064\u3044\u3066\u8AAC\u660E\u3057\u307E\u3059\u3002",
  sections: [
    {
      heading: "1. \u53CE\u96C6\u3059\u308B\u30C7\u30FC\u30BF",
      body: [
        "\u767B\u9332\u30C7\u30FC\u30BF\uFF08\u30E1\u30FC\u30EB\u30A2\u30C9\u30EC\u30B9\u3001\u30CF\u30C3\u30B7\u30E5\u5316\u3055\u308C\u305F\u30D1\u30B9\u30EF\u30FC\u30C9\uFF09\u3001\u672C\u4EBA\u78BA\u8A8D\uFF08KYC\uFF09\u30C7\u30FC\u30BF\uFF08\u6C0F\u540D\u3001\u56FD\u3001\u8EAB\u5206\u8A3C\u660E\u66F8\uFF09\u3001\u53D6\u5F15\u304A\u3088\u3073\u30C8\u30E9\u30F3\u30B6\u30AF\u30B7\u30E7\u30F3\u5C65\u6B74\u3001\u30BB\u30AD\u30E5\u30EA\u30C6\u30A3\u76EE\u7684\u306E\u6280\u8853\u30C7\u30FC\u30BF\uFF08IP\u30A2\u30C9\u30EC\u30B9\u3001\u30C7\u30D0\u30A4\u30B9\u306E\u7A2E\u985E\uFF09\u3002"
      ]
    },
    {
      heading: "2. \u30C7\u30FC\u30BF\u306E\u5229\u7528\u65B9\u6CD5",
      body: [
        "\u30B5\u30FC\u30D3\u30B9\u306E\u63D0\u4F9B\u3001\u6CE8\u6587\u306E\u57F7\u884C\u3001\u5165\u51FA\u91D1\u306E\u51E6\u7406\u3001\u4E0D\u6B63\u9632\u6B62\u3001\u30DE\u30CD\u30FC\u30ED\u30F3\u30C0\u30EA\u30F3\u30B0\u5BFE\u7B56\uFF08AML/KYC\uFF09\u8981\u4EF6\u306E\u9075\u5B88\u306E\u305F\u3081\u306B\u5229\u7528\u3057\u307E\u3059\u3002"
      ]
    },
    {
      heading: "3. \u672C\u4EBA\u78BA\u8A8D\uFF08KYC\uFF09\u30C7\u30FC\u30BF",
      body: [
        "\u672C\u4EBA\u78BA\u8A8D\u306E\u305F\u3081\u306B\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\u3055\u308C\u305F\u66F8\u985E\u306F\u6697\u53F7\u5316\u3055\u308C\u3066\u4FDD\u7BA1\u3055\u308C\u3001\u5BE9\u67FB\u304A\u3088\u3073\u898F\u5236\u9075\u5B88\u306E\u76EE\u7684\u3067\u6A29\u9650\u3092\u6301\u3064\u30B9\u30BF\u30C3\u30D5\u306E\u307F\u304C\u30A2\u30AF\u30BB\u30B9\u3067\u304D\u307E\u3059\u3002"
      ]
    },
    {
      heading: "4. \u7B2C\u4E09\u8005\u3068\u306E\u5171\u6709",
      body: [
        "\u5F53\u793E\u306F\u500B\u4EBA\u30C7\u30FC\u30BF\u3092\u8CA9\u58F2\u3057\u307E\u305B\u3093\u3002\u30C7\u30FC\u30BF\u306F\u3001\u30B5\u30FC\u30D3\u30B9\u904B\u55B6\u306B\u5FC5\u8981\u306A\u7BC4\u56F2\u5185\u3067\u306E\u307F\u30A4\u30F3\u30D5\u30E9\u30D7\u30ED\u30D0\u30A4\u30C0\u30FC\uFF08\u30DB\u30B9\u30C6\u30A3\u30F3\u30B0\u3001\u6C7A\u6E08\u51E6\u7406\uFF09\u3068\u5171\u6709\u3055\u308C\u3001\u6B63\u5F53\u306A\u6CD5\u7684\u8981\u6C42\u304C\u3042\u3063\u305F\u5834\u5408\u306B\u306F\u5F53\u5C40\u3068\u5171\u6709\u3055\u308C\u308B\u3053\u3068\u304C\u3042\u308A\u307E\u3059\u3002"
      ]
    },
    {
      heading: "5. \u30C7\u30FC\u30BF\u30BB\u30AD\u30E5\u30EA\u30C6\u30A3",
      body: [
        "\u30D1\u30B9\u30EF\u30FC\u30C9\u306F\u5FA9\u5143\u4E0D\u53EF\u80FD\u306A\u6697\u53F7\u5B66\u7684\u30CF\u30C3\u30B7\u30E5\u3068\u3057\u3066\u4FDD\u7BA1\u3055\u308C\u307E\u3059\u3002API\u30AD\u30FC\u306E\u30B7\u30FC\u30AF\u30EC\u30C3\u30C8\u306F\u4FDD\u5B58\u6642\u306B\u6697\u53F7\u5316\u3055\u308C\u307E\u3059\u3002\u30A2\u30AB\u30A6\u30F3\u30C8\u306E\u3055\u3089\u306A\u308B\u4FDD\u8B77\u306E\u305F\u3081\u4E8C\u6BB5\u968E\u8A8D\u8A3C\u306B\u5BFE\u5FDC\u3057\u3066\u3044\u307E\u3059\u3002"
      ]
    },
    {
      heading: "6. \u304A\u5BA2\u69D8\u306E\u6A29\u5229",
      body: [
        "\u304A\u5BA2\u69D8\u306E\u30C7\u30FC\u30BF\u306E\u30B3\u30D4\u30FC\u306E\u8ACB\u6C42\u3001\u307E\u305F\u306F\u524A\u9664\u306E\u8ACB\u6C42\u304C\u53EF\u80FD\u3067\u3059\u3002\u305F\u3060\u3057\u3001\u6CD5\u4EE4\u306B\u3088\u308A\u4FDD\u6301\u304C\u7FA9\u52D9\u4ED8\u3051\u3089\u308C\u3066\u3044\u308B\u60C5\u5831\uFF08\u4F8B\uFF1A\u898F\u5B9A\u671F\u9593\u306EKYC/AML\u8A18\u9332\uFF09\u306F\u9664\u304D\u307E\u3059\u3002"
      ]
    },
    {
      heading: "7. \u30C7\u30FC\u30BF\u306E\u4FDD\u6301",
      body: [
        "\u30A2\u30AB\u30A6\u30F3\u30C8\u30C7\u30FC\u30BF\u306F\u30A2\u30AB\u30A6\u30F3\u30C8\u304C\u6709\u52B9\u3067\u3042\u308B\u9593\u4FDD\u6301\u3055\u308C\u307E\u3059\u3002\u89E3\u7D04\u5F8C\u3001\u6CD5\u4EE4\u3067\u5FC5\u8981\u306A\u30C7\u30FC\u30BF\uFF08\u30C8\u30E9\u30F3\u30B6\u30AF\u30B7\u30E7\u30F3\u3001KYC\uFF09\u306F\u898F\u5B9A\u306E\u671F\u9593\u4FDD\u6301\u3055\u308C\u3001\u305D\u308C\u4EE5\u5916\u306F\u524A\u9664\u3055\u308C\u307E\u3059\u3002"
      ]
    },
    {
      heading: "8. \u304A\u554F\u3044\u5408\u308F\u305B",
      body: ["\u30C7\u30FC\u30BF\u304A\u3088\u3073\u30D7\u30E9\u30A4\u30D0\u30B7\u30FC\u306B\u95A2\u3059\u308B\u3054\u8CEA\u554F\u306F\u3001\u30A2\u30AB\u30A6\u30F3\u30C8\u5185\u306E\u30B5\u30DD\u30FC\u30C8\u30BB\u30AF\u30B7\u30E7\u30F3\u304B\u3089\u304A\u9001\u308A\u3044\u305F\u3060\u3051\u307E\u3059\u3002"]
    }
  ]
};
var JA_ABOUT = {
  title: "\u4F1A\u793E\u6982\u8981",
  updated: "\u6700\u7D42\u66F4\u65B0\u65E5: 2026\u5E748\u670822\u65E5",
  intro: "VOLTEX\u306F\u3001\u73FE\u7269\u53D6\u5F15\u304A\u3088\u3073\u8A3C\u62E0\u91D1\u4ED8\u304D\u5148\u7269\u53D6\u5F15\u3001\u6307\u5024\u30FB\u6210\u884C\u30FB\u30B9\u30C8\u30C3\u30D7\u30FB\u30C6\u30A4\u30AF\u30D7\u30ED\u30D5\u30A3\u30C3\u30C8\u6CE8\u6587\u3001\u5BFE\u5FDC\u30CD\u30C3\u30C8\u30EF\u30FC\u30AF\u3067\u306E\u5165\u51FA\u91D1\u3092\u63D0\u4F9B\u3059\u308B\u6697\u53F7\u8CC7\u7523\u53D6\u5F15\u30D7\u30E9\u30C3\u30C8\u30D5\u30A9\u30FC\u30E0\u3067\u3059\u3002",
  sections: [
    {
      heading: "\u30DE\u30C3\u30C1\u30F3\u30B0\u30A8\u30F3\u30B8\u30F3",
      body: [
        "\u6CE8\u6587\u306F\u5F53\u793E\u72EC\u81EA\u306E\u4FA1\u683C\u30FB\u6642\u9593\u512A\u5148\u30DE\u30C3\u30C1\u30F3\u30B0\u30A8\u30F3\u30B8\u30F3\u306B\u3088\u3063\u3066\u51E6\u7406\u3055\u308C\u307E\u3059\u3002\u30DE\u30FC\u30B1\u30C3\u30C8\u30C7\u30FC\u30BF\uFF08\u4FA1\u683C\u3001\u30ED\u30FC\u30BD\u30AF\u8DB3\u3001\u677F\u60C5\u5831\uFF09\u306F\u5B9F\u969B\u306E\u53D6\u5F15\u6240\u304B\u3089\u30EA\u30A2\u30EB\u30BF\u30A4\u30E0\u3067\u914D\u4FE1\u3055\u308C\u307E\u3059\u3002"
      ]
    },
    {
      heading: "\u30A2\u30AB\u30A6\u30F3\u30C8\u30BB\u30AD\u30E5\u30EA\u30C6\u30A3",
      body: [
        "\u30D1\u30B9\u30EF\u30FC\u30C9\u306F\u5FA9\u5143\u4E0D\u53EF\u80FD\u306A\u6697\u53F7\u5B66\u7684\u30CF\u30C3\u30B7\u30E5\u3068\u3057\u3066\u4FDD\u7BA1\u3055\u308C\u3001API\u30AD\u30FC\u306E\u30B7\u30FC\u30AF\u30EC\u30C3\u30C8\u306F\u4FDD\u5B58\u6642\u306B\u6697\u53F7\u5316\u3055\u308C\u307E\u3059\u3002\u4E8C\u6BB5\u968E\u8A8D\u8A3C\u3068\u30ED\u30B0\u30A4\u30F3\u5C65\u6B74\u306F\u8A2D\u5B9A \u2192 \u30BB\u30AD\u30E5\u30EA\u30C6\u30A3\u3067\u3054\u5229\u7528\u3044\u305F\u3060\u3051\u307E\u3059\u3002"
      ]
    },
    {
      heading: "\u5148\u7269\u3068\u30EA\u30B9\u30AF\u7BA1\u7406",
      body: [
        "\u5206\u96E2\u8A3C\u62E0\u91D1\u3068\u30AF\u30ED\u30B9\u8A3C\u62E0\u91D1\u306B\u3088\u308B\u8A3C\u62E0\u91D1\u53D6\u5F15\u3001\u6BB5\u968E\u7684\u306A\u30EC\u30D0\u30EC\u30C3\u30B8\u5236\u9650\u3001\u5B9F\u969B\u306E\u30DE\u30FC\u30AF\u4FA1\u683C\u306B\u57FA\u3065\u304F\u81EA\u52D5\u6E05\u7B97\u3001\u6E05\u7B97\u6642\u306E\u4E0D\u8DB3\u5206\u306B\u5BFE\u3059\u308B\u4FDD\u967A\u57FA\u91D1\u3002"
      ]
    },
    {
      heading: "\u900F\u660E\u6027",
      body: [
        "\u691C\u8A3C\u4E0D\u53EF\u80FD\u306A\u53CE\u76CA\u3084\u53D6\u5F15\u91CF\u306E\u4E3B\u5F35\u306F\u516C\u958B\u3057\u307E\u305B\u3093\u3002\u624B\u6570\u6599\u3001\u9650\u5EA6\u984D\u3001\u898F\u7D04\u306F\u8A72\u5F53\u3059\u308B\u7B87\u6240\u3067\u30A4\u30F3\u30BF\u30FC\u30D5\u30A7\u30FC\u30B9\u4E0A\u306B\u8868\u793A\u3055\u308C\u307E\u3059 \u2014 \u5C0F\u3055\u306A\u6587\u5B57\u3067\u306F\u306A\u304F\u3001\u64CD\u4F5C\u3092\u78BA\u5B9A\u3059\u308B\u524D\u306B\u660E\u793A\u3057\u307E\u3059\u3002"
      ]
    }
  ]
};
var JA_SUPPORT = {
  title: "\u30B5\u30DD\u30FC\u30C8",
  updated: "\u6700\u7D42\u66F4\u65B0\u65E5: 2026\u5E748\u670822\u65E5",
  intro: "\u3088\u304F\u3042\u308B\u3054\u8CEA\u554F\u3078\u306E\u56DE\u7B54\u3067\u3059\u3002\u30A2\u30AB\u30A6\u30F3\u30C8\u56FA\u6709\u306E\u554F\u984C\u306B\u3064\u3044\u3066\u306F\u3001\u307E\u305A\u8A2D\u5B9A\u3092\u3054\u78BA\u8A8D\u304F\u3060\u3055\u3044\u3002",
  sections: [
    {
      heading: "\u5165\u91D1\u65B9\u6CD5",
      body: [
        "\u300C\u5165\u91D1\u300D\u3092\u958B\u304F \u2192 \u30CD\u30C3\u30C8\u30EF\u30FC\u30AF\u3092\u9078\u629E \u2192 \u8868\u793A\u3055\u308C\u305F\u30A2\u30C9\u30EC\u30B9\u306B\u8CC7\u91D1\u3092\u9001\u91D1 \u2192 \u30C8\u30E9\u30F3\u30B6\u30AF\u30B7\u30E7\u30F3\u30CF\u30C3\u30B7\u30E5\u3092\u8CBC\u308A\u4ED8\u3051\u3066\u78BA\u8A8D\u3057\u307E\u3059\u3002\u73FE\u5728\u306E\u7C73\u30C9\u30EB\u76F8\u5F53\u306E\u6700\u4F4E\u5165\u91D1\u984D\u306F\u5165\u91D1\u30D5\u30A9\u30FC\u30E0\u306B\u8868\u793A\u3055\u308C\u307E\u3059\u3002\u3053\u308C\u3092\u4E0B\u56DE\u308B\u91D1\u984D\u306F\u53CD\u6620\u3055\u308C\u307E\u305B\u3093\u3002"
      ]
    },
    {
      heading: "\u6CE8\u6587\u304C\u57F7\u884C\u3055\u308C\u307E\u305B\u3093",
      body: [
        "\u30B9\u30C8\u30C3\u30D7/\u30C6\u30A4\u30AF\u30D7\u30ED\u30D5\u30A3\u30C3\u30C8\u306E\u30C8\u30EA\u30AC\u30FC\u4FA1\u683C\u304C\u73FE\u5728\u306E\u5E02\u5834\u4FA1\u683C\u306B\u5BFE\u3057\u3066\u6B63\u3057\u3044\u5074\u306B\u3042\u308B\u304B\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044 \u2014 \u6CE8\u6587\u30D5\u30A9\u30FC\u30E0\u306B\u5FC5\u8981\u306A\u65B9\u5411\u304C\u8868\u793A\u3055\u308C\u307E\u3059\u3002\u4FDD\u7559\u4E2D\u306E\u6761\u4EF6\u4ED8\u304D\u6CE8\u6587\u306F\u30C8\u30EA\u30AC\u30FC\u3092\u5F85\u6A5F\u3057\u3066\u304A\u308A\u3001\u300C\u5F85\u6A5F\u4E2D\u300D\u30B9\u30C6\u30FC\u30BF\u30B9\u304C\u8868\u793A\u3055\u308C\u307E\u3059\u3002"
      ]
    },
    {
      heading: "\u30A2\u30AB\u30A6\u30F3\u30C8\u30BB\u30AD\u30E5\u30EA\u30C6\u30A3",
      body: [
        "\u4E8C\u6BB5\u968E\u8A8D\u8A3C\u3092\u6709\u52B9\u306B\u3057\u3001\u8A2D\u5B9A \u2192 \u30BB\u30AD\u30E5\u30EA\u30C6\u30A3\u3067\u5B9A\u671F\u7684\u306B\u30ED\u30B0\u30A4\u30F3\u5C65\u6B74\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044 \u2014 \u30A2\u30AB\u30A6\u30F3\u30C8\u3078\u306E\u3059\u3079\u3066\u306E\u30B5\u30A4\u30F3\u30A4\u30F3\u304C\u305D\u3053\u306B\u8868\u793A\u3055\u308C\u307E\u3059\u3002"
      ]
    },
    {
      heading: "\u672C\u4EBA\u78BA\u8A8D\uFF08KYC\uFF09",
      body: ["\u672C\u4EBA\u78BA\u8A8D\u306E\u30B9\u30C6\u30FC\u30BF\u30B9\u3068\u5FC5\u8981\u306A\u66F8\u985E\u306F\u3001\u30A2\u30AB\u30A6\u30F3\u30C8\u306E\u672C\u4EBA\u78BA\u8A8D\u30BB\u30AF\u30B7\u30E7\u30F3\u306B\u8868\u793A\u3055\u308C\u307E\u3059\u3002"]
    },
    {
      heading: "\u307E\u3060\u3054\u8CEA\u554F\u304C\u3042\u308B\u5834\u5408",
      body: ["\u672C\u30D7\u30E9\u30C3\u30C8\u30D5\u30A9\u30FC\u30E0\u306E\u73FE\u30D0\u30FC\u30B8\u30E7\u30F3\u306B\u306F\u307E\u3060\u30E9\u30A4\u30D6\u30B5\u30DD\u30FC\u30C8\u30C1\u30E3\u30CD\u30EB\u304C\u306A\u304F\u3001\u30B5\u30DD\u30FC\u30C8\u30BB\u30AF\u30B7\u30E7\u30F3\u306F\u3053\u306EFAQ\u30DA\u30FC\u30B8\u306B\u9650\u3089\u308C\u307E\u3059\u3002"]
    }
  ]
};
var JA_RISK = {
  title: "\u30EA\u30B9\u30AF\u958B\u793A",
  updated: "\u6700\u7D42\u66F4\u65B0\u65E5: 2026\u5E748\u670822\u65E5",
  intro: "\u6697\u53F7\u8CC7\u7523\u53D6\u5F15\u306B\u306F\u91CD\u5927\u306A\u30EA\u30B9\u30AF\u304C\u4F34\u3044\u307E\u3059\u3002\u53D6\u5F15\u3092\u884C\u3046\u524D\u306B\u3001\u4EE5\u4E0B\u306E\u30EA\u30B9\u30AF\u3092\u7406\u89E3\u3057\u3001\u53D7\u3051\u5165\u308C\u3066\u304F\u3060\u3055\u3044\u3002",
  sections: [
    {
      heading: "1. \u30DC\u30E9\u30C6\u30A3\u30EA\u30C6\u30A3",
      body: ["\u6697\u53F7\u8CC7\u7523\u306E\u4FA1\u683C\u306F\u77ED\u671F\u9593\u3067\u6025\u6FC0\u306B\u5909\u52D5\u3059\u308B\u3053\u3068\u304C\u3042\u308A\u307E\u3059\u3002\u8CC7\u7523\u306E\u4FA1\u5024\u306F\u5927\u5E45\u306B\u4E0A\u6607\u3059\u308B\u3053\u3068\u3082\u3001\u30BC\u30ED\u307E\u3067\u4E0B\u843D\u3059\u308B\u3053\u3068\u3082\u3042\u308A\u307E\u3059\u3002"]
    },
    {
      heading: "2. \u4FDD\u8A3C\u306A\u3057",
      body: ["\u904E\u53BB\u306E\u5B9F\u7E3E\u306F\u5C06\u6765\u306E\u7D50\u679C\u3092\u4FDD\u8A3C\u3059\u308B\u3082\u306E\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002VOLTEX\u306F\u53D6\u5F15\u5229\u76CA\u3092\u4FDD\u8A3C\u3057\u307E\u305B\u3093\u3002"]
    },
    {
      heading: "3. \u6295\u8CC7\u52A9\u8A00\u3067\u306F\u3042\u308A\u307E\u305B\u3093",
      body: [
        "\u30D7\u30E9\u30C3\u30C8\u30D5\u30A9\u30FC\u30E0\u4E0A\u306E\u60C5\u5831\uFF08\u4FA1\u683C\u3001\u30C1\u30E3\u30FC\u30C8\u3001\u7D71\u8A08\uFF09\u306F\u60C5\u5831\u63D0\u4F9B\u306E\u307F\u3092\u76EE\u7684\u3068\u3057\u3066\u304A\u308A\u3001\u6295\u8CC7\u3001\u7A0E\u52D9\u3001\u307E\u305F\u306F\u6CD5\u5F8B\u306B\u95A2\u3059\u308B\u52A9\u8A00\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002"
      ]
    },
    {
      heading: "4. \u6210\u884C\u6CE8\u6587\u306E\u30EA\u30B9\u30AF",
      body: ["\u6210\u884C\u6CE8\u6587\u306F\u6700\u826F\u4FA1\u683C\u3067\u57F7\u884C\u3055\u308C\u307E\u3059\u304C\u3001\u7279\u306B\u6D41\u52D5\u6027\u304C\u8584\u3044\u5834\u5408\u3084\u9AD8\u3044\u30DC\u30E9\u30C6\u30A3\u30EA\u30C6\u30A3\u306E\u4E0B\u3067\u306F\u30B9\u30EA\u30C3\u30DA\u30FC\u30B8\u304C\u767A\u751F\u3059\u308B\u3053\u3068\u304C\u3042\u308A\u307E\u3059\u3002"]
    },
    {
      heading: "5. \u6280\u8853\u7684\u30EA\u30B9\u30AF",
      body: ["\u30CD\u30C3\u30C8\u30EF\u30FC\u30AF\u969C\u5BB3\u3001\u30D6\u30ED\u30C3\u30AF\u30C1\u30A7\u30FC\u30F3\u306E\u9045\u5EF6\u3001\u307E\u305F\u306F\u6280\u8853\u7684\u306A\u4E0D\u5177\u5408\u304C\u6CE8\u6587\u306E\u57F7\u884C\u3084\u30B5\u30FC\u30D3\u30B9\u306E\u5229\u7528\u53EF\u80FD\u6027\u306B\u5F71\u97FF\u3092\u53CA\u307C\u3059\u3053\u3068\u304C\u3042\u308A\u307E\u3059\u3002"]
    },
    {
      heading: "6. \u898F\u5236\u30EA\u30B9\u30AF",
      body: ["\u6697\u53F7\u8CC7\u7523\u306E\u6CD5\u7684\u5730\u4F4D\u306F\u7BA1\u8F44\u533A\u57DF\u306B\u3088\u3063\u3066\u7570\u306A\u308A\u3001\u5909\u5316\u3059\u308B\u53EF\u80FD\u6027\u304C\u3042\u308A\u3001\u30B5\u30FC\u30D3\u30B9\u306E\u5229\u7528\u53EF\u80FD\u6027\u306B\u5F71\u97FF\u3092\u4E0E\u3048\u308B\u3053\u3068\u304C\u3042\u308A\u307E\u3059\u3002"]
    },
    {
      heading: "7. \u53D6\u5F15\u306E\u4E0D\u53EF\u9006\u6027",
      body: ["\u30AA\u30F3\u30C1\u30A7\u30FC\u30F3\u306E\u9001\u91D1\u306F\u4E00\u822C\u7684\u306B\u53D6\u308A\u6D88\u3057\u3067\u304D\u307E\u305B\u3093\u3002\u8CC7\u91D1\u3092\u51FA\u91D1\u3059\u308B\u524D\u306B\u3001\u30A2\u30C9\u30EC\u30B9\u3068\u30CD\u30C3\u30C8\u30EF\u30FC\u30AF\u3092\u5341\u5206\u306B\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002"]
    },
    {
      heading: "8. \u78BA\u8A8D\u4E8B\u9805",
      body: ["VOLTEX\u3092\u5229\u7528\u3057\u3066\u53D6\u5F15\u3092\u884C\u3046\u3053\u3068\u306B\u3088\u308A\u3001\u4E0A\u8A18\u306E\u30EA\u30B9\u30AF\u3092\u7406\u89E3\u3057\u3001\u81EA\u5DF1\u8CAC\u4EFB\u3067\u53D6\u5F15\u3092\u884C\u3046\u3053\u3068\u3092\u78BA\u8A8D\u3057\u305F\u3082\u306E\u3068\u307F\u306A\u3055\u308C\u307E\u3059\u3002"]
    }
  ]
};
var KO_TERMS = {
  title: "\uC774\uC6A9\uC57D\uAD00",
  updated: "\uCD5C\uC885 \uC5C5\uB370\uC774\uD2B8: 2026\uB144 8\uC6D4 22\uC77C",
  intro: "\uBCF8 \uC57D\uAD00\uC740 VOLTEX \uD50C\uB7AB\uD3FC \uC774\uC6A9\uC5D0 \uC801\uC6A9\uB429\uB2C8\uB2E4. \uAC00\uC785 \uB610\uB294 \uC11C\uBE44\uC2A4 \uC774\uC6A9 \uC2DC \uC544\uB798 \uB0B4\uC6A9\uC744 \uC77D\uACE0 \uB3D9\uC758\uD55C \uAC83\uC73C\uB85C \uAC04\uC8FC\uB429\uB2C8\uB2E4.",
  sections: [
    {
      heading: "1. \uC11C\uBE44\uC2A4 \uC18C\uAC1C",
      body: [
        "VOLTEX\uB294 \uC9C0\uC815\uAC00 \uBC0F \uC2DC\uC7A5\uAC00 \uC8FC\uBB38 \uC2E4\uD589, \uB0B4\uBD80 \uC9C0\uAC11\uC744 \uD1B5\uD55C \uC790\uC0B0 \uBCF4\uAD00, \uC9C0\uC6D0 \uB124\uD2B8\uC6CC\uD06C\uB97C \uD1B5\uD55C \uC785\uCD9C\uAE08\uC774 \uAC00\uB2A5\uD55C \uC554\uD638\uD654\uD3D0 \uAC70\uB798 \uD50C\uB7AB\uD3FC\uC785\uB2C8\uB2E4."
      ]
    },
    {
      heading: "2. \uC774\uC6A9 \uC790\uACA9",
      body: [
        "\uBCF8 \uC11C\uBE44\uC2A4\uB294 \uB9CC 18\uC138 \uC774\uC0C1\uC758 \uBC95\uC801 \uD589\uC704 \uB2A5\uB825\uC744 \uAC16\uCD98 \uC790\uC5D0\uAC8C\uB9CC \uC81C\uACF5\uB429\uB2C8\uB2E4. \uAC00\uC785 \uC2DC, \uADC0\uD558\uC758 \uAD00\uD560 \uC9C0\uC5ED\uC5D0\uC11C \uC554\uD638\uD654\uD3D0 \uC11C\uBE44\uC2A4 \uC774\uC6A9\uC774 \uAE08\uC9C0\uB418\uC5B4 \uC788\uC9C0 \uC54A\uC74C\uC744 \uD655\uC778\uD55C \uAC83\uC73C\uB85C \uAC04\uC8FC\uB429\uB2C8\uB2E4."
      ]
    },
    {
      heading: "3. \uACC4\uC815 \uBC0F \uBCF4\uC548",
      body: [
        "\uBE44\uBC00\uBC88\uD638\uB97C \uC548\uC804\uD558\uAC8C \uBCF4\uAD00\uD558\uACE0, \uD65C\uC131\uD654\uB41C \uACBD\uC6B0 2\uB2E8\uACC4 \uC778\uC99D \uC815\uBCF4\uB97C \uBCF4\uD638\uD560 \uCC45\uC784\uC740 \uADC0\uD558\uC5D0\uAC8C \uC788\uC2B5\uB2C8\uB2E4. \uC124\uC815 \u2192 \uBCF4\uC548\uC5D0\uC11C 2FA\uB97C \uD65C\uC131\uD654\uD560 \uAC83\uC744 \uAC15\uB825\uD788 \uAD8C\uC7A5\uD569\uB2C8\uB2E4.",
        "\uACC4\uC815\uC5D0 \uBB34\uB2E8 \uC811\uADFC\uC774 \uC758\uC2EC\uB418\uB294 \uACBD\uC6B0 \uC989\uC2DC \uB2F9\uC0AC\uC5D0 \uC54C\uB824\uC8FC\uC2DC\uAE30 \uBC14\uB78D\uB2C8\uB2E4."
      ]
    },
    {
      heading: "4. \uC8FC\uBB38 \uBC0F \uCCB4\uACB0",
      body: [
        "\uC8FC\uBB38\uC740 \uAC00\uACA9-\uC2DC\uAC04 \uC6B0\uC120 \uC6D0\uCE59\uC5D0 \uB530\uB77C \uAC70\uB798 \uC5D4\uC9C4\uC5D0\uC11C \uB9E4\uCE6D\uB429\uB2C8\uB2E4. \uC2DC\uC7A5\uAC00 \uC8FC\uBB38\uC740 \uBC1C\uC8FC \uC2DC\uC810\uC758 \uD638\uAC00\uCC3D\uC5D0\uC11C \uC774\uC6A9 \uAC00\uB2A5\uD55C \uCD5C\uC801 \uAC00\uACA9\uC73C\uB85C \uCCB4\uACB0\uB418\uBA70, \uC720\uB3D9\uC131\uC774 \uB0AE\uC744 \uACBD\uC6B0 \uC2AC\uB9AC\uD53C\uC9C0\uAC00 \uBC1C\uC0DD\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4."
      ]
    },
    {
      heading: "5. \uC218\uC218\uB8CC",
      body: [
        "\uD604\uC7AC \uAC70\uB798 \uC218\uC218\uB8CC\uB294 \uAC70\uB798\uB97C \uD655\uC815\uD558\uAE30 \uC804\uC5D0 \uC778\uD130\uD398\uC774\uC2A4\uC5D0 \uD45C\uC2DC\uB429\uB2C8\uB2E4. \uB2F9\uC0AC\uB294 \uC11C\uBE44\uC2A4 \uB0B4 \uC0AC\uC804 \uACF5\uC9C0\uB97C \uD1B5\uD574 \uC218\uC218\uB8CC\uB97C \uBCC0\uACBD\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4."
      ]
    },
    {
      heading: "6. \uAE08\uC9C0\uB41C \uC774\uC6A9",
      body: [
        "\uC790\uAE08 \uC138\uD0C1, \uAE08\uC9C0\uB41C \uD65C\uB3D9\uC5D0 \uB300\uD55C \uC790\uAE08 \uC870\uB2EC, \uC2DC\uC7A5 \uC870\uC791(\uC2A4\uD478\uD551, \uC790\uC804\uAC70\uB798), \uB610\uB294 \uD50C\uB7AB\uD3FC\uC758 \uAE30\uC220\uC801 \uBCF4\uD638 \uC7A5\uCE58\uB97C \uC6B0\uD68C\uD558\uB824\uB294 \uC2DC\uB3C4\uC5D0 \uBCF8 \uC11C\uBE44\uC2A4\uB97C \uC774\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4."
      ]
    },
    {
      heading: "7. \uC815\uC9C0 \uBC0F \uD574\uC9C0",
      body: [
        "\uB2F9\uC0AC\uB294 \uBCF8 \uC57D\uAD00 \uC704\uBC18, \uBC95\uB839 \uC900\uC218, \uB610\uB294 \uC0AC\uAE30 \uC758\uC2EC \uC2DC \uAC00\uB2A5\uD55C \uACBD\uC6B0 \uC0AC\uC6A9\uC790\uC5D0\uAC8C \uD1B5\uC9C0\uD55C \uD6C4 \uACC4\uC815\uC744 \uC815\uC9C0\uD558\uAC70\uB098 \uD3D0\uC1C4\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4."
      ]
    },
    {
      heading: "8. \uCC45\uC784\uC758 \uC81C\uD55C",
      body: [
        '\uBCF8 \uC11C\uBE44\uC2A4\uB294 "\uC788\uB294 \uADF8\uB300\uB85C" \uC81C\uACF5\uB429\uB2C8\uB2E4. \uB2F9\uC0AC\uB294 \uC911\uB2E8 \uC5C6\uB294 \uC6B4\uC601\uC744 \uBCF4\uC7A5\uD558\uC9C0 \uC54A\uC73C\uBA70, \uC2DC\uC7A5 \uBCC0\uB3D9\uC131, \uB124\uD2B8\uC6CC\uD06C \uC7A5\uC560 \uB610\uB294 \uC81C3\uC790\uC758 \uD589\uC704\uB85C \uC778\uD55C \uC190\uC2E4\uC5D0 \uB300\uD574 \uCC45\uC784\uC9C0\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.'
      ]
    },
    {
      heading: "9. \uBCF8 \uC57D\uAD00\uC758 \uBCC0\uACBD",
      body: ["\uB2F9\uC0AC\uB294 \uBCF8 \uC57D\uAD00\uC744 \uC5C5\uB370\uC774\uD2B8\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4. \uC911\uB300\uD55C \uBCC0\uACBD \uC0AC\uD56D\uC740 \uBC1C\uD6A8 \uCD5C\uC18C 7\uC77C \uC804\uC5D0 \uC11C\uBE44\uC2A4 \uB0B4\uC5D0\uC11C \uACF5\uC9C0\uB429\uB2C8\uB2E4."]
    }
  ]
};
var KO_PRIVACY = {
  title: "\uAC1C\uC778\uC815\uBCF4 \uBCF4\uD638\uC815\uCC45",
  updated: "\uCD5C\uC885 \uC5C5\uB370\uC774\uD2B8: 2026\uB144 8\uC6D4 22\uC77C",
  intro: "\uBCF8 \uBB38\uC11C\uB294 \uB2F9\uC0AC\uAC00 \uC218\uC9D1\uD558\uB294 \uB370\uC774\uD130, \uADF8 \uC774\uC720, \uADF8\uB9AC\uACE0 \uBCF4\uD638 \uBC29\uBC95\uC744 \uC124\uBA85\uD569\uB2C8\uB2E4.",
  sections: [
    {
      heading: "1. \uC218\uC9D1\uD558\uB294 \uB370\uC774\uD130",
      body: [
        "\uAC00\uC785 \uB370\uC774\uD130(\uC774\uBA54\uC77C, \uD574\uC2DC \uCC98\uB9AC\uB41C \uBE44\uBC00\uBC88\uD638), \uBCF8\uC778 \uC778\uC99D(KYC) \uB370\uC774\uD130(\uC774\uB984, \uAD6D\uAC00, \uC2E0\uBD84\uC99D), \uAC70\uB798 \uBC0F \uD2B8\uB79C\uC7AD\uC158 \uB0B4\uC5ED, \uBCF4\uC548 \uBAA9\uC801\uC758 \uAE30\uC220 \uB370\uC774\uD130(IP \uC8FC\uC18C, \uAE30\uAE30 \uC720\uD615)."
      ]
    },
    {
      heading: "2. \uB370\uC774\uD130 \uC774\uC6A9 \uBC29\uBC95",
      body: [
        "\uC11C\uBE44\uC2A4 \uC81C\uACF5, \uC8FC\uBB38 \uC2E4\uD589, \uC785\uCD9C\uAE08 \uCC98\uB9AC, \uC0AC\uAE30 \uBC29\uC9C0, \uC790\uAE08\uC138\uD0C1\uBC29\uC9C0(AML/KYC) \uC694\uAC74 \uC900\uC218\uB97C \uC704\uD574 \uC0AC\uC6A9\uB429\uB2C8\uB2E4."
      ]
    },
    {
      heading: "3. \uBCF8\uC778 \uC778\uC99D(KYC) \uB370\uC774\uD130",
      body: [
        "\uBCF8\uC778 \uC778\uC99D\uC744 \uC704\uD574 \uC5C5\uB85C\uB4DC\uB41C \uC11C\uB958\uB294 \uC554\uD638\uD654\uB418\uC5B4 \uC800\uC7A5\uB418\uBA70, \uC2EC\uC0AC \uBC0F \uADDC\uC81C \uC900\uC218 \uBAA9\uC801\uC73C\uB85C \uC2B9\uC778\uB41C \uC9C1\uC6D0\uB9CC \uC811\uADFC\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4."
      ]
    },
    {
      heading: "4. \uC81C3\uC790\uC640\uC758 \uACF5\uC720",
      body: [
        "\uB2F9\uC0AC\uB294 \uAC1C\uC778 \uB370\uC774\uD130\uB97C \uD310\uB9E4\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uB370\uC774\uD130\uB294 \uC11C\uBE44\uC2A4 \uC6B4\uC601\uC5D0 \uD544\uC694\uD55C \uBC94\uC704 \uB0B4\uC5D0\uC11C\uB9CC \uC778\uD504\uB77C \uC81C\uACF5\uC5C5\uCCB4(\uD638\uC2A4\uD305, \uACB0\uC81C \uCC98\uB9AC)\uC640 \uACF5\uC720\uB420 \uC218 \uC788\uC73C\uBA70, \uC815\uB2F9\uD55C \uBC95\uC801 \uC694\uCCAD\uC774 \uC788\uB294 \uACBD\uC6B0 \uAD00\uACC4 \uB2F9\uAD6D\uACFC \uACF5\uC720\uB420 \uC218 \uC788\uC2B5\uB2C8\uB2E4."
      ]
    },
    {
      heading: "5. \uB370\uC774\uD130 \uBCF4\uC548",
      body: [
        "\uBE44\uBC00\uBC88\uD638\uB294 \uBCF5\uD638\uD654\uAC00 \uBD88\uAC00\uB2A5\uD55C \uC554\uD638\uD654 \uD574\uC2DC\uB85C \uC800\uC7A5\uB429\uB2C8\uB2E4. API \uD0A4 \uC2DC\uD06C\uB9BF\uC740 \uC800\uC7A5 \uC2DC \uC554\uD638\uD654\uB429\uB2C8\uB2E4. \uACC4\uC815 \uBCF4\uD638 \uAC15\uD654\uB97C \uC704\uD574 2\uB2E8\uACC4 \uC778\uC99D\uC744 \uC9C0\uC6D0\uD569\uB2C8\uB2E4."
      ]
    },
    {
      heading: "6. \uADC0\uD558\uC758 \uAD8C\uB9AC",
      body: [
        "\uADC0\uD558\uC758 \uB370\uC774\uD130 \uC0AC\uBCF8\uC744 \uC694\uCCAD\uD558\uAC70\uB098 \uC0AD\uC81C\uB97C \uC694\uCCAD\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4. \uB2E8, \uBC95\uC801\uC73C\uB85C \uBCF4\uAD00\uC774 \uC758\uBB34\uD654\uB41C \uC815\uBCF4(\uC608: \uADDC\uC815\uB41C \uAE30\uAC04 \uB3D9\uC548\uC758 KYC/AML \uAE30\uB85D)\uB294 \uC81C\uC678\uB429\uB2C8\uB2E4."
      ]
    },
    {
      heading: "7. \uB370\uC774\uD130 \uBCF4\uAD00",
      body: [
        "\uACC4\uC815 \uB370\uC774\uD130\uB294 \uACC4\uC815\uC774 \uD65C\uC131 \uC0C1\uD0DC\uC778 \uB3D9\uC548 \uBCF4\uAD00\uB429\uB2C8\uB2E4. \uACC4\uC815 \uD574\uC9C0 \uD6C4, \uBC95\uC801\uC73C\uB85C \uC694\uAD6C\uB418\uB294 \uB370\uC774\uD130(\uD2B8\uB79C\uC7AD\uC158, KYC)\uB294 \uADDC\uC815\uB41C \uAE30\uAC04 \uB3D9\uC548 \uBCF4\uAD00\uB418\uBA70 \uB098\uBA38\uC9C0\uB294 \uC0AD\uC81C\uB429\uB2C8\uB2E4."
      ]
    },
    {
      heading: "8. \uBB38\uC758",
      body: ["\uB370\uC774\uD130 \uBC0F \uAC1C\uC778\uC815\uBCF4 \uBCF4\uD638\uC5D0 \uAD00\uD55C \uC9C8\uBB38\uC740 \uACC4\uC815 \uB0B4 \uACE0\uAC1D\uC13C\uD130 \uC139\uC158\uC744 \uD1B5\uD574 \uBCF4\uB0B4\uC2E4 \uC218 \uC788\uC2B5\uB2C8\uB2E4."]
    }
  ]
};
var KO_ABOUT = {
  title: "\uD68C\uC0AC \uC18C\uAC1C",
  updated: "\uCD5C\uC885 \uC5C5\uB370\uC774\uD2B8: 2026\uB144 8\uC6D4 22\uC77C",
  intro: "VOLTEX\uB294 \uD604\uBB3C \uBC0F \uC99D\uAC70\uAE08 \uC120\uBB3C \uAC70\uB798, \uC9C0\uC815\uAC00\xB7\uC2DC\uC7A5\uAC00\xB7\uC2A4\uD0D1\xB7\uC775\uC808 \uC8FC\uBB38, \uC9C0\uC6D0 \uB124\uD2B8\uC6CC\uD06C\uB97C \uD1B5\uD55C \uC785\uCD9C\uAE08\uC744 \uC81C\uACF5\uD558\uB294 \uC554\uD638\uD654\uD3D0 \uAC70\uB798 \uD50C\uB7AB\uD3FC\uC785\uB2C8\uB2E4.",
  sections: [
    {
      heading: "\uB9E4\uCE6D \uC5D4\uC9C4",
      body: [
        "\uC8FC\uBB38\uC740 \uB2F9\uC0AC \uC790\uCCB4\uC758 \uAC00\uACA9-\uC2DC\uAC04 \uB9E4\uCE6D \uC5D4\uC9C4\uC5D0 \uC758\uD574 \uB9E4\uCE6D\uB429\uB2C8\uB2E4. \uB9C8\uCF13 \uB370\uC774\uD130(\uAC00\uACA9, \uCE94\uB4E4, \uD638\uAC00\uCC3D)\uB294 \uC2E4\uC81C \uAC70\uB798\uC18C\uC5D0\uC11C \uC2E4\uC2DC\uAC04\uC73C\uB85C \uC81C\uACF5\uB429\uB2C8\uB2E4."
      ]
    },
    {
      heading: "\uACC4\uC815 \uBCF4\uC548",
      body: [
        "\uBE44\uBC00\uBC88\uD638\uB294 \uBCF5\uD638\uD654\uAC00 \uBD88\uAC00\uB2A5\uD55C \uC554\uD638\uD654 \uD574\uC2DC\uB85C \uC800\uC7A5\uB418\uBA70, API \uD0A4 \uC2DC\uD06C\uB9BF\uC740 \uC800\uC7A5 \uC2DC \uC554\uD638\uD654\uB429\uB2C8\uB2E4. 2\uB2E8\uACC4 \uC778\uC99D\uACFC \uB85C\uADF8\uC778 \uB0B4\uC5ED\uC740 \uC124\uC815 \u2192 \uBCF4\uC548\uC5D0\uC11C \uC774\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4."
      ]
    },
    {
      heading: "\uC120\uBB3C \uBC0F \uC704\uD5D8 \uAD00\uB9AC",
      body: [
        "\uACA9\uB9AC \uBC0F \uAD50\uCC28 \uC99D\uAC70\uAE08\uC744 \uD1B5\uD55C \uB9C8\uC9C4 \uAC70\uB798, \uB2E8\uACC4\uBCC4 \uB808\uBC84\uB9AC\uC9C0 \uD55C\uB3C4, \uC2E4\uC81C \uB9C8\uD06C \uAC00\uACA9 \uAE30\uC900 \uC790\uB3D9 \uCCAD\uC0B0, \uCCAD\uC0B0 \uC2DC \uBD80\uC871\uBD84\uC5D0 \uB300\uD55C \uBCF4\uD5D8 \uAE30\uAE08."
      ]
    },
    {
      heading: "\uD22C\uBA85\uC131",
      body: [
        "\uAC80\uC99D\uD560 \uC218 \uC5C6\uB294 \uC218\uC775\uB960\uC774\uB098 \uAC70\uB798\uB7C9 \uC8FC\uC7A5\uC744 \uAC8C\uC2DC\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uC218\uC218\uB8CC, \uD55C\uB3C4, \uC57D\uAD00\uC740 \uD574\uB2F9\uB418\uB294 \uACF3\uC5D0 \uC778\uD130\uD398\uC774\uC2A4\uC5D0 \uD45C\uC2DC\uB429\uB2C8\uB2E4 \u2014 \uC791\uC740 \uAE00\uC528\uAC00 \uC544\uB2C8\uB77C \uC791\uC5C5\uC744 \uD655\uC815\uD558\uAE30 \uC804\uC5D0 \uBA85\uD655\uD788 \uC548\uB0B4\uB429\uB2C8\uB2E4."
      ]
    }
  ]
};
var KO_SUPPORT = {
  title: "\uACE0\uAC1D\uC13C\uD130",
  updated: "\uCD5C\uC885 \uC5C5\uB370\uC774\uD2B8: 2026\uB144 8\uC6D4 22\uC77C",
  intro: "\uC790\uC8FC \uBB3B\uB294 \uC9C8\uBB38\uC5D0 \uB300\uD55C \uB2F5\uBCC0\uC785\uB2C8\uB2E4. \uACC4\uC815\uACFC \uAD00\uB828\uB41C \uD2B9\uC815 \uBB38\uC81C\uB294 \uBA3C\uC800 \uC124\uC815\uC744 \uD655\uC778\uD574 \uC8FC\uC138\uC694.",
  sections: [
    {
      heading: "\uC785\uAE08 \uBC29\uBC95",
      body: [
        '"\uC785\uAE08"\uC744 \uC5F4\uAE30 \u2192 \uB124\uD2B8\uC6CC\uD06C \uC120\uD0DD \u2192 \uD45C\uC2DC\uB41C \uC8FC\uC18C\uB85C \uC790\uAE08 \uC804\uC1A1 \u2192 \uD2B8\uB79C\uC7AD\uC158 \uD574\uC2DC\uB97C \uBD99\uC5EC\uB123\uC5B4 \uD655\uC778\uD569\uB2C8\uB2E4. \uD604\uC7AC USD \uC0C1\uB2F9 \uCD5C\uC18C \uC785\uAE08\uC561\uC740 \uC785\uAE08 \uC591\uC2DD\uC5D0 \uD45C\uC2DC\uB418\uBA70, \uC774\uBCF4\uB2E4 \uC801\uC740 \uAE08\uC561\uC740 \uC785\uAE08 \uCC98\uB9AC\uB418\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.'
      ]
    },
    {
      heading: "\uC8FC\uBB38\uC774 \uCCB4\uACB0\uB418\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4",
      body: [
        '\uC2A4\uD0D1/\uC775\uC808 \uD2B8\uB9AC\uAC70 \uAC00\uACA9\uC774 \uD604\uC7AC \uC2DC\uC7A5 \uAC00\uACA9\uC758 \uC62C\uBC14\uB978 \uBC29\uD5A5\uC5D0 \uC788\uB294\uC9C0 \uD655\uC778\uD558\uC138\uC694 \u2014 \uC8FC\uBB38 \uC591\uC2DD\uC5D0 \uD544\uC694\uD55C \uBC29\uD5A5\uC774 \uD45C\uC2DC\uB429\uB2C8\uB2E4. \uB300\uAE30 \uC911\uC778 \uC870\uAC74\uBD80 \uC8FC\uBB38\uC740 \uD2B8\uB9AC\uAC70\uB97C \uAE30\uB2E4\uB9AC\uBA70 "\uB300\uAE30 \uC911" \uC0C1\uD0DC\uB85C \uD45C\uC2DC\uB429\uB2C8\uB2E4.'
      ]
    },
    {
      heading: "\uACC4\uC815 \uBCF4\uC548",
      body: [
        "2\uB2E8\uACC4 \uC778\uC99D\uC744 \uCF1C\uACE0 \uC124\uC815 \u2192 \uBCF4\uC548\uC5D0\uC11C \uB85C\uADF8\uC778 \uB0B4\uC5ED\uC744 \uC8FC\uAE30\uC801\uC73C\uB85C \uD655\uC778\uD558\uC138\uC694 \u2014 \uACC4\uC815\uC5D0 \uB300\uD55C \uBAA8\uB4E0 \uB85C\uADF8\uC778\uC774 \uADF8\uACF3\uC5D0 \uD45C\uC2DC\uB429\uB2C8\uB2E4."
      ]
    },
    {
      heading: "\uBCF8\uC778 \uC778\uC99D(KYC)",
      body: ["\uADC0\uD558\uC758 \uC778\uC99D \uC0C1\uD0DC\uC640 \uD544\uC694\uD55C \uC11C\uB958\uB294 \uACC4\uC815\uC758 \uC778\uC99D \uC139\uC158\uC5D0 \uD45C\uC2DC\uB429\uB2C8\uB2E4."]
    },
    {
      heading: "\uB354 \uAD81\uAE08\uD55C \uC810\uC774 \uC788\uC73C\uC2E0\uAC00\uC694",
      body: ["\uBCF8 \uD50C\uB7AB\uD3FC\uC758 \uD604\uC7AC \uBC84\uC804\uC5D0\uB294 \uC544\uC9C1 \uC2E4\uC2DC\uAC04 \uACE0\uAC1D\uC13C\uD130 \uCC44\uB110\uC774 \uC5C6\uC73C\uBA70, \uACE0\uAC1D\uC13C\uD130 \uC139\uC158\uC740 \uC774 FAQ \uD398\uC774\uC9C0\uB85C \uC81C\uD55C\uB429\uB2C8\uB2E4."]
    }
  ]
};
var KO_RISK = {
  title: "\uC704\uD5D8 \uACE0\uC9C0",
  updated: "\uCD5C\uC885 \uC5C5\uB370\uC774\uD2B8: 2026\uB144 8\uC6D4 22\uC77C",
  intro: "\uC554\uD638\uD654\uD3D0 \uAC70\uB798\uC5D0\uB294 \uC0C1\uB2F9\uD55C \uC704\uD5D8\uC774 \uB530\uB985\uB2C8\uB2E4. \uAC70\uB798\uD558\uAE30 \uC804\uC5D0 \uC544\uB798 \uC704\uD5D8\uC744 \uC774\uD574\uD558\uACE0 \uC218\uB77D\uD588\uB294\uC9C0 \uD655\uC778\uD558\uC138\uC694.",
  sections: [
    {
      heading: "1. \uBCC0\uB3D9\uC131",
      body: ["\uC554\uD638\uD654\uD3D0 \uAC00\uACA9\uC740 \uC9E7\uC740 \uAE30\uAC04\uC5D0 \uAE09\uACA9\uD788 \uBCC0\uB3D9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4. \uC790\uC0B0 \uAC00\uCE58\uB294 \uD06C\uAC8C \uC0C1\uC2B9\uD558\uAC70\uB098 0\uAE4C\uC9C0 \uD558\uB77D\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4."]
    },
    {
      heading: "2. \uBCF4\uC7A5 \uC5C6\uC74C",
      body: ["\uACFC\uAC70 \uC2E4\uC801\uC774 \uBBF8\uB798 \uACB0\uACFC\uB97C \uBCF4\uC7A5\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. VOLTEX\uB294 \uAC70\uB798 \uC218\uC775\uC744 \uBCF4\uC7A5\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4."]
    },
    {
      heading: "3. \uD22C\uC790 \uC790\uBB38\uC774 \uC544\uB2D8",
      body: [
        "\uD50C\uB7AB\uD3FC\uC5D0 \uC81C\uACF5\uB418\uB294 \uC815\uBCF4(\uAC00\uACA9, \uCC28\uD2B8, \uD1B5\uACC4)\uB294 \uC815\uBCF4 \uC81C\uACF5 \uBAA9\uC801\uC73C\uB85C\uB9CC \uC81C\uACF5\uB418\uBA70 \uD22C\uC790, \uC138\uBB34 \uB610\uB294 \uBC95\uB960 \uC790\uBB38\uC774 \uC544\uB2D9\uB2C8\uB2E4."
      ]
    },
    {
      heading: "4. \uC2DC\uC7A5\uAC00 \uC8FC\uBB38 \uC704\uD5D8",
      body: ["\uC2DC\uC7A5\uAC00 \uC8FC\uBB38\uC740 \uC774\uC6A9 \uAC00\uB2A5\uD55C \uCD5C\uC801 \uAC00\uACA9\uC73C\uB85C \uCCB4\uACB0\uB418\uBA70, \uD2B9\uD788 \uC720\uB3D9\uC131\uC774 \uB0AE\uAC70\uB098 \uBCC0\uB3D9\uC131\uC774 \uB192\uC744 \uB54C \uC2AC\uB9AC\uD53C\uC9C0\uAC00 \uBC1C\uC0DD\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4."]
    },
    {
      heading: "5. \uAE30\uC220\uC801 \uC704\uD5D8",
      body: ["\uB124\uD2B8\uC6CC\uD06C \uC7A5\uC560, \uBE14\uB85D\uCCB4\uC778 \uC9C0\uC5F0 \uB610\uB294 \uAE30\uC220\uC801 \uACB0\uD568\uC774 \uC8FC\uBB38 \uCCB4\uACB0\uC774\uB098 \uC11C\uBE44\uC2A4 \uC774\uC6A9 \uAC00\uB2A5\uC131\uC5D0 \uC601\uD5A5\uC744 \uC904 \uC218 \uC788\uC2B5\uB2C8\uB2E4."]
    },
    {
      heading: "6. \uADDC\uC81C \uC704\uD5D8",
      body: ["\uC554\uD638\uD654\uD3D0\uC758 \uBC95\uC801 \uC9C0\uC704\uB294 \uAD00\uD560 \uC9C0\uC5ED\uC5D0 \uB530\uB77C \uB2E4\uB974\uBA70 \uBCC0\uACBD\uB420 \uC218 \uC788\uACE0, \uC774\uB294 \uC11C\uBE44\uC2A4 \uC774\uC6A9 \uAC00\uB2A5\uC131\uC5D0 \uC601\uD5A5\uC744 \uC904 \uC218 \uC788\uC2B5\uB2C8\uB2E4."]
    },
    {
      heading: "7. \uAC70\uB798\uC758 \uBE44\uAC00\uC5ED\uC131",
      body: ["\uC628\uCCB4\uC778 \uC1A1\uAE08\uC740 \uC77C\uBC18\uC801\uC73C\uB85C \uCDE8\uC18C\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uC790\uAE08\uC744 \uCD9C\uAE08\uD558\uAE30 \uC804\uC5D0 \uC8FC\uC18C\uC640 \uB124\uD2B8\uC6CC\uD06C\uB97C \uBC18\uB4DC\uC2DC \uB2E4\uC2DC \uD655\uC778\uD558\uC138\uC694."]
    },
    {
      heading: "8. \uD655\uC778",
      body: ["\uAC70\uB798\uB97C \uC704\uD574 VOLTEX\uB97C \uC774\uC6A9\uD568\uC73C\uB85C\uC368, \uADC0\uD558\uB294 \uC704\uC5D0 \uB098\uC5F4\uB41C \uC704\uD5D8\uC744 \uC774\uD574\uD558\uBA70 \uBCF8\uC778\uC758 \uCC45\uC784\uD558\uC5D0 \uAC70\uB798\uD568\uC744 \uD655\uC778\uD55C \uAC83\uC73C\uB85C \uAC04\uC8FC\uB429\uB2C8\uB2E4."]
    }
  ]
};
var LEGAL_CONTENT = {
  ru: { terms: RU_TERMS, privacy: RU_PRIVACY, risk: RU_RISK, about: RU_ABOUT, support: RU_SUPPORT },
  en: { terms: EN_TERMS, privacy: EN_PRIVACY, risk: EN_RISK, about: EN_ABOUT, support: EN_SUPPORT },
  zh: { terms: ZH_TERMS, privacy: ZH_PRIVACY, risk: ZH_RISK, about: ZH_ABOUT, support: ZH_SUPPORT },
  es: { terms: ES_TERMS, privacy: ES_PRIVACY, risk: ES_RISK, about: ES_ABOUT, support: ES_SUPPORT },
  hi: { terms: HI_TERMS, privacy: HI_PRIVACY, risk: HI_RISK, about: HI_ABOUT, support: HI_SUPPORT },
  ja: { terms: JA_TERMS, privacy: JA_PRIVACY, risk: JA_RISK, about: JA_ABOUT, support: JA_SUPPORT },
  ko: { terms: KO_TERMS, privacy: KO_PRIVACY, risk: KO_RISK, about: KO_ABOUT, support: KO_SUPPORT }
};

// src/lib/seo/legalMeta.ts
var ABOUT_DESCRIPTION = "\u041C\u044B \u0441\u043E\u0437\u0434\u0430\u0451\u043C \u043F\u0440\u043E\u0441\u0442\u0440\u0430\u043D\u0441\u0442\u0432\u043E, \u0432 \u043A\u043E\u0442\u043E\u0440\u043E\u043C \u0440\u044B\u043D\u043A\u0438, \u0442\u043E\u0440\u0433\u043E\u0432\u044B\u0435 \u0438\u043D\u0441\u0442\u0440\u0443\u043C\u0435\u043D\u0442\u044B \u0438 \u0443\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0430\u043A\u0442\u0438\u0432\u0430\u043C\u0438 \u0441\u0442\u0430\u043D\u043E\u0432\u044F\u0442\u0441\u044F \u0447\u0430\u0441\u0442\u044C\u044E \u0435\u0434\u0438\u043D\u043E\u0433\u043E \u043E\u043F\u044B\u0442\u0430.";
function legalMeta(doc, lang = "ru") {
  const content = LEGAL_CONTENT[lang][doc];
  return { title: `${content.title} \u2014 VOLTEX`, description: doc === "about" ? ABOUT_DESCRIPTION : content.intro };
}

// src/lib/seo/pages.ts
function legalPages() {
  return LEGAL_DOCS.map((doc) => ({ path: `legal/${doc}`, ...legalMeta(doc) }));
}
function publicPages(content) {
  return [...seoPages(content), ...legalPages()];
}
function unlistedPages() {
  return [
    ...PRIVATE_ROUTES.map((route) => ({ path: route.slice(1), robots: ROBOTS_PRIVATE })),
    ...ADMIN_PAGES.map((page) => ({ path: `admin/${page}`, robots: ROBOTS_PRIVATE })),
    ...UNPROMOTED_ROUTES.map((route) => ({ path: route.slice(1), robots: ROBOTS_PRIVATE })),
    ...UTILITY_ROUTES.map((route) => ({ path: route.slice(1), robots: ROBOTS_UNLISTED }))
  ];
}
function withRobots(indexHtml, robots) {
  return indexHtml.replace(/\s*<link rel="canonical"[^>]*>/, "").replace(/\s*<meta property="og:url"[^>]*>/, "").replace(/(<meta name="description"[^>]*>)/, `$1
    <meta name="robots" content="${robots}" />`);
}
function sitemapUrls(content) {
  const urls = /* @__PURE__ */ new Set([`${SITE_ORIGIN}/`]);
  for (const page of publicPages(content)) {
    const self = `${SITE_ORIGIN}/${page.path}`;
    const runtime = canonicalFor(`/${page.path}`);
    if (robotsFor(`/${page.path}`)) throw new Error(`Static page ${page.path} is marked unlisted by lib/seo/site.ts`);
    if (runtime !== (page.canonical ?? self)) throw new Error(`Canonical mismatch for ${page.path}: static ${page.canonical ?? self}, app ${runtime}`);
    if (!page.canonical) urls.add(self);
  }
  const [home, ...rest] = [...urls];
  return [home, ...rest.sort()];
}
var xmlEscape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
function sitemapXml(urls) {
  const body = urls.map((url) => `  <url><loc>${xmlEscape(url)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}
function robotsTxt() {
  return [
    "# VOLTEX. Every page may be crawled. Signed-in areas and the sign-in screens",
    "# are kept out of search results by their robots meta and X-Robots-Tag, not",
    "# here: robots.txt is public and is not access control.",
    "User-agent: *",
    "Disallow:",
    "",
    `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
    ""
  ].join("\n");
}

// contentPlugin.ts
var MODULES = { "virtual:voltex-academy": "academy", "virtual:voltex-help": "help" };
function readContent(dir) {
  const files = {};
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(md|json)$/.test(entry.name)) files[path.relative(dir, full).split(path.sep).join("/")] = fs.readFileSync(full, "utf8");
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return files;
}
function voltexContent() {
  let dir = "";
  let compiled = null;
  const compile = () => compiled ??= compileContent(readContent(dir));
  const content = {
    name: "voltex-content",
    configResolved(config) {
      dir = path.resolve(config.root, "content");
    },
    buildStart() {
      compiled = null;
      const { problems } = compile();
      if (problems.length) this.warn(`Academy/Help content problems:
- ${problems.join("\n- ")}`);
    },
    resolveId(id) {
      return id in MODULES ? `\0${id}` : null;
    },
    load(id) {
      if (!id.startsWith("\0virtual:voltex-")) return null;
      const key = MODULES[id.slice(1)];
      if (!key) return null;
      for (const file of Object.keys(readContent(dir))) this.addWatchFile(path.join(dir, file));
      return `export default ${JSON.stringify(compile()[key])};`;
    },
    configureServer(server) {
      server.watcher.add(dir);
      server.watcher.on("all", (_event, file) => {
        if (!file.startsWith(dir)) return;
        compiled = null;
        for (const id of Object.keys(MODULES)) {
          const mod = server.moduleGraph.getModuleById(`\0${id}`);
          if (mod) server.moduleGraph.invalidateModule(mod);
        }
        server.ws.send({ type: "full-reload" });
      });
    }
  };
  const pageHeads = {
    name: "voltex-content-page-heads",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const index = bundle["index.html"];
      if (!index || index.type !== "asset") return;
      const html = String(index.source);
      for (const page of publicPages(compile())) {
        this.emitFile({ type: "asset", fileName: `${page.path}.html`, source: withPageHead(html, page) });
      }
      for (const { path: page, robots } of unlistedPages()) {
        this.emitFile({ type: "asset", fileName: `${page}.html`, source: withRobots(html, robots) });
      }
      this.emitFile({ type: "asset", fileName: "sitemap.xml", source: sitemapXml(sitemapUrls(compile())) });
      this.emitFile({ type: "asset", fileName: "robots.txt", source: robotsTxt() });
    }
  };
  return [content, pageHeads];
}

// wallet591-profiles.json
var wallet591_profiles_default = {
  production: {
    origin: "https://voltextech.net",
    env: {
      VITE_API_URL: "https://api.voltextech.net/api/v1",
      VITE_MARKET_EDGE_URL: "https://market.voltextech.net",
      VITE_KYC_EDGE_URL: "https://kyc.voltextech.net",
      VITE_DEPOSIT_CATALOGUE_URL: "https://voltex-deposit-catalogue-production.nazardzuba79.workers.dev",
      VITE_MANUAL_DEPOSIT_CATALOGUE: "true",
      VITE_WALLET_CONVERSION_ENABLED: "false"
    }
  },
  ru: {
    origin: "https://ru.voltextech.net",
    env: {
      VITE_API_URL: "https://ru.voltextech.net/api/v1",
      VITE_MARKET_EDGE_URL: "https://ru.voltextech.net/_voltex/market",
      VITE_KYC_EDGE_URL: "https://ru.voltextech.net/_voltex/kyc",
      VITE_DEPOSIT_CATALOGUE_URL: "https://ru.voltextech.net/_voltex/catalogue",
      VITE_MANUAL_DEPOSIT_CATALOGUE: "true",
      VITE_WALLET_CONVERSION_ENABLED: "false"
    }
  }
};

// vite.config.ts
var releaseProfile = process.env.VOLTEX_RELEASE_PROFILE;
var releaseConfig = releaseProfile ? wallet591_profiles_default[releaseProfile] : void 0;
if (releaseProfile) {
  if (!releaseConfig || !/^[a-f0-9]{40}$/.test(process.env.VOLTEX_RELEASE_SOURCE ?? "")) throw new Error("Invalid release profile/source");
  for (const [key, value] of Object.entries(releaseConfig.env)) {
    if (process.env[key] !== value) throw new Error(`Release environment mismatch: ${key}`);
  }
}
var depositEdge = process.env.VITE_DEPOSIT_CATALOGUE_URL;
if (process.env.VITE_STOCKS_GLOBAL_SIMULATOR === "true" && process.env.VITE_STOCKS_ENABLED !== "true") throw new Error("Local global Stocks simulator requires Stocks enabled");
if (process.env.VITE_STOCKS_SIMULATOR === "true" && (process.env.VITE_STOCKS_ENABLED !== "true" || process.env.VITE_STOCKS_WIDGET_PREVIEW !== "true")) {
  throw new Error("Local Stocks simulator requires the Stocks route and official widget preview");
}
if (process.env.VITE_STOCKS_ENABLED === "true" && process.env.VITE_STOCKS_WIDGET_PREVIEW !== "true") {
  const stockOrigin = new URL(process.env.VITE_STOCKS_ORIGIN ?? "");
  if (stockOrigin.protocol !== "https:" && !(stockOrigin.protocol === "http:" && stockOrigin.hostname === "127.0.0.1") || stockOrigin.username || stockOrigin.password || stockOrigin.search || stockOrigin.hash) throw new Error("Stocks requires a dedicated https origin (loopback allowed for QA)");
}
if (depositEdge !== void 0 && depositEdge.trim() !== "" && resolveCatalogueEdge(depositEdge) === null) {
  throw new Error("VITE_DEPOSIT_CATALOGUE_URL must be an https URL (http only for 127.0.0.1) without credentials, query or hash");
}
if (process.env.VITE_MANUAL_DEPOSIT_CATALOGUE === "true" && !depositEdge?.trim()) {
  console.warn("[deposit] VITE_MANUAL_DEPOSIT_CATALOGUE=true without VITE_DEPOSIT_CATALOGUE_URL: the Deposit dialog reads the catalogue from the API (Render).");
}
var vite_config_default = defineConfig({
  // Academy and Help pages are compiled from frontend/content/ at build time.
  plugins: [react(), ...voltexContent(), ...releaseConfig ? [{
    name: "reviewed-release-profile",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "release-build.json", source: JSON.stringify({
        profile: releaseProfile,
        source: process.env.VOLTEX_RELEASE_SOURCE,
        env: releaseConfig.env
      }) });
    }
  }] : []],
  // The market edge origin (lib/marketEdge.ts). Empty = production default.
  // A compile-time constant rather than import.meta, so modules that read it
  // stay importable from the CommonJS Jest suites.
  define: {
    __VOLTEX_STOCKS_GLOBAL_SIMULATOR__: process.env.VITE_STOCKS_GLOBAL_SIMULATOR === "true",
    __VOLTEX_STOCKS_SIMULATOR__: process.env.VITE_STOCKS_SIMULATOR === "true",
    __VOLTEX_STOCKS_WIDGET_PREVIEW__: process.env.VITE_STOCKS_WIDGET_PREVIEW === "true",
    __VOLTEX_STOCKS_ENABLED__: process.env.VITE_STOCKS_ENABLED === "true",
    __VOLTEX_STOCKS_ORIGIN__: JSON.stringify(process.env.VITE_STOCKS_ORIGIN ?? ""),
    __VOLTEX_MARKET_EDGE_URL__: JSON.stringify(process.env.VITE_MARKET_EDGE_URL ?? "")
  },
  server: {
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiLCAic3JjL2xpYi9kZXBvc2l0Q2F0YWxvZ3VlRWRnZS50cyIsICJjb250ZW50UGx1Z2luLnRzIiwgInNyYy9saWIvY29udGVudC9jb21waWxlLnRzIiwgInNyYy9saWIvc2VvL3NpdGUudHMiLCAic3JjL2xpYi9sZWdhbENvbnRlbnQudHMiLCAic3JjL2xpYi9zZW8vbGVnYWxNZXRhLnRzIiwgInNyYy9saWIvc2VvL3BhZ2VzLnRzIiwgIndhbGxldDU5MS1wcm9maWxlcy5qc29uIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZGlybmFtZSA9IFwiL2hvbWUvdXNlci92b2x0ZXgtcmMvZnJvbnRlbmRcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9ob21lL3VzZXIvdm9sdGV4LXJjL2Zyb250ZW5kL3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9ob21lL3VzZXIvdm9sdGV4LXJjL2Zyb250ZW5kL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSc7XG5pbXBvcnQgcmVhY3QgZnJvbSAnQHZpdGVqcy9wbHVnaW4tcmVhY3QnO1xuaW1wb3J0IHsgcmVzb2x2ZUNhdGFsb2d1ZUVkZ2UgfSBmcm9tICcuL3NyYy9saWIvZGVwb3NpdENhdGFsb2d1ZUVkZ2UnO1xuaW1wb3J0IHsgdm9sdGV4Q29udGVudCB9IGZyb20gJy4vY29udGVudFBsdWdpbic7XG5pbXBvcnQgcmVsZWFzZVByb2ZpbGVzIGZyb20gJy4vd2FsbGV0NTkxLXByb2ZpbGVzLmpzb24nO1xuXG5jb25zdCByZWxlYXNlUHJvZmlsZSA9IHByb2Nlc3MuZW52LlZPTFRFWF9SRUxFQVNFX1BST0ZJTEU7XG5jb25zdCByZWxlYXNlQ29uZmlnID0gcmVsZWFzZVByb2ZpbGUgPyByZWxlYXNlUHJvZmlsZXNbcmVsZWFzZVByb2ZpbGUgYXMga2V5b2YgdHlwZW9mIHJlbGVhc2VQcm9maWxlc10gOiB1bmRlZmluZWQ7XG5pZiAocmVsZWFzZVByb2ZpbGUpIHtcbiAgaWYgKCFyZWxlYXNlQ29uZmlnIHx8ICEvXlthLWYwLTldezQwfSQvLnRlc3QocHJvY2Vzcy5lbnYuVk9MVEVYX1JFTEVBU0VfU09VUkNFID8/ICcnKSkgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIHJlbGVhc2UgcHJvZmlsZS9zb3VyY2UnKTtcbiAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMocmVsZWFzZUNvbmZpZy5lbnYpKSB7XG4gICAgaWYgKHByb2Nlc3MuZW52W2tleV0gIT09IHZhbHVlKSB0aHJvdyBuZXcgRXJyb3IoYFJlbGVhc2UgZW52aXJvbm1lbnQgbWlzbWF0Y2g6ICR7a2V5fWApO1xuICB9XG59XG5cbi8vIERlcG9zaXQgY2F0YWxvZ3VlIGFjdGl2YXRpb24gaXMgY2hvc2VuIGF0IGJ1aWxkIHRpbWUgYW5kIG5ldmVyIGZhbGxzIGJhY2tcbi8vIGF0IHJ1bnRpbWUsIHNvIGEgbWFsZm9ybWVkIG9yaWdpbiBtdXN0IHN0b3AgdGhlIGJ1aWxkIHJhdGhlciB0aGFuIHNoaXAgYVxuLy8gRGVwb3NpdCBkaWFsb2cgdGhhdCBzaWxlbnRseSByZWFkcyBSZW5kZXIgKG9yIG5vdGhpbmcpLlxuY29uc3QgZGVwb3NpdEVkZ2UgPSBwcm9jZXNzLmVudi5WSVRFX0RFUE9TSVRfQ0FUQUxPR1VFX1VSTDtcbmlmIChwcm9jZXNzLmVudi5WSVRFX1NUT0NLU19HTE9CQUxfU0lNVUxBVE9SID09PSAndHJ1ZScgJiYgcHJvY2Vzcy5lbnYuVklURV9TVE9DS1NfRU5BQkxFRCAhPT0gJ3RydWUnKSB0aHJvdyBuZXcgRXJyb3IoJ0xvY2FsIGdsb2JhbCBTdG9ja3Mgc2ltdWxhdG9yIHJlcXVpcmVzIFN0b2NrcyBlbmFibGVkJyk7XG5pZiAocHJvY2Vzcy5lbnYuVklURV9TVE9DS1NfU0lNVUxBVE9SID09PSAndHJ1ZScgJiYgKHByb2Nlc3MuZW52LlZJVEVfU1RPQ0tTX0VOQUJMRUQgIT09ICd0cnVlJyB8fCBwcm9jZXNzLmVudi5WSVRFX1NUT0NLU19XSURHRVRfUFJFVklFVyAhPT0gJ3RydWUnKSkge1xuICB0aHJvdyBuZXcgRXJyb3IoJ0xvY2FsIFN0b2NrcyBzaW11bGF0b3IgcmVxdWlyZXMgdGhlIFN0b2NrcyByb3V0ZSBhbmQgb2ZmaWNpYWwgd2lkZ2V0IHByZXZpZXcnKTtcbn1cbmlmIChwcm9jZXNzLmVudi5WSVRFX1NUT0NLU19FTkFCTEVEID09PSAndHJ1ZScgJiYgcHJvY2Vzcy5lbnYuVklURV9TVE9DS1NfV0lER0VUX1BSRVZJRVcgIT09ICd0cnVlJykge1xuICBjb25zdCBzdG9ja09yaWdpbiA9IG5ldyBVUkwocHJvY2Vzcy5lbnYuVklURV9TVE9DS1NfT1JJR0lOID8/ICcnKTtcbiAgaWYgKChzdG9ja09yaWdpbi5wcm90b2NvbCAhPT0gJ2h0dHBzOicgJiYgIShzdG9ja09yaWdpbi5wcm90b2NvbCA9PT0gJ2h0dHA6JyAmJiBzdG9ja09yaWdpbi5ob3N0bmFtZSA9PT0gJzEyNy4wLjAuMScpKSB8fCBzdG9ja09yaWdpbi51c2VybmFtZSB8fCBzdG9ja09yaWdpbi5wYXNzd29yZCB8fCBzdG9ja09yaWdpbi5zZWFyY2ggfHwgc3RvY2tPcmlnaW4uaGFzaCkgdGhyb3cgbmV3IEVycm9yKCdTdG9ja3MgcmVxdWlyZXMgYSBkZWRpY2F0ZWQgaHR0cHMgb3JpZ2luIChsb29wYmFjayBhbGxvd2VkIGZvciBRQSknKTtcbn1cbmlmIChkZXBvc2l0RWRnZSAhPT0gdW5kZWZpbmVkICYmIGRlcG9zaXRFZGdlLnRyaW0oKSAhPT0gJycgJiYgcmVzb2x2ZUNhdGFsb2d1ZUVkZ2UoZGVwb3NpdEVkZ2UpID09PSBudWxsKSB7XG4gIHRocm93IG5ldyBFcnJvcignVklURV9ERVBPU0lUX0NBVEFMT0dVRV9VUkwgbXVzdCBiZSBhbiBodHRwcyBVUkwgKGh0dHAgb25seSBmb3IgMTI3LjAuMC4xKSB3aXRob3V0IGNyZWRlbnRpYWxzLCBxdWVyeSBvciBoYXNoJyk7XG59XG5pZiAocHJvY2Vzcy5lbnYuVklURV9NQU5VQUxfREVQT1NJVF9DQVRBTE9HVUUgPT09ICd0cnVlJyAmJiAhZGVwb3NpdEVkZ2U/LnRyaW0oKSkge1xuICBjb25zb2xlLndhcm4oJ1tkZXBvc2l0XSBWSVRFX01BTlVBTF9ERVBPU0lUX0NBVEFMT0dVRT10cnVlIHdpdGhvdXQgVklURV9ERVBPU0lUX0NBVEFMT0dVRV9VUkw6IHRoZSBEZXBvc2l0IGRpYWxvZyByZWFkcyB0aGUgY2F0YWxvZ3VlIGZyb20gdGhlIEFQSSAoUmVuZGVyKS4nKTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgLy8gQWNhZGVteSBhbmQgSGVscCBwYWdlcyBhcmUgY29tcGlsZWQgZnJvbSBmcm9udGVuZC9jb250ZW50LyBhdCBidWlsZCB0aW1lLlxuICBwbHVnaW5zOiBbcmVhY3QoKSwgLi4udm9sdGV4Q29udGVudCgpLCAuLi4ocmVsZWFzZUNvbmZpZyA/IFt7XG4gICAgbmFtZTogJ3Jldmlld2VkLXJlbGVhc2UtcHJvZmlsZScsXG4gICAgZ2VuZXJhdGVCdW5kbGUoKSB7XG4gICAgICB0aGlzLmVtaXRGaWxlKHsgdHlwZTogJ2Fzc2V0JywgZmlsZU5hbWU6ICdyZWxlYXNlLWJ1aWxkLmpzb24nLCBzb3VyY2U6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgcHJvZmlsZTogcmVsZWFzZVByb2ZpbGUsIHNvdXJjZTogcHJvY2Vzcy5lbnYuVk9MVEVYX1JFTEVBU0VfU09VUkNFLCBlbnY6IHJlbGVhc2VDb25maWcuZW52LFxuICAgICAgfSkgfSk7XG4gICAgfSxcbiAgfV0gOiBbXSldLFxuICAvLyBUaGUgbWFya2V0IGVkZ2Ugb3JpZ2luIChsaWIvbWFya2V0RWRnZS50cykuIEVtcHR5ID0gcHJvZHVjdGlvbiBkZWZhdWx0LlxuICAvLyBBIGNvbXBpbGUtdGltZSBjb25zdGFudCByYXRoZXIgdGhhbiBpbXBvcnQubWV0YSwgc28gbW9kdWxlcyB0aGF0IHJlYWQgaXRcbiAgLy8gc3RheSBpbXBvcnRhYmxlIGZyb20gdGhlIENvbW1vbkpTIEplc3Qgc3VpdGVzLlxuICBkZWZpbmU6IHtcbiAgICBfX1ZPTFRFWF9TVE9DS1NfR0xPQkFMX1NJTVVMQVRPUl9fOiBwcm9jZXNzLmVudi5WSVRFX1NUT0NLU19HTE9CQUxfU0lNVUxBVE9SID09PSAndHJ1ZScsXG4gICAgX19WT0xURVhfU1RPQ0tTX1NJTVVMQVRPUl9fOiBwcm9jZXNzLmVudi5WSVRFX1NUT0NLU19TSU1VTEFUT1IgPT09ICd0cnVlJyxcbiAgICBfX1ZPTFRFWF9TVE9DS1NfV0lER0VUX1BSRVZJRVdfXzogcHJvY2Vzcy5lbnYuVklURV9TVE9DS1NfV0lER0VUX1BSRVZJRVcgPT09ICd0cnVlJyxcbiAgICBfX1ZPTFRFWF9TVE9DS1NfRU5BQkxFRF9fOiBwcm9jZXNzLmVudi5WSVRFX1NUT0NLU19FTkFCTEVEID09PSAndHJ1ZScsXG4gICAgX19WT0xURVhfU1RPQ0tTX09SSUdJTl9fOiBKU09OLnN0cmluZ2lmeShwcm9jZXNzLmVudi5WSVRFX1NUT0NLU19PUklHSU4gPz8gJycpLFxuICAgIF9fVk9MVEVYX01BUktFVF9FREdFX1VSTF9fOiBKU09OLnN0cmluZ2lmeShwcm9jZXNzLmVudi5WSVRFX01BUktFVF9FREdFX1VSTCA/PyAnJyksXG4gIH0sXG4gIHNlcnZlcjoge1xuICAgIHByb3h5OiB7XG4gICAgICAnL2FwaSc6IHsgdGFyZ2V0OiAnaHR0cDovL2xvY2FsaG9zdDozMDAwJywgY2hhbmdlT3JpZ2luOiB0cnVlIH0sXG4gICAgfSxcbiAgfSxcbn0pO1xuIiwgImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS91c2VyL3ZvbHRleC1yYy9mcm9udGVuZC9zcmMvbGliXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvaG9tZS91c2VyL3ZvbHRleC1yYy9mcm9udGVuZC9zcmMvbGliL2RlcG9zaXRDYXRhbG9ndWVFZGdlLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9ob21lL3VzZXIvdm9sdGV4LXJjL2Zyb250ZW5kL3NyYy9saWIvZGVwb3NpdENhdGFsb2d1ZUVkZ2UudHNcIjsvKiogUHVyZSAobm8gaW1wb3J0Lm1ldGEpOiB2YWxpZGF0ZXMgdGhlIGJ1aWxkLXRpbWUgQ2xvdWRmbGFyZSBjYXRhbG9ndWUgb3JpZ2luLiBodHRwcyBvbmx5OyBodHRwIG9ubHkgZm9yIGEgMTI3LjAuMC4xIHRlc3QgV29ya2VyLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVDYXRhbG9ndWVFZGdlKHZhbHVlOiB1bmtub3duKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09ICdzdHJpbmcnIHx8ICF2YWx1ZS50cmltKCkpIHJldHVybiBudWxsO1xuICB0cnkge1xuICAgIGNvbnN0IHVybCA9IG5ldyBVUkwodmFsdWUudHJpbSgpKTtcbiAgICBjb25zdCBsb29wYmFjayA9IHVybC5wcm90b2NvbCA9PT0gJ2h0dHA6JyAmJiB1cmwuaG9zdG5hbWUgPT09ICcxMjcuMC4wLjEnO1xuICAgIGlmICgodXJsLnByb3RvY29sICE9PSAnaHR0cHM6JyAmJiAhbG9vcGJhY2spIHx8IHVybC51c2VybmFtZSB8fCB1cmwucGFzc3dvcmQgfHwgdXJsLnNlYXJjaCB8fCB1cmwuaGFzaCkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIHVybC50b1N0cmluZygpLnJlcGxhY2UoL1xcLyQvLCAnJyk7XG4gIH0gY2F0Y2ggeyByZXR1cm4gbnVsbDsgfVxufVxuIiwgImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS91c2VyL3ZvbHRleC1yYy9mcm9udGVuZFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL2hvbWUvdXNlci92b2x0ZXgtcmMvZnJvbnRlbmQvY29udGVudFBsdWdpbi50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vaG9tZS91c2VyL3ZvbHRleC1yYy9mcm9udGVuZC9jb250ZW50UGx1Z2luLnRzXCI7aW1wb3J0IGZzIGZyb20gJ25vZGU6ZnMnO1xuaW1wb3J0IHBhdGggZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB0eXBlIHsgUGx1Z2luLCBSZXNvbHZlZENvbmZpZyB9IGZyb20gJ3ZpdGUnO1xuaW1wb3J0IHsgY29tcGlsZUNvbnRlbnQsIHdpdGhQYWdlSGVhZCwgdHlwZSBDb21waWxlZENvbnRlbnQgfSBmcm9tICcuL3NyYy9saWIvY29udGVudC9jb21waWxlJztcbmltcG9ydCB7IHB1YmxpY1BhZ2VzLCByb2JvdHNUeHQsIHNpdGVtYXBVcmxzLCBzaXRlbWFwWG1sLCB1bmxpc3RlZFBhZ2VzLCB3aXRoUm9ib3RzIH0gZnJvbSAnLi9zcmMvbGliL3Nlby9wYWdlcyc7XG5cbi8qKlxuICogQWNhZGVteSBhbmQgSGVscCBhcmUgc3RhdGljOiBmcm9udGVuZC9jb250ZW50LyBpcyByZWFkIGFuZCBjb21waWxlZCB3aGlsZVxuICogdGhlIHNpdGUgaXMgYnVpbHQsIGFuZCB0aGUgcGFnZXMgaW1wb3J0IHRoZSByZXN1bHQgYXMgdHdvIHZpcnR1YWwgbW9kdWxlcy5cbiAqIE5vIEFQSSByZXF1ZXN0LCBubyBkYXRhYmFzZSB0YWJsZSwgbm8gc2VydmVyIGNvZGUgc2hvd3MgYW4gYXJ0aWNsZS5cbiAqXG4gKiBUaGUgYnVpbGQgYWxzbyB3cml0ZXMgb25lIHNtYWxsIEhUTUwgZmlsZSBwZXIgcHVibGljIEFjYWRlbXksIEhlbHAgYW5kXG4gKiBsZWdhbCBhZGRyZXNzIFx1MjAxNCB0aGUgc2FtZSBpbmRleC5odG1sIHdpdGggdGhhdCBwYWdlJ3MgPHRpdGxlPiwgZGVzY3JpcHRpb25cbiAqIGFuZCBjYW5vbmljYWwgXHUyMDE0IHNvIGEgc2VhcmNoIGVuZ2luZSBzZWVzIHRoZW0gYmVmb3JlIGFueSBzY3JpcHQgcnVucy5cbiAqIENsb3VkZmxhcmUgUGFnZXMgc2VydmVzIC9hY2FkZW15L3gveSBmcm9tIGFjYWRlbXkveC95Lmh0bWw7IGV2ZXJ5dGhpbmcgZWxzZVxuICogc3RpbGwgZmFsbHMgYmFjayB0byBpbmRleC5odG1sIGFzIGJlZm9yZS4gU2lnbmVkLWluIGFuZCBzaWduLWluIGFkZHJlc3Nlc1xuICogZ2V0IHRoZSBzYW1lIGNvcHkgd2l0aCBhIG5vaW5kZXggcm9ib3RzIG1ldGEsIGFuZCB0aGUgYnVpbGQgYWRkc1xuICogc2l0ZW1hcC54bWwgYW5kIHJvYm90cy50eHQgKGxpYi9zZW8vcGFnZXMudHMsIGxpYi9zZW8vc2l0ZS50cykuXG4gKi9cblxuY29uc3QgTU9EVUxFUyA9IHsgJ3ZpcnR1YWw6dm9sdGV4LWFjYWRlbXknOiAnYWNhZGVteScsICd2aXJ0dWFsOnZvbHRleC1oZWxwJzogJ2hlbHAnIH0gYXMgY29uc3Q7XG50eXBlIFZpcnR1YWxJZCA9IGtleW9mIHR5cGVvZiBNT0RVTEVTO1xuXG5mdW5jdGlvbiByZWFkQ29udGVudChkaXI6IHN0cmluZyk6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4ge1xuICBjb25zdCBmaWxlczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9O1xuICBjb25zdCB3YWxrID0gKGN1cnJlbnQ6IHN0cmluZykgPT4ge1xuICAgIGZvciAoY29uc3QgZW50cnkgb2YgZnMucmVhZGRpclN5bmMoY3VycmVudCwgeyB3aXRoRmlsZVR5cGVzOiB0cnVlIH0pKSB7XG4gICAgICBjb25zdCBmdWxsID0gcGF0aC5qb2luKGN1cnJlbnQsIGVudHJ5Lm5hbWUpO1xuICAgICAgaWYgKGVudHJ5LmlzRGlyZWN0b3J5KCkpIHdhbGsoZnVsbCk7XG4gICAgICBlbHNlIGlmICgvXFwuKG1kfGpzb24pJC8udGVzdChlbnRyeS5uYW1lKSkgZmlsZXNbcGF0aC5yZWxhdGl2ZShkaXIsIGZ1bGwpLnNwbGl0KHBhdGguc2VwKS5qb2luKCcvJyldID0gZnMucmVhZEZpbGVTeW5jKGZ1bGwsICd1dGY4Jyk7XG4gICAgfVxuICB9O1xuICBpZiAoZnMuZXhpc3RzU3luYyhkaXIpKSB3YWxrKGRpcik7XG4gIHJldHVybiBmaWxlcztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZvbHRleENvbnRlbnQoKTogUGx1Z2luW10ge1xuICBsZXQgZGlyID0gJyc7XG4gIGxldCBjb21waWxlZDogQ29tcGlsZWRDb250ZW50IHwgbnVsbCA9IG51bGw7XG4gIGNvbnN0IGNvbXBpbGUgPSAoKSA9PiAoY29tcGlsZWQgPz89IGNvbXBpbGVDb250ZW50KHJlYWRDb250ZW50KGRpcikpKTtcblxuICBjb25zdCBjb250ZW50OiBQbHVnaW4gPSB7XG4gICAgbmFtZTogJ3ZvbHRleC1jb250ZW50JyxcbiAgICBjb25maWdSZXNvbHZlZChjb25maWc6IFJlc29sdmVkQ29uZmlnKSB7XG4gICAgICBkaXIgPSBwYXRoLnJlc29sdmUoY29uZmlnLnJvb3QsICdjb250ZW50Jyk7XG4gICAgfSxcbiAgICBidWlsZFN0YXJ0KCkge1xuICAgICAgY29tcGlsZWQgPSBudWxsO1xuICAgICAgY29uc3QgeyBwcm9ibGVtcyB9ID0gY29tcGlsZSgpO1xuICAgICAgaWYgKHByb2JsZW1zLmxlbmd0aCkgdGhpcy53YXJuKGBBY2FkZW15L0hlbHAgY29udGVudCBwcm9ibGVtczpcXG4tICR7cHJvYmxlbXMuam9pbignXFxuLSAnKX1gKTtcbiAgICB9LFxuICAgIHJlc29sdmVJZChpZCkge1xuICAgICAgcmV0dXJuIGlkIGluIE1PRFVMRVMgPyBgXFwwJHtpZH1gIDogbnVsbDtcbiAgICB9LFxuICAgIGxvYWQoaWQpIHtcbiAgICAgIGlmICghaWQuc3RhcnRzV2l0aCgnXFwwdmlydHVhbDp2b2x0ZXgtJykpIHJldHVybiBudWxsO1xuICAgICAgY29uc3Qga2V5ID0gTU9EVUxFU1tpZC5zbGljZSgxKSBhcyBWaXJ0dWFsSWRdO1xuICAgICAgaWYgKCFrZXkpIHJldHVybiBudWxsO1xuICAgICAgZm9yIChjb25zdCBmaWxlIG9mIE9iamVjdC5rZXlzKHJlYWRDb250ZW50KGRpcikpKSB0aGlzLmFkZFdhdGNoRmlsZShwYXRoLmpvaW4oZGlyLCBmaWxlKSk7XG4gICAgICByZXR1cm4gYGV4cG9ydCBkZWZhdWx0ICR7SlNPTi5zdHJpbmdpZnkoY29tcGlsZSgpW2tleV0pfTtgO1xuICAgIH0sXG4gICAgY29uZmlndXJlU2VydmVyKHNlcnZlcikge1xuICAgICAgc2VydmVyLndhdGNoZXIuYWRkKGRpcik7XG4gICAgICBzZXJ2ZXIud2F0Y2hlci5vbignYWxsJywgKF9ldmVudCwgZmlsZSkgPT4ge1xuICAgICAgICBpZiAoIWZpbGUuc3RhcnRzV2l0aChkaXIpKSByZXR1cm47XG4gICAgICAgIGNvbXBpbGVkID0gbnVsbDtcbiAgICAgICAgZm9yIChjb25zdCBpZCBvZiBPYmplY3Qua2V5cyhNT0RVTEVTKSkge1xuICAgICAgICAgIGNvbnN0IG1vZCA9IHNlcnZlci5tb2R1bGVHcmFwaC5nZXRNb2R1bGVCeUlkKGBcXDAke2lkfWApO1xuICAgICAgICAgIGlmIChtb2QpIHNlcnZlci5tb2R1bGVHcmFwaC5pbnZhbGlkYXRlTW9kdWxlKG1vZCk7XG4gICAgICAgIH1cbiAgICAgICAgc2VydmVyLndzLnNlbmQoeyB0eXBlOiAnZnVsbC1yZWxvYWQnIH0pO1xuICAgICAgfSk7XG4gICAgfSxcbiAgfTtcbiAgLy8gQSBzZXBhcmF0ZSBsYXRlIHBsdWdpbjogaW5kZXguaHRtbCBvbmx5IGV4aXN0cyBpbiB0aGUgYnVuZGxlIG9uY2UgVml0ZSdzXG4gIC8vIG93biBIVE1MIHN0ZXAgaGFzIHJ1bi5cbiAgY29uc3QgcGFnZUhlYWRzOiBQbHVnaW4gPSB7XG4gICAgbmFtZTogJ3ZvbHRleC1jb250ZW50LXBhZ2UtaGVhZHMnLFxuICAgIGFwcGx5OiAnYnVpbGQnLFxuICAgIGVuZm9yY2U6ICdwb3N0JyxcbiAgICBnZW5lcmF0ZUJ1bmRsZShfb3B0aW9ucywgYnVuZGxlKSB7XG4gICAgICBjb25zdCBpbmRleCA9IGJ1bmRsZVsnaW5kZXguaHRtbCddO1xuICAgICAgaWYgKCFpbmRleCB8fCBpbmRleC50eXBlICE9PSAnYXNzZXQnKSByZXR1cm47XG4gICAgICBjb25zdCBodG1sID0gU3RyaW5nKGluZGV4LnNvdXJjZSk7XG4gICAgICBmb3IgKGNvbnN0IHBhZ2Ugb2YgcHVibGljUGFnZXMoY29tcGlsZSgpKSkge1xuICAgICAgICB0aGlzLmVtaXRGaWxlKHsgdHlwZTogJ2Fzc2V0JywgZmlsZU5hbWU6IGAke3BhZ2UucGF0aH0uaHRtbGAsIHNvdXJjZTogd2l0aFBhZ2VIZWFkKGh0bWwsIHBhZ2UpIH0pO1xuICAgICAgfVxuICAgICAgZm9yIChjb25zdCB7IHBhdGg6IHBhZ2UsIHJvYm90cyB9IG9mIHVubGlzdGVkUGFnZXMoKSkge1xuICAgICAgICB0aGlzLmVtaXRGaWxlKHsgdHlwZTogJ2Fzc2V0JywgZmlsZU5hbWU6IGAke3BhZ2V9Lmh0bWxgLCBzb3VyY2U6IHdpdGhSb2JvdHMoaHRtbCwgcm9ib3RzKSB9KTtcbiAgICAgIH1cbiAgICAgIHRoaXMuZW1pdEZpbGUoeyB0eXBlOiAnYXNzZXQnLCBmaWxlTmFtZTogJ3NpdGVtYXAueG1sJywgc291cmNlOiBzaXRlbWFwWG1sKHNpdGVtYXBVcmxzKGNvbXBpbGUoKSkpIH0pO1xuICAgICAgdGhpcy5lbWl0RmlsZSh7IHR5cGU6ICdhc3NldCcsIGZpbGVOYW1lOiAncm9ib3RzLnR4dCcsIHNvdXJjZTogcm9ib3RzVHh0KCkgfSk7XG4gICAgfSxcbiAgfTtcbiAgcmV0dXJuIFtjb250ZW50LCBwYWdlSGVhZHNdO1xufVxuIiwgImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS91c2VyL3ZvbHRleC1yYy9mcm9udGVuZC9zcmMvbGliL2NvbnRlbnRcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9ob21lL3VzZXIvdm9sdGV4LXJjL2Zyb250ZW5kL3NyYy9saWIvY29udGVudC9jb21waWxlLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9ob21lL3VzZXIvdm9sdGV4LXJjL2Zyb250ZW5kL3NyYy9saWIvY29udGVudC9jb21waWxlLnRzXCI7aW1wb3J0IHsgTWFya2VkLCB0eXBlIFRva2VucyB9IGZyb20gJ21hcmtlZCc7XG5pbXBvcnQgdHlwZSB7XG4gIEFjYWRlbXlDb250ZW50LCBBY2FkZW15U2VjdGlvbiwgQXJ0aWNsZSwgQnlMYW5nLCBGYXFJdGVtLCBGZWVzLCBHbG9zc2FyeVRlcm0sIEhlbHBDb250ZW50LCBJbmNpZGVudCxcbiAgU3RhdHVzQ29tcG9uZW50LCBUb2NFbnRyeSxcbn0gZnJvbSAnLi90eXBlcyc7XG5pbXBvcnQgeyBTSVRFX09SSUdJTiB9IGZyb20gJy4uL3Nlby9zaXRlJztcblxuLyoqXG4gKiBCdWlsZC10aW1lIGNvbXBpbGVyIGZvciBmcm9udGVuZC9jb250ZW50Ly4gUHVyZTogaXQgdGFrZXMgdGhlIGZpbGVzIGFzXG4gKiB0ZXh0IGtleWVkIGJ5IHRoZWlyIHBhdGggaW5zaWRlIGNvbnRlbnQvIChcInJ1L2FjYWRlbXkvb3Nub3Z5L3gubWRcIikgYW5kXG4gKiByZXR1cm5zIGZpbmlzaGVkIGRhdGEsIHNvIHRoZSBWaXRlIHBsdWdpbiBhbmQgdGhlIEplc3Qgc3VpdGUgcnVuIHRoZSB2ZXJ5XG4gKiBzYW1lIGNvZGUuIE5vdGhpbmcgaGVyZSBzaGlwcyB0byB0aGUgYnJvd3Nlci5cbiAqL1xuXG5leHBvcnQgaW50ZXJmYWNlIENvbXBpbGVkQ29udGVudCB7XG4gIGFjYWRlbXk6IEJ5TGFuZzxBY2FkZW15Q29udGVudD47XG4gIGhlbHA6IEJ5TGFuZzxIZWxwQ29udGVudD47XG4gIC8qKiBCcm9rZW4gYHJlbGF0ZWRgIC8gZ2xvc3NhcnkgbGlua3MgYW5kIG90aGVyIG1pc3Rha2VzLCBpbiBwbGFpbiB3b3Jkcy4gKi9cbiAgcHJvYmxlbXM6IHN0cmluZ1tdO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFNlb1BhZ2Uge1xuICBwYXRoOiBzdHJpbmc7XG4gIHRpdGxlOiBzdHJpbmc7XG4gIGRlc2NyaXB0aW9uOiBzdHJpbmc7XG4gIC8qKiBBYnNvbHV0ZSBVUkwgc2VhcmNoIGVuZ2luZXMgc2hvdWxkIGluZGV4IGluc3RlYWQgb2YgdGhpcyBhZGRyZXNzIChhIHBhZ2UgdGhlIGFwcCByZWRpcmVjdHMgZWxzZXdoZXJlKS4gKi9cbiAgY2Fub25pY2FsPzogc3RyaW5nO1xufVxuXG50eXBlIEZyb250bWF0dGVyID0gUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVtYmVyIHwgc3RyaW5nW10+O1xuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VGcm9udG1hdHRlcihzb3VyY2U6IHN0cmluZyk6IHsgZGF0YTogRnJvbnRtYXR0ZXI7IGJvZHk6IHN0cmluZyB9IHtcbiAgY29uc3QgbWF0Y2ggPSAvXlx1RkVGRj8tLS1cXHI/XFxuKFtcXHNcXFNdKj8pXFxyP1xcbi0tLVsgXFx0XSooPzpcXHI/XFxufCQpLy5leGVjKHNvdXJjZSk7XG4gIGlmICghbWF0Y2gpIHJldHVybiB7IGRhdGE6IHt9LCBib2R5OiBzb3VyY2UgfTtcbiAgY29uc3QgZGF0YTogRnJvbnRtYXR0ZXIgPSB7fTtcbiAgZm9yIChjb25zdCBsaW5lIG9mIG1hdGNoWzFdLnNwbGl0KC9cXHI/XFxuLykpIHtcbiAgICBjb25zdCBmaWVsZCA9IC9eKFtBLVphLXpfXVtcXHctXSopXFxzKjpcXHMqKC4qKSQvLmV4ZWMobGluZSk7XG4gICAgaWYgKGZpZWxkKSBkYXRhW2ZpZWxkWzFdXSA9IGZyb250bWF0dGVyVmFsdWUoZmllbGRbMl0udHJpbSgpKTtcbiAgfVxuICByZXR1cm4geyBkYXRhLCBib2R5OiBzb3VyY2Uuc2xpY2UobWF0Y2hbMF0ubGVuZ3RoKSB9O1xufVxuXG5mdW5jdGlvbiB1bnF1b3RlKHZhbHVlOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gL14oWydcIl0pLipcXDEkLy50ZXN0KHZhbHVlKSA/IHZhbHVlLnNsaWNlKDEsIC0xKSA6IHZhbHVlO1xufVxuXG5mdW5jdGlvbiBmcm9udG1hdHRlclZhbHVlKHJhdzogc3RyaW5nKTogc3RyaW5nIHwgbnVtYmVyIHwgc3RyaW5nW10ge1xuICBpZiAoL15cXFsuKlxcXSQvLnRlc3QocmF3KSkge1xuICAgIHJldHVybiByYXcuc2xpY2UoMSwgLTEpLnNwbGl0KCcsJykubWFwKChpdGVtKSA9PiB1bnF1b3RlKGl0ZW0udHJpbSgpKSkuZmlsdGVyKEJvb2xlYW4pO1xuICB9XG4gIGlmICgvXi0/XFxkKyhcXC5cXGQrKT8kLy50ZXN0KHJhdykpIHJldHVybiBOdW1iZXIocmF3KTtcbiAgcmV0dXJuIHVucXVvdGUocmF3KTtcbn1cblxuY29uc3QgZXNjYXBlSHRtbCA9ICh0ZXh0OiBzdHJpbmcpID0+XG4gIHRleHQucmVwbGFjZSgvJi9nLCAnJmFtcDsnKS5yZXBsYWNlKC88L2csICcmbHQ7JykucmVwbGFjZSgvPi9nLCAnJmd0OycpLnJlcGxhY2UoL1wiL2csICcmcXVvdDsnKTtcblxuY29uc3QgcGxhaW5UZXh0ID0gKG1hcmtkb3duOiBzdHJpbmcpID0+IG1hcmtkb3duLnJlcGxhY2UoL1sqX2BdL2csICcnKS50cmltKCk7XG5cbi8qKiBNYXJrZG93biBcdTIxOTIgSFRNTC4gSFRNTCBjb21tZW50cyBhcmUgZHJvcHBlZDsgYW55IG90aGVyIHJhdyBIVE1MIGlzIHNob3duXG4gKiBhcyB0ZXh0LCBuZXZlciBleGVjdXRlZC4gYCMjYCBoZWFkaW5ncyBnZXQgaWRzIGZvciBhIHRhYmxlIG9mIGNvbnRlbnRzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlbmRlck1hcmtkb3duKHNvdXJjZTogc3RyaW5nKTogeyBodG1sOiBzdHJpbmc7IHRvYzogVG9jRW50cnlbXSB9IHtcbiAgY29uc3QgdG9jOiBUb2NFbnRyeVtdID0gW107XG4gIGNvbnN0IG1hcmtlZCA9IG5ldyBNYXJrZWQoeyBnZm06IHRydWUsIGJyZWFrczogdHJ1ZSB9KTtcbiAgbWFya2VkLnVzZSh7XG4gICAgcmVuZGVyZXI6IHtcbiAgICAgIGhlYWRpbmcodGhpczogeyBwYXJzZXI6IHsgcGFyc2VJbmxpbmUodG9rZW5zOiBUb2tlbnMuR2VuZXJpY1tdKTogc3RyaW5nIH0gfSwgdG9rZW46IFRva2Vucy5IZWFkaW5nKSB7XG4gICAgICAgIGNvbnN0IGlubmVyID0gdGhpcy5wYXJzZXIucGFyc2VJbmxpbmUodG9rZW4udG9rZW5zKTtcbiAgICAgICAgaWYgKHRva2VuLmRlcHRoICE9PSAyKSByZXR1cm4gYDxoJHt0b2tlbi5kZXB0aH0+JHtpbm5lcn08L2gke3Rva2VuLmRlcHRofT5cXG5gO1xuICAgICAgICBjb25zdCBpZCA9IGBzZWN0aW9uLSR7dG9jLmxlbmd0aCArIDF9YDtcbiAgICAgICAgdG9jLnB1c2goeyBpZCwgdGl0bGU6IHBsYWluVGV4dCh0b2tlbi50ZXh0KSB9KTtcbiAgICAgICAgcmV0dXJuIGA8aDIgaWQ9XCIke2lkfVwiPiR7aW5uZXJ9PC9oMj5cXG5gO1xuICAgICAgfSxcbiAgICAgIGh0bWwodG9rZW46IFRva2Vucy5IVE1MIHwgVG9rZW5zLlRhZykge1xuICAgICAgICByZXR1cm4gZXNjYXBlSHRtbCh0b2tlbi50ZXh0KTtcbiAgICAgIH0sXG4gICAgfSxcbiAgfSk7XG4gIGNvbnN0IHdpdGhvdXRDb21tZW50cyA9IHNvdXJjZS5yZXBsYWNlKC88IS0tW1xcc1xcU10qPy0tPi9nLCAnJyk7XG4gIGNvbnN0IGh0bWwgPSAobWFya2VkLnBhcnNlKHdpdGhvdXRDb21tZW50cywgeyBhc3luYzogZmFsc2UgfSkgYXMgc3RyaW5nKVxuICAgIC8vIFRhYmxlcyBzY3JvbGwgaW5zaWRlIHRoZWlyIG93biBib3ggb24gYSBwaG9uZTsgdGhlIHBhZ2UgbmV2ZXIgZG9lcy5cbiAgICAucmVwbGFjZSgvPHRhYmxlPi9nLCAnPGRpdiBjbGFzcz1cInZ4LW1kLXRhYmxlXCI+PHRhYmxlPicpXG4gICAgLnJlcGxhY2UoLzxcXC90YWJsZT4vZywgJzwvdGFibGU+PC9kaXY+Jyk7XG4gIHJldHVybiB7IGh0bWwsIHRvYyB9O1xufVxuXG4vKiogRmllbGRzIHdob3NlIG5hbWUgc3RhcnRzIHdpdGggXHUwMEFCX1x1MDBCQiBhcmUgbm90ZXMgZm9yIHdob2V2ZXIgZWRpdHMgdGhlIGZpbGUuICovXG5mdW5jdGlvbiB3aXRob3V0Tm90ZXM8VD4odmFsdWU6IFQpOiBUIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSByZXR1cm4gdmFsdWUubWFwKHdpdGhvdXROb3RlcykgYXMgVDtcbiAgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcpIHtcbiAgICByZXR1cm4gT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgICAgT2JqZWN0LmVudHJpZXModmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pXG4gICAgICAgIC5maWx0ZXIoKFtrZXldKSA9PiAha2V5LnN0YXJ0c1dpdGgoJ18nKSlcbiAgICAgICAgLm1hcCgoW2tleSwgaXRlbV0pID0+IFtrZXksIHdpdGhvdXROb3RlcyhpdGVtKV0pLFxuICAgICkgYXMgVDtcbiAgfVxuICByZXR1cm4gdmFsdWU7XG59XG5cbmZ1bmN0aW9uIHJlYWRKc29uPFQ+KGZpbGVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LCBwYXRoOiBzdHJpbmcsIHByb2JsZW1zOiBzdHJpbmdbXSk6IFQgfCB1bmRlZmluZWQge1xuICBpZiAoIShwYXRoIGluIGZpbGVzKSkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgdHJ5IHtcbiAgICByZXR1cm4gd2l0aG91dE5vdGVzKEpTT04ucGFyc2UoZmlsZXNbcGF0aF0pIGFzIFQpO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHByb2JsZW1zLnB1c2goYCR7cGF0aH06IFx1MDQ0NFx1MDQzMFx1MDQzOVx1MDQzQiBcdTA0M0RcdTA0MzUgXHUwNDQ3XHUwNDM4XHUwNDQyXHUwNDMwXHUwNDM1XHUwNDQyXHUwNDQxXHUwNDRGIFx1MDQzQVx1MDQzMFx1MDQzQSBKU09OICgkeyhlcnJvciBhcyBFcnJvcikubWVzc2FnZX0pYCk7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxufVxuXG5jb25zdCBzdHIgPSAodmFsdWU6IHVua25vd24sIGZhbGxiYWNrID0gJycpID0+ICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnID8gdmFsdWUgOiB0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInID8gU3RyaW5nKHZhbHVlKSA6IGZhbGxiYWNrKTtcbmNvbnN0IG51bSA9ICh2YWx1ZTogdW5rbm93biwgZmFsbGJhY2s6IG51bWJlcikgPT4gKHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicgPyB2YWx1ZSA6IE51bWJlcih2YWx1ZSkgfHwgZmFsbGJhY2spO1xuXG5mdW5jdGlvbiBjb21waWxlQWNhZGVteShsYW5nOiBzdHJpbmcsIGZpbGVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LCBwcm9ibGVtczogc3RyaW5nW10pOiBBY2FkZW15Q29udGVudCB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IHJvb3QgPSBgJHtsYW5nfS9hY2FkZW15L2A7XG4gIGNvbnN0IHNlY3Rpb25zRmlsZSA9IGAke3Jvb3R9X3NlY3Rpb25zLmpzb25gO1xuICBjb25zdCByYXdTZWN0aW9ucyA9IHJlYWRKc29uPEFjYWRlbXlTZWN0aW9uW10+KGZpbGVzLCBzZWN0aW9uc0ZpbGUsIHByb2JsZW1zKTtcbiAgaWYgKCFyYXdTZWN0aW9ucykgcmV0dXJuIHVuZGVmaW5lZDtcbiAgY29uc3Qgc2VjdGlvbnMgPSByYXdTZWN0aW9uc1xuICAgIC5tYXAoKHMpID0+ICh7IGlkOiBzdHIocy5pZCksIHRpdGxlOiBzdHIocy50aXRsZSksIGRlc2NyaXB0aW9uOiBzdHIocy5kZXNjcmlwdGlvbiksIG9yZGVyOiBudW0ocy5vcmRlciwgOTk5KSB9KSlcbiAgICAuc29ydCgoYSwgYikgPT4gYS5vcmRlciAtIGIub3JkZXIpO1xuICBjb25zdCBzZWN0aW9uSWRzID0gbmV3IFNldChzZWN0aW9ucy5tYXAoKHMpID0+IHMuaWQpKTtcblxuICBjb25zdCBhcnRpY2xlczogQXJ0aWNsZVtdID0gW107XG4gIGZvciAoY29uc3QgW3BhdGgsIHNvdXJjZV0gb2YgT2JqZWN0LmVudHJpZXMoZmlsZXMpKSB7XG4gICAgY29uc3QgcGFydHMgPSAvXihbXi9dKylcXC9hY2FkZW15XFwvKFteL10rKVxcLyhbXi9dKylcXC5tZCQvLmV4ZWMocGF0aCk7XG4gICAgaWYgKCFwYXJ0cyB8fCBwYXJ0c1sxXSAhPT0gbGFuZykgY29udGludWU7XG4gICAgY29uc3QgeyBkYXRhLCBib2R5IH0gPSBwYXJzZUZyb250bWF0dGVyKHNvdXJjZSk7XG4gICAgY29uc3QgYXJ0aWNsZTogQXJ0aWNsZSA9IHtcbiAgICAgIHNsdWc6IHN0cihkYXRhLnNsdWcsIHBhcnRzWzNdKSxcbiAgICAgIHNlY3Rpb246IHN0cihkYXRhLnNlY3Rpb24sIHBhcnRzWzJdKSxcbiAgICAgIHRpdGxlOiBzdHIoZGF0YS50aXRsZSwgcGFydHNbM10pLFxuICAgICAgb3JkZXI6IG51bShkYXRhLm9yZGVyLCA5OTkpLFxuICAgICAgbGV2ZWw6IHN0cihkYXRhLmxldmVsKSxcbiAgICAgIHJlYWRUaW1lOiBudW0oZGF0YS5yZWFkVGltZSwgMCksXG4gICAgICBzdW1tYXJ5OiBzdHIoZGF0YS5zdW1tYXJ5KSxcbiAgICAgIHJlbGF0ZWQ6IEFycmF5LmlzQXJyYXkoZGF0YS5yZWxhdGVkKSA/IGRhdGEucmVsYXRlZCA6IFtdLFxuICAgICAgaHRtbDogcmVuZGVyTWFya2Rvd24oYm9keSkuaHRtbCxcbiAgICB9O1xuICAgIGlmICghc2VjdGlvbklkcy5oYXMoYXJ0aWNsZS5zZWN0aW9uKSkgcHJvYmxlbXMucHVzaChgJHtwYXRofTogXHUwNDQwXHUwNDMwXHUwNDM3XHUwNDM0XHUwNDM1XHUwNDNCIFx1MDBBQiR7YXJ0aWNsZS5zZWN0aW9ufVx1MDBCQiBcdTA0M0RcdTA0MzUgXHUwNDNEXHUwNDMwXHUwNDM5XHUwNDM0XHUwNDM1XHUwNDNEIFx1MDQzMiBfc2VjdGlvbnMuanNvbmApO1xuICAgIGlmIChhcnRpY2xlcy5zb21lKChhKSA9PiBhLnNsdWcgPT09IGFydGljbGUuc2x1ZykpIHByb2JsZW1zLnB1c2goYCR7cGF0aH06IHNsdWcgXHUwMEFCJHthcnRpY2xlLnNsdWd9XHUwMEJCIFx1MDQ0M1x1MDQzNlx1MDQzNSBcdTA0MzdcdTA0MzBcdTA0M0RcdTA0NEZcdTA0NDIgXHUwNDM0XHUwNDQwXHUwNDQzXHUwNDMzXHUwNDNFXHUwNDM5IFx1MDQ0MVx1MDQ0Mlx1MDQzMFx1MDQ0Mlx1MDQ0Q1x1MDQ1MVx1MDQzOWApO1xuICAgIGFydGljbGVzLnB1c2goYXJ0aWNsZSk7XG4gIH1cbiAgYXJ0aWNsZXMuc29ydCgoYSwgYikgPT4gYS5vcmRlciAtIGIub3JkZXIgfHwgYS50aXRsZS5sb2NhbGVDb21wYXJlKGIudGl0bGUsICdydScpKTtcblxuICBjb25zdCBnbG9zc2FyeSA9IChyZWFkSnNvbjxHbG9zc2FyeVRlcm1bXT4oZmlsZXMsIGAke3Jvb3R9Z2xvc3NhcnkuanNvbmAsIHByb2JsZW1zKSA/PyBbXSlcbiAgICAubWFwKChnKSA9PiAoeyB0ZXJtOiBzdHIoZy50ZXJtKSwgZGVmOiBzdHIoZy5kZWYpLCAuLi4oZy5saW5rID8geyBsaW5rOiBzdHIoZy5saW5rKSB9IDoge30pIH0pKTtcblxuICBjb25zdCBzbHVncyA9IG5ldyBTZXQoYXJ0aWNsZXMubWFwKChhKSA9PiBhLnNsdWcpKTtcbiAgZm9yIChjb25zdCBhcnRpY2xlIG9mIGFydGljbGVzKSB7XG4gICAgZm9yIChjb25zdCBzbHVnIG9mIGFydGljbGUucmVsYXRlZCkge1xuICAgICAgaWYgKCFzbHVncy5oYXMoc2x1ZykpIHByb2JsZW1zLnB1c2goYCR7bGFuZ30vYWNhZGVteS8ke2FydGljbGUuc2VjdGlvbn0vJHthcnRpY2xlLnNsdWd9Lm1kOiBcdTA0MzIgcmVsYXRlZCBcdTA0NDNcdTA0M0FcdTA0MzBcdTA0MzdcdTA0MzBcdTA0M0RcdTA0MzAgXHUwNDNEXHUwNDM1XHUwNDQxXHUwNDQzXHUwNDQ5XHUwNDM1XHUwNDQxXHUwNDQyXHUwNDMyXHUwNDQzXHUwNDRFXHUwNDQ5XHUwNDMwXHUwNDRGIFx1MDQ0MVx1MDQ0Mlx1MDQzMFx1MDQ0Mlx1MDQ0Q1x1MDQ0RiBcdTAwQUIke3NsdWd9XHUwMEJCYCk7XG4gICAgfVxuICB9XG4gIGZvciAoY29uc3QgdGVybSBvZiBnbG9zc2FyeSkge1xuICAgIGlmICh0ZXJtLmxpbmsgJiYgIXNsdWdzLmhhcyh0ZXJtLmxpbmspKSBwcm9ibGVtcy5wdXNoKGAke3Jvb3R9Z2xvc3NhcnkuanNvbjogXHUwNDQyXHUwNDM1XHUwNDQwXHUwNDNDXHUwNDM4XHUwNDNEIFx1MDBBQiR7dGVybS50ZXJtfVx1MDBCQiBcdTA0NDFcdTA0NDFcdTA0NEJcdTA0M0JcdTA0MzBcdTA0MzVcdTA0NDJcdTA0NDFcdTA0NEYgXHUwNDNEXHUwNDMwIFx1MDQzRFx1MDQzNVx1MDQ0MVx1MDQ0M1x1MDQ0OVx1MDQzNVx1MDQ0MVx1MDQ0Mlx1MDQzMlx1MDQ0M1x1MDQ0RVx1MDQ0OVx1MDQ0M1x1MDQ0RSBcdTA0NDFcdTA0NDJcdTA0MzBcdTA0NDJcdTA0NENcdTA0NEUgXHUwMEFCJHt0ZXJtLmxpbmt9XHUwMEJCYCk7XG4gIH1cbiAgcmV0dXJuIHsgc2VjdGlvbnMsIGFydGljbGVzLCBnbG9zc2FyeSB9O1xufVxuXG5mdW5jdGlvbiBjb21waWxlSGVscChsYW5nOiBzdHJpbmcsIGZpbGVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LCBwcm9ibGVtczogc3RyaW5nW10pOiBIZWxwQ29udGVudCB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IHJvb3QgPSBgJHtsYW5nfS9oZWxwL2A7XG4gIGlmICghT2JqZWN0LmtleXMoZmlsZXMpLnNvbWUoKHBhdGgpID0+IHBhdGguc3RhcnRzV2l0aChyb290KSkpIHJldHVybiB1bmRlZmluZWQ7XG4gIGNvbnN0IGZhcSA9IChyZWFkSnNvbjxGYXFJdGVtW10+KGZpbGVzLCBgJHtyb290fWZhcS5qc29uYCwgcHJvYmxlbXMpID8/IFtdKVxuICAgIC5tYXAoKGl0ZW0pID0+ICh7IGdyb3VwOiBzdHIoaXRlbS5ncm91cCksIHE6IHN0cihpdGVtLnEpLCBhOiBzdHIoaXRlbS5hKSB9KSk7XG4gIGNvbnN0IGZlZXMgPSByZWFkSnNvbjxGZWVzPihmaWxlcywgYCR7cm9vdH1mZWVzLmpzb25gLCBwcm9ibGVtcykgPz8ge307XG4gIGNvbnN0IGZlZXNIdG1sID0gZmlsZXNbYCR7cm9vdH1mZWVzLm1kYF0gPyByZW5kZXJNYXJrZG93bihwYXJzZUZyb250bWF0dGVyKGZpbGVzW2Ake3Jvb3R9ZmVlcy5tZGBdKS5ib2R5KS5odG1sIDogJyc7XG4gIGNvbnN0IHJ1bGVzID0gZmlsZXNbYCR7cm9vdH1ydWxlcy5tZGBdID8gcmVuZGVyTWFya2Rvd24ocGFyc2VGcm9udG1hdHRlcihmaWxlc1tgJHtyb290fXJ1bGVzLm1kYF0pLmJvZHkpIDogeyBodG1sOiAnJywgdG9jOiBbXSB9O1xuICBjb25zdCBzdGF0dXMgPSByZWFkSnNvbjx7IGNvbXBvbmVudHM/OiBTdGF0dXNDb21wb25lbnRbXTsgaW5jaWRlbnRzPzogSW5jaWRlbnRbXSB9PihmaWxlcywgYCR7cm9vdH1pbmNpZGVudHMuanNvbmAsIHByb2JsZW1zKSA/PyB7fTtcbiAgcmV0dXJuIHtcbiAgICBmYXEsXG4gICAgZmVlcyxcbiAgICBmZWVzSHRtbCxcbiAgICBydWxlc0h0bWw6IHJ1bGVzLmh0bWwsXG4gICAgcnVsZXNUb2M6IHJ1bGVzLnRvYyxcbiAgICBjb21wb25lbnRzOiAoc3RhdHVzLmNvbXBvbmVudHMgPz8gW10pLm1hcCgoYykgPT4gKHsgaWQ6IHN0cihjLmlkKSwgbmFtZTogc3RyKGMubmFtZSkgfSkpLFxuICAgIGluY2lkZW50czogc3RhdHVzLmluY2lkZW50cyA/PyBbXSxcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNvbXBpbGVDb250ZW50KGZpbGVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+KTogQ29tcGlsZWRDb250ZW50IHtcbiAgY29uc3QgcHJvYmxlbXM6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IGxhbmdzID0gWy4uLm5ldyBTZXQoT2JqZWN0LmtleXMoZmlsZXMpLm1hcCgocGF0aCkgPT4gcGF0aC5zcGxpdCgnLycpWzBdKSldLnNvcnQoKTtcbiAgY29uc3QgYWNhZGVteTogUGFydGlhbDxSZWNvcmQ8c3RyaW5nLCBBY2FkZW15Q29udGVudD4+ID0ge307XG4gIGNvbnN0IGhlbHA6IFBhcnRpYWw8UmVjb3JkPHN0cmluZywgSGVscENvbnRlbnQ+PiA9IHt9O1xuICBmb3IgKGNvbnN0IGxhbmcgb2YgbGFuZ3MpIHtcbiAgICBjb25zdCBhID0gY29tcGlsZUFjYWRlbXkobGFuZywgZmlsZXMsIHByb2JsZW1zKTtcbiAgICBpZiAoYSkgYWNhZGVteVtsYW5nXSA9IGE7XG4gICAgY29uc3QgaCA9IGNvbXBpbGVIZWxwKGxhbmcsIGZpbGVzLCBwcm9ibGVtcyk7XG4gICAgaWYgKGgpIGhlbHBbbGFuZ10gPSBoO1xuICB9XG4gIGlmICghYWNhZGVteS5ydSkgcHJvYmxlbXMucHVzaCgnXHUwNDFEXHUwNDM1XHUwNDQyIHJ1L2FjYWRlbXkvX3NlY3Rpb25zLmpzb24gXHUyMDE0IFx1MDQxMFx1MDQzQVx1MDQzMFx1MDQzNFx1MDQzNVx1MDQzQ1x1MDQzOFx1MDQ0RiBcdTA0MzFcdTA0MzVcdTA0MzcgXHUwNDQwXHUwNDQzXHUwNDQxXHUwNDQxXHUwNDNBXHUwNDNFXHUwNDMzXHUwNDNFIFx1MDQ0Mlx1MDQzNVx1MDQzQVx1MDQ0MVx1MDQ0Mlx1MDQzMCBcdTA0M0RcdTA0MzUgXHUwNDQxXHUwNDNFXHUwNDMxXHUwNDM4XHUwNDQwXHUwNDMwXHUwNDM1XHUwNDQyXHUwNDQxXHUwNDRGJyk7XG4gIGlmICghaGVscC5ydSkgcHJvYmxlbXMucHVzaCgnXHUwNDFEXHUwNDM1XHUwNDQyIFx1MDQzRlx1MDQzMFx1MDQzRlx1MDQzQVx1MDQzOCBydS9oZWxwIFx1MjAxNCBcdTA0MUZcdTA0M0VcdTA0M0NcdTA0M0VcdTA0NDlcdTA0NEMgXHUwNDMxXHUwNDM1XHUwNDM3IFx1MDQ0MFx1MDQ0M1x1MDQ0MVx1MDQ0MVx1MDQzQVx1MDQzRVx1MDQzM1x1MDQzRSBcdTA0NDJcdTA0MzVcdTA0M0FcdTA0NDFcdTA0NDJcdTA0MzAgXHUwNDNEXHUwNDM1IFx1MDQ0MVx1MDQzRVx1MDQzMVx1MDQzOFx1MDQ0MFx1MDQzMFx1MDQzNVx1MDQ0Mlx1MDQ0MVx1MDQ0RicpO1xuICByZXR1cm4ge1xuICAgIGFjYWRlbXk6IHsgLi4uYWNhZGVteSwgcnU6IGFjYWRlbXkucnUgPz8geyBzZWN0aW9uczogW10sIGFydGljbGVzOiBbXSwgZ2xvc3Nhcnk6IFtdIH0gfSxcbiAgICBoZWxwOiB7IC4uLmhlbHAsIHJ1OiBoZWxwLnJ1ID8/IHsgZmFxOiBbXSwgZmVlczoge30sIGZlZXNIdG1sOiAnJywgcnVsZXNIdG1sOiAnJywgcnVsZXNUb2M6IFtdLCBjb21wb25lbnRzOiBbXSwgaW5jaWRlbnRzOiBbXSB9IH0sXG4gICAgcHJvYmxlbXMsXG4gIH07XG59XG5cbmV4cG9ydCBjb25zdCBBQ0FERU1ZX1RJVExFID0gJ1x1MDQxMFx1MDQzQVx1MDQzMFx1MDQzNFx1MDQzNVx1MDQzQ1x1MDQzOFx1MDQ0RiBWT0xURVgnO1xuZXhwb3J0IGNvbnN0IEFDQURFTVlfREVTQ1JJUFRJT04gPSAnXHUwNDExXHUwNDM1XHUwNDQxXHUwNDNGXHUwNDNCXHUwNDMwXHUwNDQyXHUwNDNEXHUwNDRCXHUwNDM1IFx1MDQ0MVx1MDQ0Mlx1MDQzMFx1MDQ0Mlx1MDQ0Q1x1MDQzOCBcdTA0M0UgXHUwNDNBXHUwNDQwXHUwNDM4XHUwNDNGXHUwNDQyXHUwNDNFXHUwNDMyXHUwNDMwXHUwNDNCXHUwNDRFXHUwNDQyXHUwNDM1LCBcdTA0NDRcdTA0NENcdTA0NEVcdTA0NDdcdTA0MzVcdTA0NDBcdTA0NDFcdTA0MzBcdTA0NDUsIFx1MDQ0MFx1MDQzOFx1MDQ0MVx1MDQzQVx1MDQzMFx1MDQ0NSBcdTA0MzggXHUwNDMxXHUwNDM1XHUwNDM3XHUwNDNFXHUwNDNGXHUwNDMwXHUwNDQxXHUwNDNEXHUwNDNFXHUwNDQxXHUwNDQyXHUwNDM4IFx1MjAxNCBcdTA0M0ZcdTA0NDBcdTA0M0VcdTA0NDFcdTA0NDJcdTA0NEJcdTA0M0MgXHUwNDRGXHUwNDM3XHUwNDRCXHUwNDNBXHUwNDNFXHUwNDNDLic7XG5leHBvcnQgY29uc3QgSEVMUF9USVRMRSA9ICdcdTA0MUZcdTA0M0VcdTA0M0NcdTA0M0VcdTA0NDlcdTA0NEMgVk9MVEVYJztcbmV4cG9ydCBjb25zdCBGQVFfREVTQ1JJUFRJT04gPSAnXHUwNDFFXHUwNDQyXHUwNDMyXHUwNDM1XHUwNDQyXHUwNDRCIFx1MDQzRFx1MDQzMCBcdTA0NDdcdTA0MzBcdTA0NDFcdTA0NDJcdTA0NEJcdTA0MzUgXHUwNDMyXHUwNDNFXHUwNDNGXHUwNDQwXHUwNDNFXHUwNDQxXHUwNDRCIFx1MDQzRVx1MDQzMSBcdTA0MzBcdTA0M0FcdTA0M0FcdTA0MzBcdTA0NDNcdTA0M0RcdTA0NDJcdTA0MzUsIFx1MDQzRlx1MDQzRVx1MDQzRlx1MDQzRVx1MDQzQlx1MDQzRFx1MDQzNVx1MDQzRFx1MDQzOFx1MDQzOCwgXHUwNDQyXHUwNDNFXHUwNDQwXHUwNDMzXHUwNDNFXHUwNDMyXHUwNDNCXHUwNDM1IFx1MDQzOCBcdTA0MzJcdTA0NEJcdTA0MzJcdTA0M0VcdTA0MzRcdTA0MzUgXHUwNDNEXHUwNDMwIFZPTFRFWC4nO1xuZXhwb3J0IGNvbnN0IEtOT1dMRURHRV9ERVNDUklQVElPTiA9ICdcdTA0MUZcdTA0NDBcdTA0MzBcdTA0M0FcdTA0NDJcdTA0MzhcdTA0NDdcdTA0MzVcdTA0NDFcdTA0M0FcdTA0MzBcdTA0NEYgXHUwNDM4XHUwNDNEXHUwNDQ0XHUwNDNFXHUwNDQwXHUwNDNDXHUwNDMwXHUwNDQ2XHUwNDM4XHUwNDRGIFx1MDQzRSBcdTA0M0FcdTA0M0VcdTA0M0NcdTA0MzhcdTA0NDFcdTA0NDFcdTA0MzhcdTA0NEZcdTA0NDUgXHUwNDM4IFx1MDQzRlx1MDQ0MFx1MDQzMFx1MDQzMlx1MDQzOFx1MDQzQlx1MDQzMFx1MDQ0NSBcdTA0NDJcdTA0M0VcdTA0NDBcdTA0MzNcdTA0M0VcdTA0MzJcdTA0M0JcdTA0MzggXHUwNDNEXHUwNDMwIFZPTFRFWC4nO1xuXG4vKiogT25lIGVudHJ5IHBlciBwdWJsaWMgQWNhZGVteS9IZWxwIGFkZHJlc3MsIGZvciB0aGUgc3RhdGljIDx0aXRsZT4gYW5kXG4gKiBkZXNjcmlwdGlvbiBzZWFyY2ggZW5naW5lcyByZWFkIGJlZm9yZSBhbnkgc2NyaXB0IHJ1bnMuICovXG5leHBvcnQgZnVuY3Rpb24gc2VvUGFnZXMoY29udGVudDogQ29tcGlsZWRDb250ZW50KTogU2VvUGFnZVtdIHtcbiAgY29uc3QgeyBzZWN0aW9ucywgYXJ0aWNsZXMgfSA9IGNvbnRlbnQuYWNhZGVteS5ydTtcbiAgY29uc3QgcGFnZXM6IFNlb1BhZ2VbXSA9IFtcbiAgICB7IHBhdGg6ICdhY2FkZW15JywgdGl0bGU6IEFDQURFTVlfVElUTEUsIGRlc2NyaXB0aW9uOiBBQ0FERU1ZX0RFU0NSSVBUSU9OIH0sXG4gICAgeyBwYXRoOiAnYWNhZGVteS9sZWFybicsIHRpdGxlOiBgXHUwNDFFXHUwNDMxXHUwNDQzXHUwNDQ3XHUwNDM1XHUwNDNEXHUwNDM4XHUwNDM1IFx1MjAxNCAke0FDQURFTVlfVElUTEV9YCwgZGVzY3JpcHRpb246IEFDQURFTVlfREVTQ1JJUFRJT04gfSxcbiAgICB7IHBhdGg6ICdhY2FkZW15L2tub3dsZWRnZScsIHRpdGxlOiBgXHUwNDExXHUwNDMwXHUwNDM3XHUwNDMwIFx1MDQzN1x1MDQzRFx1MDQzMFx1MDQzRFx1MDQzOFx1MDQzOSBcdTIwMTQgJHtBQ0FERU1ZX1RJVExFfWAsIGRlc2NyaXB0aW9uOiBLTk9XTEVER0VfREVTQ1JJUFRJT04gfSxcbiAgICB7IHBhdGg6ICdhY2FkZW15L2ZhcScsIHRpdGxlOiBgXHUwNDEyXHUwNDNFXHUwNDNGXHUwNDQwXHUwNDNFXHUwNDQxXHUwNDRCIFx1MDQzOCBcdTA0M0VcdTA0NDJcdTA0MzJcdTA0MzVcdTA0NDJcdTA0NEIgXHUyMDE0ICR7QUNBREVNWV9USVRMRX1gLCBkZXNjcmlwdGlvbjogRkFRX0RFU0NSSVBUSU9OIH0sXG4gICAgeyBwYXRoOiAnYWNhZGVteS9nbG9zc2FyeScsIHRpdGxlOiBgXHUwNDEzXHUwNDNCXHUwNDNFXHUwNDQxXHUwNDQxXHUwNDMwXHUwNDQwXHUwNDM4XHUwNDM5IFx1MjAxNCAke0FDQURFTVlfVElUTEV9YCwgZGVzY3JpcHRpb246ICdcdTA0MUFcdTA0M0VcdTA0NDBcdTA0M0VcdTA0NDJcdTA0M0FcdTA0MzhcdTA0MzUgXHUwNDNFXHUwNDNGXHUwNDQwXHUwNDM1XHUwNDM0XHUwNDM1XHUwNDNCXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDRGIFx1MDQzRVx1MDQ0MVx1MDQzRFx1MDQzRVx1MDQzMlx1MDQzRFx1MDQ0Qlx1MDQ0NSBcdTA0NDJcdTA0MzVcdTA0NDBcdTA0M0NcdTA0MzhcdTA0M0RcdTA0M0VcdTA0MzIgXHUwNDNBXHUwNDQwXHUwNDM4XHUwNDNGXHUwNDQyXHUwNDNFXHUwNDMyXHUwNDMwXHUwNDNCXHUwNDRFXHUwNDQyXHUwNDNEXHUwNDNFXHUwNDM5IFx1MDQ0Mlx1MDQzRVx1MDQ0MFx1MDQzM1x1MDQzRVx1MDQzMlx1MDQzQlx1MDQzOC4nIH0sXG4gIF07XG4gIGZvciAoY29uc3Qgc2VjdGlvbiBvZiBzZWN0aW9ucykge1xuICAgIGlmIChzZWN0aW9uLmlkID09PSAnZ2xvc3NhcnknKSBjb250aW51ZTtcbiAgICBwYWdlcy5wdXNoKHsgcGF0aDogYGFjYWRlbXkvJHtzZWN0aW9uLmlkfWAsIHRpdGxlOiBgJHtzZWN0aW9uLnRpdGxlfSBcdTIwMTQgJHtBQ0FERU1ZX1RJVExFfWAsIGRlc2NyaXB0aW9uOiBzZWN0aW9uLmRlc2NyaXB0aW9uIH0pO1xuICB9XG4gIGZvciAoY29uc3QgYXJ0aWNsZSBvZiBhcnRpY2xlcykge1xuICAgIHBhZ2VzLnB1c2goeyBwYXRoOiBgYWNhZGVteS8ke2FydGljbGUuc2VjdGlvbn0vJHthcnRpY2xlLnNsdWd9YCwgdGl0bGU6IGAke2FydGljbGUudGl0bGV9IFx1MjAxNCAke0FDQURFTVlfVElUTEV9YCwgZGVzY3JpcHRpb246IGFydGljbGUuc3VtbWFyeSB9KTtcbiAgfVxuICAvLyBUaGUgYXBwIHJlZGlyZWN0cyB0aGUgb2xkIEhlbHAgYWRkcmVzc2VzIGludG8gdGhlIEFjYWRlbXkgKEhlbHBQYWdlKTsgdGhlaXJcbiAgLy8gc3RhdGljIGNvcGllcyBzdGF5IGZvciBvbGQgbGlua3MgYW5kIG5hbWUgdGhlIG5ldyBwYWdlIGFzIGNhbm9uaWNhbC5cbiAgY29uc3QgaGVscDogW3N0cmluZywgc3RyaW5nLCBzdHJpbmcsIHN0cmluZ11bXSA9IFtcbiAgICBbJ2hlbHAnLCAnXHUwNDEyXHUwNDNFXHUwNDNGXHUwNDQwXHUwNDNFXHUwNDQxXHUwNDRCIFx1MDQzOCBcdTA0M0VcdTA0NDJcdTA0MzJcdTA0MzVcdTA0NDJcdTA0NEInLCBGQVFfREVTQ1JJUFRJT04sICdhY2FkZW15L2ZhcSddLFxuICAgIFsnaGVscC9mYXEnLCAnXHUwNDEyXHUwNDNFXHUwNDNGXHUwNDQwXHUwNDNFXHUwNDQxXHUwNDRCIFx1MDQzOCBcdTA0M0VcdTA0NDJcdTA0MzJcdTA0MzVcdTA0NDJcdTA0NEInLCBGQVFfREVTQ1JJUFRJT04sICdhY2FkZW15L2ZhcSddLFxuICAgIFsnaGVscC9mZWVzJywgJ1x1MDQxQVx1MDQzRVx1MDQzQ1x1MDQzOFx1MDQ0MVx1MDQ0MVx1MDQzOFx1MDQzOCcsICdcdTA0MjJcdTA0M0VcdTA0NDBcdTA0MzNcdTA0M0VcdTA0MzJcdTA0NEJcdTA0MzUgXHUwNDNBXHUwNDNFXHUwNDNDXHUwNDM4XHUwNDQxXHUwNDQxXHUwNDM4XHUwNDM4LCBcdTA0M0ZcdTA0M0VcdTA0M0ZcdTA0M0VcdTA0M0JcdTA0M0RcdTA0MzVcdTA0M0RcdTA0MzhcdTA0MzUgXHUwNDM4IFx1MDQzMlx1MDQ0Qlx1MDQzMlx1MDQzRVx1MDQzNCBcdTA0M0RcdTA0MzAgVk9MVEVYLicsICdhY2FkZW15L2tub3dsZWRnZSddLFxuICAgIFsnaGVscC9ydWxlcycsICdcdTA0MUZcdTA0NDBcdTA0MzBcdTA0MzJcdTA0MzhcdTA0M0JcdTA0MzAgXHUwNDQyXHUwNDNFXHUwNDQwXHUwNDMzXHUwNDNFXHUwNDMyXHUwNDNCXHUwNDM4JywgJ1x1MDQxQVx1MDQzMFx1MDQzQSBcdTA0NDBcdTA0MzBcdTA0MzFcdTA0M0VcdTA0NDJcdTA0MzBcdTA0NEVcdTA0NDIgXHUwNDNFXHUwNDQwXHUwNDM0XHUwNDM1XHUwNDQwXHUwNDMwLCBcdTA0M0NcdTA0MzBcdTA0NDBcdTA0MzZcdTA0MzAsIFx1MDQzQlx1MDQzOFx1MDQzQVx1MDQzMlx1MDQzOFx1MDQzNFx1MDQzMFx1MDQ0Nlx1MDQzOFx1MDQ0RiBcdTA0MzggXHUwNDQxXHUwNDQyXHUwNDMwXHUwNDMyXHUwNDNBXHUwNDMwIFx1MDQ0NFx1MDQzOFx1MDQzRFx1MDQzMFx1MDQzRFx1MDQ0MVx1MDQzOFx1MDQ0MFx1MDQzRVx1MDQzMlx1MDQzMFx1MDQzRFx1MDQzOFx1MDQ0RiBcdTA0M0RcdTA0MzAgVk9MVEVYLicsICdhY2FkZW15L2tub3dsZWRnZSddLFxuICBdO1xuICBmb3IgKGNvbnN0IFtwYXRoLCB0aXRsZSwgZGVzY3JpcHRpb24sIHRhcmdldF0gb2YgaGVscCkgcGFnZXMucHVzaCh7IHBhdGgsIHRpdGxlOiBgJHt0aXRsZX0gXHUyMDE0ICR7SEVMUF9USVRMRX1gLCBkZXNjcmlwdGlvbiwgY2Fub25pY2FsOiBgJHtTSVRFX09SSUdJTn0vJHt0YXJnZXR9YCB9KTtcbiAgcGFnZXMucHVzaCh7IHBhdGg6ICdoZWxwL3N0YXR1cycsIHRpdGxlOiBgXHUwNDIxXHUwNDQyXHUwNDMwXHUwNDQyXHUwNDQzXHUwNDQxIFx1MDQ0MVx1MDQzOFx1MDQ0MVx1MDQ0Mlx1MDQzNVx1MDQzQ1x1MDQ0QiBcdTIwMTQgJHtBQ0FERU1ZX1RJVExFfWAsIGRlc2NyaXB0aW9uOiAnXHUwNDFFXHUwNDQyXHUwNDMyXHUwNDM1XHUwNDQ3XHUwNDMwXHUwNDRFXHUwNDQyIFx1MDQzQlx1MDQzOCBcdTA0NDFcdTA0MzVcdTA0NDBcdTA0MzJcdTA0MzVcdTA0NDAgVk9MVEVYIFx1MDQzOCBcdTA0NDBcdTA0NEJcdTA0M0RcdTA0M0VcdTA0NDdcdTA0M0RcdTA0NEJcdTA0MzUgXHUwNDM0XHUwNDMwXHUwNDNEXHUwNDNEXHUwNDRCXHUwNDM1OyBcdTA0M0VcdTA0M0ZcdTA0NDNcdTA0MzFcdTA0M0JcdTA0MzhcdTA0M0FcdTA0M0VcdTA0MzJcdTA0MzBcdTA0M0RcdTA0M0RcdTA0NEJcdTA0MzUgXHUwNDQxXHUwNDNFXHUwNDNFXHUwNDMxXHUwNDQ5XHUwNDM1XHUwNDNEXHUwNDM4XHUwNDRGIFx1MDQzRSBcdTA0NDFcdTA0MzFcdTA0M0VcdTA0NEZcdTA0NDUuJyB9KTtcbiAgcmV0dXJuIHBhZ2VzO1xufVxuXG4vKiogaW5kZXguaHRtbCB3aXRoIHRoaXMgcGFnZSdzIHRpdGxlLCBkZXNjcmlwdGlvbiBhbmQgY2Fub25pY2FsIGFkZHJlc3NcbiAqIChpdHMgb3duIFVSTCB1bmxlc3MgdGhlIHBhZ2UgbmFtZXMgYW5vdGhlcikuICovXG5leHBvcnQgZnVuY3Rpb24gd2l0aFBhZ2VIZWFkKGluZGV4SHRtbDogc3RyaW5nLCBwYWdlOiBTZW9QYWdlKTogc3RyaW5nIHtcbiAgY29uc3QgdGl0bGUgPSBlc2NhcGVIdG1sKHBhZ2UudGl0bGUpO1xuICBjb25zdCBkZXNjcmlwdGlvbiA9IGVzY2FwZUh0bWwocGFnZS5kZXNjcmlwdGlvbik7XG4gIGNvbnN0IGNhbm9uaWNhbCA9IGVzY2FwZUh0bWwocGFnZS5jYW5vbmljYWwgPz8gYCR7U0lURV9PUklHSU59LyR7cGFnZS5wYXRofWApO1xuICByZXR1cm4gaW5kZXhIdG1sXG4gICAgLnJlcGxhY2UoLzx0aXRsZT5bXFxzXFxTXSo/PFxcL3RpdGxlPi8sIGA8dGl0bGU+JHt0aXRsZX08L3RpdGxlPmApXG4gICAgLnJlcGxhY2UoLyg8bWV0YSBuYW1lPVwiZGVzY3JpcHRpb25cIiBjb250ZW50PVwiKVteXCJdKihcIikvLCBgJDEke2Rlc2NyaXB0aW9ufSQyYClcbiAgICAucmVwbGFjZSgvKDxsaW5rIHJlbD1cImNhbm9uaWNhbFwiIGhyZWY9XCIpW15cIl0qKFwiKS8sIGAkMSR7Y2Fub25pY2FsfSQyYClcbiAgICAucmVwbGFjZSgvKDxtZXRhIHByb3BlcnR5PVwib2c6dXJsXCIgY29udGVudD1cIilbXlwiXSooXCIpLywgYCQxJHtjYW5vbmljYWx9JDJgKVxuICAgIC5yZXBsYWNlKC8oPG1ldGEgcHJvcGVydHk9XCJvZzp0aXRsZVwiIGNvbnRlbnQ9XCIpW15cIl0qKFwiKS8sIGAkMSR7dGl0bGV9JDJgKVxuICAgIC5yZXBsYWNlKC8oPG1ldGEgcHJvcGVydHk9XCJvZzpkZXNjcmlwdGlvblwiIGNvbnRlbnQ9XCIpW15cIl0qKFwiKS8sIGAkMSR7ZGVzY3JpcHRpb259JDJgKVxuICAgIC5yZXBsYWNlKC8oPG1ldGEgbmFtZT1cInR3aXR0ZXI6dGl0bGVcIiBjb250ZW50PVwiKVteXCJdKihcIikvLCBgJDEke3RpdGxlfSQyYClcbiAgICAucmVwbGFjZSgvKDxtZXRhIG5hbWU9XCJ0d2l0dGVyOmRlc2NyaXB0aW9uXCIgY29udGVudD1cIilbXlwiXSooXCIpLywgYCQxJHtkZXNjcmlwdGlvbn0kMmApO1xufVxuIiwgImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS91c2VyL3ZvbHRleC1yYy9mcm9udGVuZC9zcmMvbGliL3Nlb1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL2hvbWUvdXNlci92b2x0ZXgtcmMvZnJvbnRlbmQvc3JjL2xpYi9zZW8vc2l0ZS50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vaG9tZS91c2VyL3ZvbHRleC1yYy9mcm9udGVuZC9zcmMvbGliL3Nlby9zaXRlLnRzXCI7LyoqXG4gKiBXaGF0IHNlYXJjaCBlbmdpbmVzIG1heSBpbmRleCBvbiBWT0xURVgsIGFuZCB1bmRlciB3aGljaCBhZGRyZXNzLiBTaGFyZWQgYnlcbiAqIHRoZSBidWlsZCAoc3RhdGljIHBhZ2UgaGVhZHMsIHNpdGVtYXAueG1sLCByb2JvdHMudHh0IFx1MjAxNCBmcm9udGVuZC9jb250ZW50UGx1Z2luLnRzKVxuICogYW5kIGJ5IHRoZSBhcHAsIHdoaWNoIGtlZXBzIHRoZSBzYW1lIGNhbm9uaWNhbCBhbmQgcm9ib3RzIHZhbHVlcyB3aGlsZSBhXG4gKiB2aXNpdG9yIG1vdmVzIGJldHdlZW4gcGFnZXMgKFJvdXRlU2VvKS4gUHVyZTogbm8gRE9NIGFuZCBubyBjb250ZW50XG4gKiBjb21waWxlciwgc28gaXQgaXMgc2FmZSBpbiB0aGUgYnJvd3NlciBidW5kbGUgYW5kIGluIEplc3QuXG4gKlxuICogT25lIHB1YmxpYyBhZGRyZXNzIHBlciBwYWdlLCBvbiBodHRwczovL3ZvbHRleHRlY2gubmV0LiBydS52b2x0ZXh0ZWNoLm5ldFxuICogc2VydmVzIHRoZSBzYW1lIGJ1aWxkIGFzIGFuIGFsdGVybmF0aXZlIHdheSBpbjsgaXRzIHBhZ2VzIG5hbWUgdGhlIG1haW5cbiAqIGRvbWFpbiBhcyBjYW5vbmljYWwgaW5zdGVhZCBvZiByZWRpcmVjdGluZywgc28gUlUgZGVlcCBsaW5rcywgcmVnaXN0cmF0aW9uLFxuICogaW52aXRhdGlvbnMgYW5kIHRoZSBzZXNzaW9uIGtlZXAgd29ya2luZyB0aGVyZS4gVGhlIHNldmVuIGludGVyZmFjZVxuICogbGFuZ3VhZ2VzIHNoYXJlIG9uZSBVUkwgcGVyIHBhZ2UgKHRoZSBjaG9pY2UgbGl2ZXMgaW4gdGhlIGJyb3dzZXIpLCBzbyB0aGVyZVxuICogYXJlIG5vIGxhbmd1YWdlIGFsdGVybmF0ZXMgdG8gZGVjbGFyZSB3aXRoIGhyZWZsYW5nLlxuICovXG5leHBvcnQgY29uc3QgU0lURV9PUklHSU4gPSAnaHR0cHM6Ly92b2x0ZXh0ZWNoLm5ldCc7XG5leHBvcnQgY29uc3QgT0dfSU1BR0VfVVJMID0gYCR7U0lURV9PUklHSU59L29nLWltYWdlLnBuZ2A7XG5cbi8qKiBTaWduZWQtaW4gYXJlYXM6IGV2ZXJ5IFJlcXVpcmVBdXRoIHJvdXRlIGluIEFwcC50c3gsIHRoZSBhZG1pbiBjb25zb2xlLFxuICogdGhlIGNsaWVudCByZWRpcmVjdHMgaW50byB0aGVtLCBhbmQgdGhlIGZsYWctZ2F0ZWQgU3RvY2tzIHNlY3Rpb24uICovXG5leHBvcnQgY29uc3QgUFJJVkFURV9ST1VURVMgPSBbXG4gICcvdHJhZGUnLCAnL2Z1dHVyZXMnLCAnL21hcmtldHMnLCAnL2JhbmtpbmcnLCAnL2Vhcm4nLCAnL3NldHRpbmdzJywgJy9jYXJkJywgJy93YWxsZXQnLCAnL290YycsXG4gICcvZGFzaGJvYXJkJywgJy9jb3B5LXRyYWRpbmcnLCAnL2FyYml0cmFnZScsICcvdG9vbHMnLCAnL3RyYWRpbmctYm90cycsICcvYW5hbHl0aWNzJywgJy9zdG9ja3MnLCAnL2FkbWluJyxcbl0gYXMgY29uc3Q7XG5leHBvcnQgY29uc3QgQURNSU5fUEFHRVMgPSBbJ3dhbGxldHMnLCAndXNlcnMnLCAna3ljJywgJ3dpdGhkcmF3YWxzJywgJ290YycsICdkZXBvc2l0cycsICdhdWRpdC1sb2cnLCAnbGlzdGluZ3MnXSBhcyBjb25zdDtcbi8qKiBQdWJsaWMsIGJ1dCBub3QgY29udGVudDogc2lnbi1pbiBhbmQgc2lnbi11cCAoYWxzbyByZWFjaGVkIHdpdGggP25leHQ9IGFuZCByZWZlcnJhbCBxdWVyeSBzdHJpbmdzKS4gKi9cbmV4cG9ydCBjb25zdCBVVElMSVRZX1JPVVRFUyA9IFsnL2xvZ2luJywgJy9yZWdpc3RlciddIGFzIGNvbnN0O1xuLyoqIFB1YmxpYywgYnV0IGtlcHQgb3V0IG9mIHNlYXJjaCB3aXRoIHRoZSBwYWdlJ3Mgb3duIG5vaW5kZXgsIG5vZm9sbG93XG4gKiAoTGljZW5jZXNQYWdlKTogaXQgc2hvd3Mgc3VwcGxpZWQgaW1hZ2VzIHdob3NlIGRldGFpbHMgYXJlIG5vdCBjb25maXJtZWQgaW5cbiAqIG9mZmljaWFsIHJlZ2lzdGVycyAobGljZW5zZXMucmV2aWV3Tm90aWNlKS4gKi9cbmV4cG9ydCBjb25zdCBVTlBST01PVEVEX1JPVVRFUyA9IFsnL2xlZ2FsL2xpY2Vuc2VzJ10gYXMgY29uc3Q7XG4vKiogT2xkIEhlbHAgYWRkcmVzc2VzIHRoYXQgdGhlIGFwcCByZWRpcmVjdHMgaW50byB0aGUgQWNhZGVteSAoSGVscFBhZ2UpLiAqL1xuZXhwb3J0IGNvbnN0IExFR0FDWV9IRUxQOiBSZWFkb25seTxSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+PiA9IHtcbiAgJy9oZWxwJzogJy9hY2FkZW15L2ZhcScsXG4gICcvaGVscC9mYXEnOiAnL2FjYWRlbXkvZmFxJyxcbiAgJy9oZWxwL2ZlZXMnOiAnL2FjYWRlbXkva25vd2xlZGdlJyxcbiAgJy9oZWxwL3J1bGVzJzogJy9hY2FkZW15L2tub3dsZWRnZScsXG59O1xuZXhwb3J0IGNvbnN0IExFR0FMX0RPQ1MgPSBbJ3Rlcm1zJywgJ3ByaXZhY3knLCAncmlzaycsICdhYm91dCcsICdzdXBwb3J0J10gYXMgY29uc3Q7XG5cbmV4cG9ydCBjb25zdCBST0JPVFNfUFJJVkFURSA9ICdub2luZGV4LCBub2ZvbGxvdyc7XG5leHBvcnQgY29uc3QgUk9CT1RTX1VOTElTVEVEID0gJ25vaW5kZXgsIGZvbGxvdyc7XG5cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVQYXRoKHBhdGhuYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBwYXRoID0gYC8ke3BhdGhuYW1lLnNwbGl0KC9bPyNdLylbMF19YC5yZXBsYWNlKC9cXC97Mix9L2csICcvJyk7XG4gIHJldHVybiBwYXRoLmxlbmd0aCA+IDEgPyBwYXRoLnJlcGxhY2UoL1xcLyskLywgJycpIDogJy8nO1xufVxuXG5jb25zdCB3aXRoaW4gPSAocGF0aDogc3RyaW5nLCBiYXNlOiBzdHJpbmcpID0+IHBhdGggPT09IGJhc2UgfHwgcGF0aC5zdGFydHNXaXRoKGAke2Jhc2V9L2ApO1xuXG4vKiogVGhlIHJvYm90cyBkaXJlY3RpdmUgZm9yIGFuIGFkZHJlc3MsIG9yIG51bGwgd2hlcmUgdGhlIGRlZmF1bHQgKGluZGV4LCBmb2xsb3cpIGFwcGxpZXMuICovXG5leHBvcnQgZnVuY3Rpb24gcm9ib3RzRm9yKHBhdGhuYW1lOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgY29uc3QgcGF0aCA9IG5vcm1hbGl6ZVBhdGgocGF0aG5hbWUpLnRvTG93ZXJDYXNlKCk7XG4gIGlmIChQUklWQVRFX1JPVVRFUy5zb21lKChyb3V0ZSkgPT4gd2l0aGluKHBhdGgsIHJvdXRlKSkgfHwgKFVOUFJPTU9URURfUk9VVEVTIGFzIHJlYWRvbmx5IHN0cmluZ1tdKS5pbmNsdWRlcyhwYXRoKSkgcmV0dXJuIFJPQk9UU19QUklWQVRFO1xuICBpZiAoKFVUSUxJVFlfUk9VVEVTIGFzIHJlYWRvbmx5IHN0cmluZ1tdKS5pbmNsdWRlcyhwYXRoKSkgcmV0dXJuIFJPQk9UU19VTkxJU1RFRDtcbiAgcmV0dXJuIG51bGw7XG59XG5cbi8qKiBUaGUgYWJzb2x1dGUgY2Fub25pY2FsIFVSTCBvZiBhIHB1YmxpYyBwYWdlLCBvciBudWxsIHdoZXJlIG5vbmUgaXMgY2xhaW1lZFxuICogKHByaXZhdGUgYW5kIHNpZ24taW4gcGFnZXMsIHJlZmVycmFsIGNvZGVzLCB1bmtub3duIGFkZHJlc3NlcykuICovXG5leHBvcnQgZnVuY3Rpb24gY2Fub25pY2FsRm9yKHBhdGhuYW1lOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKHJvYm90c0ZvcihwYXRobmFtZSkpIHJldHVybiBudWxsO1xuICBjb25zdCBwYXRoID0gbm9ybWFsaXplUGF0aChwYXRobmFtZSkudG9Mb3dlckNhc2UoKTtcbiAgaWYgKHBhdGggPT09ICcvJykgcmV0dXJuIGAke1NJVEVfT1JJR0lOfS9gO1xuICBpZiAoTEVHQUNZX0hFTFBbcGF0aF0pIHJldHVybiBTSVRFX09SSUdJTiArIExFR0FDWV9IRUxQW3BhdGhdO1xuICBpZiAocGF0aC5zdGFydHNXaXRoKCcvaGVscC8nKSkgcmV0dXJuIFNJVEVfT1JJR0lOICsgKHBhdGggPT09ICcvaGVscC9zdGF0dXMnID8gcGF0aCA6ICcvYWNhZGVteS9mYXEnKTtcbiAgaWYgKHdpdGhpbihwYXRoLCAnL2FjYWRlbXknKSkgcmV0dXJuIFNJVEVfT1JJR0lOICsgcGF0aDtcbiAgY29uc3QgbGVnYWwgPSAvXlxcL2xlZ2FsXFwvKFthLXotXSspJC8uZXhlYyhwYXRoKTtcbiAgaWYgKGxlZ2FsICYmIChMRUdBTF9ET0NTIGFzIHJlYWRvbmx5IHN0cmluZ1tdKS5pbmNsdWRlcyhsZWdhbFsxXSkpIHJldHVybiBTSVRFX09SSUdJTiArIHBhdGg7XG4gIHJldHVybiBudWxsO1xufVxuIiwgImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS91c2VyL3ZvbHRleC1yYy9mcm9udGVuZC9zcmMvbGliXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvaG9tZS91c2VyL3ZvbHRleC1yYy9mcm9udGVuZC9zcmMvbGliL2xlZ2FsQ29udGVudC50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vaG9tZS91c2VyL3ZvbHRleC1yYy9mcm9udGVuZC9zcmMvbGliL2xlZ2FsQ29udGVudC50c1wiO2ltcG9ydCB7IExhbmcgfSBmcm9tICcuL2kxOG4nO1xuXG5leHBvcnQgdHlwZSBMZWdhbERvYyA9ICd0ZXJtcycgfCAncHJpdmFjeScgfCAncmlzaycgfCAnYWJvdXQnIHwgJ3N1cHBvcnQnO1xuXG5leHBvcnQgaW50ZXJmYWNlIExlZ2FsU2VjdGlvbiB7XG4gIGhlYWRpbmc6IHN0cmluZztcbiAgYm9keTogc3RyaW5nW107XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgTGVnYWxDb250ZW50IHtcbiAgdGl0bGU6IHN0cmluZztcbiAgdXBkYXRlZDogc3RyaW5nO1xuICBpbnRybzogc3RyaW5nO1xuICBzZWN0aW9uczogTGVnYWxTZWN0aW9uW107XG59XG5cbmNvbnN0IFJVX1RFUk1TOiBMZWdhbENvbnRlbnQgPSB7XG4gIHRpdGxlOiAnXHUwNDIzXHUwNDQxXHUwNDNCXHUwNDNFXHUwNDMyXHUwNDM4XHUwNDRGIFx1MDQzOFx1MDQ0MVx1MDQzRlx1MDQzRVx1MDQzQlx1MDQ0Q1x1MDQzN1x1MDQzRVx1MDQzMlx1MDQzMFx1MDQzRFx1MDQzOFx1MDQ0RicsXG4gIHVwZGF0ZWQ6ICdcdTA0MUZcdTA0M0VcdTA0NDFcdTA0M0JcdTA0MzVcdTA0MzRcdTA0M0RcdTA0MzVcdTA0MzUgXHUwNDNFXHUwNDMxXHUwNDNEXHUwNDNFXHUwNDMyXHUwNDNCXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDM1OiAyMiBcdTA0MzBcdTA0MzJcdTA0MzNcdTA0NDNcdTA0NDFcdTA0NDJcdTA0MzAgMjAyNiBcdTA0MzMuJyxcbiAgaW50cm86XG4gICAgJ1x1MDQyRFx1MDQ0Mlx1MDQzOCBcdTA0NDNcdTA0NDFcdTA0M0JcdTA0M0VcdTA0MzJcdTA0MzhcdTA0NEYgXHUwNDQwXHUwNDM1XHUwNDMzXHUwNDQzXHUwNDNCXHUwNDM4XHUwNDQwXHUwNDQzXHUwNDRFXHUwNDQyIFx1MDQzOFx1MDQ0MVx1MDQzRlx1MDQzRVx1MDQzQlx1MDQ0Q1x1MDQzN1x1MDQzRVx1MDQzMlx1MDQzMFx1MDQzRFx1MDQzOFx1MDQzNSBcdTA0M0ZcdTA0M0JcdTA0MzBcdTA0NDJcdTA0NDRcdTA0M0VcdTA0NDBcdTA0M0NcdTA0NEIgVk9MVEVYLiBcdTA0MjBcdTA0MzVcdTA0MzNcdTA0MzhcdTA0NDFcdTA0NDJcdTA0NDBcdTA0MzhcdTA0NDBcdTA0NDNcdTA0NEZcdTA0NDFcdTA0NEMgXHUwNDM4XHUwNDNCXHUwNDM4IFx1MDQzOFx1MDQ0MVx1MDQzRlx1MDQzRVx1MDQzQlx1MDQ0Q1x1MDQzN1x1MDQ0M1x1MDQ0RiBcdTA0NDFcdTA0MzVcdTA0NDBcdTA0MzJcdTA0MzhcdTA0NDEsIFx1MDQ0Mlx1MDQ0QiBcdTA0M0ZcdTA0M0VcdTA0MzRcdTA0NDJcdTA0MzJcdTA0MzVcdTA0NDBcdTA0MzZcdTA0MzRcdTA0MzBcdTA0MzVcdTA0NDhcdTA0NEMsIFx1MDQ0N1x1MDQ0Mlx1MDQzRSBcdTA0M0ZcdTA0NDBcdTA0M0VcdTA0NDdcdTA0MzhcdTA0NDJcdTA0MzBcdTA0M0IoXHUwNDMwKSBcdTA0MzggXHUwNDQxXHUwNDNFXHUwNDMzXHUwNDNCXHUwNDMwXHUwNDQxXHUwNDM1XHUwNDNEKFx1MDQzRFx1MDQzMCkgXHUwNDQxIFx1MDQzOFx1MDQzN1x1MDQzQlx1MDQzRVx1MDQzNlx1MDQzNVx1MDQzRFx1MDQzRFx1MDQ0Qlx1MDQzQyBcdTA0M0RcdTA0MzhcdTA0MzZcdTA0MzUuJyxcbiAgc2VjdGlvbnM6IFtcbiAgICB7XG4gICAgICBoZWFkaW5nOiAnMS4gXHUwNDFFIFx1MDQ0MVx1MDQzNVx1MDQ0MFx1MDQzMlx1MDQzOFx1MDQ0MVx1MDQzNScsXG4gICAgICBib2R5OiBbXG4gICAgICAgICdWT0xURVggXHUyMDE0IFx1MDQzRlx1MDQzQlx1MDQzMFx1MDQ0Mlx1MDQ0NFx1MDQzRVx1MDQ0MFx1MDQzQ1x1MDQzMCBcdTA0MzRcdTA0M0JcdTA0NEYgXHUwNDQyXHUwNDNFXHUwNDQwXHUwNDMzXHUwNDNFXHUwNDMyXHUwNDNCXHUwNDM4IFx1MDQzQVx1MDQ0MFx1MDQzOFx1MDQzRlx1MDQ0Mlx1MDQzRVx1MDQzMlx1MDQzMFx1MDQzQlx1MDQ0RVx1MDQ0Mlx1MDQzMFx1MDQzQ1x1MDQzOCwgXHUwNDNGXHUwNDNFXHUwNDM3XHUwNDMyXHUwNDNFXHUwNDNCXHUwNDRGXHUwNDRFXHUwNDQ5XHUwNDMwXHUwNDRGIFx1MDQ0MFx1MDQzMFx1MDQzN1x1MDQzQ1x1MDQzNVx1MDQ0OVx1MDQzMFx1MDQ0Mlx1MDQ0QyBcdTA0M0JcdTA0MzhcdTA0M0NcdTA0MzhcdTA0NDJcdTA0M0RcdTA0NEJcdTA0MzUgXHUwNDM4IFx1MDQ0MFx1MDQ0Qlx1MDQzRFx1MDQzRVx1MDQ0N1x1MDQzRFx1MDQ0Qlx1MDQzNSBcdTA0M0VcdTA0NDBcdTA0MzRcdTA0MzVcdTA0NDBcdTA0MzAsIFx1MDQ0NVx1MDQ0MFx1MDQzMFx1MDQzRFx1MDQzOFx1MDQ0Mlx1MDQ0QyBcdTA0MzBcdTA0M0FcdTA0NDJcdTA0MzhcdTA0MzJcdTA0NEIgXHUwNDMyXHUwNDNFIFx1MDQzMlx1MDQzRFx1MDQ0M1x1MDQ0Mlx1MDQ0MFx1MDQzNVx1MDQzRFx1MDQzRFx1MDQzNVx1MDQzQyBcdTA0M0FcdTA0M0VcdTA0NDhcdTA0MzVcdTA0M0JcdTA0NENcdTA0M0FcdTA0MzUgXHUwNDM4IFx1MDQ0MVx1MDQzRVx1MDQzMlx1MDQzNVx1MDQ0MFx1MDQ0OFx1MDQzMFx1MDQ0Mlx1MDQ0QyBcdTA0MzRcdTA0MzVcdTA0M0ZcdTA0M0VcdTA0MzdcdTA0MzhcdTA0NDJcdTA0NEIvXHUwNDMyXHUwNDRCXHUwNDMyXHUwNDNFXHUwNDM0XHUwNDRCIFx1MDQzMiBcdTA0M0ZcdTA0M0VcdTA0MzRcdTA0MzRcdTA0MzVcdTA0NDBcdTA0MzZcdTA0MzhcdTA0MzJcdTA0MzBcdTA0MzVcdTA0M0NcdTA0NEJcdTA0NDUgXHUwNDQxXHUwNDM1XHUwNDQyXHUwNDRGXHUwNDQ1LicsXG4gICAgICBdLFxuICAgIH0sXG4gICAge1xuICAgICAgaGVhZGluZzogJzIuIFx1MDQxRlx1MDQ0MFx1MDQzMFx1MDQzMlx1MDQzRSBcdTA0M0RcdTA0MzAgXHUwNDM4XHUwNDQxXHUwNDNGXHUwNDNFXHUwNDNCXHUwNDRDXHUwNDM3XHUwNDNFXHUwNDMyXHUwNDMwXHUwNDNEXHUwNDM4XHUwNDM1JyxcbiAgICAgIGJvZHk6IFtcbiAgICAgICAgJ1x1MDQyMVx1MDQzNVx1MDQ0MFx1MDQzMlx1MDQzOFx1MDQ0MVx1MDQzRVx1MDQzQyBcdTA0M0NcdTA0M0VcdTA0MzNcdTA0NDNcdTA0NDIgXHUwNDNGXHUwNDNFXHUwNDNCXHUwNDRDXHUwNDM3XHUwNDNFXHUwNDMyXHUwNDMwXHUwNDQyXHUwNDRDXHUwNDQxXHUwNDRGIFx1MDQ0Mlx1MDQzRVx1MDQzQlx1MDQ0Q1x1MDQzQVx1MDQzRSBcdTA0MzRcdTA0MzVcdTA0MzVcdTA0NDFcdTA0M0ZcdTA0M0VcdTA0NDFcdTA0M0VcdTA0MzFcdTA0M0RcdTA0NEJcdTA0MzUgXHUwNDNCXHUwNDM4XHUwNDQ2XHUwNDMwIFx1MDQ0MVx1MDQ0Mlx1MDQzMFx1MDQ0MFx1MDQ0OFx1MDQzNSAxOCBcdTA0M0JcdTA0MzVcdTA0NDIuIFx1MDQyMFx1MDQzNVx1MDQzM1x1MDQzOFx1MDQ0MVx1MDQ0Mlx1MDQ0MFx1MDQzOFx1MDQ0MFx1MDQ0M1x1MDQ0Rlx1MDQ0MVx1MDQ0QywgXHUwNDQyXHUwNDRCIFx1MDQzRlx1MDQzRVx1MDQzNFx1MDQ0Mlx1MDQzMlx1MDQzNVx1MDQ0MFx1MDQzNlx1MDQzNFx1MDQzMFx1MDQzNVx1MDQ0OFx1MDQ0QywgXHUwNDQ3XHUwNDQyXHUwNDNFIFx1MDQzOFx1MDQ0MVx1MDQzRlx1MDQzRVx1MDQzQlx1MDQ0Q1x1MDQzN1x1MDQzRVx1MDQzMlx1MDQzMFx1MDQzRFx1MDQzOFx1MDQzNSBcdTA0M0FcdTA0NDBcdTA0MzhcdTA0M0ZcdTA0NDJcdTA0M0VcdTA0MzJcdTA0MzBcdTA0M0JcdTA0NEVcdTA0NDJcdTA0M0RcdTA0NEJcdTA0NDUgXHUwNDQxXHUwNDM1XHUwNDQwXHUwNDMyXHUwNDM4XHUwNDQxXHUwNDNFXHUwNDMyIFx1MDQzRFx1MDQzNSBcdTA0MzdcdTA0MzBcdTA0M0ZcdTA0NDBcdTA0MzVcdTA0NDlcdTA0MzVcdTA0M0RcdTA0M0UgXHUwNDMyIFx1MDQ0Mlx1MDQzMlx1MDQzRVx1MDQzNVx1MDQzOSBcdTA0NEVcdTA0NDBcdTA0MzhcdTA0NDFcdTA0MzRcdTA0MzhcdTA0M0FcdTA0NDZcdTA0MzhcdTA0MzguJyxcbiAgICAgIF0sXG4gICAgfSxcbiAgICB7XG4gICAgICBoZWFkaW5nOiAnMy4gXHUwNDEwXHUwNDNBXHUwNDNBXHUwNDMwXHUwNDQzXHUwNDNEXHUwNDQyIFx1MDQzOCBcdTA0MzFcdTA0MzVcdTA0MzdcdTA0M0VcdTA0M0ZcdTA0MzBcdTA0NDFcdTA0M0RcdTA0M0VcdTA0NDFcdTA0NDJcdTA0NEMnLFxuICAgICAgYm9keTogW1xuICAgICAgICAnXHUwNDIyXHUwNDRCIFx1MDQzRFx1MDQzNVx1MDQ0MVx1MDQ1MVx1MDQ0OFx1MDQ0QyBcdTA0M0VcdTA0NDJcdTA0MzJcdTA0MzVcdTA0NDJcdTA0NDFcdTA0NDJcdTA0MzJcdTA0MzVcdTA0M0RcdTA0M0RcdTA0M0VcdTA0NDFcdTA0NDJcdTA0NEMgXHUwNDM3XHUwNDMwIFx1MDQzQVx1MDQzRVx1MDQzRFx1MDQ0NFx1MDQzOFx1MDQzNFx1MDQzNVx1MDQzRFx1MDQ0Nlx1MDQzOFx1MDQzMFx1MDQzQlx1MDQ0Q1x1MDQzRFx1MDQzRVx1MDQ0MVx1MDQ0Mlx1MDQ0QyBcdTA0M0ZcdTA0MzBcdTA0NDBcdTA0M0VcdTA0M0JcdTA0NEYgXHUwNDM4LCBcdTA0M0ZcdTA0NDBcdTA0MzggXHUwNDMyXHUwNDNBXHUwNDNCXHUwNDRFXHUwNDQ3XHUwNDM1XHUwNDNEXHUwNDM4XHUwNDM4LCBcdTA0M0FcdTA0M0JcdTA0NEVcdTA0NDdcdTA0MzVcdTA0MzkgXHUwNDM0XHUwNDMyXHUwNDQzXHUwNDQ1XHUwNDQ0XHUwNDMwXHUwNDNBXHUwNDQyXHUwNDNFXHUwNDQwXHUwNDNEXHUwNDNFXHUwNDM5IFx1MDQzMFx1MDQ0M1x1MDQ0Mlx1MDQzNVx1MDQzRFx1MDQ0Mlx1MDQzOFx1MDQ0NFx1MDQzOFx1MDQzQVx1MDQzMFx1MDQ0Nlx1MDQzOFx1MDQzOC4gXHUwNDFDXHUwNDRCIFx1MDQzRFx1MDQzMFx1MDQ0MVx1MDQ0Mlx1MDQzRVx1MDQ0Rlx1MDQ0Mlx1MDQzNVx1MDQzQlx1MDQ0Q1x1MDQzRFx1MDQzRSBcdTA0NDBcdTA0MzVcdTA0M0FcdTA0M0VcdTA0M0NcdTA0MzVcdTA0M0RcdTA0MzRcdTA0NDNcdTA0MzVcdTA0M0MgXHUwNDMyXHUwNDNBXHUwNDNCXHUwNDRFXHUwNDQ3XHUwNDM4XHUwNDQyXHUwNDRDIDJGQSBcdTA0MzIgXHUwNDQwXHUwNDMwXHUwNDM3XHUwNDM0XHUwNDM1XHUwNDNCXHUwNDM1IFx1MDBBQlx1MDQxRFx1MDQzMFx1MDQ0MVx1MDQ0Mlx1MDQ0MFx1MDQzRVx1MDQzOVx1MDQzQVx1MDQzOCBcdTIxOTIgXHUwNDExXHUwNDM1XHUwNDM3XHUwNDNFXHUwNDNGXHUwNDMwXHUwNDQxXHUwNDNEXHUwNDNFXHUwNDQxXHUwNDQyXHUwNDRDXHUwMEJCLicsXG4gICAgICAgICdcdTA0MjFcdTA0M0VcdTA0M0VcdTA0MzFcdTA0NDlcdTA0MzggXHUwNDNEXHUwNDMwXHUwNDNDIFx1MDQzRFx1MDQzNVx1MDQzQ1x1MDQzNVx1MDQzNFx1MDQzQlx1MDQzNVx1MDQzRFx1MDQzRFx1MDQzRSBcdTA0M0ZcdTA0NDBcdTA0MzggXHUwNDNGXHUwNDNFXHUwNDM0XHUwNDNFXHUwNDM3XHUwNDQwXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDM4IFx1MDQzRFx1MDQzMCBcdTA0M0RcdTA0MzVcdTA0NDFcdTA0MzBcdTA0M0RcdTA0M0FcdTA0NDZcdTA0MzhcdTA0M0VcdTA0M0RcdTA0MzhcdTA0NDBcdTA0M0VcdTA0MzJcdTA0MzBcdTA0M0RcdTA0M0RcdTA0NEJcdTA0MzkgXHUwNDM0XHUwNDNFXHUwNDQxXHUwNDQyXHUwNDQzXHUwNDNGIFx1MDQzQSBcdTA0MzBcdTA0M0FcdTA0M0FcdTA0MzBcdTA0NDNcdTA0M0RcdTA0NDJcdTA0NDMuJyxcbiAgICAgIF0sXG4gICAgfSxcbiAgICB7XG4gICAgICBoZWFkaW5nOiAnNC4gXHUwNDFFXHUwNDQwXHUwNDM0XHUwNDM1XHUwNDQwXHUwNDMwIFx1MDQzOCBcdTA0MzhcdTA0NDFcdTA0M0ZcdTA0M0VcdTA0M0JcdTA0M0RcdTA0MzVcdTA0M0RcdTA0MzhcdTA0MzUnLFxuICAgICAgYm9keTogW1xuICAgICAgICAnXHUwNDFFXHUwNDQwXHUwNDM0XHUwNDM1XHUwNDQwXHUwNDMwIFx1MDQzOFx1MDQ0MVx1MDQzRlx1MDQzRVx1MDQzQlx1MDQzRFx1MDQ0Rlx1MDQ0RVx1MDQ0Mlx1MDQ0MVx1MDQ0RiBcdTA0NDJcdTA0M0VcdTA0NDBcdTA0MzNcdTA0M0VcdTA0MzJcdTA0NEJcdTA0M0MgXHUwNDM0XHUwNDMyXHUwNDM4XHUwNDM2XHUwNDNBXHUwNDNFXHUwNDNDIFx1MDQzRlx1MDQzRSBcdTA0M0ZcdTA0NDBcdTA0MzhcdTA0M0RcdTA0NDZcdTA0MzhcdTA0M0ZcdTA0NDMgXHUwNDQ2XHUwNDM1XHUwNDNEXHUwNDMwLVx1MDQzMlx1MDQ0MFx1MDQzNVx1MDQzQ1x1MDQ0RiBcdTA0MzIgXHUwNDNGXHUwNDNFXHUwNDQwXHUwNDRGXHUwNDM0XHUwNDNBXHUwNDM1IFx1MDQzRlx1MDQzRVx1MDQ0MVx1MDQ0Mlx1MDQ0M1x1MDQzRlx1MDQzQlx1MDQzNVx1MDQzRFx1MDQzOFx1MDQ0Ri4gXHUwNDIwXHUwNDRCXHUwNDNEXHUwNDNFXHUwNDQ3XHUwNDNEXHUwNDRCXHUwNDM1IFx1MDQzRVx1MDQ0MFx1MDQzNFx1MDQzNVx1MDQ0MFx1MDQzMCBcdTA0MzhcdTA0NDFcdTA0M0ZcdTA0M0VcdTA0M0JcdTA0M0RcdTA0NEZcdTA0NEVcdTA0NDJcdTA0NDFcdTA0NEYgXHUwNDNGXHUwNDNFIFx1MDQzQlx1MDQ0M1x1MDQ0N1x1MDQ0OFx1MDQzNVx1MDQzOSBcdTA0MzRcdTA0M0VcdTA0NDFcdTA0NDJcdTA0NDNcdTA0M0ZcdTA0M0RcdTA0M0VcdTA0MzkgXHUwNDQ2XHUwNDM1XHUwNDNEXHUwNDM1IFx1MDQzMiBcdTA0NDFcdTA0NDJcdTA0MzBcdTA0M0FcdTA0MzBcdTA0M0RcdTA0MzUgXHUwNDNEXHUwNDMwIFx1MDQzQ1x1MDQzRVx1MDQzQ1x1MDQzNVx1MDQzRFx1MDQ0MiBcdTA0NDBcdTA0MzBcdTA0MzdcdTA0M0NcdTA0MzVcdTA0NDlcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NEYgXHUwNDM4IFx1MDQzQ1x1MDQzRVx1MDQzM1x1MDQ0M1x1MDQ0MiBcdTA0MzFcdTA0NEJcdTA0NDJcdTA0NEMgXHUwNDNGXHUwNDNFXHUwNDM0XHUwNDMyXHUwNDM1XHUwNDQwXHUwNDM2XHUwNDM1XHUwNDNEXHUwNDRCIFx1MDQzRlx1MDQ0MFx1MDQzRVx1MDQ0MVx1MDQzQVx1MDQzMFx1MDQzQlx1MDQ0Q1x1MDQzN1x1MDQ0Qlx1MDQzMlx1MDQzMFx1MDQzRFx1MDQzOFx1MDQ0RSBcdTA0M0ZcdTA0NDBcdTA0MzggXHUwNDNEXHUwNDM1XHUwNDM0XHUwNDNFXHUwNDQxXHUwNDQyXHUwNDMwXHUwNDQyXHUwNDNFXHUwNDQ3XHUwNDNEXHUwNDNFXHUwNDM5IFx1MDQzQlx1MDQzOFx1MDQzQVx1MDQzMlx1MDQzOFx1MDQzNFx1MDQzRFx1MDQzRVx1MDQ0MVx1MDQ0Mlx1MDQzOC4nLFxuICAgICAgXSxcbiAgICB9LFxuICAgIHtcbiAgICAgIGhlYWRpbmc6ICc1LiBcdTA0MUFcdTA0M0VcdTA0M0NcdTA0MzhcdTA0NDFcdTA0NDFcdTA0MzhcdTA0MzgnLFxuICAgICAgYm9keTogW1xuICAgICAgICAnXHUwNDE0XHUwNDM1XHUwNDM5XHUwNDQxXHUwNDQyXHUwNDMyXHUwNDQzXHUwNDRFXHUwNDQ5XHUwNDM4XHUwNDM1IFx1MDQ0Mlx1MDQzRVx1MDQ0MFx1MDQzM1x1MDQzRVx1MDQzMlx1MDQ0Qlx1MDQzNSBcdTA0M0FcdTA0M0VcdTA0M0NcdTA0MzhcdTA0NDFcdTA0NDFcdTA0MzhcdTA0MzggXHUwNDNFXHUwNDQyXHUwNDNFXHUwNDMxXHUwNDQwXHUwNDMwXHUwNDM2XHUwNDMwXHUwNDRFXHUwNDQyXHUwNDQxXHUwNDRGIFx1MDQzMiBcdTA0MzhcdTA0M0RcdTA0NDJcdTA0MzVcdTA0NDBcdTA0NDRcdTA0MzVcdTA0MzlcdTA0NDFcdTA0MzUgXHUwNDNGXHUwNDM1XHUwNDQwXHUwNDM1XHUwNDM0IFx1MDQzRlx1MDQzRVx1MDQzNFx1MDQ0Mlx1MDQzMlx1MDQzNVx1MDQ0MFx1MDQzNlx1MDQzNFx1MDQzNVx1MDQzRFx1MDQzOFx1MDQzNVx1MDQzQyBcdTA0NDFcdTA0MzRcdTA0MzVcdTA0M0JcdTA0M0FcdTA0MzguIFx1MDQxQ1x1MDQ0QiBcdTA0MzJcdTA0M0ZcdTA0NDBcdTA0MzBcdTA0MzJcdTA0MzUgXHUwNDM4XHUwNDM3XHUwNDNDXHUwNDM1XHUwNDNEXHUwNDRGXHUwNDQyXHUwNDRDIFx1MDQ0MFx1MDQzMFx1MDQzN1x1MDQzQ1x1MDQzNVx1MDQ0MCBcdTA0M0FcdTA0M0VcdTA0M0NcdTA0MzhcdTA0NDFcdTA0NDFcdTA0MzhcdTA0MzksIFx1MDQ0M1x1MDQzMlx1MDQzNVx1MDQzNFx1MDQzRVx1MDQzQ1x1MDQzOFx1MDQzMiBcdTA0M0VcdTA0MzEgXHUwNDREXHUwNDQyXHUwNDNFXHUwNDNDIFx1MDQzMiBcdTA0NDFcdTA0MzVcdTA0NDBcdTA0MzJcdTA0MzhcdTA0NDFcdTA0MzUgXHUwNDM3XHUwNDMwXHUwNDQwXHUwNDMwXHUwNDNEXHUwNDM1XHUwNDM1LicsXG4gICAgICBdLFxuICAgIH0sXG4gICAge1xuICAgICAgaGVhZGluZzogJzYuIFx1MDQxN1x1MDQzMFx1MDQzRlx1MDQ0MFx1MDQzNVx1MDQ0OVx1MDQ1MVx1MDQzRFx1MDQzRFx1MDQzRVx1MDQzNSBcdTA0MzhcdTA0NDFcdTA0M0ZcdTA0M0VcdTA0M0JcdTA0NENcdTA0MzdcdTA0M0VcdTA0MzJcdTA0MzBcdTA0M0RcdTA0MzhcdTA0MzUnLFxuICAgICAgYm9keTogW1xuICAgICAgICAnXHUwNDE3XHUwNDMwXHUwNDNGXHUwNDQwXHUwNDM1XHUwNDQ5XHUwNDMwXHUwNDM1XHUwNDQyXHUwNDQxXHUwNDRGIFx1MDQzOFx1MDQ0MVx1MDQzRlx1MDQzRVx1MDQzQlx1MDQ0Q1x1MDQzN1x1MDQzRVx1MDQzMlx1MDQzMFx1MDQ0Mlx1MDQ0QyBcdTA0NDFcdTA0MzVcdTA0NDBcdTA0MzJcdTA0MzhcdTA0NDEgXHUwNDM0XHUwNDNCXHUwNDRGIFx1MDQzRVx1MDQ0Mlx1MDQzQ1x1MDQ0Qlx1MDQzMlx1MDQzMFx1MDQzRFx1MDQzOFx1MDQ0RiBcdTA0MzRcdTA0MzVcdTA0M0RcdTA0MzVcdTA0MzMsIFx1MDQ0NFx1MDQzOFx1MDQzRFx1MDQzMFx1MDQzRFx1MDQ0MVx1MDQzOFx1MDQ0MFx1MDQzRVx1MDQzMlx1MDQzMFx1MDQzRFx1MDQzOFx1MDQ0RiBcdTA0MzdcdTA0MzBcdTA0M0ZcdTA0NDBcdTA0MzVcdTA0NDlcdTA0NTFcdTA0M0RcdTA0M0RcdTA0M0VcdTA0MzkgXHUwNDM0XHUwNDM1XHUwNDRGXHUwNDQyXHUwNDM1XHUwNDNCXHUwNDRDXHUwNDNEXHUwNDNFXHUwNDQxXHUwNDQyXHUwNDM4LCBcdTA0M0NcdTA0MzBcdTA0M0RcdTA0MzhcdTA0M0ZcdTA0NDNcdTA0M0JcdTA0MzhcdTA0NDBcdTA0M0VcdTA0MzJcdTA0MzBcdTA0M0RcdTA0MzhcdTA0NEYgXHUwNDQwXHUwNDRCXHUwNDNEXHUwNDNBXHUwNDNFXHUwNDNDIChcdTA0NDFcdTA0M0ZcdTA0NDNcdTA0NDRcdTA0MzhcdTA0M0RcdTA0MzMsIFx1MDQzMlx1MDQzRVx1MDQ0OFx1MDQzOFx1MDQzRFx1MDQzMy1cdTA0NDJcdTA0NDBcdTA0MzVcdTA0MzlcdTA0MzRcdTA0MzhcdTA0M0RcdTA0MzMpIFx1MDQzOFx1MDQzQlx1MDQzOCBcdTA0M0ZcdTA0M0VcdTA0M0ZcdTA0NEJcdTA0NDJcdTA0M0VcdTA0M0EgXHUwNDNFXHUwNDMxXHUwNDNFXHUwNDM5XHUwNDQyXHUwNDM4IFx1MDQ0Mlx1MDQzNVx1MDQ0NVx1MDQzRFx1MDQzOFx1MDQ0N1x1MDQzNVx1MDQ0MVx1MDQzQVx1MDQzOFx1MDQzNSBcdTA0M0VcdTA0MzNcdTA0NDBcdTA0MzBcdTA0M0RcdTA0MzhcdTA0NDdcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NEYgXHUwNDNGXHUwNDNCXHUwNDMwXHUwNDQyXHUwNDQ0XHUwNDNFXHUwNDQwXHUwNDNDXHUwNDRCLicsXG4gICAgICBdLFxuICAgIH0sXG4gICAge1xuICAgICAgaGVhZGluZzogJzcuIFx1MDQxRlx1MDQ0MFx1MDQzOFx1MDQzRVx1MDQ0MVx1MDQ0Mlx1MDQzMFx1MDQzRFx1MDQzRVx1MDQzMlx1MDQzQVx1MDQzMCBcdTA0MzggXHUwNDNGXHUwNDQwXHUwNDM1XHUwNDNBXHUwNDQwXHUwNDMwXHUwNDQ5XHUwNDM1XHUwNDNEXHUwNDM4XHUwNDM1JyxcbiAgICAgIGJvZHk6IFtcbiAgICAgICAgJ1x1MDQxQ1x1MDQ0QiBcdTA0MzJcdTA0M0ZcdTA0NDBcdTA0MzBcdTA0MzJcdTA0MzUgXHUwNDNGXHUwNDQwXHUwNDM4XHUwNDNFXHUwNDQxXHUwNDQyXHUwNDMwXHUwNDNEXHUwNDNFXHUwNDMyXHUwNDM4XHUwNDQyXHUwNDRDIFx1MDQzOFx1MDQzQlx1MDQzOCBcdTA0MzdcdTA0MzBcdTA0M0FcdTA0NDBcdTA0NEJcdTA0NDJcdTA0NEMgXHUwNDMwXHUwNDNBXHUwNDNBXHUwNDMwXHUwNDQzXHUwNDNEXHUwNDQyIFx1MDQzRlx1MDQ0MFx1MDQzOCBcdTA0M0RcdTA0MzBcdTA0NDBcdTA0NDNcdTA0NDhcdTA0MzVcdTA0M0RcdTA0MzhcdTA0MzggXHUwNDNEXHUwNDMwXHUwNDQxXHUwNDQyXHUwNDNFXHUwNDRGXHUwNDQ5XHUwNDM4XHUwNDQ1IFx1MDQ0M1x1MDQ0MVx1MDQzQlx1MDQzRVx1MDQzMlx1MDQzOFx1MDQzOSwgXHUwNDNGXHUwNDNFIFx1MDQ0Mlx1MDQ0MFx1MDQzNVx1MDQzMVx1MDQzRVx1MDQzMlx1MDQzMFx1MDQzRFx1MDQzOFx1MDQ0RSBcdTA0MzdcdTA0MzBcdTA0M0FcdTA0M0VcdTA0M0RcdTA0MzAgXHUwNDM4XHUwNDNCXHUwNDM4IFx1MDQzRlx1MDQ0MFx1MDQzOCBcdTA0M0ZcdTA0M0VcdTA0MzRcdTA0M0VcdTA0MzdcdTA0NDBcdTA0MzVcdTA0M0RcdTA0MzhcdTA0MzggXHUwNDNEXHUwNDMwIFx1MDQzQ1x1MDQzRVx1MDQ0OFx1MDQzNVx1MDQzRFx1MDQzRFx1MDQzOFx1MDQ0N1x1MDQzNVx1MDQ0MVx1MDQ0Mlx1MDQzMlx1MDQzRSwgXHUwNDQzXHUwNDMyXHUwNDM1XHUwNDM0XHUwNDNFXHUwNDNDXHUwNDM4XHUwNDMyIFx1MDQzRlx1MDQzRVx1MDQzQlx1MDQ0Q1x1MDQzN1x1MDQzRVx1MDQzMlx1MDQzMFx1MDQ0Mlx1MDQzNVx1MDQzQlx1MDQ0RiwgXHUwNDMzXHUwNDM0XHUwNDM1IFx1MDQ0RFx1MDQ0Mlx1MDQzRSBcdTA0MzJcdTA0M0VcdTA0MzdcdTA0M0NcdTA0M0VcdTA0MzZcdTA0M0RcdTA0M0UuJyxcbiAgICAgIF0sXG4gICAgfSxcbiAgICB7XG4gICAgICBoZWFkaW5nOiAnOC4gXHUwNDFFXHUwNDMzXHUwNDQwXHUwNDMwXHUwNDNEXHUwNDM4XHUwNDQ3XHUwNDM1XHUwNDNEXHUwNDM4XHUwNDM1IFx1MDQzRVx1MDQ0Mlx1MDQzMlx1MDQzNVx1MDQ0Mlx1MDQ0MVx1MDQ0Mlx1MDQzMlx1MDQzNVx1MDQzRFx1MDQzRFx1MDQzRVx1MDQ0MVx1MDQ0Mlx1MDQzOCcsXG4gICAgICBib2R5OiBbXG4gICAgICAgICdcdTA0MjFcdTA0MzVcdTA0NDBcdTA0MzJcdTA0MzhcdTA0NDEgXHUwNDNGXHUwNDQwXHUwNDM1XHUwNDM0XHUwNDNFXHUwNDQxXHUwNDQyXHUwNDMwXHUwNDMyXHUwNDNCXHUwNDRGXHUwNDM1XHUwNDQyXHUwNDQxXHUwNDRGIFx1MDBBQlx1MDQzQVx1MDQzMFx1MDQzQSBcdTA0MzVcdTA0NDFcdTA0NDJcdTA0NENcdTAwQkIuIFx1MDQxQ1x1MDQ0QiBcdTA0M0RcdTA0MzUgXHUwNDMzXHUwNDMwXHUwNDQwXHUwNDMwXHUwNDNEXHUwNDQyXHUwNDM4XHUwNDQwXHUwNDQzXHUwNDM1XHUwNDNDIFx1MDQzMVx1MDQzNVx1MDQ0MVx1MDQzRlx1MDQzNVx1MDQ0MFx1MDQzNVx1MDQzMVx1MDQzRVx1MDQzOVx1MDQzRFx1MDQ0M1x1MDQ0RSBcdTA0NDBcdTA0MzBcdTA0MzFcdTA0M0VcdTA0NDJcdTA0NDMgXHUwNDM4IFx1MDQzRFx1MDQzNSBcdTA0M0RcdTA0MzVcdTA0NDFcdTA0NTFcdTA0M0MgXHUwNDNFXHUwNDQyXHUwNDMyXHUwNDM1XHUwNDQyXHUwNDQxXHUwNDQyXHUwNDMyXHUwNDM1XHUwNDNEXHUwNDNEXHUwNDNFXHUwNDQxXHUwNDQyXHUwNDM4IFx1MDQzN1x1MDQzMCBcdTA0NDNcdTA0MzFcdTA0NEJcdTA0NDJcdTA0M0FcdTA0MzgsIFx1MDQzMlx1MDQzRVx1MDQzN1x1MDQzRFx1MDQzOFx1MDQzQVx1MDQ0OFx1MDQzOFx1MDQzNSBcdTA0MzhcdTA0MzctXHUwNDM3XHUwNDMwIFx1MDQ0MFx1MDQ0Qlx1MDQzRFx1MDQzRVx1MDQ0N1x1MDQzRFx1MDQzRVx1MDQzOSBcdTA0MzJcdTA0M0VcdTA0M0JcdTA0MzBcdTA0NDJcdTA0MzhcdTA0M0JcdTA0NENcdTA0M0RcdTA0M0VcdTA0NDFcdTA0NDJcdTA0MzgsIFx1MDQ0MVx1MDQzMVx1MDQzRVx1MDQzNVx1MDQzMiBcdTA0NDFcdTA0MzVcdTA0NDJcdTA0MzggXHUwNDM4XHUwNDNCXHUwNDM4IFx1MDQzNFx1MDQzNVx1MDQzOVx1MDQ0MVx1MDQ0Mlx1MDQzMlx1MDQzOFx1MDQzOSBcdTA0NDJcdTA0NDBcdTA0MzVcdTA0NDJcdTA0NENcdTA0MzhcdTA0NDUgXHUwNDQxXHUwNDQyXHUwNDNFXHUwNDQwXHUwNDNFXHUwNDNELicsXG4gICAgICBdLFxuICAgIH0sXG4gICAge1xuICAgICAgaGVhZGluZzogJzkuIFx1MDQxOFx1MDQzN1x1MDQzQ1x1MDQzNVx1MDQzRFx1MDQzNVx1MDQzRFx1MDQzOFx1MDQ0RiBcdTA0NDNcdTA0NDFcdTA0M0JcdTA0M0VcdTA0MzJcdTA0MzhcdTA0MzknLFxuICAgICAgYm9keTogW1xuICAgICAgICAnXHUwNDFDXHUwNDRCIFx1MDQzQ1x1MDQzRVx1MDQzNlx1MDQzNVx1MDQzQyBcdTA0M0VcdTA0MzFcdTA0M0RcdTA0M0VcdTA0MzJcdTA0M0JcdTA0NEZcdTA0NDJcdTA0NEMgXHUwNDREXHUwNDQyXHUwNDM4IFx1MDQ0M1x1MDQ0MVx1MDQzQlx1MDQzRVx1MDQzMlx1MDQzOFx1MDQ0Ri4gXHUwNDIxXHUwNDQzXHUwNDQ5XHUwNDM1XHUwNDQxXHUwNDQyXHUwNDMyXHUwNDM1XHUwNDNEXHUwNDNEXHUwNDRCXHUwNDM1IFx1MDQzOFx1MDQzN1x1MDQzQ1x1MDQzNVx1MDQzRFx1MDQzNVx1MDQzRFx1MDQzOFx1MDQ0RiBcdTA0MzFcdTA0NDNcdTA0MzRcdTA0NDNcdTA0NDIgXHUwNDMwXHUwNDNEXHUwNDNFXHUwNDNEXHUwNDQxXHUwNDM4XHUwNDQwXHUwNDNFXHUwNDMyXHUwNDMwXHUwNDNEXHUwNDRCIFx1MDQzMiBcdTA0NDFcdTA0MzVcdTA0NDBcdTA0MzJcdTA0MzhcdTA0NDFcdTA0MzUgXHUwNDNEXHUwNDM1IFx1MDQzQ1x1MDQzNVx1MDQzRFx1MDQzNVx1MDQzNSBcdTA0NDdcdTA0MzVcdTA0M0MgXHUwNDM3XHUwNDMwIDcgXHUwNDM0XHUwNDNEXHUwNDM1XHUwNDM5IFx1MDQzNFx1MDQzRSBcdTA0MzJcdTA0NDFcdTA0NDJcdTA0NDNcdTA0M0ZcdTA0M0JcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NEYgXHUwNDMyIFx1MDQ0MVx1MDQzOFx1MDQzQlx1MDQ0My4nLFxuICAgICAgXSxcbiAgICB9LFxuICBdLFxufTtcblxuY29uc3QgUlVfUFJJVkFDWTogTGVnYWxDb250ZW50ID0ge1xuICB0aXRsZTogJ1x1MDQxRlx1MDQzRVx1MDQzQlx1MDQzOFx1MDQ0Mlx1MDQzOFx1MDQzQVx1MDQzMCBcdTA0M0FcdTA0M0VcdTA0M0RcdTA0NDRcdTA0MzhcdTA0MzRcdTA0MzVcdTA0M0RcdTA0NDZcdTA0MzhcdTA0MzBcdTA0M0JcdTA0NENcdTA0M0RcdTA0M0VcdTA0NDFcdTA0NDJcdTA0MzgnLFxuICB1cGRhdGVkOiAnXHUwNDFGXHUwNDNFXHUwNDQxXHUwNDNCXHUwNDM1XHUwNDM0XHUwNDNEXHUwNDM1XHUwNDM1IFx1MDQzRVx1MDQzMVx1MDQzRFx1MDQzRVx1MDQzMlx1MDQzQlx1MDQzNVx1MDQzRFx1MDQzOFx1MDQzNTogMjIgXHUwNDMwXHUwNDMyXHUwNDMzXHUwNDQzXHUwNDQxXHUwNDQyXHUwNDMwIDIwMjYgXHUwNDMzLicsXG4gIGludHJvOiAnXHUwNDJEXHUwNDQyXHUwNDNFXHUwNDQyIFx1MDQzNFx1MDQzRVx1MDQzQVx1MDQ0M1x1MDQzQ1x1MDQzNVx1MDQzRFx1MDQ0MiBcdTA0M0VcdTA0M0ZcdTA0MzhcdTA0NDFcdTA0NEJcdTA0MzJcdTA0MzBcdTA0MzVcdTA0NDIsIFx1MDQzQVx1MDQzMFx1MDQzQVx1MDQzOFx1MDQzNSBcdTA0MzRcdTA0MzBcdTA0M0RcdTA0M0RcdTA0NEJcdTA0MzUgXHUwNDNDXHUwNDRCIFx1MDQ0MVx1MDQzRVx1MDQzMVx1MDQzOFx1MDQ0MFx1MDQzMFx1MDQzNVx1MDQzQywgXHUwNDM3XHUwNDMwXHUwNDQ3XHUwNDM1XHUwNDNDIFx1MDQzOCBcdTA0M0FcdTA0MzBcdTA0M0EgXHUwNDM4XHUwNDQ1IFx1MDQzN1x1MDQzMFx1MDQ0OVx1MDQzOFx1MDQ0OVx1MDQzMFx1MDQzNVx1MDQzQy4nLFxuICBzZWN0aW9uczogW1xuICAgIHtcbiAgICAgIGhlYWRpbmc6ICcxLiBcdTA0MUFcdTA0MzBcdTA0M0FcdTA0MzhcdTA0MzUgXHUwNDM0XHUwNDMwXHUwNDNEXHUwNDNEXHUwNDRCXHUwNDM1IFx1MDQzQ1x1MDQ0QiBcdTA0NDFcdTA0M0VcdTA0MzFcdTA0MzhcdTA0NDBcdTA0MzBcdTA0MzVcdTA0M0MnLFxuICAgICAgYm9keTogW1xuICAgICAgICAnXHUwNDIwXHUwNDM1XHUwNDMzXHUwNDM4XHUwNDQxXHUwNDQyXHUwNDQwXHUwNDMwXHUwNDQ2XHUwNDM4XHUwNDNFXHUwNDNEXHUwNDNEXHUwNDRCXHUwNDM1IFx1MDQzNFx1MDQzMFx1MDQzRFx1MDQzRFx1MDQ0Qlx1MDQzNSAoZW1haWwsIFx1MDQ0NVx1MDQzNVx1MDQ0OFx1MDQzOFx1MDQ0MFx1MDQzRVx1MDQzMlx1MDQzMFx1MDQzRFx1MDQzRFx1MDQ0Qlx1MDQzOSBcdTA0M0ZcdTA0MzBcdTA0NDBcdTA0M0VcdTA0M0JcdTA0NEMpLCBcdTA0MzRcdTA0MzBcdTA0M0RcdTA0M0RcdTA0NEJcdTA0MzUgXHUwNDMyXHUwNDM1XHUwNDQwXHUwNDM4XHUwNDQ0XHUwNDM4XHUwNDNBXHUwNDMwXHUwNDQ2XHUwNDM4XHUwNDM4IChLWUMpOiBcdTA0MzhcdTA0M0NcdTA0NEYsIFx1MDQ0MVx1MDQ0Mlx1MDQ0MFx1MDQzMFx1MDQzRFx1MDQzMCwgXHUwNDM0XHUwNDNFXHUwNDNBXHUwNDQzXHUwNDNDXHUwNDM1XHUwNDNEXHUwNDQyLCBcdTA0NDNcdTA0MzRcdTA0M0VcdTA0NDFcdTA0NDJcdTA0M0VcdTA0MzJcdTA0MzVcdTA0NDBcdTA0NEZcdTA0NEVcdTA0NDlcdTA0MzhcdTA0MzkgXHUwNDNCXHUwNDM4XHUwNDQ3XHUwNDNEXHUwNDNFXHUwNDQxXHUwNDQyXHUwNDRDLCBcdTA0MzhcdTA0NDFcdTA0NDJcdTA0M0VcdTA0NDBcdTA0MzhcdTA0NEYgXHUwNDQyXHUwNDNFXHUwNDQwXHUwNDMzXHUwNDNFXHUwNDMyIFx1MDQzOCBcdTA0NDJcdTA0NDBcdTA0MzBcdTA0M0RcdTA0MzdcdTA0MzBcdTA0M0FcdTA0NDZcdTA0MzhcdTA0MzksIFx1MDQ0Mlx1MDQzNVx1MDQ0NVx1MDQzRFx1MDQzOFx1MDQ0N1x1MDQzNVx1MDQ0MVx1MDQzQVx1MDQzMFx1MDQ0RiBcdTA0MzhcdTA0M0RcdTA0NDRcdTA0M0VcdTA0NDBcdTA0M0NcdTA0MzBcdTA0NDZcdTA0MzhcdTA0NEYgKElQLVx1MDQzMFx1MDQzNFx1MDQ0MFx1MDQzNVx1MDQ0MSwgXHUwNDQyXHUwNDM4XHUwNDNGIFx1MDQ0M1x1MDQ0MVx1MDQ0Mlx1MDQ0MFx1MDQzRVx1MDQzOVx1MDQ0MVx1MDQ0Mlx1MDQzMlx1MDQzMCkgXHUwNDM0XHUwNDNCXHUwNDRGIFx1MDQ0Nlx1MDQzNVx1MDQzQlx1MDQzNVx1MDQzOSBcdTA0MzFcdTA0MzVcdTA0MzdcdTA0M0VcdTA0M0ZcdTA0MzBcdTA0NDFcdTA0M0RcdTA0M0VcdTA0NDFcdTA0NDJcdTA0MzguJyxcbiAgICAgIF0sXG4gICAgfSxcbiAgICB7XG4gICAgICBoZWFkaW5nOiAnMi4gXHUwNDFBXHUwNDMwXHUwNDNBIFx1MDQzQ1x1MDQ0QiBcdTA0MzhcdTA0NDFcdTA0M0ZcdTA0M0VcdTA0M0JcdTA0NENcdTA0MzdcdTA0NDNcdTA0MzVcdTA0M0MgXHUwNDM0XHUwNDMwXHUwNDNEXHUwNDNEXHUwNDRCXHUwNDM1JyxcbiAgICAgIGJvZHk6IFtcbiAgICAgICAgJ1x1MDQxNFx1MDQzQlx1MDQ0RiBcdTA0M0ZcdTA0NDBcdTA0MzVcdTA0MzRcdTA0M0VcdTA0NDFcdTA0NDJcdTA0MzBcdTA0MzJcdTA0M0JcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NEYgXHUwNDQxXHUwNDM1XHUwNDQwXHUwNDMyXHUwNDM4XHUwNDQxXHUwNDMwLCBcdTA0MzhcdTA0NDFcdTA0M0ZcdTA0M0VcdTA0M0JcdTA0M0RcdTA0MzVcdTA0M0RcdTA0MzhcdTA0NEYgXHUwNDNFXHUwNDQwXHUwNDM0XHUwNDM1XHUwNDQwXHUwNDNFXHUwNDMyLCBcdTA0M0VcdTA0MzFcdTA0NDBcdTA0MzBcdTA0MzFcdTA0M0VcdTA0NDJcdTA0M0FcdTA0MzggXHUwNDM0XHUwNDM1XHUwNDNGXHUwNDNFXHUwNDM3XHUwNDM4XHUwNDQyXHUwNDNFXHUwNDMyL1x1MDQzMlx1MDQ0Qlx1MDQzMlx1MDQzRVx1MDQzNFx1MDQzRVx1MDQzMiwgXHUwNDNGXHUwNDQwXHUwNDM1XHUwNDM0XHUwNDNFXHUwNDQyXHUwNDMyXHUwNDQwXHUwNDMwXHUwNDQ5XHUwNDM1XHUwNDNEXHUwNDM4XHUwNDRGIFx1MDQzQ1x1MDQzRVx1MDQ0OFx1MDQzNVx1MDQzRFx1MDQzRFx1MDQzOFx1MDQ0N1x1MDQzNVx1MDQ0MVx1MDQ0Mlx1MDQzMlx1MDQzMCBcdTA0MzggXHUwNDQxXHUwNDNFXHUwNDMxXHUwNDNCXHUwNDRFXHUwNDM0XHUwNDM1XHUwNDNEXHUwNDM4XHUwNDRGIFx1MDQ0Mlx1MDQ0MFx1MDQzNVx1MDQzMVx1MDQzRVx1MDQzMlx1MDQzMFx1MDQzRFx1MDQzOFx1MDQzOSBcdTA0MzdcdTA0MzBcdTA0M0FcdTA0M0VcdTA0M0RcdTA0M0VcdTA0MzRcdTA0MzBcdTA0NDJcdTA0MzVcdTA0M0JcdTA0NENcdTA0NDFcdTA0NDJcdTA0MzJcdTA0MzAgXHUwNDNFIFx1MDQzRlx1MDQ0MFx1MDQzRVx1MDQ0Mlx1MDQzOFx1MDQzMlx1MDQzRVx1MDQzNFx1MDQzNVx1MDQzOVx1MDQ0MVx1MDQ0Mlx1MDQzMlx1MDQzOFx1MDQzOCBcdTA0M0VcdTA0NDJcdTA0M0NcdTA0NEJcdTA0MzJcdTA0MzBcdTA0M0RcdTA0MzhcdTA0NEUgXHUwNDM0XHUwNDM1XHUwNDNEXHUwNDM1XHUwNDMzIChBTUwvS1lDKS4nLFxuICAgICAgXSxcbiAgICB9LFxuICAgIHtcbiAgICAgIGhlYWRpbmc6ICczLiBcdTA0MTRcdTA0MzBcdTA0M0RcdTA0M0RcdTA0NEJcdTA0MzUgXHUwNDMyXHUwNDM1XHUwNDQwXHUwNDM4XHUwNDQ0XHUwNDM4XHUwNDNBXHUwNDMwXHUwNDQ2XHUwNDM4XHUwNDM4IChLWUMpJyxcbiAgICAgIGJvZHk6IFtcbiAgICAgICAgJ1x1MDQxNFx1MDQzRVx1MDQzQVx1MDQ0M1x1MDQzQ1x1MDQzNVx1MDQzRFx1MDQ0Mlx1MDQ0QiwgXHUwNDM3XHUwNDMwXHUwNDMzXHUwNDQwXHUwNDQzXHUwNDM2XHUwNDM1XHUwNDNEXHUwNDNEXHUwNDRCXHUwNDM1IFx1MDQzNFx1MDQzQlx1MDQ0RiBcdTA0MzJcdTA0MzVcdTA0NDBcdTA0MzhcdTA0NDRcdTA0MzhcdTA0M0FcdTA0MzBcdTA0NDZcdTA0MzhcdTA0MzggXHUwNDNCXHUwNDM4XHUwNDQ3XHUwNDNEXHUwNDNFXHUwNDQxXHUwNDQyXHUwNDM4LCBcdTA0NDVcdTA0NDBcdTA0MzBcdTA0M0RcdTA0NEZcdTA0NDJcdTA0NDFcdTA0NEYgXHUwNDMyIFx1MDQzN1x1MDQzMFx1MDQ0OFx1MDQzOFx1MDQ0NFx1MDQ0MFx1MDQzRVx1MDQzMlx1MDQzMFx1MDQzRFx1MDQzRFx1MDQzRVx1MDQzQyBcdTA0MzJcdTA0MzhcdTA0MzRcdTA0MzUgXHUwNDM4IFx1MDQzNFx1MDQzRVx1MDQ0MVx1MDQ0Mlx1MDQ0M1x1MDQzRlx1MDQzRFx1MDQ0QiBcdTA0NDJcdTA0M0VcdTA0M0JcdTA0NENcdTA0M0FcdTA0M0UgXHUwNDQzXHUwNDNGXHUwNDNFXHUwNDNCXHUwNDNEXHUwNDNFXHUwNDNDXHUwNDNFXHUwNDQ3XHUwNDM1XHUwNDNEXHUwNDNEXHUwNDNFXHUwNDNDXHUwNDQzIFx1MDQzRlx1MDQzNVx1MDQ0MFx1MDQ0MVx1MDQzRVx1MDQzRFx1MDQzMFx1MDQzQlx1MDQ0MyBcdTA0MzRcdTA0M0JcdTA0NEYgXHUwNDQ2XHUwNDM1XHUwNDNCXHUwNDM1XHUwNDM5IFx1MDQzRlx1MDQ0MFx1MDQzRVx1MDQzMlx1MDQzNVx1MDQ0MFx1MDQzQVx1MDQzOCBcdTA0MzggXHUwNDQxXHUwNDNFXHUwNDNFXHUwNDQyXHUwNDMyXHUwNDM1XHUwNDQyXHUwNDQxXHUwNDQyXHUwNDMyXHUwNDM4XHUwNDRGIFx1MDQ0Mlx1MDQ0MFx1MDQzNVx1MDQzMVx1MDQzRVx1MDQzMlx1MDQzMFx1MDQzRFx1MDQzOFx1MDQ0Rlx1MDQzQyBcdTA0NDBcdTA0MzVcdTA0MzNcdTA0NDNcdTA0M0JcdTA0MzhcdTA0NDBcdTA0M0VcdTA0MzJcdTA0MzBcdTA0M0RcdTA0MzhcdTA0NEYuJyxcbiAgICAgIF0sXG4gICAgfSxcbiAgICB7XG4gICAgICBoZWFkaW5nOiAnNC4gXHUwNDFGXHUwNDM1XHUwNDQwXHUwNDM1XHUwNDM0XHUwNDMwXHUwNDQ3XHUwNDMwIFx1MDQzNFx1MDQzMFx1MDQzRFx1MDQzRFx1MDQ0Qlx1MDQ0NSBcdTA0NDJcdTA0NDBcdTA0MzVcdTA0NDJcdTA0NENcdTA0MzhcdTA0M0MgXHUwNDNCXHUwNDM4XHUwNDQ2XHUwNDMwXHUwNDNDJyxcbiAgICAgIGJvZHk6IFtcbiAgICAgICAgJ1x1MDQxQ1x1MDQ0QiBcdTA0M0RcdTA0MzUgXHUwNDNGXHUwNDQwXHUwNDNFXHUwNDM0XHUwNDMwXHUwNDUxXHUwNDNDIFx1MDQzRlx1MDQzNVx1MDQ0MFx1MDQ0MVx1MDQzRVx1MDQzRFx1MDQzMFx1MDQzQlx1MDQ0Q1x1MDQzRFx1MDQ0Qlx1MDQzNSBcdTA0MzRcdTA0MzBcdTA0M0RcdTA0M0RcdTA0NEJcdTA0MzUuIFx1MDQxNFx1MDQzMFx1MDQzRFx1MDQzRFx1MDQ0Qlx1MDQzNSBcdTA0M0NcdTA0M0VcdTA0MzNcdTA0NDNcdTA0NDIgXHUwNDNGXHUwNDM1XHUwNDQwXHUwNDM1XHUwNDM0XHUwNDMwXHUwNDMyXHUwNDMwXHUwNDQyXHUwNDRDXHUwNDQxXHUwNDRGIFx1MDQzRlx1MDQzRVx1MDQ0MVx1MDQ0Mlx1MDQzMFx1MDQzMlx1MDQ0OVx1MDQzOFx1MDQzQVx1MDQzMFx1MDQzQyBcdTA0MzhcdTA0M0RcdTA0NDRcdTA0NDBcdTA0MzBcdTA0NDFcdTA0NDJcdTA0NDBcdTA0NDNcdTA0M0FcdTA0NDJcdTA0NDNcdTA0NDBcdTA0NEIgKFx1MDQ0NVx1MDQzRVx1MDQ0MVx1MDQ0Mlx1MDQzOFx1MDQzRFx1MDQzMywgXHUwNDNFXHUwNDMxXHUwNDQwXHUwNDMwXHUwNDMxXHUwNDNFXHUwNDQyXHUwNDNBXHUwNDMwIFx1MDQzRlx1MDQzQlx1MDQzMFx1MDQ0Mlx1MDQzNVx1MDQzNlx1MDQzNVx1MDQzOSkgXHUwNDM4XHUwNDQxXHUwNDNBXHUwNDNCXHUwNDRFXHUwNDQ3XHUwNDM4XHUwNDQyXHUwNDM1XHUwNDNCXHUwNDRDXHUwNDNEXHUwNDNFIFx1MDQzMiBcdTA0M0VcdTA0MzFcdTA0NEFcdTA0NTFcdTA0M0NcdTA0MzUsIFx1MDQzRFx1MDQzNVx1MDQzRVx1MDQzMVx1MDQ0NVx1MDQzRVx1MDQzNFx1MDQzOFx1MDQzQ1x1MDQzRVx1MDQzQyBcdTA0MzRcdTA0M0JcdTA0NEYgXHUwNDQwXHUwNDMwXHUwNDMxXHUwNDNFXHUwNDQyXHUwNDRCIFx1MDQ0MVx1MDQzNVx1MDQ0MFx1MDQzMlx1MDQzOFx1MDQ0MVx1MDQzMCwgXHUwNDMwIFx1MDQ0Mlx1MDQzMFx1MDQzQVx1MDQzNlx1MDQzNSBcdTA0M0ZcdTA0M0UgXHUwNDM3XHUwNDMwXHUwNDNBXHUwNDNFXHUwNDNEXHUwNDNEXHUwNDNFXHUwNDNDXHUwNDQzIFx1MDQ0Mlx1MDQ0MFx1MDQzNVx1MDQzMVx1MDQzRVx1MDQzMlx1MDQzMFx1MDQzRFx1MDQzOFx1MDQ0RSBcdTA0MzNcdTA0M0VcdTA0NDFcdTA0NDNcdTA0MzRcdTA0MzBcdTA0NDBcdTA0NDFcdTA0NDJcdTA0MzJcdTA0MzVcdTA0M0RcdTA0M0RcdTA0NEJcdTA0NDUgXHUwNDNFXHUwNDQwXHUwNDMzXHUwNDMwXHUwNDNEXHUwNDNFXHUwNDMyLicsXG4gICAgICBdLFxuICAgIH0sXG4gICAge1xuICAgICAgaGVhZGluZzogJzUuIFx1MDQxMVx1MDQzNVx1MDQzN1x1MDQzRVx1MDQzRlx1MDQzMFx1MDQ0MVx1MDQzRFx1MDQzRVx1MDQ0MVx1MDQ0Mlx1MDQ0QyBcdTA0MzRcdTA0MzBcdTA0M0RcdTA0M0RcdTA0NEJcdTA0NDUnLFxuICAgICAgYm9keTogW1xuICAgICAgICAnXHUwNDFGXHUwNDMwXHUwNDQwXHUwNDNFXHUwNDNCXHUwNDM4IFx1MDQ0NVx1MDQ0MFx1MDQzMFx1MDQzRFx1MDQ0Rlx1MDQ0Mlx1MDQ0MVx1MDQ0RiBcdTA0MzIgXHUwNDMyXHUwNDM4XHUwNDM0XHUwNDM1IFx1MDQzRFx1MDQzNVx1MDQzRVx1MDQzMVx1MDQ0MFx1MDQzMFx1MDQ0Mlx1MDQzOFx1MDQzQ1x1MDQ0Qlx1MDQ0NSBcdTA0M0FcdTA0NDBcdTA0MzhcdTA0M0ZcdTA0NDJcdTA0M0VcdTA0MzNcdTA0NDBcdTA0MzBcdTA0NDRcdTA0MzhcdTA0NDdcdTA0MzVcdTA0NDFcdTA0M0FcdTA0MzhcdTA0NDUgXHUwNDQ1XHUwNDM1XHUwNDQ4XHUwNDM1XHUwNDM5LiBcdTA0MjFcdTA0MzVcdTA0M0FcdTA0NDBcdTA0MzVcdTA0NDJcdTA0NEIgQVBJLVx1MDQzQVx1MDQzQlx1MDQ0RVx1MDQ0N1x1MDQzNVx1MDQzOSBcdTA0NDhcdTA0MzhcdTA0NDRcdTA0NDBcdTA0NDNcdTA0NEVcdTA0NDJcdTA0NDFcdTA0NEYgXHUwNDNGXHUwNDQwXHUwNDM4IFx1MDQ0NVx1MDQ0MFx1MDQzMFx1MDQzRFx1MDQzNVx1MDQzRFx1MDQzOFx1MDQzOC4gXHUwNDFDXHUwNDRCIFx1MDQzRlx1MDQzRVx1MDQzNFx1MDQzNFx1MDQzNVx1MDQ0MFx1MDQzNlx1MDQzOFx1MDQzMlx1MDQzMFx1MDQzNVx1MDQzQyBcdTA0MzRcdTA0MzJcdTA0NDNcdTA0NDVcdTA0NDRcdTA0MzBcdTA0M0FcdTA0NDJcdTA0M0VcdTA0NDBcdTA0M0RcdTA0NDNcdTA0NEUgXHUwNDMwXHUwNDQzXHUwNDQyXHUwNDM1XHUwNDNEXHUwNDQyXHUwNDM4XHUwNDQ0XHUwNDM4XHUwNDNBXHUwNDMwXHUwNDQ2XHUwNDM4XHUwNDRFIFx1MDQzNFx1MDQzQlx1MDQ0RiBcdTA0MzRcdTA0M0VcdTA0M0ZcdTA0M0VcdTA0M0JcdTA0M0RcdTA0MzhcdTA0NDJcdTA0MzVcdTA0M0JcdTA0NENcdTA0M0RcdTA0M0VcdTA0MzkgXHUwNDM3XHUwNDMwXHUwNDQ5XHUwNDM4XHUwNDQyXHUwNDRCIFx1MDQzMFx1MDQzQVx1MDQzQVx1MDQzMFx1MDQ0M1x1MDQzRFx1MDQ0Mlx1MDQzMC4nLFxuICAgICAgXSxcbiAgICB9LFxuICAgIHtcbiAgICAgIGhlYWRpbmc6ICc2LiBcdTA0MjJcdTA0MzJcdTA0M0VcdTA0MzggXHUwNDNGXHUwNDQwXHUwNDMwXHUwNDMyXHUwNDMwJyxcbiAgICAgIGJvZHk6IFtcbiAgICAgICAgJ1x1MDQyMlx1MDQ0QiBcdTA0M0NcdTA0M0VcdTA0MzZcdTA0MzVcdTA0NDhcdTA0NEMgXHUwNDM3XHUwNDMwXHUwNDNGXHUwNDQwXHUwNDNFXHUwNDQxXHUwNDM4XHUwNDQyXHUwNDRDIFx1MDQzQVx1MDQzRVx1MDQzRlx1MDQzOFx1MDQ0RSBcdTA0NDFcdTA0MzJcdTA0M0VcdTA0MzhcdTA0NDUgXHUwNDM0XHUwNDMwXHUwNDNEXHUwNDNEXHUwNDRCXHUwNDQ1IFx1MDQzOFx1MDQzQlx1MDQzOCBcdTA0MzhcdTA0NDUgXHUwNDQzXHUwNDM0XHUwNDMwXHUwNDNCXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDM1LCBcdTA0MzdcdTA0MzAgXHUwNDM4XHUwNDQxXHUwNDNBXHUwNDNCXHUwNDRFXHUwNDQ3XHUwNDM1XHUwNDNEXHUwNDM4XHUwNDM1XHUwNDNDIFx1MDQzOFx1MDQzRFx1MDQ0NFx1MDQzRVx1MDQ0MFx1MDQzQ1x1MDQzMFx1MDQ0Nlx1MDQzOFx1MDQzOCwgXHUwNDNBXHUwNDNFXHUwNDQyXHUwNDNFXHUwNDQwXHUwNDQzXHUwNDRFIFx1MDQzQ1x1MDQ0QiBcdTA0M0VcdTA0MzFcdTA0NEZcdTA0MzdcdTA0MzBcdTA0M0RcdTA0NEIgXHUwNDQ1XHUwNDQwXHUwNDMwXHUwNDNEXHUwNDM4XHUwNDQyXHUwNDRDIFx1MDQzRlx1MDQzRSBcdTA0MzdcdTA0MzBcdTA0M0FcdTA0M0VcdTA0M0RcdTA0NDMgKFx1MDQzRFx1MDQzMFx1MDQzRlx1MDQ0MFx1MDQzOFx1MDQzQ1x1MDQzNVx1MDQ0MCwgXHUwNDM3XHUwNDMwXHUwNDNGXHUwNDM4XHUwNDQxXHUwNDM4IEtZQy9BTUwgXHUwNDMyIFx1MDQ0Mlx1MDQzNVx1MDQ0N1x1MDQzNVx1MDQzRFx1MDQzOFx1MDQzNSBcdTA0NDNcdTA0NDFcdTA0NDJcdTA0MzBcdTA0M0RcdTA0M0VcdTA0MzJcdTA0M0JcdTA0MzVcdTA0M0RcdTA0M0RcdTA0M0VcdTA0MzNcdTA0M0UgXHUwNDQxXHUwNDQwXHUwNDNFXHUwNDNBXHUwNDMwKS4nLFxuICAgICAgXSxcbiAgICB9LFxuICAgIHtcbiAgICAgIGhlYWRpbmc6ICc3LiBcdTA0MjVcdTA0NDBcdTA0MzBcdTA0M0RcdTA0MzVcdTA0M0RcdTA0MzhcdTA0MzUgXHUwNDM0XHUwNDMwXHUwNDNEXHUwNDNEXHUwNDRCXHUwNDQ1JyxcbiAgICAgIGJvZHk6IFtcbiAgICAgICAgJ1x1MDQxNFx1MDQzMFx1MDQzRFx1MDQzRFx1MDQ0Qlx1MDQzNSBcdTA0MzBcdTA0M0FcdTA0M0FcdTA0MzBcdTA0NDNcdTA0M0RcdTA0NDJcdTA0MzAgXHUwNDQ1XHUwNDQwXHUwNDMwXHUwNDNEXHUwNDRGXHUwNDQyXHUwNDQxXHUwNDRGLCBcdTA0M0ZcdTA0M0VcdTA0M0FcdTA0MzAgXHUwNDMwXHUwNDNBXHUwNDNBXHUwNDMwXHUwNDQzXHUwNDNEXHUwNDQyIFx1MDQzMFx1MDQzQVx1MDQ0Mlx1MDQzOFx1MDQzMlx1MDQzNVx1MDQzRC4gXHUwNDFGXHUwNDNFXHUwNDQxXHUwNDNCXHUwNDM1IFx1MDQzN1x1MDQzMFx1MDQzQVx1MDQ0MFx1MDQ0Qlx1MDQ0Mlx1MDQzOFx1MDQ0RiBcdTA0MzBcdTA0M0FcdTA0M0FcdTA0MzBcdTA0NDNcdTA0M0RcdTA0NDJcdTA0MzAgXHUwNDM0XHUwNDMwXHUwNDNEXHUwNDNEXHUwNDRCXHUwNDM1LCBcdTA0NDJcdTA0NDBcdTA0MzVcdTA0MzFcdTA0NDNcdTA0MzVcdTA0M0NcdTA0NEJcdTA0MzUgXHUwNDM3XHUwNDMwXHUwNDNBXHUwNDNFXHUwNDNEXHUwNDNFXHUwNDNDIChcdTA0NDJcdTA0NDBcdTA0MzBcdTA0M0RcdTA0MzdcdTA0MzBcdTA0M0FcdTA0NDZcdTA0MzhcdTA0MzgsIEtZQyksIFx1MDQ0NVx1MDQ0MFx1MDQzMFx1MDQzRFx1MDQ0Rlx1MDQ0Mlx1MDQ0MVx1MDQ0RiBcdTA0NDNcdTA0NDFcdTA0NDJcdTA0MzBcdTA0M0RcdTA0M0VcdTA0MzJcdTA0M0JcdTA0MzVcdTA0M0RcdTA0M0RcdTA0NEJcdTA0MzkgXHUwNDQwXHUwNDM1XHUwNDMzXHUwNDQzXHUwNDNCXHUwNDM4XHUwNDQwXHUwNDNFXHUwNDMyXHUwNDMwXHUwNDNEXHUwNDM4XHUwNDM1XHUwNDNDIFx1MDQ0MVx1MDQ0MFx1MDQzRVx1MDQzQSwgXHUwNDNFXHUwNDQxXHUwNDQyXHUwNDMwXHUwNDNCXHUwNDRDXHUwNDNEXHUwNDRCXHUwNDM1IFx1MjAxNCBcdTA0NDNcdTA0MzRcdTA0MzBcdTA0M0JcdTA0NEZcdTA0NEVcdTA0NDJcdTA0NDFcdTA0NEYuJyxcbiAgICAgIF0sXG4gICAgfSxcbiAgICB7XG4gICAgICBoZWFkaW5nOiAnOC4gXHUwNDIxXHUwNDMyXHUwNDRGXHUwNDM3XHUwNDRDIFx1MDQ0MSBcdTA0M0RcdTA0MzBcdTA0M0NcdTA0MzgnLFxuICAgICAgYm9keTogW1xuICAgICAgICAnXHUwNDEyXHUwNDNFXHUwNDNGXHUwNDQwXHUwNDNFXHUwNDQxXHUwNDRCIFx1MDQzRSBcdTA0MzRcdTA0MzBcdTA0M0RcdTA0M0RcdTA0NEJcdTA0NDUgXHUwNDM4IFx1MDQzQVx1MDQzRVx1MDQzRFx1MDQ0NFx1MDQzOFx1MDQzNFx1MDQzNVx1MDQzRFx1MDQ0Nlx1MDQzOFx1MDQzMFx1MDQzQlx1MDQ0Q1x1MDQzRFx1MDQzRVx1MDQ0MVx1MDQ0Mlx1MDQzOCBcdTA0M0NcdTA0M0VcdTA0MzZcdTA0M0RcdTA0M0UgXHUwNDNEXHUwNDMwXHUwNDNGXHUwNDQwXHUwNDMwXHUwNDMyXHUwNDM4XHUwNDQyXHUwNDRDIFx1MDQ0N1x1MDQzNVx1MDQ0MFx1MDQzNVx1MDQzNyBcdTA0NDBcdTA0MzBcdTA0MzdcdTA0MzRcdTA0MzVcdTA0M0IgXHUwNDNGXHUwNDNFXHUwNDM0XHUwNDM0XHUwNDM1XHUwNDQwXHUwNDM2XHUwNDNBXHUwNDM4IFx1MDQzMiBcdTA0MzBcdTA0M0FcdTA0M0FcdTA0MzBcdTA0NDNcdTA0M0RcdTA0NDJcdTA0MzUuJyxcbiAgICAgIF0sXG4gICAgfSxcbiAgXSxcbn07XG5cbmNvbnN0IFJVX0FCT1VUOiBMZWdhbENvbnRlbnQgPSB7XG4gIHRpdGxlOiAnXHUwNDFFIFx1MDQzRFx1MDQzMFx1MDQ0MScsXG4gIHVwZGF0ZWQ6ICdcdTA0MUZcdTA0M0VcdTA0NDFcdTA0M0JcdTA0MzVcdTA0MzRcdTA0M0RcdTA0MzVcdTA0MzUgXHUwNDNFXHUwNDMxXHUwNDNEXHUwNDNFXHUwNDMyXHUwNDNCXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDM1OiAyMiBcdTA0MzBcdTA0MzJcdTA0MzNcdTA0NDNcdTA0NDFcdTA0NDJcdTA0MzAgMjAyNiBcdTA0MzMuJyxcbiAgaW50cm86XG4gICAgJ1ZPTFRFWCBcdTIwMTQgXHUwNDNGXHUwNDNCXHUwNDMwXHUwNDQyXHUwNDQ0XHUwNDNFXHUwNDQwXHUwNDNDXHUwNDMwIFx1MDQzNFx1MDQzQlx1MDQ0RiBcdTA0NDJcdTA0M0VcdTA0NDBcdTA0MzNcdTA0M0VcdTA0MzJcdTA0M0JcdTA0MzggXHUwNDNBXHUwNDQwXHUwNDM4XHUwNDNGXHUwNDQyXHUwNDNFXHUwNDMyXHUwNDMwXHUwNDNCXHUwNDRFXHUwNDQyXHUwNDMwXHUwNDNDXHUwNDM4OiBcdTA0NDFcdTA0M0ZcdTA0M0VcdTA0NDIgXHUwNDM4IFx1MDQ0NFx1MDQ0Q1x1MDQ0RVx1MDQ0N1x1MDQzNVx1MDQ0MFx1MDQ0MVx1MDQ0QiBcdTA0NDEgXHUwNDNDXHUwNDMwXHUwNDQwXHUwNDM2XHUwNDM4XHUwNDNEXHUwNDMwXHUwNDNCXHUwNDRDXHUwNDNEXHUwNDNFXHUwNDM5IFx1MDQ0Mlx1MDQzRVx1MDQ0MFx1MDQzM1x1MDQzRVx1MDQzMlx1MDQzQlx1MDQzNVx1MDQzOSwgXHUwNDNCXHUwNDM4XHUwNDNDXHUwNDM4XHUwNDQyXHUwNDNEXHUwNDRCXHUwNDM1LCBcdTA0NDBcdTA0NEJcdTA0M0RcdTA0M0VcdTA0NDdcdTA0M0RcdTA0NEJcdTA0MzUsIFx1MDQ0MVx1MDQ0Mlx1MDQzRVx1MDQzRi0gXHUwNDM4IFx1MDQ0Mlx1MDQzNVx1MDQzOVx1MDQzQS1cdTA0M0ZcdTA0NDBcdTA0M0VcdTA0NDRcdTA0MzhcdTA0NDIgXHUwNDNFXHUwNDQwXHUwNDM0XHUwNDM1XHUwNDQwXHUwNDMwLCBcdTA0MzJcdTA0NEJcdTA0MzJcdTA0M0VcdTA0MzQgXHUwNDM4IFx1MDQzNFx1MDQzNVx1MDQzRlx1MDQzRVx1MDQzN1x1MDQzOFx1MDQ0MiBcdTA0MzIgXHUwNDNGXHUwNDNFXHUwNDM0XHUwNDM0XHUwNDM1XHUwNDQwXHUwNDM2XHUwNDM4XHUwNDMyXHUwNDMwXHUwNDM1XHUwNDNDXHUwNDRCXHUwNDQ1IFx1MDQ0MVx1MDQzNVx1MDQ0Mlx1MDQ0Rlx1MDQ0NS4nLFxuICBzZWN0aW9uczogW1xuICAgIHtcbiAgICAgIGhlYWRpbmc6ICdcdTA0MjJcdTA0M0VcdTA0NDBcdTA0MzNcdTA0M0VcdTA0MzJcdTA0NEJcdTA0MzkgXHUwNDM0XHUwNDMyXHUwNDM4XHUwNDM2XHUwNDNFXHUwNDNBJyxcbiAgICAgIGJvZHk6IFtcbiAgICAgICAgJ1x1MDQxRVx1MDQ0MFx1MDQzNFx1MDQzNVx1MDQ0MFx1MDQzMCBcdTA0NDFcdTA0M0VcdTA0M0ZcdTA0M0VcdTA0NDFcdTA0NDJcdTA0MzBcdTA0MzJcdTA0M0JcdTA0NEZcdTA0NEVcdTA0NDJcdTA0NDFcdTA0NEYgXHUwNDQxXHUwNDNFXHUwNDMxXHUwNDQxXHUwNDQyXHUwNDMyXHUwNDM1XHUwNDNEXHUwNDNEXHUwNDRCXHUwNDNDIFx1MDQ0Mlx1MDQzRVx1MDQ0MFx1MDQzM1x1MDQzRVx1MDQzMlx1MDQ0Qlx1MDQzQyBcdTA0MzRcdTA0MzJcdTA0MzhcdTA0MzZcdTA0M0FcdTA0M0VcdTA0M0MgXHUwNDNGXHUwNDNFIFx1MDQzRlx1MDQ0MFx1MDQzOFx1MDQzRFx1MDQ0Nlx1MDQzOFx1MDQzRlx1MDQ0MyBcdTA0NDZcdTA0MzVcdTA0M0RcdTA0MzAtXHUwNDMyXHUwNDQwXHUwNDM1XHUwNDNDXHUwNDRGLiBcdTA0MjBcdTA0NEJcdTA0M0RcdTA0M0VcdTA0NDdcdTA0M0RcdTA0NEJcdTA0MzUgXHUwNDM0XHUwNDMwXHUwNDNEXHUwNDNEXHUwNDRCXHUwNDM1IFx1MjAxNCBcdTA0NDZcdTA0MzVcdTA0M0RcdTA0NEIsIFx1MDQ0MVx1MDQzMlx1MDQzNVx1MDQ0N1x1MDQzOCBcdTA0MzggXHUwNDQxXHUwNDQyXHUwNDMwXHUwNDNBXHUwNDMwXHUwNDNEIFx1MjAxNCBcdTA0M0ZcdTA0M0VcdTA0NDFcdTA0NDJcdTA0NDNcdTA0M0ZcdTA0MzBcdTA0NEVcdTA0NDIgXHUwNDQxIFx1MDQzMVx1MDQzOFx1MDQ0MFx1MDQzNlx1MDQzNVx1MDQzMlx1MDQ0Qlx1MDQ0NSBcdTA0M0ZcdTA0M0JcdTA0M0VcdTA0NDlcdTA0MzBcdTA0MzRcdTA0M0VcdTA0M0EgXHUwNDMyIFx1MDQ0MFx1MDQzNVx1MDQzMFx1MDQzQlx1MDQ0Q1x1MDQzRFx1MDQzRVx1MDQzQyBcdTA0MzJcdTA0NDBcdTA0MzVcdTA0M0NcdTA0MzVcdTA0M0RcdTA0MzguJyxcbiAgICAgIF0sXG4gICAgfSxcbiAgICB7XG4gICAgICBoZWFkaW5nOiAnXHUwNDExXHUwNDM1XHUwNDM3XHUwNDNFXHUwNDNGXHUwNDMwXHUwNDQxXHUwNDNEXHUwNDNFXHUwNDQxXHUwNDQyXHUwNDRDIFx1MDQzMFx1MDQzQVx1MDQzQVx1MDQzMFx1MDQ0M1x1MDQzRFx1MDQ0Mlx1MDQzMCcsXG4gICAgICBib2R5OiBbXG4gICAgICAgICdcdTA0MUZcdTA0MzBcdTA0NDBcdTA0M0VcdTA0M0JcdTA0MzggXHUwNDQ1XHUwNDQwXHUwNDMwXHUwNDNEXHUwNDRGXHUwNDQyXHUwNDQxXHUwNDRGIFx1MDQzMiBcdTA0MzJcdTA0MzhcdTA0MzRcdTA0MzUgXHUwNDNEXHUwNDM1XHUwNDNFXHUwNDMxXHUwNDQwXHUwNDMwXHUwNDQyXHUwNDM4XHUwNDNDXHUwNDRCXHUwNDQ1IFx1MDQzQVx1MDQ0MFx1MDQzOFx1MDQzRlx1MDQ0Mlx1MDQzRVx1MDQzM1x1MDQ0MFx1MDQzMFx1MDQ0NFx1MDQzOFx1MDQ0N1x1MDQzNVx1MDQ0MVx1MDQzQVx1MDQzOFx1MDQ0NSBcdTA0NDVcdTA0MzVcdTA0NDhcdTA0MzVcdTA0MzksIFx1MDQ0MVx1MDQzNVx1MDQzQVx1MDQ0MFx1MDQzNVx1MDQ0Mlx1MDQ0QiBBUEktXHUwNDNBXHUwNDNCXHUwNDRFXHUwNDQ3XHUwNDM1XHUwNDM5IFx1MDQ0OFx1MDQzOFx1MDQ0NFx1MDQ0MFx1MDQ0M1x1MDQ0RVx1MDQ0Mlx1MDQ0MVx1MDQ0RiBcdTA0M0ZcdTA0NDBcdTA0MzggXHUwNDQ1XHUwNDQwXHUwNDMwXHUwNDNEXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDM4LiBcdTA0MTRcdTA0MzJcdTA0NDNcdTA0NDVcdTA0NDRcdTA0MzBcdTA0M0FcdTA0NDJcdTA0M0VcdTA0NDBcdTA0M0RcdTA0MzBcdTA0NEYgXHUwNDMwXHUwNDQzXHUwNDQyXHUwNDM1XHUwNDNEXHUwNDQyXHUwNDM4XHUwNDQ0XHUwNDM4XHUwNDNBXHUwNDMwXHUwNDQ2XHUwNDM4XHUwNDRGIFx1MDQzOCBcdTA0MzZcdTA0NDNcdTA0NDBcdTA0M0RcdTA0MzBcdTA0M0IgXHUwNDMyXHUwNDQ1XHUwNDNFXHUwNDM0XHUwNDNFXHUwNDMyIFx1MDQzNFx1MDQzRVx1MDQ0MVx1MDQ0Mlx1MDQ0M1x1MDQzRlx1MDQzRFx1MDQ0QiBcdTA0MzIgXHUwNDQwXHUwNDMwXHUwNDM3XHUwNDM0XHUwNDM1XHUwNDNCXHUwNDM1IFx1MDBBQlx1MDQxRFx1MDQzMFx1MDQ0MVx1MDQ0Mlx1MDQ0MFx1MDQzRVx1MDQzOVx1MDQzQVx1MDQzOCBcdTIxOTIgXHUwNDExXHUwNDM1XHUwNDM3XHUwNDNFXHUwNDNGXHUwNDMwXHUwNDQxXHUwNDNEXHUwNDNFXHUwNDQxXHUwNDQyXHUwNDRDXHUwMEJCLicsXG4gICAgICBdLFxuICAgIH0sXG4gICAge1xuICAgICAgaGVhZGluZzogJ1x1MDQyNFx1MDQ0Q1x1MDQ0RVx1MDQ0N1x1MDQzNVx1MDQ0MFx1MDQ0MVx1MDQ0QiBcdTA0MzggXHUwNDQwXHUwNDM4XHUwNDQxXHUwNDNBLVx1MDQzQ1x1MDQzNVx1MDQzRFx1MDQzNVx1MDQzNFx1MDQzNlx1MDQzQ1x1MDQzNVx1MDQzRFx1MDQ0MicsXG4gICAgICBib2R5OiBbXG4gICAgICAgICdcdTA0MUNcdTA0MzBcdTA0NDBcdTA0MzZcdTA0MzhcdTA0M0RcdTA0MzBcdTA0M0JcdTA0NENcdTA0M0RcdTA0MzBcdTA0NEYgXHUwNDQyXHUwNDNFXHUwNDQwXHUwNDMzXHUwNDNFXHUwNDMyXHUwNDNCXHUwNDRGIFx1MDQ0MSBcdTA0MzhcdTA0MzdcdTA0M0VcdTA0M0JcdTA0MzhcdTA0NDBcdTA0M0VcdTA0MzJcdTA0MzBcdTA0M0RcdTA0M0RcdTA0M0VcdTA0MzkgXHUwNDM4IFx1MDQzQVx1MDQ0MFx1MDQzRVx1MDQ0MVx1MDQ0MS1cdTA0M0NcdTA0MzBcdTA0NDBcdTA0MzZcdTA0M0VcdTA0MzksIFx1MDQzQ1x1MDQzRFx1MDQzRVx1MDQzM1x1MDQzRVx1MDQ0M1x1MDQ0MFx1MDQzRVx1MDQzMlx1MDQzRFx1MDQzNVx1MDQzMlx1MDQzRVx1MDQzNSBcdTA0M0ZcdTA0M0JcdTA0MzVcdTA0NDdcdTA0M0UsIFx1MDQzMFx1MDQzMlx1MDQ0Mlx1MDQzRVx1MDQzQ1x1MDQzMFx1MDQ0Mlx1MDQzOFx1MDQ0N1x1MDQzNVx1MDQ0MVx1MDQzQVx1MDQzMFx1MDQ0RiBcdTA0M0JcdTA0MzhcdTA0M0FcdTA0MzJcdTA0MzhcdTA0MzRcdTA0MzBcdTA0NDZcdTA0MzhcdTA0NEYgXHUwNDNGXHUwNDNFIFx1MDQ0MFx1MDQzNVx1MDQzMFx1MDQzQlx1MDQ0Q1x1MDQzRFx1MDQzRVx1MDQzOSBtYXJrLXByaWNlIFx1MDQzOCBcdTA0NDFcdTA0NDJcdTA0NDBcdTA0MzBcdTA0NDVcdTA0M0VcdTA0MzJcdTA0M0VcdTA0MzkgXHUwNDQ0XHUwNDNFXHUwNDNEXHUwNDM0IFx1MDQzRFx1MDQzMCBcdTA0NDFcdTA0M0JcdTA0NDNcdTA0NDdcdTA0MzBcdTA0MzkgXHUwNDM0XHUwNDM1XHUwNDQ0XHUwNDM4XHUwNDQ2XHUwNDM4XHUwNDQyXHUwNDMwIFx1MDQzRlx1MDQ0MFx1MDQzOCBcdTA0M0JcdTA0MzhcdTA0M0FcdTA0MzJcdTA0MzhcdTA0MzRcdTA0MzBcdTA0NDZcdTA0MzhcdTA0MzguJyxcbiAgICAgIF0sXG4gICAgfSxcbiAgICB7XG4gICAgICBoZWFkaW5nOiAnXHUwNDFGXHUwNDQwXHUwNDNFXHUwNDM3XHUwNDQwXHUwNDMwXHUwNDQ3XHUwNDNEXHUwNDNFXHUwNDQxXHUwNDQyXHUwNDRDJyxcbiAgICAgIGJvZHk6IFtcbiAgICAgICAgJ1x1MDQxQ1x1MDQ0QiBcdTA0M0RcdTA0MzUgXHUwNDNGXHUwNDQzXHUwNDMxXHUwNDNCXHUwNDM4XHUwNDNBXHUwNDQzXHUwNDM1XHUwNDNDIFx1MDQzRFx1MDQzNVx1MDQzRlx1MDQ0MFx1MDQzRVx1MDQzMlx1MDQzNVx1MDQ0MFx1MDQ0Rlx1MDQzNVx1MDQzQ1x1MDQ0Qlx1MDQzNSBcdTA0M0VcdTA0MzFcdTA0MzVcdTA0NDlcdTA0MzBcdTA0M0RcdTA0MzhcdTA0NEYgXHUwNDNFIFx1MDQzNFx1MDQzRVx1MDQ0NVx1MDQzRVx1MDQzNFx1MDQzRFx1MDQzRVx1MDQ0MVx1MDQ0Mlx1MDQzOCBcdTA0MzhcdTA0M0JcdTA0MzggXHUwNDNFXHUwNDMxXHUwNDRBXHUwNDUxXHUwNDNDXHUwNDMwXHUwNDQ1IFx1MDQ0Mlx1MDQzRVx1MDQ0MFx1MDQzM1x1MDQzRVx1MDQzMi4gXHUwNDFBXHUwNDNFXHUwNDNDXHUwNDM4XHUwNDQxXHUwNDQxXHUwNDM4XHUwNDM4LCBcdTA0M0JcdTA0MzhcdTA0M0NcdTA0MzhcdTA0NDJcdTA0NEIgXHUwNDM4IFx1MDQ0M1x1MDQ0MVx1MDQzQlx1MDQzRVx1MDQzMlx1MDQzOFx1MDQ0RiBcdTA0M0VcdTA0NDJcdTA0M0VcdTA0MzFcdTA0NDBcdTA0MzBcdTA0MzZcdTA0MzBcdTA0NEVcdTA0NDJcdTA0NDFcdTA0NEYgXHUwNDMyIFx1MDQzOFx1MDQzRFx1MDQ0Mlx1MDQzNVx1MDQ0MFx1MDQ0NFx1MDQzNVx1MDQzOVx1MDQ0MVx1MDQzNSBcdTA0NDJcdTA0MzBcdTA0M0MsIFx1MDQzM1x1MDQzNFx1MDQzNSBcdTA0M0VcdTA0M0RcdTA0MzggXHUwNDNGXHUwNDQwXHUwNDM4XHUwNDNDXHUwNDM1XHUwNDNEXHUwNDRGXHUwNDRFXHUwNDQyXHUwNDQxXHUwNDRGIFx1MjAxNCBcdTA0MzRcdTA0M0UgXHUwNDNGXHUwNDNFXHUwNDM0XHUwNDQyXHUwNDMyXHUwNDM1XHUwNDQwXHUwNDM2XHUwNDM0XHUwNDM1XHUwNDNEXHUwNDM4XHUwNDRGIFx1MDQzNFx1MDQzNVx1MDQzOVx1MDQ0MVx1MDQ0Mlx1MDQzMlx1MDQzOFx1MDQ0RiwgXHUwNDMwIFx1MDQzRFx1MDQzNSBcdTA0M0NcdTA0MzVcdTA0M0JcdTA0M0FcdTA0MzhcdTA0M0MgXHUwNDQ4XHUwNDQwXHUwNDM4XHUwNDQ0XHUwNDQyXHUwNDNFXHUwNDNDLicsXG4gICAgICBdLFxuICAgIH0sXG4gIF0sXG59O1xuXG5jb25zdCBSVV9TVVBQT1JUOiBMZWdhbENvbnRlbnQgPSB7XG4gIHRpdGxlOiAnXHUwNDFGXHUwNDNFXHUwNDM0XHUwNDM0XHUwNDM1XHUwNDQwXHUwNDM2XHUwNDNBXHUwNDMwJyxcbiAgdXBkYXRlZDogJ1x1MDQxRlx1MDQzRVx1MDQ0MVx1MDQzQlx1MDQzNVx1MDQzNFx1MDQzRFx1MDQzNVx1MDQzNSBcdTA0M0VcdTA0MzFcdTA0M0RcdTA0M0VcdTA0MzJcdTA0M0JcdTA0MzVcdTA0M0RcdTA0MzhcdTA0MzU6IDIyIFx1MDQzMFx1MDQzMlx1MDQzM1x1MDQ0M1x1MDQ0MVx1MDQ0Mlx1MDQzMCAyMDI2IFx1MDQzMy4nLFxuICBpbnRybzogJ1x1MDQxRVx1MDQ0Mlx1MDQzMlx1MDQzNVx1MDQ0Mlx1MDQ0QiBcdTA0M0RcdTA0MzAgXHUwNDQ3XHUwNDMwXHUwNDQxXHUwNDQyXHUwNDRCXHUwNDM1IFx1MDQzMlx1MDQzRVx1MDQzRlx1MDQ0MFx1MDQzRVx1MDQ0MVx1MDQ0Qi4gXHUwNDE0XHUwNDNCXHUwNDRGIFx1MDQzMlx1MDQzRVx1MDQzRlx1MDQ0MFx1MDQzRVx1MDQ0MVx1MDQzRVx1MDQzMiBcdTA0M0ZcdTA0M0UgXHUwNDNBXHUwNDNFXHUwNDNEXHUwNDNBXHUwNDQwXHUwNDM1XHUwNDQyXHUwNDNEXHUwNDNFXHUwNDNDXHUwNDQzIFx1MDQzMFx1MDQzQVx1MDQzQVx1MDQzMFx1MDQ0M1x1MDQzRFx1MDQ0Mlx1MDQ0MyBcdTA0MzIgXHUwNDNGXHUwNDM1XHUwNDQwXHUwNDMyXHUwNDQzXHUwNDRFIFx1MDQzRVx1MDQ0N1x1MDQzNVx1MDQ0MFx1MDQzNVx1MDQzNFx1MDQ0QyBcdTA0MzdcdTA0MzBcdTA0MzNcdTA0M0JcdTA0NEZcdTA0M0RcdTA0MzggXHUwNDMyIFx1MDBBQlx1MDQxRFx1MDQzMFx1MDQ0MVx1MDQ0Mlx1MDQ0MFx1MDQzRVx1MDQzOVx1MDQzQVx1MDQzOFx1MDBCQi4nLFxuICBzZWN0aW9uczogW1xuICAgIHtcbiAgICAgIGhlYWRpbmc6ICdcdTA0MUFcdTA0MzBcdTA0M0EgXHUwNDNGXHUwNDNFXHUwNDNGXHUwNDNFXHUwNDNCXHUwNDNEXHUwNDM4XHUwNDQyXHUwNDRDIFx1MDQzMVx1MDQzMFx1MDQzQlx1MDQzMFx1MDQzRFx1MDQ0MScsXG4gICAgICBib2R5OiBbXG4gICAgICAgICdcdTA0MUVcdTA0NDJcdTA0M0FcdTA0NDBcdTA0M0VcdTA0MzkgXHUwMEFCXHUwNDFGXHUwNDNFXHUwNDNGXHUwNDNFXHUwNDNCXHUwNDNEXHUwNDM4XHUwNDQyXHUwNDRDXHUwMEJCIFx1MjE5MiBcdTA0MzJcdTA0NEJcdTA0MzFcdTA0MzVcdTA0NDBcdTA0MzggXHUwNDQxXHUwNDM1XHUwNDQyXHUwNDRDIFx1MjE5MiBcdTA0M0VcdTA0NDJcdTA0M0ZcdTA0NDBcdTA0MzBcdTA0MzJcdTA0NEMgXHUwNDQxXHUwNDQwXHUwNDM1XHUwNDM0XHUwNDQxXHUwNDQyXHUwNDMyXHUwNDMwIFx1MDQzRFx1MDQzMCBcdTA0M0ZcdTA0M0VcdTA0M0FcdTA0MzBcdTA0MzdcdTA0MzBcdTA0M0RcdTA0M0RcdTA0NEJcdTA0MzkgXHUwNDMwXHUwNDM0XHUwNDQwXHUwNDM1XHUwNDQxIFx1MjE5MiBcdTA0MzJcdTA0NDFcdTA0NDJcdTA0MzBcdTA0MzJcdTA0NEMgXHUwNDQ1XHUwNDM1XHUwNDQ4IFx1MDQ0Mlx1MDQ0MFx1MDQzMFx1MDQzRFx1MDQzN1x1MDQzMFx1MDQzQVx1MDQ0Nlx1MDQzOFx1MDQzOCBcdTA0MzRcdTA0M0JcdTA0NEYgXHUwNDNGXHUwNDQwXHUwNDNFXHUwNDMyXHUwNDM1XHUwNDQwXHUwNDNBXHUwNDM4LiBcdTA0MTBcdTA0M0FcdTA0NDJcdTA0NDNcdTA0MzBcdTA0M0JcdTA0NENcdTA0M0RcdTA0MzBcdTA0NEYgXHUwNDNDXHUwNDM4XHUwNDNEXHUwNDM4XHUwNDNDXHUwNDMwXHUwNDNCXHUwNDRDXHUwNDNEXHUwNDMwXHUwNDRGIFx1MDQ0MVx1MDQ0M1x1MDQzQ1x1MDQzQ1x1MDQzMCBcdTA0MzIgVVNEIFx1MDQ0M1x1MDQzQVx1MDQzMFx1MDQzN1x1MDQzMFx1MDQzRFx1MDQzMCBcdTA0MzIgXHUwNDQ0XHUwNDNFXHUwNDQwXHUwNDNDXHUwNDM1IFx1MDQzRlx1MDQzRVx1MDQzRlx1MDQzRVx1MDQzQlx1MDQzRFx1MDQzNVx1MDQzRFx1MDQzOFx1MDQ0RjsgXHUwNDQxXHUwNDQzXHUwNDNDXHUwNDNDXHUwNDMwIFx1MDQzRFx1MDQzOFx1MDQzNlx1MDQzNSBcdTA0M0NcdTA0MzhcdTA0M0RcdTA0MzhcdTA0M0NcdTA0NDNcdTA0M0NcdTA0MzAgXHUwNDNEXHUwNDM1IFx1MDQzMVx1MDQ0M1x1MDQzNFx1MDQzNVx1MDQ0MiBcdTA0MzdcdTA0MzBcdTA0NDdcdTA0MzhcdTA0NDFcdTA0M0JcdTA0MzVcdTA0M0RcdTA0MzAuJyxcbiAgICAgIF0sXG4gICAgfSxcbiAgICB7XG4gICAgICBoZWFkaW5nOiAnXHUwNDFFXHUwNDQwXHUwNDM0XHUwNDM1XHUwNDQwIFx1MDQzRFx1MDQzNSBcdTA0MzhcdTA0NDFcdTA0M0ZcdTA0M0VcdTA0M0JcdTA0M0RcdTA0NEZcdTA0MzVcdTA0NDJcdTA0NDFcdTA0NEYnLFxuICAgICAgYm9keTogW1xuICAgICAgICAnXHUwNDFGXHUwNDQwXHUwNDNFXHUwNDMyXHUwNDM1XHUwNDQwXHUwNDRDLCBcdTA0NDdcdTA0NDJcdTA0M0UgXHUwNDQyXHUwNDQwXHUwNDM4XHUwNDMzXHUwNDMzXHUwNDM1XHUwNDQwXHUwNDNEXHUwNDMwXHUwNDRGIFx1MDQ0Nlx1MDQzNVx1MDQzRFx1MDQzMCBcdTA0NDFcdTA0NDJcdTA0M0VcdTA0M0YvXHUwNDQyXHUwNDM1XHUwNDM5XHUwNDNBLVx1MDQzRlx1MDQ0MFx1MDQzRVx1MDQ0NFx1MDQzOFx1MDQ0MiBcdTA0M0VcdTA0NDBcdTA0MzRcdTA0MzVcdTA0NDBcdTA0MzAgXHUwNDQwXHUwNDMwXHUwNDQxXHUwNDNGXHUwNDNFXHUwNDNCXHUwNDNFXHUwNDM2XHUwNDM1XHUwNDNEXHUwNDMwIFx1MDQzRlx1MDQzRSBcdTA0M0ZcdTA0NDBcdTA0MzBcdTA0MzJcdTA0MzhcdTA0M0JcdTA0NENcdTA0M0RcdTA0NDNcdTA0NEUgXHUwNDQxXHUwNDQyXHUwNDNFXHUwNDQwXHUwNDNFXHUwNDNEXHUwNDQzIFx1MDQzRVx1MDQ0MiBcdTA0NDJcdTA0MzVcdTA0M0FcdTA0NDNcdTA0NDlcdTA0MzVcdTA0MzkgXHUwNDQwXHUwNDRCXHUwNDNEXHUwNDNFXHUwNDQ3XHUwNDNEXHUwNDNFXHUwNDM5IFx1MDQ0Nlx1MDQzNVx1MDQzRFx1MDQ0QiBcdTIwMTQgXHUwNDM4XHUwNDNEXHUwNDQyXHUwNDM1XHUwNDQwXHUwNDQ0XHUwNDM1XHUwNDM5XHUwNDQxIFx1MDQzRlx1MDQzRVx1MDQzNFx1MDQ0MVx1MDQzQVx1MDQzMFx1MDQzN1x1MDQ0Qlx1MDQzMlx1MDQzMFx1MDQzNVx1MDQ0MiBcdTA0M0RcdTA0NDNcdTA0MzZcdTA0M0RcdTA0M0VcdTA0MzUgXHUwNDNEXHUwNDMwXHUwNDNGXHUwNDQwXHUwNDMwXHUwNDMyXHUwNDNCXHUwNDM1XHUwNDNEXHUwNDM4XHUwNDM1IFx1MDQzRlx1MDQ0MFx1MDQ0Rlx1MDQzQ1x1MDQzRSBcdTA0MzIgXHUwNDQ0XHUwNDNFXHUwNDQwXHUwNDNDXHUwNDM1IFx1MDQzRVx1MDQ0MFx1MDQzNFx1MDQzNVx1MDQ0MFx1MDQzMC4gXHUwNDFFXHUwNDQyXHUwNDNBXHUwNDQwXHUwNDRCXHUwNDQyXHUwNDRCXHUwNDM1IFx1MDQ0M1x1MDQ0MVx1MDQzQlx1MDQzRVx1MDQzMlx1MDQzRFx1MDQ0Qlx1MDQzNSBcdTA0M0VcdTA0NDBcdTA0MzRcdTA0MzVcdTA0NDBcdTA0MzAgXHUwNDM2XHUwNDM0XHUwNDQzXHUwNDQyIFx1MDQ0MVx1MDQ0MFx1MDQzMFx1MDQzMVx1MDQzMFx1MDQ0Mlx1MDQ0Qlx1MDQzMlx1MDQzMFx1MDQzRFx1MDQzOFx1MDQ0RiBcdTA0NDJcdTA0NDBcdTA0MzhcdTA0MzNcdTA0MzNcdTA0MzVcdTA0NDBcdTA0MzAgXHUwNDM4IFx1MDQzRVx1MDQ0Mlx1MDQzRVx1MDQzMVx1MDQ0MFx1MDQzMFx1MDQzNlx1MDQzMFx1MDQ0RVx1MDQ0Mlx1MDQ0MVx1MDQ0RiBcdTA0NDFcdTA0M0UgXHUwNDQxXHUwNDQyXHUwNDMwXHUwNDQyXHUwNDQzXHUwNDQxXHUwNDNFXHUwNDNDIFx1MDBBQlx1MDQxRVx1MDQzNlx1MDQzOFx1MDQzNFx1MDQzMFx1MDQzNVx1MDQ0Mlx1MDBCQi4nLFxuICAgICAgXSxcbiAgICB9LFxuICAgIHtcbiAgICAgIGhlYWRpbmc6ICdcdTA0MTFcdTA0MzVcdTA0MzdcdTA0M0VcdTA0M0ZcdTA0MzBcdTA0NDFcdTA0M0RcdTA0M0VcdTA0NDFcdTA0NDJcdTA0NEMgXHUwNDMwXHUwNDNBXHUwNDNBXHUwNDMwXHUwNDQzXHUwNDNEXHUwNDQyXHUwNDMwJyxcbiAgICAgIGJvZHk6IFtcbiAgICAgICAgJ1x1MDQxMlx1MDQzQVx1MDQzQlx1MDQ0RVx1MDQ0N1x1MDQzOCBcdTA0MzRcdTA0MzJcdTA0NDNcdTA0NDVcdTA0NDRcdTA0MzBcdTA0M0FcdTA0NDJcdTA0M0VcdTA0NDBcdTA0M0RcdTA0NDNcdTA0NEUgXHUwNDMwXHUwNDQzXHUwNDQyXHUwNDM1XHUwNDNEXHUwNDQyXHUwNDM4XHUwNDQ0XHUwNDM4XHUwNDNBXHUwNDMwXHUwNDQ2XHUwNDM4XHUwNDRFIFx1MDQzOCBcdTA0M0ZcdTA0MzVcdTA0NDBcdTA0MzhcdTA0M0VcdTA0MzRcdTA0MzhcdTA0NDdcdTA0MzVcdTA0NDFcdTA0M0FcdTA0MzggXHUwNDNGXHUwNDQwXHUwNDNFXHUwNDMyXHUwNDM1XHUwNDQwXHUwNDRGXHUwNDM5IFx1MDQzNlx1MDQ0M1x1MDQ0MFx1MDQzRFx1MDQzMFx1MDQzQiBcdTA0MzJcdTA0NDVcdTA0M0VcdTA0MzRcdTA0M0VcdTA0MzIgXHUwNDMyIFx1MDBBQlx1MDQxRFx1MDQzMFx1MDQ0MVx1MDQ0Mlx1MDQ0MFx1MDQzRVx1MDQzOVx1MDQzQVx1MDQzOCBcdTIxOTIgXHUwNDExXHUwNDM1XHUwNDM3XHUwNDNFXHUwNDNGXHUwNDMwXHUwNDQxXHUwNDNEXHUwNDNFXHUwNDQxXHUwNDQyXHUwNDRDXHUwMEJCIFx1MjAxNCBcdTA0NDJcdTA0MzBcdTA0M0MgXHUwNDMyXHUwNDM4XHUwNDM0XHUwNDNEXHUwNDNFIFx1MDQzQVx1MDQzMFx1MDQzNlx1MDQzNFx1MDQ0Qlx1MDQzOSBcdTA0MzJcdTA0NDVcdTA0M0VcdTA0MzQgXHUwNDMyIFx1MDQzMFx1MDQzQVx1MDQzQVx1MDQzMFx1MDQ0M1x1MDQzRFx1MDQ0Mi4nLFxuICAgICAgXSxcbiAgICB9LFxuICAgIHtcbiAgICAgIGhlYWRpbmc6ICdcdTA0MTJcdTA0MzVcdTA0NDBcdTA0MzhcdTA0NDRcdTA0MzhcdTA0M0FcdTA0MzBcdTA0NDZcdTA0MzhcdTA0NEYgKEtZQyknLFxuICAgICAgYm9keTogWydcdTA0MjFcdTA0NDJcdTA0MzBcdTA0NDJcdTA0NDNcdTA0NDEgXHUwNDM4IFx1MDQ0Mlx1MDQ0MFx1MDQzNVx1MDQzMVx1MDQ0M1x1MDQzNVx1MDQzQ1x1MDQ0Qlx1MDQzNSBcdTA0MzRcdTA0M0VcdTA0M0FcdTA0NDNcdTA0M0NcdTA0MzVcdTA0M0RcdTA0NDJcdTA0NEIgXHUwNDM0XHUwNDNCXHUwNDRGIFx1MDQzMlx1MDQzNVx1MDQ0MFx1MDQzOFx1MDQ0NFx1MDQzOFx1MDQzQVx1MDQzMFx1MDQ0Nlx1MDQzOFx1MDQzOCBcdTA0M0VcdTA0NDJcdTA0M0VcdTA0MzFcdTA0NDBcdTA0MzBcdTA0MzZcdTA0MzBcdTA0NEVcdTA0NDJcdTA0NDFcdTA0NEYgXHUwNDMyIFx1MDQ0MFx1MDQzMFx1MDQzN1x1MDQzNFx1MDQzNVx1MDQzQlx1MDQzNSBcdTA0MzBcdTA0M0FcdTA0M0FcdTA0MzBcdTA0NDNcdTA0M0RcdTA0NDJcdTA0MzAsIFx1MDQzRVx1MDQ0Mlx1MDQzMlx1MDQzNVx1MDQ0N1x1MDQzMFx1MDQ0RVx1MDQ0OVx1MDQzNVx1MDQzQyBcdTA0MzdcdTA0MzAgXHUwNDMyXHUwNDM1XHUwNDQwXHUwNDM4XHUwNDQ0XHUwNDM4XHUwNDNBXHUwNDMwXHUwNDQ2XHUwNDM4XHUwNDRFLiddLFxuICAgIH0sXG4gICAge1xuICAgICAgaGVhZGluZzogJ1x1MDQxRVx1MDQ0MVx1MDQ0Mlx1MDQzMFx1MDQzQlx1MDQzOFx1MDQ0MVx1MDQ0QyBcdTA0MzJcdTA0M0VcdTA0M0ZcdTA0NDBcdTA