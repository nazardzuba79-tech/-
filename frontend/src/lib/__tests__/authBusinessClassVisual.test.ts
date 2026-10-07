import { readFileSync, statSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';

const root = resolve(__dirname, '../../../..');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8').replace(/\r\n/g, '\n');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const shell = read('frontend/src/pages/auth-shell/AuthShell.tsx');
const css = read('frontend/src/pages/auth-shell/auth-shell.css');

describe('business-class visual preserves reviewed authentication', () => {
  // Exact fresh-main deb4b107 sources, normalized only for Windows line endings.
  test.each([
    ['frontend/src/pages/AuthPage.tsx', 'ed5c36556873dd4d51f2b7f41d554eb6bccd270f328488b0e0c0a11bc2621cf4'],
    ['frontend/src/pages/register/RegisterPage.tsx', '23c2a8a21716c6da67cc51c5c7f8c725b2074cecbfaf77c948aacf610ef52d29'],
    ['frontend/src/pages/register/RegisterPanel.tsx', '1e47f15e188f8883ffaf40a725f8e8b2de90b8d604d7ec285802a21339e18c8e'],
    ['frontend/src/pages/auth-shell/AuthFields.tsx', '6253311614e77c749048b5111c03d0cd59325ed3bf6bdaeda43f59d5b15ea9f5'],
    ['frontend/src/lib/returnTo.ts', 'e5ffb48e4adc49aafced4458c2ed9d5fbd2274f5f3366e81f442904dab6572d3'],
  ])('%s is unchanged', (file, hash) => expect(digest(read(file))).toBe(hash));

  test('right form theme, focus, validation and controls are unchanged', () => {
    const formCSS = css.slice(css.indexOf('/* Light form theme'), css.indexOf('@media (min-width: 1800px)'));
    expect(digest(formCSS)).toBe('2cfe7a3a245be028e50322ca5602d2d073dcde913f3628d17cfd6a271f0cb28d');
    expect(shell).toContain('{children}');
    expect(shell).toContain('onClick={openSupportWidget}');
    expect(shell).toContain('to={`/login${window.location.search}`}');
    expect(shell).toContain('to={`/register${window.location.search}`}');
    expect(shell).not.toMatch(/\bfetch\(|\bapi\.|useEffect/);
  });

  test('responsive local photo with reserved dimensions; no old overlays or fake endorsements', () => {
    expect(shell).toContain('<picture>');
    expect(shell).toContain('media="(max-width: 760px)"');
    expect(shell).toContain('width="1440" height="2160"');
    expect(shell).toContain("fetchpriority: 'high'");
    expect(shell).not.toMatch(/aircraft-v6|communityCount|community-v4|cardCaption|https:\/\//);
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)');
    expect(css).toContain('object-fit: cover');
    expect(css).not.toContain('mask-image');
    expect(shell).not.toContain('<h1>');
    for (const name of ['960', '1440', 'mobile']) {
      const file = resolve(root, `frontend/public/auth/business-class-${name}.webp`);
      const buffer = readFileSync(file);
      expect(buffer.toString('ascii', 0, 4)).toBe('RIFF');
      expect(buffer.toString('ascii', 8, 12)).toBe('WEBP');
      expect(statSync(file).size).toBeLessThan(name === 'mobile' ? 70000 : 200000);
    }
  });
});
