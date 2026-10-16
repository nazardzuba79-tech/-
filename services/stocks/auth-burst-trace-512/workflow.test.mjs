import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BASELINE_SHA, WORKFLOW_PATH, normalizedWorkflow } from './launch-gate.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const text = fs.readFileSync(new URL('../../../.github/workflows/stocks-review.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const job = text.match(/^  stocks-auth-one-burst:\n([\s\S]*?)(?=^  stocks-backend-admission:)/m)?.[0];


// Exact source transition reviewed independently on 2026-10-15. This permits
// only the recorded correctness review, never a future browser/environment edit.
const REVIEWED_TRANSITION = {
  "executionHookPacketSha256": "69521f4d2cbde2d0a258ec7d3a2e56f8b60126a200a6b8f7d8d7d87711b95fa1",
  "packetSha256": "c29812c80ffec3fd4f77bc9a93fbf38736b8a0b494dbde4dbb6badf5f19d66b3",
  "independentReviewSha256": "01913ec41c204a69af53062058947d81f5822842f01298c26c302d717cd8bdfe",
  "parentCommit": "a9902b55f3bac65b1624f4774834c0ab26b00d4c",
  "historicCommit": "f045d7255f1195ef3c7b6cca5a5e63f4c851a2a8",
  "historicSha256": "8f0052ba6c1025fca0c452b5c744bf9b01ada245fc5b2b50d1c553c261da395d",
  "parentSha256": "390ad4591be088d04da01304ed1da29532fe226e86688d617bb743f3f237f166",
  "reviewedSha256": "dec3661742d5510668d0762c7494a2f09c16ff97f36519e3d19d808c59f9e71c",
  "headerBeforeSha256": "d65a9f86cfa5a93f3a6c112194248ca17ea02a48ee577a465332281500a71fdc",
  "headerAfterSha256": "d2198228c2371b157663d77a3f8201922cfb2373ddc0cf0fcc9f4e98caf6031a",
  "beforeOrder": [
    "stocks-auth-one-burst",
    "stocks-backend-admission",
    "stocks-auth-preparation",
    "stocks-auth-http-paired",
    "stocks-full-backend-offline",
    "stocks-review-selection",
    "stocks-pr512-targeted-http",
    "stocks-pr512-phase-diagnostic",
    "stocks-pr512-pristine-timeline",
    "stocks-pr512-registration-pairs",
    "stocks-pr512-cx23-model",
    "stocks-joined-phase-diagnostic",
    "stocks-performance-profile",
    "isolated-simulator",
    "frontend-regression",
    "stocks-ui-browser",
    "crypto-service-comparison",
    "launch-resource-comparison",
    "bounded-stock-runtime"
  ],
  "afterOrder": [
    "stocks-pg-discovery",
    "stocks-correctness-result",
    "stocks-auth-one-burst",
    "stocks-backend-admission",
    "stocks-auth-preparation",
    "stocks-auth-http-paired",
    "stocks-full-backend-offline",
    "stocks-review-selection",
    "stocks-pr512-targeted-http",
    "stocks-pr512-phase-diagnostic",
    "stocks-pr512-pristine-timeline",
    "stocks-pr512-registration-pairs",
    "stocks-pr512-cx23-model",
    "stocks-joined-phase-diagnostic",
    "stocks-performance-profile",
    "isolated-simulator",
    "frontend-regression",
    "stocks-ui-browser",
    "crypto-service-comparison",
    "launch-resource-comparison",
    "bounded-stock-runtime"
  ],
  "blocks": [
    {
      "name": "stocks-auth-one-burst",
      "change": "unchanged",
      "beforeSha256": "18d20ef8b445b77e251d6f8e9218a62e59fe9c92dd890ba8128f1463deb47166",
      "afterSha256": "18d20ef8b445b77e251d6f8e9218a62e59fe9c92dd890ba8128f1463deb47166"
    },
    {
      "name": "stocks-backend-admission",
      "change": "unchanged",
      "beforeSha256": "12c35383af5051887f1c1cd5edcf7419468a000132248fd05a989fb4ab81eff1",
      "afterSha256": "12c35383af5051887f1c1cd5edcf7419468a000132248fd05a989fb4ab81eff1"
    },
    {
      "name": "stocks-auth-preparation",
      "change": "unchanged",
      "beforeSha256": "356086dea197a56991559105ac883494c419b3f6557c12c5eb0cb46fc062881f",
      "afterSha256": "356086dea197a56991559105ac883494c419b3f6557c12c5eb0cb46fc062881f"
    },
    {
      "name": "stocks-auth-http-paired",
      "change": "unchanged",
      "beforeSha256": "1aa6119e363fe159c25a87823643e41df72ee025bfce4e4905defeafd3e46d36",
      "afterSha256": "1aa6119e363fe159c25a87823643e41df72ee025bfce4e4905defeafd3e46d36"
    },
    {
      "name": "stocks-full-backend-offline",
      "change": "modified",
      "beforeSha256": "dc1fc3f5f2dfaf5f932d0f8a3c819006c7cf829e26912c4f152c8dfa18fff85f",
      "afterSha256": "c3dccbafa40a82f73bfba8a0d22879ee9d500b57477fd3e689fb6498ec4a4555"
    },
    {
      "name": "stocks-review-selection",
      "change": "modified",
      "beforeSha256": "96e8e1d54833798fdfc00463f85a0327b5e4d5e252d66202a28e8b940b7ed280",
      "afterSha256": "92bfe00a8be3f76e175677a1c468d0ead0722bf7d76af04da25d7058c35d5fd5"
    },
    {
      "name": "stocks-pr512-targeted-http",
      "change": "unchanged",
      "beforeSha256": "1eafaf2131ae3c3a1395f146f35ba950106ba1022fc70a65d1fd54e49433a920",
      "afterSha256": "1eafaf2131ae3c3a1395f146f35ba950106ba1022fc70a65d1fd54e49433a920"
    },
    {
      "name": "stocks-pr512-phase-diagnostic",
      "change": "unchanged",
      "beforeSha256": "4c7f4bcfc2c2f742d4cd04d6e9eb82abae6ea43793365e55020d8ddf14f688d9",
      "afterSha256": "4c7f4bcfc2c2f742d4cd04d6e9eb82abae6ea43793365e55020d8ddf14f688d9"
    },
    {
      "name": "stocks-pr512-pristine-timeline",
      "change": "unchanged",
      "beforeSha256": "5b3e23bbff51a63dd1d77c652b1d502aea1950739a0aee733f57993f7b6254b6",
      "afterSha256": "5b3e23bbff51a63dd1d77c652b1d502aea1950739a0aee733f57993f7b6254b6"
    },
    {
      "name": "stocks-pr512-registration-pairs",
      "change": "unchanged",
      "beforeSha256": "a6a8ae23ab3dacc22edb7963bab22f8d873728598610a42abd515c8163a55dfb",
      "afterSha256": "a6a8ae23ab3dacc22edb7963bab22f8d873728598610a42abd515c8163a55dfb"
    },
    {
      "name": "stocks-pr512-cx23-model",
      "change": "unchanged",
      "beforeSha256": "13689731285ef3bb90205bd6e40c8ceea7701ead98ac26f3d055884f115ae88f",
      "afterSha256": "13689731285ef3bb90205bd6e40c8ceea7701ead98ac26f3d055884f115ae88f"
    },
    {
      "name": "stocks-joined-phase-diagnostic",
      "change": "unchanged",
      "beforeSha256": "79079d63af2b38246247b21bee3f91326d82dd114f4baaa8124b4b03d7e8e8ad",
      "afterSha256": "79079d63af2b38246247b21bee3f91326d82dd114f4baaa8124b4b03d7e8e8ad"
    },
    {
      "name": "stocks-performance-profile",
      "change": "unchanged",
      "beforeSha256": "b9ce5f7f7993c0cb5f6bc7ebd5ca271910f3aa1d1a1e05df5215049cd5ddd28c",
      "afterSha256": "b9ce5f7f7993c0cb5f6bc7ebd5ca271910f3aa1d1a1e05df5215049cd5ddd28c"
    },
    {
      "name": "isolated-simulator",
      "change": "modified",
      "beforeSha256": "15ae1abb1a80152d1e45fb27161a9af0a3a141b7a04ec6e9174b9c8a063fa54b",
      "afterSha256": "739ee12420675d1802bca0a732c2e2cbd1872241d1b44efde3edea454b9c1cce"
    },
    {
      "name": "frontend-regression",
      "change": "modified",
      "beforeSha256": "fa94e72644e2cfaa5be489ad13c1db2a8f800e2ca364984e34de35d5a7daaf3c",
      "afterSha256": "a882cbf1098ba99f4da012569f68acd3a11370aee0f1e2cf5f1379cba8d977da"
    },
    {
      "name": "stocks-ui-browser",
      "change": "modified",
      "beforeSha256": "9c65d8e28ca6e5f9d52a39c063bfc937e4dba656b98ca2d643f6f5a11955adca",
      "afterSha256": "6874d6c4a18b224f271cbb499f4cf06d2d410acf98566329879e5047c0d3628d"
    },
    {
      "name": "crypto-service-comparison",
      "change": "unchanged",
      "beforeSha256": "cd711022f246778f9cb7ddbc17cc34a3d9ea9a18eca2bfdd0ba21c5ff89e848c",
      "afterSha256": "cd711022f246778f9cb7ddbc17cc34a3d9ea9a18eca2bfdd0ba21c5ff89e848c"
    },
    {
      "name": "launch-resource-comparison",
      "change": "unchanged",
      "beforeSha256": "35e3d56d7fbe2f579f527ee50171b21fc7d0f5910e4e46cb3d22671c1a6b793a",
      "afterSha256": "35e3d56d7fbe2f579f527ee50171b21fc7d0f5910e4e46cb3d22671c1a6b793a"
    },
    {
      "name": "bounded-stock-runtime",
      "change": "modified",
      "beforeSha256": "2ee750bd1802b5241c1d7015e5c97e543df0b978fc1c8ebe8b88f51b105ca308",
      "afterSha256": "ab7c8605037961e5312454d6b93f37607eb7eec9e09f1527eec1801e9870a01c"
    },
    {
      "name": "stocks-pg-discovery",
      "change": "added",
      "beforeSha256": null,
      "afterSha256": "f422e950a18ac43963d29e35c21f45415b128b318e24f5a2720bbd2eaf2bef69"
    },
    {
      "name": "stocks-correctness-result",
      "change": "added",
      "beforeSha256": null,
      "afterSha256": "1fb7ba770a17a8fa500f1191bfa04acfea78961968bf625bbedf144e8d5dfe99"
    }
  ]
};
// Separate native-VM transition; the original historical/correctness chain above
// remains immutable. These exact candidate bytes require independent review.
const NATIVE_TRANSITION = {
  sourceCommit: 'db67cc02ed82eea6b2cfdfdc30599592357bbe68',
  sourceSha256: 'dec3661742d5510668d0762c7494a2f09c16ff97f36519e3d19d808c59f9e71c',
  reviewedSha256: '8e934cae128c396867df2632c549b6866b868ffab5c6965e41518ca2a38437d1',
  headerBefore: 'd2198228c2371b157663d77a3f8201922cfb2373ddc0cf0fcc9f4e98caf6031a',
  headerAfter: '88726b9660bf3fc88277f2cca532aaaa5239f9a0950230598bdcccb8a1d6bc14',
  blocks: [
    ['stocks-correctness-result', '1fb7ba770a17a8fa500f1191bfa04acfea78961968bf625bbedf144e8d5dfe99', 'e2ae92ff7418f3ed255d1bd384a02121b4188ae10d3eb74e323af203fb9f1b5e'],
    ['stocks-native-backend-admission', null, 'f14b6147c910d4d10a412132b692f14b5810569dc4b6f33d4bbda45b36212983'],
    ['stocks-full-backend-offline', 'c3dccbafa40a82f73bfba8a0d22879ee9d500b57477fd3e689fb6498ec4a4555', 'e1d090cb747df9e9ccec3f86ce0d7d934d78d383927a7ed39fbf82db99d18e47'],
    ['stocks-ui-browser', '6874d6c4a18b224f271cbb499f4cf06d2d410acf98566329879e5047c0d3628d', 'c53c259c66669d8e2d5f4bdcad15f173c979129c1d007c4800ee248f7cce6349'],
  ],
};
// The recording dependency adds only one fixed environment value. All earlier
// reviewed transitions, finite pins and the other 21 job blocks stay exact.
const FFMPEG_TRANSITION = {
  sourceCommit: 'b0dfad72a852b9f3e5471ea2895188953df0f0e3',
  sourceSha256: '8e934cae128c396867df2632c549b6866b868ffab5c6965e41518ca2a38437d1',
  reviewedSha256: '5d5fd617c6d514708759b5ea85e4053b0a6006049156aaf89d07f9f0c09eb88f',
  browserBefore: 'c53c259c66669d8e2d5f4bdcad15f173c979129c1d007c4800ee248f7cce6349',
  browserAfter: '3c8da2bc71d064b5b5ef6b1852e8752ecbc95f437b5ff78a6b66329fd9a524a4',
};
// Independently reviewed local-only two-trader correctness additions. This is
// a separate transition; none of the consumed finite-head proofs above change.
const TWO_TRADER_TRANSITION = {
  sourceCommit: '186b80bebd9ab31ad22aa269e9077744fbbaa32f',
  sourceSha256: '5d5fd617c6d514708759b5ea85e4053b0a6006049156aaf89d07f9f0c09eb88f',
  reviewedSha256: '565311e817726e13700de7ec90c71b0a2d6e49a74ae8ec951018d0beee92ef39',
  headerBefore: '88726b9660bf3fc88277f2cca532aaaa5239f9a0950230598bdcccb8a1d6bc14',
  headerAfter: '78f688e9de822236ad552f168e490a3cec6856876f30283aa9b26413f4dc1c33',
  isolatedBefore: '739ee12420675d1802bca0a732c2e2cbd1872241d1b44efde3edea454b9c1cce',
  isolatedAfter: '6756a12b902646158f0891f4e950f94d6f610396d8129341054c57f8755aaa5f',
};
const sha256 = value => createHash('sha256').update(value).digest('hex');
function workflowParts(value) {
  const marker = value.indexOf('\njobs:\n');
  assert.ok(marker >= 0, 'workflow jobs section missing');
  const matches = [...value.matchAll(/^  ([a-z][a-z0-9-]*):\n/gm)].filter(row => row.index > marker);
  assert.ok(matches.length > 0, 'workflow jobs missing');
  const order = matches.map(row => row[1]);
  assert.equal(new Set(order).size, order.length, 'duplicate workflow job');
  return { header: value.slice(0, matches[0].index), order,
    blocks: Object.fromEntries(matches.map((row, index) => [row[1],
      value.slice(row.index, matches[index + 1]?.index ?? value.length)])) };
}
function assertReviewedTransition(current, parent, original) {
  // CRLF-to-LF is performed by the callers, as in the original guard. No
  // condition, arbitrary job, source pin or policy digest is normalized away.
  assert.equal(BASELINE_SHA, REVIEWED_TRANSITION.historicCommit);
  assert.equal(sha256(original), REVIEWED_TRANSITION.historicSha256, 'historical baseline source changed');
  assert.equal(sha256(parent), REVIEWED_TRANSITION.parentSha256, 'review parent source changed');
  const prior = workflowParts(parent);
  assert.deepEqual(prior.order, REVIEWED_TRANSITION.beforeOrder);
  assert.equal(sha256(prior.header), REVIEWED_TRANSITION.headerBeforeSha256);
  assert.equal(parent.replace(prior.blocks['stocks-auth-one-burst'], ''), original,
    'original whole-workflow provenance must remain exact');
  if (current === parent) return 'ORIGINAL_PARENT';
  const candidate = workflowParts(current);
  assert.deepEqual(candidate.order, REVIEWED_TRANSITION.afterOrder, 'unreviewed workflow job inventory/order');
  assert.equal(sha256(candidate.header), REVIEWED_TRANSITION.headerAfterSha256, 'unreviewed workflow header');
  assert.equal(REVIEWED_TRANSITION.blocks.filter(row => row.change === 'unchanged').length, 13);
  assert.equal(REVIEWED_TRANSITION.blocks.filter(row => row.change === 'modified').length, 6);
  assert.equal(REVIEWED_TRANSITION.blocks.filter(row => row.change === 'added').length, 2);
  for (const row of REVIEWED_TRANSITION.blocks) {
    if (row.beforeSha256 === null) {
      assert.equal(row.change, 'added');
      assert.equal(prior.blocks[row.name], undefined, 'added job existed in reviewed parent');
    } else assert.equal(sha256(prior.blocks[row.name]), row.beforeSha256, 'parent job changed: ' + row.name);
    assert.equal(typeof candidate.blocks[row.name], 'string', 'missing job: ' + row.name);
    if (row.change === 'unchanged') assert.equal(candidate.blocks[row.name], prior.blocks[row.name],
      'untouched workflow job changed: ' + row.name);
    assert.equal(sha256(candidate.blocks[row.name]), row.afterSha256, 'unreviewed job bytes: ' + row.name);
  }
  assert.equal(sha256(current), REVIEWED_TRANSITION.reviewedSha256, 'unreviewed complete workflow source');
  return 'REVIEWED_CORRECTNESS_V2';
}
function assertNativeTransition(current, source, parent, original) {
  assert.equal(assertReviewedTransition(source, parent, original), 'REVIEWED_CORRECTNESS_V2');
  assert.equal(sha256(source), NATIVE_TRANSITION.sourceSha256);
  assert.equal(NATIVE_TRANSITION.sourceSha256, REVIEWED_TRANSITION.reviewedSha256);
  const prior = workflowParts(source), candidate = workflowParts(current);
  const order = [...prior.order]; order.splice(order.indexOf('stocks-full-backend-offline'), 0, 'stocks-native-backend-admission');
  assert.equal(prior.order.length, 21); assert.deepEqual(candidate.order, order);
  assert.equal(sha256(prior.header), NATIVE_TRANSITION.headerBefore); assert.equal(sha256(candidate.header), NATIVE_TRANSITION.headerAfter);
  const trigger = "'scripts/qa-stocks*'"; assert.equal(prior.header.split(trigger).length, 2);
  assert.equal(candidate.header, prior.header.replace(trigger,
    trigger + ", 'scripts/stocks-browser-native/**', 'scripts/stocks-browser-native-*'"));
  const modified = new Set(NATIVE_TRANSITION.blocks.map(row => row[0]));
  const unchanged = prior.order.filter(name => !modified.has(name)); assert.equal(unchanged.length, 18);
  for (const name of unchanged) assert.equal(candidate.blocks[name], prior.blocks[name], 'unrelated job changed: ' + name);
  for (const [name, before, after] of NATIVE_TRANSITION.blocks) {
    if (before === null) assert.equal(prior.blocks[name], undefined);
    else assert.equal(sha256(prior.blocks[name]), before);
    assert.equal(sha256(candidate.blocks[name]), after, 'unreviewed native job: ' + name);
  }
  const backendBody = block => block.slice(block.indexOf('    runs-on:'));
  assert.equal(backendBody(candidate.blocks['stocks-full-backend-offline']), backendBody(prior.blocks['stocks-full-backend-offline']));
  assert.equal(sha256(current), NATIVE_TRANSITION.reviewedSha256);
  return 'REVIEWED_NATIVE_BROWSER_V1';
}
function assertFfmpegTransition(current, source, nativeSource, parent, original) {
  assert.equal(assertNativeTransition(source, nativeSource, parent, original), 'REVIEWED_NATIVE_BROWSER_V1');
  assert.equal(sha256(source), FFMPEG_TRANSITION.sourceSha256);
  const prior = workflowParts(source), candidate = workflowParts(current);
  assert.equal(prior.order.length, 22); assert.deepEqual(candidate.order, prior.order); assert.equal(candidate.header, prior.header);
  for (const name of prior.order.filter(name => name !== 'stocks-ui-browser')) assert.equal(candidate.blocks[name], prior.blocks[name], 'non-browser job changed: ' + name);
  const prefix = '/usr/lib/voltex-stocks-browser-b7726070ca707965e9a17b38e4f15ba283bf6f65c339626c092862af7b19badc';
  const anchor = '      QA_SOURCE_SHA: ${{ github.event.pull_request.head.sha || github.sha }}\n' +
    '      QA_PLAYWRIGHT_MODULE: ' + prefix + '/playwright/node_modules/playwright\n';
  assert.equal(prior.blocks['stocks-ui-browser'].split(anchor).length, 2);
  assert.equal(candidate.blocks['stocks-ui-browser'], prior.blocks['stocks-ui-browser'].replace(anchor, anchor + '      PLAYWRIGHT_BROWSERS_PATH: ' + prefix + '/browsers\n'));
  assert.equal(sha256(prior.blocks['stocks-ui-browser']), FFMPEG_TRANSITION.browserBefore);
  assert.equal(sha256(candidate.blocks['stocks-ui-browser']), FFMPEG_TRANSITION.browserAfter);
  assert.equal(sha256(current), FFMPEG_TRANSITION.reviewedSha256); return 'REVIEWED_NATIVE_FFMPEG_V1';
}
function assertTwoTraderTransition(current, source, ffmpegSource, nativeSource, parent, original) {
  assert.equal(assertFfmpegTransition(source, ffmpegSource, nativeSource, parent, original), 'REVIEWED_NATIVE_FFMPEG_V1');
  assert.equal(sha256(source), TWO_TRADER_TRANSITION.sourceSha256);
  const prior = workflowParts(source), candidate = workflowParts(current);
  assert.equal(prior.order.length, 22); assert.deepEqual(candidate.order, prior.order);
  for (const name of prior.order.filter(name => name !== 'isolated-simulator')) {
    assert.equal(candidate.blocks[name], prior.blocks[name], 'non-isolated job changed: ' + name);
  }
  const trigger = "'scripts/qa-stocks*', 'scripts/stocks-browser-native/**'";
  assert.equal(prior.header.split(trigger).length, 2, 'exactly one reviewed trigger anchor');
  assert.equal(candidate.header, prior.header.replace(trigger,
    "'scripts/qa-stocks*', 'scripts/stocks-two-trader-*', 'scripts/stocks-browser-native/**'"));
  assert.equal(sha256(prior.header), TWO_TRADER_TRANSITION.headerBefore);
  assert.equal(sha256(candidate.header), TWO_TRADER_TRANSITION.headerAfter);
  const before = '      - name: Local staging recovery guards\n' +
    '        run: node --test scripts/qa-stocks-local-stage.test.cjs\n';
  const after = '      - name: Local staging recovery guards\n' +
    '        run: node --test scripts/qa-stocks-local-stage.test.cjs scripts/qa-stocks-package-proof.test.cjs\n' +
    '      - name: Two trusted traders, market-only viewers and isolated fixture preview\n' +
    '        run: node --test services/stocks-global/account-existing-only.test.mjs services/stocks-global/two-trader-http.test.mjs services/stocks-global/two-trader-auth-lifetime.test.mjs scripts/stocks-two-trader-preview.test.mjs\n';
  assert.equal(prior.blocks['isolated-simulator'].split(before).length, 2, 'exactly one reviewed correctness step anchor');
  assert.equal(candidate.blocks['isolated-simulator'], prior.blocks['isolated-simulator'].replace(before, after));
  assert.equal(sha256(prior.blocks['isolated-simulator']), TWO_TRADER_TRANSITION.isolatedBefore);
  assert.equal(sha256(candidate.blocks['isolated-simulator']), TWO_TRADER_TRANSITION.isolatedAfter);
  assert.equal(sha256(current), TWO_TRADER_TRANSITION.reviewedSha256);
  return 'REVIEWED_TWO_TRADER_LOCAL_V1';
}
let frozenWorkflowInputs;
function frozenInputs() {
  if (!frozenWorkflowInputs) {
    const read = commit => execFileSync('git', ['show', commit + ':' + WORKFLOW_PATH], {
      cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 ** 2 }).replace(/\r\n/g, '\n');
    frozenWorkflowInputs = { parent: read(REVIEWED_TRANSITION.parentCommit), original: read(BASELINE_SHA), nativeSource: read(NATIVE_TRANSITION.sourceCommit), ffmpegSource: read(FFMPEG_TRANSITION.sourceCommit), twoTraderSource: read(TWO_TRADER_TRANSITION.sourceCommit) };
  }
  return frozenWorkflowInputs;
}
function checkTransition(candidate) {
  const { parent, original, nativeSource, ffmpegSource, twoTraderSource } = frozenInputs();
  return assertTwoTraderTransition(candidate, twoTraderSource, ffmpegSource, nativeSource, parent, original);
}
function changedBlock(name, transform) {
  const block = workflowParts(text).blocks[name];
  assert.equal(typeof block, 'string');
  const changed = transform(block);
  assert.notEqual(changed, block, 'negative control did not change ' + name);
  return text.replace(block, changed);
}

