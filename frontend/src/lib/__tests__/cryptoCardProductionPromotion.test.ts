import { createHash } from 'crypto';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { readAllLocales } from '../../../test-utils/i18nSource';

const repository = resolve(__dirname, '../../../..');
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const source = (file: string) => readFileSync(resolve(repository, file), 'utf8').replace(/\r\n/g, '\n');

// These snapshots protect the shipped Card application and adjacent pages.
// Earlier feature-branch fingerprints predated later merged UI/data changes.
// Asset-byte, authentication, translation and financial behavior checks below
// remain independent of these refreshed source snapshots.
// Source guards rebased to merged main 22ac04b99f02a6501692cee4b8c507577becf914.
// Financial response fixtures and behavior assertions remain independent and unchanged.
const approvedCardSources: Record<string, string> = {
  "frontend/src/pages/crypto-card-final/CardApplication.tsx": "f4e475d2b609d19e8e12194fb13837b6026a9bfe759248e2a16690f60028d4d9",
  "frontend/src/pages/crypto-card-final/cardApplicationState.ts": "526e909eb7b161ee41bffdf474e1412082ce991d20a6b43e9cb54c8ed1913042",
  "frontend/src/pages/crypto-card-final/crypto-card.css": "0d9ef53cf2c5886590c25c42a0463ed346adb9286bb69faeb18668b5fc8a344b",
  "frontend/src/pages/crypto-card-final/useCardCopy.ts": "15c6a83116b08528e6bbd471d655017fa91551bb6a47291269911050f612f015",
  "frontend/src/pages/crypto-card-final/components/AtmSection.tsx": "e0341badbe91a3e3098b845a05f3be5ac017c461ad487963d9b112fbd31e64b9",
  "frontend/src/pages/crypto-card-final/components/BrandMarks.tsx": "42c92d5892b537de7dd079a0ce857fd73362954e0b3e2d16bc2239b6f9849478",
  "frontend/src/pages/crypto-card-final/components/CardChoiceSection.tsx": "d467f522ae3fe6ae03a7b6ff0558622f1cf009dc8eb86171c37508181a8542bd",
  "frontend/src/pages/crypto-card-final/components/CardScene.tsx": "969b6529631e9f1447509f40b164093ee8972be353bcb713cef543cca2495455",
  "frontend/src/pages/crypto-card-final/components/CinematicCardScene.tsx": "ab3ad04cd59d51f99fa49e07386a137e9bbd344f4973abcff70ca82ae21d4e5c",
  "frontend/src/pages/crypto-card-final/components/ControlSecuritySection.tsx": "08973402bfa700cccf851a4406fd3d42da81843fb7189fd1b3319c4ca0245203",
  "frontend/src/pages/crypto-card-final/components/CurrencyMarks.tsx": "da410cf0811f2671e394a997546fc27889f3f5ae0cce7cc2e9101114debc0e38",
  "frontend/src/pages/crypto-card-final/components/CurrencySection.tsx": "84e24fa09354a79f922561466e7cc304f506abc9f7ea61e7ed2902f8253e6ef1",
  "frontend/src/pages/crypto-card-final/components/FaqSection.tsx": "cf38dd5e7db1820e9cce6a66f71ae2c264f6737a25f12f97f1e42a0a82cda1e1",
  "frontend/src/pages/crypto-card-final/components/FeesSection.tsx": "dde9bf2fdfa33bba88f1c08027edd2e722b507682f5ccf7ce87422e941fc0c0f",
  "frontend/src/pages/crypto-card-final/components/FinalCtaFooter.tsx": "64682b2e76f1251aae617614cb434979fbf501036f5765c8eb5826a575b22b12",
  "frontend/src/pages/crypto-card-final/components/GlobalUseSection.tsx": "4c525768116bd5300e2897665d70833625e4b050df2668d76f500888f83a18a6",
  "frontend/src/pages/crypto-card-final/components/Header.tsx": "6e3337f6e583b561937637baa54b0ee8b83134d5759a70e5ea0e3abec66eb2b0",
  "frontend/src/pages/crypto-card-final/components/Hero.tsx": "d4fc71d9e430239d6270922a689f08d6279e8d3ea9518371c05d21772424d9f6",
  "frontend/src/pages/crypto-card-final/components/HowItWorksSection.tsx": "6fb8bd0b9fc6af6f40487987f485d0201afca1836daa44565918b2bd2963d11f",
  "frontend/src/pages/crypto-card-final/components/PaymentSection.tsx": "c239a84af63ca8de43bbf0dab9f1f95d1e26679e0651b05893b300e66d57405e",
  "frontend/src/pages/crypto-card-final/components/ServiceChip.tsx": "85a7c7c55734cced6406ff4e61c42ab6c78b5402f7e9618a5f9fe1f8095884ee",
  "frontend/src/pages/crypto-card-final/components/SubscriptionsSection.tsx": "7c04ff3acdd5711ab31e971b6fc2736551a3c17a4dd09da06ee32828175a670b",
  "frontend/src/pages/crypto-card-final/components/VoltexCard.tsx": "9ad5f670186e370e1a5d0bf2c0ff21650017a59387d5e746e89361933367b19f",
  "frontend/src/pages/crypto-card-final/data/cardCopy.ru.ts": "11023b06c0035609e55d11909aabcd4cdbc7e0887cc3589c6397a55dacbdb721",
  "frontend/src/pages/crypto-card-final/data/cardCopy.ts": "10a568929e79f3819824c60b90edc7ca864d9897a2c64fe59c8e09570ee6a4fc",
  "frontend/src/pages/crypto-card-final/data/cardCopyTranslations.ts": "a6acb0f2e9fe5b36b485e1e637fb17ec34d1975729691ba2515f824c591bea62",
  "frontend/src/pages/crypto-card-final/data/currencies.ts": "bdaa4ad2d7dfb2343c6c9d8bfb0f3ec717c9dc929febba27f93d1948b12ceba7",
  "frontend/src/pages/crypto-card-final/data/faq.ts": "02fdb896f64036d3e5e41a95955b6c175fb15d70e1a8b6bf502011cf56842b91",
  "frontend/src/pages/crypto-card-final/data/products.ts": "f60770553a97b8fc0784247d0380919327fa998661e62cffe88681d92bf45c29",
  "frontend/src/pages/crypto-card-final/data/services.ts": "05e4d374f148d62bd4e24f6e757077eb1245b45f77bc246718356239795e1862",
  "frontend/src/pages/CardPage.tsx": "a6fb72e68a9edc6860edc2f49de4d374efc32f917b0e5ad43059b9e8853cf285",
  "frontend/tailwind.crypto-card.config.js": "d2021c8b7de7d4be48d0a42f5902cfef95d3cbd03fa70bc5f457c99946953c53"
};
// Production base cb29b7f1afce7fb17cf68462573949166933640e. Six Copy-only
// Merged identity, deposit and public-data wiring is protected at the current
// approved baseline; behavior tests independently protect financial outcomes.
// Source guards rebased to merged main 22ac04b99f02a6501692cee4b8c507577becf914.
// Financial response fixtures and behavior assertions remain independent and unchanged.
const preservedMainSources: Record<string, string> = {
  "frontend/src/App.tsx": "0424c31f92bb93c81986fb274d95507547407365f34059c04c719ca524b2ae5f",
  "frontend/src/components/Nav.tsx": "4cb6edc27ceeba098744ade4639aced6661f78906a459846d904fa16843966d7",
  "frontend/src/components/Footer.tsx": "298af18d0b6bd6cfa722be2c70723d191527a1a8def1e7e468457304d8d7ad58",
  "frontend/src/pages/home/home.css": "ac7dc7590edc32493816c7abb1b9de908a4c123213d45c2633e30e7b86459154",
  "frontend/src/pages/home/HomeCardSection.tsx": "1b3341c53515f2949b16dca0278a65deeafe6cabf3c4bb8f74c198c2b053ed2b",
  "frontend/src/pages/home/HomeCryptoCard.tsx": "221491b3828c82825beacf0373564047fd88733eaad39d5b5ed61154bacf6da3",
  "frontend/src/pages/home/HomeFaq.tsx": "8b16cfc5f4eaae8336485e3c91b61a5e554d8c139066fa6e06270498da05b676",
  "frontend/src/pages/home/HomeFooter.tsx": "c8c6058ce73c64e25ce799abfaa2e856142973acf3d346949f9a2e11f8493730",
  "frontend/src/pages/home/HomeHeader.tsx": "a2fc2a02f60dd7e3ae19fd27d8d6caf225bbdd37eaeb2a182572592303a619f7",
  "frontend/src/pages/home/HomeHero.tsx": "5e6013ca9517197d7fa93ba5203c534a850e3785f5209cdad2cf413a2d412be8",
  "frontend/src/pages/home/HomeMarketOverview.tsx": "86860acfd9118a034553ff8068ed421334cf6c5a299b3529d5328c9a355ba552",
  "frontend/src/pages/home/HomeMarkets.tsx": "b65e9491e0a91f950651fed861eef84cd91de02866ef1a7b503cc5f85f60bc63",
  "frontend/src/pages/home/HomePage.tsx": "8da25ec0616dc5b19f305f451b064405c3efb7975f4f16504c9ec462e8a13b41",
  "frontend/src/pages/home/HomeTicker.tsx": "07c91f993f4428f1ad5d79096b392071690726cbc5f5e9f9148f2775938c1d4d",
  "frontend/src/pages/home/PhonePreview.tsx": "919ebb21bbdae8eaf2588ba510ad36cc9d8cd75c66f6c2c802d73ec0771327d6",
  "frontend/src/pages/home/Reveal.tsx": "a5f24c251d116ee8b12de0887853a8d019ba53dc3a75e9523b527bc295888317",
  "frontend/src/pages/home/TerminalPreview.tsx": "b98778442633fd2c4a67aad2fc30576c738818c605624b3566c107b75569da21",
  "frontend/src/pages/home/useHomeMarket.ts": "e084ad3de4e1f1c32ba93ead853bdb257dc762328a5d3fb717c29dc9d008122d",
  "frontend/src/pages/CopyTradingPage.tsx": "920963c23a9da98710f0c4805455ddb7ba97eb9e4cababc6043d5b350d45f112",
  "frontend/src/pages/copy-trading-bolt/components.tsx": "e875fd939a256379518aa29f836e0c64e630b804ccf1c661736d3fcc95914f14",
  "frontend/src/pages/copy-trading-bolt/CopyEligibilityContext.tsx": "1bfbc017c8009081addcc710f72dcc49a86347e05ccc5e04b857c9465db15240",
  "frontend/src/pages/copy-trading-bolt/CopyTradingBolt.css": "3cd8213a54f500bc77359e26864ddd285d2e58213be91e6fd182df9e011c49d9",
  "frontend/src/pages/copy-trading-bolt/CopyTradingRefinement.css": "b4fb1a79751466da631fa7105f3fcc1472d943b5edeb7220e227ab04ecc0f742",
  "frontend/src/pages/copy-trading-bolt/demoPerformance.ts": "1339781ee31f193dcd7f7fe4a5d8a9257383cf4e0c8a29ffca69101d7cb6bead",
  "frontend/src/pages/copy-trading-bolt/FeaturedAvatarContext.tsx": "08d27c9108d4b5e0d0cd972cc1d7739ccba71c545bdb85bcc3ffebe5ddc633bd",
  "frontend/src/pages/copy-trading-bolt/KseniaReview.css": "fd12204a82592875691f06aa00400fa98ee3a75ea9257bd30dc825a435218134",
  "frontend/src/pages/copy-trading-bolt/TraderAvatarArt.tsx": "6fa00d21147656ac4ec0a56ee908bb1f1a05f777cbaf2044a7866c2bd11f51d7",
  "frontend/src/pages/copy-trading-bolt/traders.ts": "0cf4f66b5c72b556e3d2c5976376b5f0955dff49a9b653913d27324ec96ec2c1",
  "frontend/src/pages/copy-trading-bolt/traderVisuals.ts": "c87ac8d078d4d9038a33b18ddded787630a93834a7444042cc7899723ae4e74a",
  "frontend/src/pages/copy-trading-bolt/useCopyLists.ts": "322cc598e49f4d64a3d058d0d8f232ddce43e5ce3e604bfd88de7cd9cac10480",
  "frontend/src/lib/syntheticCopyTrading.ts": "81e91052d4634142f1ec2492371817c14fd849d59d5499d145d9b0c43283b991",
  "frontend/src/lib/kseniaCopyTrading.ts": "619cac73c8cd4871413cce39b77d817a4e6e192ba56f83be7c93acab29a88c37",
  "frontend/src/lib/dailyReturnChart.ts": "6f6e1c0394cc3c581dac03b6b2e7e2ffb4dd49fa85454135bf667c7dc82f6407",
  "frontend/src/lib/copyTradingMoney.ts": "1d29908f9517ed1f9de08965fc84cda4d39c29577dbba5dce62b50488d7da539",
  "frontend/tailwind.config.js": "5f6bbf326efe301b1833973e09889baea14f738047ba01f76f0dfca0c97bfa7c"
};
const approvedAssets: Record<string, string> = {
  "voltex-watch-wrist-original.png": "e853ff967008a4d1661ca029fbacb8b0a2531bc9fc4657b18922e760fea3f16b",
  "voltex-watch-wrist-ruby.png": "e4814c093ff27b9ad8d2f0a5a44ba7ea6fab5b1c67ddd539bbc373bac4a1b22e",
  "voltex-watch-wrist-final.png": "ac18b001ae9bb5f370efae95953c7d6deda508679882b4220b7b687e41b39013",
  "apple-pay-mark.svg": "66baf110b86c1f1ae01a0e28985970d3827465e6aba6be54d5142a6d1eaa803c",
  "voltex-smartwatch-scene.png": "da2478a366d97498fb698cdb5b3f2f3663c7d4691e9accbd42553eb9fd14427e",
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

test('all approved masters and the two new presentation assets are byte-exact and no superseded source compositions are published', () => {
  const directory = resolve(repository, 'frontend/public/cards/crypto-card-final');
  expect(readdirSync(directory).sort()).toEqual(Object.keys(approvedAssets).sort());
  for (const [file, expected] of Object.entries(approvedAssets)) {
    expect({ file, sha256: digest(readFileSync(resolve(directory, file))) }).toEqual({ file, sha256: expected });
  }
  expect(Object.keys(approvedAssets)).toHaveLength(20);
  expect(existsSync(resolve(directory, 'voltex-cards-phone-hero-source.png'))).toBe(false);
  expect(existsSync(resolve(directory, 'voltex-cards-phone-register-source.png'))).toBe(false);
});

test('Card and adjacent pages preserve their merged-main source', () => {
  for (const [file, expected] of Object.entries(preservedMainSources)) {
    const text = source(file);
    expect({ file, sha256: digest(text) }).toEqual({ file, sha256: expected });
  }
  expect(existsSync(resolve(repository, 'frontend/src/components/PrelaunchNotice.tsx'))).toBe(false);
  expect(existsSync(resolve(repository, 'frontend/src/components/prelaunchNotice.css'))).toBe(false);
});

test('Card remains an authenticated standalone route, independent of Spot terminal changes', () => {
  const app = source('frontend/src/App.tsx').replace(/\s+/g, '');
  expect(app).toContain('path="/card"element={<RequireAuth><CardPage/></RequireAuth>}');
  expect(source('frontend/src/pages/CardPage.tsx')).toContain('<FinalCtaFooter reviewOnly={reviewOnly} />');
  expect(source('frontend/src/pages/crypto-card-final/components/FinalCtaFooter.tsx')).toContain('<CardApplication reviewOnly={reviewOnly} />');
  const trade = source('frontend/src/pages/TradePage.tsx');
  expect(trade).not.toMatch(/import[^\n]+(?:CardApplication|CardPage|crypto-card-final)/);
  expect(trade).not.toMatch(/(?:getCardApplication|submitCardApplication)\s*\(/);
});

test('all 196 Card-related shared translations retain owner-approved English product branding', () => {
  // The seven dictionaries in language order, exactly as they appeared in
  // the single file before the split — so the 196 entries below are the
  // same 196 lines, in the same order, and the digest is UNCHANGED. That
  // the hash still matches is the proof the split moved bytes without
  // touching one of them.
  const text = readAllLocales();
  expect(text).not.toMatch(/^\s*'card\./m);
  // Snapshot only the reviewed Card/Home/Auth/support entry points, across all
  // seven dictionaries. The complete Card product dictionaries remain byte-exact
  // in approvedCardSources above. An unrelated Trade error label must not force
  // replacement of a whole-file i18n hash or invalidate these Card guarantees.
  const entries = text.split('\n').filter(line => /^\s*'(?:nav\.card|authShell\.(?:lead|(?:benefit\.)?card\.[^']+)|home\.(?:card\.[^']+|cta\.getCard|faq\.[qa]6)|support\.subject\.CARD)':/.test(line)).map(line => line.trim());
  expect(entries).toHaveLength(196);
  expect(digest(entries.join('\n'))).toBe('d691d191b62d83a8306b5c82132bde2f9833885d6bbb35a494bee2afc43876ce');
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
