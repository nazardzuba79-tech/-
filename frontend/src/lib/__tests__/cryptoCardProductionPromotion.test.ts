import { createHash } from 'crypto';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { restoreCopyDepositUx } from '../../../test-utils/copyDepositUx';

const repository = resolve(__dirname, '../../../..');
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const source = (file: string) => readFileSync(resolve(repository, file), 'utf8').replace(/\r\n/g, '\n');

// Reviewed source 0a9c9022b8cf0cac757328606eaf9c7b52fa3a86, not a redesign.
const approvedCardSources: Record<string, string> = {
  "frontend/src/pages/crypto-card-final/CardApplication.tsx": "f4e475d2b609d19e8e12194fb13837b6026a9bfe759248e2a16690f60028d4d9",
  "frontend/src/pages/crypto-card-final/cardApplicationState.ts": "526e909eb7b161ee41bffdf474e1412082ce991d20a6b43e9cb54c8ed1913042",
  "frontend/src/pages/crypto-card-final/crypto-card.css": "9ed9552a641fdc63c5593e5ad00bbab6b7a8fc63102105259e401252cfe5c6a1",
  "frontend/src/pages/crypto-card-final/useCardCopy.ts": "6a1c229a9546f386a65254fa2446b45a32605cdf3480e9c381dde5a60ae33494",
  "frontend/src/pages/crypto-card-final/components/AtmSection.tsx": "e0341badbe91a3e3098b845a05f3be5ac017c461ad487963d9b112fbd31e64b9",
  "frontend/src/pages/crypto-card-final/components/BrandMarks.tsx": "42c92d5892b537de7dd079a0ce857fd73362954e0b3e2d16bc2239b6f9849478",
  "frontend/src/pages/crypto-card-final/components/CardChoiceSection.tsx": "d467f522ae3fe6ae03a7b6ff0558622f1cf009dc8eb86171c37508181a8542bd",
  "frontend/src/pages/crypto-card-final/components/CardScene.tsx": "0c91018e5c60cdb5ea257c0e848eb47114b7b798def214ee6f29025bfd5cb42a",
  "frontend/src/pages/crypto-card-final/components/CinematicCardScene.tsx": "8767a816aac2fcc488be7c1326a173281f9ff7ad15f9947add38f6e39f008df1",
  "frontend/src/pages/crypto-card-final/components/ControlSecuritySection.tsx": "08973402bfa700cccf851a4406fd3d42da81843fb7189fd1b3319c4ca0245203",
  "frontend/src/pages/crypto-card-final/components/CurrencyMarks.tsx": "da410cf0811f2671e394a997546fc27889f3f5ae0cce7cc2e9101114debc0e38",
  "frontend/src/pages/crypto-card-final/components/CurrencySection.tsx": "f7f50a6172e66dfc30b57eef34d130539f57e5bbb4c1694df51245b7dc99fdcc",
  "frontend/src/pages/crypto-card-final/components/FaqSection.tsx": "cf38dd5e7db1820e9cce6a66f71ae2c264f6737a25f12f97f1e42a0a82cda1e1",
  "frontend/src/pages/crypto-card-final/components/FeesSection.tsx": "dde9bf2fdfa33bba88f1c08027edd2e722b507682f5ccf7ce87422e941fc0c0f",
  "frontend/src/pages/crypto-card-final/components/FinalCtaFooter.tsx": "64682b2e76f1251aae617614cb434979fbf501036f5765c8eb5826a575b22b12",
  "frontend/src/pages/crypto-card-final/components/GlobalUseSection.tsx": "4c525768116bd5300e2897665d70833625e4b050df2668d76f500888f83a18a6",
  "frontend/src/pages/crypto-card-final/components/Header.tsx": "6e3337f6e583b561937637baa54b0ee8b83134d5759a70e5ea0e3abec66eb2b0",
  "frontend/src/pages/crypto-card-final/components/Hero.tsx": "2e80c8ed7fa688499e645ca947337ed657017e87fb9d467f94fe2ecf7d9678f8",
  "frontend/src/pages/crypto-card-final/components/HowItWorksSection.tsx": "6fb8bd0b9fc6af6f40487987f485d0201afca1836daa44565918b2bd2963d11f",
  "frontend/src/pages/crypto-card-final/components/PaymentSection.tsx": "c239a84af63ca8de43bbf0dab9f1f95d1e26679e0651b05893b300e66d57405e",
  "frontend/src/pages/crypto-card-final/components/ServiceChip.tsx": "85a7c7c55734cced6406ff4e61c42ab6c78b5402f7e9618a5f9fe1f8095884ee",
  "frontend/src/pages/crypto-card-final/components/SubscriptionsSection.tsx": "7c04ff3acdd5711ab31e971b6fc2736551a3c17a4dd09da06ee32828175a670b",
  "frontend/src/pages/crypto-card-final/components/VoltexCard.tsx": "377d1fd5a5a0c2b024bf62b3bbadd72059e71f2e3b5c98ae4f559d59d162c2c4",
  "frontend/src/pages/crypto-card-final/data/cardCopy.ru.ts": "dd11eea2a4394197f583899d6b3a7ca89f3f05e6958b1515e5c824a01a5ee3ab",
  "frontend/src/pages/crypto-card-final/data/cardCopy.ts": "10a568929e79f3819824c60b90edc7ca864d9897a2c64fe59c8e09570ee6a4fc",
  "frontend/src/pages/crypto-card-final/data/cardCopyTranslations.ts": "834ceec514e787f87c3ad08d1a75e6fa3372469f48fcea1274877fd800bbfda2",
  "frontend/src/pages/crypto-card-final/data/currencies.ts": "bdaa4ad2d7dfb2343c6c9d8bfb0f3ec717c9dc929febba27f93d1948b12ceba7",
  "frontend/src/pages/crypto-card-final/data/faq.ts": "02fdb896f64036d3e5e41a95955b6c175fb15d70e1a8b6bf502011cf56842b91",
  "frontend/src/pages/crypto-card-final/data/products.ts": "f60770553a97b8fc0784247d0380919327fa998661e62cffe88681d92bf45c29",
  "frontend/src/pages/crypto-card-final/data/services.ts": "05e4d374f148d62bd4e24f6e757077eb1245b45f77bc246718356239795e1862",
  "frontend/src/pages/CardPage.tsx": "a6fb72e68a9edc6860edc2f49de4d374efc32f917b0e5ad43059b9e8853cf285",
  "frontend/tailwind.crypto-card.config.js": "d2021c8b7de7d4be48d0a42f5902cfef95d3cbd03fa70bc5f457c99946953c53"
};
// Production base cb29b7f1afce7fb17cf68462573949166933640e. Six Copy-only
// fingerprints were advanced for the explicitly approved identity-bound blue
// badge: page/adapter/type wiring, inline SVG placement and its CSS only.
// copyVerifiedBadge and the existing canonical/renderer fingerprints verify
// those boundaries separately. The later authorized Spot task may change
// TradePage independently; Card's authenticated route is asserted below instead
// of freezing an unrelated product page. The later source-aware Copy labels
// replace the removed global/contextual wrappers. Exact source reversals below
// permit only those inline additions; no financial calculation/hash is relaxed.
const preservedMainSources: Record<string, string> = {
  "frontend/src/App.tsx": "749a43215c32af860a398205c3fb08c1ac1a9cba095dd7a26049384c6d4e2efd",
  "frontend/src/components/Nav.tsx": "68cddc0c6c344af0b10de091a2e750abec29f2ea2a1ba53f0bfd977c16de31c4",
  "frontend/src/components/Footer.tsx": "7d72658c25f6185816779d68f7bf5720992e50f5788fccaf08fdf3b18b486b63",
  "frontend/src/pages/home/home.css": "f2e53a7bd3f0d3e61d5f71d9d12d45ac3bde9149930747d1019b102b70a4f23b",
  "frontend/src/pages/home/HomeCardSection.tsx": "6c59eaba4532371e58ae531c2fdc800a96c3756cc9910d4ff7405995fbadbaeb",
  "frontend/src/pages/home/HomeCryptoCard.tsx": "ce5a19d0d45c56cd38485e72790e96cb6c2093e0666a176aae2c45c161984535",
  "frontend/src/pages/home/HomeFaq.tsx": "8b16cfc5f4eaae8336485e3c91b61a5e554d8c139066fa6e06270498da05b676",
  "frontend/src/pages/home/HomeFooter.tsx": "c8c6058ce73c64e25ce799abfaa2e856142973acf3d346949f9a2e11f8493730",
  "frontend/src/pages/home/HomeHeader.tsx": "9f52f98f8f38750ed5d380c95eb4b9a270124e26549cbb427d3d6ecde08e0ed3",
  "frontend/src/pages/home/HomeHero.tsx": "d6e4a4d4feae468961d953dd6abfd3711073bfd6ff407efa2fc4d2adfaa6e639",
  "frontend/src/pages/home/HomeMarketOverview.tsx": "e4e78ef28478c4e498cdec0cf72c39f05ada80c31dbd3ac66461b746d4af414e",
  "frontend/src/pages/home/HomeMarkets.tsx": "39c868803bd823dc362c3a4585c8948cd0ed28132fdd7d9b8c2f23dfe2a22d47",
  "frontend/src/pages/home/HomePage.tsx": "5a2d3507b9c090410e65eaaf3a205039c0513ba252ceafa8098e8fafa3a07910",
  "frontend/src/pages/home/HomeTicker.tsx": "bf3196e341c7baf711645a3e728f3c482b91eb386abe3e84e428cc4220b09200",
  "frontend/src/pages/home/PhonePreview.tsx": "919ebb21bbdae8eaf2588ba510ad36cc9d8cd75c66f6c2c802d73ec0771327d6",
  "frontend/src/pages/home/Reveal.tsx": "a5f24c251d116ee8b12de0887853a8d019ba53dc3a75e9523b527bc295888317",
  "frontend/src/pages/home/TerminalPreview.tsx": "278010a479c9102267599c93e9f4b712a313088bb6b115786ee3ee0a4b2c3ceb",
  "frontend/src/pages/home/useHomeMarket.ts": "28d77b6950b9a944cf80d12f9ede522f598a32471fc62309b69e64518a58880e",
  "frontend/src/pages/CopyTradingPage.tsx": "023cc003fb8301e49e235e0b8dbdaa841f6b7e551831fbc270d70f5955d063ce",
  "frontend/src/pages/copy-trading-bolt/components.tsx": "0a7c8d48876e168daa955c391320aaf7e2d7d650a28fe3eee36787e194a28692",
  "frontend/src/pages/copy-trading-bolt/CopyEligibilityContext.tsx": "4b8a2e6359d5d03dbe33a91094b75f75b703ec5ee22b74467c22ff7eae9b363c",
  "frontend/src/pages/copy-trading-bolt/CopyTradingBolt.css": "7b287821fe20bdd9eba8ec86ae0b392ae373b75c11cd48309031f4bbc80daf33",
  // Owner-requested marketplace card polish; profile/chart CSS is separately frozen.
  "frontend/src/pages/copy-trading-bolt/CopyTradingRefinement.css": "4a23c8b6f80086e232b747846fb32b92741eebd3261ad1cc5764f7869626f869",
  "frontend/src/pages/copy-trading-bolt/demoPerformance.ts": "1339781ee31f193dcd7f7fe4a5d8a9257383cf4e0c8a29ffca69101d7cb6bead",
  "frontend/src/pages/copy-trading-bolt/FeaturedAvatarContext.tsx": "08d27c9108d4b5e0d0cd972cc1d7739ccba71c545bdb85bcc3ffebe5ddc633bd",
  "frontend/src/pages/copy-trading-bolt/KseniaReview.css": "fd12204a82592875691f06aa00400fa98ee3a75ea9257bd30dc825a435218134",
  "frontend/src/pages/copy-trading-bolt/TraderAvatarArt.tsx": "6fa00d21147656ac4ec0a56ee908bb1f1a05f777cbaf2044a7866c2bd11f51d7",
  "frontend/src/pages/copy-trading-bolt/traders.ts": "ab4d3408ef96696f88570fc75d31d227e705a0f84733bb173b9071bf7c5ed469",
  "frontend/src/pages/copy-trading-bolt/traderVisuals.ts": "c87ac8d078d4d9038a33b18ddded787630a93834a7444042cc7899723ae4e74a",
  "frontend/src/pages/copy-trading-bolt/useCopyLists.ts": "322cc598e49f4d64a3d058d0d8f232ddce43e5ce3e604bfd88de7cd9cac10480",
  "frontend/src/lib/syntheticCopyTrading.ts": "f7f9664a0630d3eda53a2ca6ba61c1a20613fb2991d57ae0a5ecc53ed27ca4ea",
  "frontend/src/lib/kseniaCopyTrading.ts": "dec995b8c3e11223a1f878c884db47c6823e7a12e60c34d7f7b75e4fa9b313ab",
  "frontend/src/lib/dailyReturnChart.ts": "6f6e1c0394cc3c581dac03b6b2e7e2ffb4dd49fa85454135bf667c7dc82f6407",
  "frontend/src/lib/copyTradingMoney.ts": "1d29908f9517ed1f9de08965fc84cda4d39c29577dbba5dce62b50488d7da539",
  "frontend/tailwind.config.js": "9cfbd5faaf195d1ce52bdf1d8b378ed7ea5b43f3e106af17bf9be44832fe5999"
};
const approvedAssets: Record<string, string> = {
  "5165f22b-08e6-4b9b-83eb-d4b778cc9aad.jpg": "d67bb871ba92b31d5da246599d8521933b29e1d7b5aa78a8e2e9fcd98c1e5d45",
  "a71588d4-cbfc-4255-88c2-66a8977c28fe.jpg": "dcee9a1931938098794285596629337731ce7b1aee44bb0e09ac123c2a457c6c",
  "beb1109b-fa4d-4739-804c-6e1cb6d5d170.jpg": "d284af848b57b39e253c8690221ea2bccd2098c270efcebb7fc65f61f881c5f1",
  "cef11d73-5081-4f82-879c-1d5ef1391f70.jpg": "43a16892ef7ec21042602b1ba2be36aabd65ae6d60b6a4dd04327a7baa531905",
  "e02dd952-015e-4a66-851e-4561ff0cc446.jpg": "0680c82ef237c561c28d1b8888a700641e5dc3a4767da8a578c9c76ad172a4d7",
  "f944ce76-d7cd-444f-bc2a-3e651c76b609.jpg": "1e5342a4cf670b59c1c972044fc75d5cb2162c5c80f8a22f38b580d8ce6cbf5a",
  "financial-times.svg": "19160f4ccb49eacfff409322bdb03cee1549cbca5d550866219cd079c67b494d",
  "fraunces-500.ttf": "0c2fad18ed36cc400041f1e281ee79954a329b345caffc38dfaa3bb8bcef57de",
  "Fraunces-OFL.txt": "bdf4c22802eaf804f998195871c6b8938aac2ac14b2d78a8bd66a6f1eced833b",
  "voltex-black-signature-final.png": "494de1377e5fb5ae1108398a1788cd6b98981215b6315edc4aea0cc54f4a3ad1",
  "voltex-black-signature-final.webp": "a898845c6893403c920348008e2e5513f8707e7fcefe92cfa03438099eabfa16",
  "voltex-cards-phone-hero.webp": "fbf933426bcdcab2862cd243d7aa934f37549ffa536112d1a99ab11e3d0ec6d1",
  "voltex-cards-phone-register.webp": "9cccc9c8a524e8dfa31982f43d6569b820dbd15ea945194c0eacfd84e29d2ab5",
  "voltex-titanium-final.png": "b4d69e2b18dd4459127ecedcd21876a569275bc83e9878a54466dfc6737195f8",
  "voltex-titanium-final.webp": "de32c9f131bbd9b0ff867882012b258699f21526f624af708658f6b87683a2d5"
};