test('reviewed correctness transition retains whole historical provenance and exact 13 untouched jobs', () => {
  assert.ok(job);
  const { parent, original, nativeSource, ffmpegSource, twoTraderSource } = frozenInputs();
  assert.equal(assertReviewedTransition(parent, parent, original), 'ORIGINAL_PARENT');
  assert.equal(assertReviewedTransition(nativeSource, parent, original), 'REVIEWED_CORRECTNESS_V2');
  assert.equal(assertNativeTransition(ffmpegSource, nativeSource, parent, original), 'REVIEWED_NATIVE_BROWSER_V1');
  assert.equal(assertFfmpegTransition(twoTraderSource, ffmpegSource, nativeSource, parent, original), 'REVIEWED_NATIVE_FFMPEG_V1');
  assert.equal(checkTransition(text), 'REVIEWED_TWO_TRADER_LOCAL_V1');
});
test('recording transition binds the exact prior source and rejects alternate mutable cache paths', () => {
  const { parent, original, nativeSource, ffmpegSource, twoTraderSource } = frozenInputs();
  assert.throws(() => assertFfmpegTransition(twoTraderSource, ffmpegSource + '\n', nativeSource, parent, original));
  const line = text.match(/^      PLAYWRIGHT_BROWSERS_PATH: .+$/m)?.[0]; assert.ok(line);
  for (const replacement of ['', '      PLAYWRIGHT_BROWSERS_PATH: /tmp/ms-playwright', line + '\n' + line]) assert.throws(() => checkTransition(text.replace(line, replacement)));
});
test('native-only transition cannot mutate unrelated jobs, its exact source or reviewed scheduling', () => {
  const { parent, original, nativeSource, ffmpegSource } = frozenInputs();
  assert.throws(() => assertNativeTransition(ffmpegSource, nativeSource + '\n', parent, original));
  assert.throws(() => assertNativeTransition(ffmpegSource, ffmpegSource, parent, original));
  for (const name of workflowParts(text).order) assert.throws(() => checkTransition(changedBlock(name, block => block.replace(/\n$/, ' \n'))), undefined, name);
  for (const needle of ['inherited_db67', 'ubuntu-22.04', 'scripts/stocks-browser-native/**', 'timeout-minutes: 30']) {
    assert.ok(text.includes(needle)); assert.throws(() => checkTransition(text.replace(needle, needle + 'x')));
  }
});
test('two-trader transition permits only its reviewed trigger and additive correctness tests', () => {
  const { parent, original, nativeSource, ffmpegSource, twoTraderSource } = frozenInputs();
  assert.throws(() => assertTwoTraderTransition(text, twoTraderSource + '\n', ffmpegSource, nativeSource, parent, original));
  const trigger = "'scripts/stocks-two-trader-*'";
  assert.equal(text.split(trigger).length, 2);
  for (const replacement of ["'scripts/**'", "'scripts/stocks-two-trader-preview.mjs'", trigger + ', ' + trigger]) {
    assert.throws(() => checkTransition(text.replace(trigger, replacement)));
  }
  for (const omitted of [' scripts/qa-stocks-package-proof.test.cjs',
    ' services/stocks-global/account-existing-only.test.mjs',
    ' services/stocks-global/two-trader-http.test.mjs',
    ' services/stocks-global/two-trader-auth-lifetime.test.mjs',
    ' scripts/stocks-two-trader-preview.test.mjs']) {
    assert.throws(() => checkTransition(changedBlock('isolated-simulator', block => block.replace(omitted, ''))));
  }
  assert.throws(() => checkTransition(changedBlock('isolated-simulator', block => block.replace(
    '      - name: Two trusted traders, market-only viewers and isolated fixture preview\n',
    '      - name: Two trusted traders, market-only viewers and isolated fixture preview\n        continue-on-error: true\n'))));
});
test('one-byte mutations in every untouched workflow block are rejected', () => {
  for (const row of REVIEWED_TRANSITION.blocks.filter(row => row.change === 'unchanged')) {
    assert.throws(() => checkTransition(changedBlock(row.name, block => block.replace(/\n$/, ' \n'))),
      undefined, row.name);
  }
});
test('reviewed changed and added blocks do not permit any future unreviewed bytes', () => {
  for (const row of REVIEWED_TRANSITION.blocks.filter(row => row.change !== 'unchanged')) {
    assert.throws(() => checkTransition(changedBlock(row.name, block => block.replace(/\n$/, ' \n'))),
      undefined, row.name);
  }
});
test('unreviewed header or trigger changes are rejected', () => {
  assert.throws(() => checkTransition(text.replace('name: Stocks isolated review', 'name: Stocks isolated review changed')));
});
test('each original consumed finite-head pin remains immutable', () => {
  for (const [name, pin] of [
    ['stocks-auth-one-burst', '75e2453ed85c03d12114f2e29ba9acf0f6e6f31f'],
    ['stocks-auth-preparation', 'dc5327b7def5ac4f5b448f820bbd279b7072d7f9'],
    ['stocks-auth-http-paired', 'dc5327b7def5ac4f5b448f820bbd279b7072d7f9'],
  ]) {
    assert.throws(() => checkTransition(changedBlock(name,
      block => block.replace("head.sha == '" + pin + "'", "head.sha == '" + '0'.repeat(40) + "'"))), undefined, name);
  }
});
test('unexpected, removed, duplicated or reordered jobs are rejected', () => {
  const parts = workflowParts(text), first = parts.blocks[parts.order[0]], second = parts.blocks[parts.order[1]];
  for (const candidate of [
    text + '\n  unreviewed-job:\n    runs-on: ubuntu-latest\n',
    text.replace(first, ''), text.replace(first, first + first),
    text.replace(first + second, second + first),
  ]) {
    assert.notEqual(candidate, text);
    assert.throws(() => checkTransition(candidate));
  }
});

