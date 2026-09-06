import { createRequire } from 'module';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import { VerifiedBadge } from '../../../test-utils/verifiedBadge';
import { withStrategyIdentityVerification, kseniaTrader, type PublicStrategyIdentity } from '../kseniaCopyTrading';
import { syntheticNazaraTrader } from '../syntheticCopyTrading';
import { nazarTrader } from '../../pages/copy-trading-bolt/traders';
import { createKseniaReviewState, kseniaReviewResponse } from '../../../../src/services/copyTrading/canonical/kseniaReview';

const frontend = resolve(__dirname, '../../..');
const req = createRequire(resolve(frontend, 'package.json'));
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const render = (verified?: unknown, label?: string) => renderToStaticMarkup(React.createElement(VerifiedBadge, { verified, label }));
const identity = (overrides: Partial<PublicStrategyIdentity> = {}): PublicStrategyIdentity => ({
  traderId: nazarTrader.id, displayName: 'Nazar', avatarUrl: null, avatarVersion: null,
  verified: true, premium: false, ...overrides,
});

test('the actual shared badge is a small accessible blue SVG with a white check', () => {
  const html = render(true);
  expect(html).toMatch(/^<svg class="copy-verified-badge" width="15" height="15" viewBox="0 0 24 24"/);
  expect(html).toContain('role="img" aria-label="Верифицирован" focusable="false"');
  expect(html).toContain('<title>Верифицирован</title>');
  expect(html).toContain('fill="#1d9bf0"');
  expect(html).toContain('stroke="#fff"');
  expect(html).not.toMatch(/<img|<image|<span|http|VIP/);
  expect(render(true, 'Verified identity')).toContain('aria-label="Verified identity"');
});

test.each([false, undefined, null, 'true', 'APPROVED', 1, {}, []])('verified=%p never enables the badge without boolean true', verified => {
  expect(render(verified)).toBe('');
});

test.each(['Nazar', 'Nazara', 'New display name', 'Ksenia'])('identity status is ID-bound, not inferred from display name %s', name => {
  const trader = { ...nazarTrader, name, verified: false, vip: false };
  const projected = withStrategyIdentityVerification(trader, identity({ displayName: 'Different server label' }));
  expect(projected.identityVerified).toBe(true);
  expect(projected.name).toBe(name);
  expect(render(projected.identityVerified)).toContain('copy-verified-badge');
});

test('a future verified trader with a non-flagship ID uses the same identity contract and SVG', () => {
  const trader = { ...nazarTrader, id: 'VX-FUTURE-VERIFIED-OWNER', name: 'Future independent trader', verified: false, vip: false };
  const projected = withStrategyIdentityVerification(trader, identity({ traderId: trader.id, displayName: trader.name }));
  expect(projected.identityVerified).toBe(true);
  expect(render(projected.identityVerified)).toContain('copy-verified-badge');
  expect(withStrategyIdentityVerification(trader, identity()).identityVerified).toBe(false);
});

test.each([undefined, identity({ verified: false }), identity({ traderId: 'VX-UNRELATED' })])('missing/false/mismatched backend identity cannot inherit old static verification (%p)', supplied => {
  const trader = { ...nazarTrader, verified: true, identityVerified: true, vip: true };
  const projected = withStrategyIdentityVerification(trader, supplied);
  expect(projected.identityVerified).toBe(false);
  expect(render(projected.identityVerified)).toBe('');
});

test('identity projection changes only the presentation boolean and never mutates input data', () => {
  const trader = syntheticNazaraTrader(null);
  const owner = identity();
  const before = JSON.stringify({ trader, owner });
  const projected = withStrategyIdentityVerification(trader, owner);
  expect(projected).not.toBe(trader);
  const { identityVerified, ...unchanged } = projected;
  const { identityVerified: previous, ...original } = trader;
  expect(identityVerified).toBe(true);
  expect(unchanged).toEqual(original);
  expect(JSON.stringify({ trader, owner })).toBe(before);
});

test('Ksenia NOT_STARTED/verified-false stays unbadged and identity changes do not alter canonical economics', () => {
  const data = kseniaReviewResponse(createKseniaReviewState());
  const before = JSON.stringify(data);
  const absent = kseniaTrader(data);
  const unverified = kseniaTrader(data, identity({ traderId: 'VX-KSENIA', displayName: 'Ksenia', verified: false, premium: true }));
  const verified = kseniaTrader(data, identity({ traderId: 'VX-KSENIA', displayName: 'Renamed owner', verified: true }));
  const mismatched = kseniaTrader(data, identity({ traderId: nazarTrader.id, verified: true }));
  expect(absent.identityVerified).toBe(false);
  expect(unverified.identityVerified).toBe(false);
  expect(mismatched.identityVerified).toBe(false);
  expect(render(unverified.identityVerified)).toBe('');
  expect(render(mismatched.identityVerified)).toBe('');
  expect(verified.identityVerified).toBe(true);
  const economics = ({ verified: _legacy, identityVerified: _identity, ownerAvatarUrl: _avatar, ...rest }: typeof absent) => rest;
  expect(economics(unverified)).toEqual(economics(absent));
  expect(economics(verified)).toEqual(economics(absent));
  expect(economics(mismatched)).toEqual(economics(absent));
  expect(JSON.stringify(data)).toBe(before);
});

test('both Copy surfaces consume one shared badge and no legacy avatar-overlay element', () => {
  const source = readFileSync(resolve(frontend, 'src/pages/copy-trading-bolt/components.tsx'), 'utf8');
  expect(source).toContain("import { VerifiedBadge } from './VerifiedBadge'");
  expect(source.match(/<VerifiedBadge verified=\{trader\.identityVerified\} \/>/g)).toHaveLength(3);
  expect(source).not.toContain('className="verified-badge"');
  expect(source).not.toMatch(/trader\.verified\s*&&/);
  const styles = ['CopyTradingBolt.css', 'CopyTradingRefinement.css'].map(file =>
    readFileSync(resolve(frontend, 'src/pages/copy-trading-bolt', file), 'utf8')).join('\n');
  expect(styles).not.toMatch(/\.profile-verified\b|\.nazara-verified\b/);
  expect(styles).toMatch(/\.copy-verified-badge\s*\{[^}]*flex:\s*0 0 15px/);
  expect(styles).toMatch(/\.trader-display-name\s*\{[^}]*align-items:\s*center/);
});