test('selective Card promotion preserves the exact approved page, composition, copy and state machine', () => {
  for (const [file, expected] of Object.entries(approvedCardSources)) {
    expect({ file, sha256: digest(source(file)) }).toEqual({ file, sha256: expected });
  }
});

test('all fifteen approved assets are byte-exact and no superseded source compositions are published', () => {
  const directory = resolve(repository, 'frontend/public/cards/crypto-card-final');
  expect(readdirSync(directory).sort()).toEqual(Object.keys(approvedAssets).sort());
  for (const [file, expected] of Object.entries(approvedAssets)) {
    expect({ file, sha256: digest(readFileSync(resolve(directory, file))) }).toEqual({ file, sha256: expected });
  }
  expect(Object.keys(approvedAssets)).toHaveLength(15);
  expect(existsSync(resolve(directory, 'voltex-cards-phone-hero-source.png'))).toBe(false);
  expect(existsSync(resolve(directory, 'voltex-cards-phone-register-source.png'))).toBe(false);
});

test('Copy preserves its approved source except exact labels and click-only deposit requirement UX', () => {
  for (const [file, expected] of Object.entries(preservedMainSources)) {
    let text = source(file);
    if (file === 'frontend/src/App.tsx') {
      expect(text).not.toMatch(/PrelaunchApplication|PrelaunchNotice|CopyTradingNotice/);
      const importAnchor = "import { AdminAuditLogPage } from './pages/admin/AdminAuditLogPage';\n";
      expect(text.split(importAnchor)).toHaveLength(2);
      expect(text.split('    <BrowserRouter>\n')).toHaveLength(2);
      expect(text.split('      </Routes>\n')).toHaveLength(2);
      // Reverse only the three owner-approved removed lines. Every route,
      // RequireAuth/redirect function, import and other byte remains frozen.
      text = text.replace(importAnchor, importAnchor + "import { PrelaunchApplication } from './components/PrelaunchNotice';\n")
        .replace('    <BrowserRouter>\n', '    <BrowserRouter>\n      <PrelaunchApplication>\n')
        .replace('      </Routes>\n', '      </Routes>\n      </PrelaunchApplication>\n');
    }
    if (file === 'frontend/src/pages/copy-trading-bolt/components.tsx') {
      // Reverse only the requested VIP move; retain all data/rendering guards.
      const inlineVip = '<div className="nazara-name trader-display-name"><h3>{trader.name}</h3><VerifiedBadge verified={trader.identityVerified} />{trader.vip && <VipBadge />}</div>';
      expect(text.split(inlineVip)).toHaveLength(2);
      text = text.replace(inlineVip, '<div className="nazara-name trader-display-name"><h3>{trader.name}</h3><VerifiedBadge verified={trader.identityVerified} /></div>\n              <div className="nazara-status">{trader.vip && <VipBadge />}</div>');
      text = restoreCopyDepositUx(text);
      // All original bytes, including ROI/drawdown calculations, data adapters,
      // charts and eligible copy actions, must match after reversing this exact
      // UX allowlist and the source labels. Existing hashes are not advanced.
      const additions = [
        "import { ModeledDataLabel } from '../../components/ModeledDataLabel';\n",
        "import { isModeledResponse, isModeledTraderData, isModeledAggregate, preserveModeledSource } from '../../lib/modeledCopyData';\n",
        '          <ModeledDataLabel modeled={isModeledTraderData(trader, synthetic)} />\n',
        '<ModeledDataLabel modeled={isModeledTraderData(trader, liveSynthetic)} />',
        "<ModeledDataLabel modeled={value !== '—' && (label === 'Total Followers' ? isModeledAggregate(marketplaceTraders) || isModeledTraderData(trader, synthetic) : isModeledResponse(synthetic))} />",
      ];
      for (const added of additions) {
        expect({ added, occurrences: text.split(added).length - 1 }).toEqual({ added, occurrences: 1 });
        text = text.replace(added, '');
      }
      const projection = 'searchTraders(tabRoster, query).map(item => preserveModeledSource(item, { ...item, drawdown:';
      expect(text.split(projection)).toHaveLength(2);
      text = text.replace(projection, 'searchTraders(tabRoster, query).map(item => ({ ...item, drawdown:');
    }
    expect({ file, sha256: digest(text) }).toEqual({ file, sha256: expected });
  }
  expect(existsSync(resolve(repository, 'frontend/src/components/PrelaunchNotice.tsx'))).toBe(false);
  expect(existsSync(resolve(repository, 'frontend/src/components/prelaunchNotice.css'))).toBe(false);
});

