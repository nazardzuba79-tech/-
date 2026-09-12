import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, resolve } from 'path';
import ts from 'typescript';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const { StaticRouter } = req('react-router');

function modules(lang = 'ru') {
  const cache: Record<string, any> = {};
  const load = (file: string): any => {
    const full = resolve(frontend, 'src', file);
    if (cache[full]) return cache[full];
    const output: any = {};
    cache[full] = output;
    const code = ts.transpileModule(readFileSync(full, 'utf8'), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    new Function('require', 'exports', code)((name: string) => {
      if (name.endsWith('.css')) return {};
      if (name === '../../lib/i18n') {
        const dictionary = load(`lib/i18n/locales/${lang}.ts`)[lang.toUpperCase()];
        return { useLanguage: () => ({ lang, t: (key: string) => {
          if (!(key in dictionary)) throw new Error(`Missing ${lang} translation: ${key}`);
          return dictionary[key];
        } }), localeOf: () => lang };
      }
      if (name === './useHomeMarket') return { useHomeMarket: () => ({}) };
      // These unrelated sections neither decide nor influence the two mounted
      // production sections' DOM order. Card, sessions and wrappers stay real.
      const unrelated = ['HomeHeader', 'HomeHero', 'HomeMarketOverview', 'HomeHeatmap', 'HomeMarkets', 'HomeEcosystem', 'HomeFaq', 'HomeFooter'];
      if (unrelated.some(part => name === `./${part}`)) return { [name.slice(2)]: () => null };
      if (name.startsWith('.')) {
        const candidate = resolve(dirname(full), name);
        const extension = ['.tsx', '.ts'].find(ext => existsSync(candidate + ext));
        if (extension) return load(candidate + extension);
      }
      return req(name);
    }, output);
    return output;
  };
  return load;
}

test('production homepage DOM mounts approved Titanium before the immediately following trading sessions section', () => {
  const { HomePage } = modules()('pages/home/HomePage.tsx');
  const html = renderToStaticMarkup(React.createElement(StaticRouter, { location: '/' }, React.createElement(HomePage)));
  const sections = [...html.matchAll(/<section\b[^>]*>/g)].map(match => match[0]);
  expect(sections).toHaveLength(2);
  expect(sections[0]).toContain('id="card"');
  expect(sections[0]).toContain('data-hand-variant="titanium-soft"');
  expect(sections[1]).toContain('id="trading-sessions"');
  expect(html).toContain('/cards/travel/voltex-titanium-soft.png');
  expect(html).not.toContain('Один мир. Разные часовые пояса.');
});

test.each(['ru', 'en', 'zh', 'es', 'hi', 'ja', 'ko'])('sessions render complete localized content and crypto availability in %s', lang => {
  const load = modules(lang);
  const { HomeTradingSessions } = load('pages/home/HomeTradingSessions.tsx');
  const copy = load('pages/home/tradingSessionsCopy.ts').TRADING_SESSIONS_COPY[lang];
  const html = renderToStaticMarkup(React.createElement(HomeTradingSessions, { now: new Date('2026-09-11T13:00:00Z') }));
  expect(html).toContain('id="trading-sessions"');
  expect(html).toContain(copy.crypto);
  for (const city of Object.values(copy.cities)) expect(html).toContain(city);
  expect(html).not.toContain('NaN');
  expect(html).not.toContain('undefined');
});

test('rendered status and overlap respond to the injected clock across a session close', () => {
  const { HomeTradingSessions } = modules('en')('pages/home/HomeTradingSessions.tsx');
  const render = (at: string) => renderToStaticMarkup(React.createElement(HomeTradingSessions, { now: new Date(at) }));
  const overlapping = render('2026-09-11T15:59:00Z');
  const closed = render('2026-09-11T16:00:00Z');
  expect(overlapping).not.toBe(closed);
  // The public card attributes make status inspectable without parsing prose.
  expect(overlapping).toMatch(/data-session-id="europe"[^>]*data-status="ACTIVE"/);
  expect(closed).toMatch(/data-session-id="europe"[^>]*data-status="CLOSED"/);
});