test('one-burst workflow retains serial preparation, source gates and a single explicit run', () => {
  const workflow = normalizedWorkflow(text);
  assert.match(workflow.declaredPolicySha256, /^[a-f0-9]{64}$/);
  assert.match(job, /needs: \[stocks-auth-preparation, stocks-auth-http-paired, stocks-backend-admission, isolated-simulator, frontend-regression, bounded-stock-runtime\]/);
  assert.match(job, /github\.event\.action == 'synchronize' && github\.run_attempt == 1/);
  assert.match(job, /group: stocks-one-burst-pr512\n      cancel-in-progress: false/);
  assert.equal((job.match(/launcher\.mjs --run /g) || []).length, 1);
  assert.equal((job.match(/launcher\.mjs --prepare /g) || []).length, 1);
  assert.match(job, /timeout-minutes: 40/);
  assert.ok(job.indexOf('validatePreparationSource') < job.indexOf('downloadArtifact'));
  assert.ok(job.indexOf('downloadArtifact') < job.indexOf('launcher.mjs --prepare'));
  assert.ok(job.indexOf('launcher.mjs --prepare') < job.indexOf('workflow-config.mjs run-config'));
  assert.ok(job.indexOf('workflow-config.mjs run-config') < job.indexOf('launcher.mjs --run'));
  assert.equal((job.match(/if: steps\.trace_source\.outputs\.eligible == 'true'/g) || []).length, 5);
  assert.ok(!/workflow_dispatch|continue-on-error|sudo |prisma |wrangler |ssh |pull_request_target/.test(job));
  assert.match(job, /permissions:\n      contents: read\n      actions: read/);
  assert.ok(!job.includes('...context, runAttempt'), 'GitHub Context repo is a prototype getter and must not be lost by spreading');
  assert.match(job, /repo: context\.repo/);
});