test('Card remains an authenticated standalone route, independent of Spot terminal changes', () => {
  const app = source('frontend/src/App.tsx').replace(/\s+/g, ' ');
  expect(app).toContain('path="/card" element={ <RequireAuth> <CardPage /> </RequireAuth> }');
  expect(source('frontend/src/pages/CardPage.tsx')).toContain('<FinalCtaFooter reviewOnly={reviewOnly} />');
  expect(source('frontend/src/pages/crypto-card-final/components/FinalCtaFooter.tsx')).toContain('<CardApplication reviewOnly={reviewOnly} />');
  const trade = source('frontend/src/pages/TradePage.tsx');
  expect(trade).not.toMatch(/import[^\n]+(?:CardApplication|CardPage|crypto-card-final)/);
  expect(trade).not.toMatch(/(?:getCardApplication|submitCardApplication)\s*\(/);
});

test('all 196 existing Card-related shared translations stay exact while Spot may add its own keys', () => {
  const text = source('frontend/src/lib/i18n.tsx');
  expect(text).not.toMatch(/^\s*'card\./m);
  // Snapshot only the reviewed Card/Home/Auth/support entry points, across all
  // seven dictionaries. The complete Card product dictionaries remain byte-exact
  // in approvedCardSources above. An unrelated Trade error label must not force
  // replacement of a whole-file i18n hash or invalidate these Card guarantees.
  const entries = text.split('\n').filter(line => /^\s*'(?:nav\.card|authShell\.(?:lead|(?:benefit\.)?card\.[^']+)|home\.(?:card\.[^']+|cta\.getCard|faq\.[qa]6)|support\.subject\.CARD)':/.test(line)).map(line => line.trim());
  expect(entries).toHaveLength(196);
  expect(digest(entries.join('\n'))).toBe('9d42978eef5f862316cdb8ac0510c773fea669f252e9f0be23e36f42dd71284a');
});

test('Card API uses normal authenticated backend requests without review or client eligibility branches', () => {
  const api = source('frontend/src/lib/api.ts');
  expect(api).toContain("getCardApplication: () => request<CardApplicationSnapshot>('/card/application/me')");
  expect(api).toContain("submitCardApplication: (product: CardProduct)");
  expect(api).toContain("method: 'POST', body: JSON.stringify({ product })");
  expect(api).not.toMatch(/getCardWaitlist|joinCardWaitlist|reviewReadPath|REVIEW_UNAVAILABLE|SpotPeriodReferences|getKseniaReview/);
  expect(api).toContain("getNazarCopyTrading:");
  expect(api).toContain("getKseniaCopyTrading:");
  expect(api).toContain("getCopyStrategyIdentities:");
});

test('only approved Card dependencies are added and the production build workflow remains unchanged', () => {
  const manifest = JSON.parse(source('frontend/package.json'));
  expect(manifest.scripts).toEqual({ dev: 'vite', build: 'tsc -b && vite build', preview: 'vite preview' });
  expect(manifest.dependencies['@icons-pack/react-simple-icons']).toBe('12.9.0');
  expect(manifest.dependencies['country-flag-icons']).toBe('1.6.20');
  expect(manifest.dependencies['framer-motion']).toBe('11.5.4');
  expect(existsSync(resolve(repository, 'frontend/src/lib/spotPeriodReturns.ts'))).toBe(false);
  expect(existsSync(resolve(repository, 'frontend/src/review/main.tsx'))).toBe(false);
});