test('evidence upload excludes image archive, seed database and Docker configuration', () => {
  const upload = job.slice(job.indexOf('      - name: Preserve public diagnostic'));
  assert.match(upload, /if: always\(\)/);
  assert.ok(!/runtime-image\.tar|accounts\.sqlite|run-config\.json|prepare-config\.json|docker-config/.test(upload));
  assert.match(upload, /source-eligibility\.json/);
  assert.match(upload, /result\.json/);
  for (const file of ['driver-attempts.jsonl', 'driver-cgroups.jsonl', 'observer-*.json']) assert.ok(upload.includes(file));
});
test('actual workflow selected-member reader permits only the digest-bound empty build.log', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stocks-inline-log-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const body = job.match(/\.map\(p => \{\n([\s\S]*?)\n            \}\);/)?.[1];
  assert.ok(body, 'selected-member inline reader must remain covered');
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const read = new Function('p', 'stageDirectory', 'fs', 'path', 'assert', 'hash', body);
  fs.writeFileSync(path.join(dir, 'build.log'), '');
  assert.deepEqual(read('build.log', dir, fs, path, assert, hash), { path: 'build.log', bytes: 0,
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' });
  for (const name of ['report.json', 'build-provenance.json', 'compiled.js', 'nested/build.log']) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), '');
    assert.throws(() => read(name, dir, fs, path, assert, hash), undefined, name);
  }
});
