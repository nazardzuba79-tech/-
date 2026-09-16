#!/usr/bin/env node
/**
 * Compatibility runner for the original native Futures browser QA.
 *
 * The product now has a real Cross / Isolated choice, while the older QA
 * still assumed every owner session was pinned to Cross and tried to open
 * chart tools by desktop double-click even at the 390px touch viewport.
 * Keep the original suite intact and apply only those two expectation/input
 * updates at runtime so all of its existing coverage continues to run.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const sourcePath = path.join(__dirname, 'qa-native-demo-browser.cjs');
const tempPath = path.join(__dirname, `.qa-native-demo-browser-current-${process.pid}.cjs`);
let source = fs.readFileSync(sourcePath, 'utf8');

const oldMode = "  assert(/(?:Cross|Кросс)/i.test(g.mode || ''), 'Owner margin mode is not Cross: ' + JSON.stringify(g));";
const newMode = "  assert(/(?:Cross|Кросс|Isolated|Изолированная)/i.test(g.mode || ''), 'Owner margin mode is neither Cross nor Isolated: ' + JSON.stringify(g));";
if (!source.includes(oldMode)) throw new Error('Native QA margin-mode assertion changed; update compatibility runner deliberately.');
source = source.replace(oldMode, newMode);

const oldMenu = "  const menu = p.locator('.chart-tools-menu');\n";
const newMenu = "  const menu = p.locator('.chart-tools-menu');\n  // Touch/mobile uses the product's compact chart-tools trigger; desktop\n  // keeps exercising the documented double-click gesture below.\n  const touchTrigger = p.locator('.chart-tools-trigger');\n  if (await touchTrigger.isVisible().catch(() => false)) {\n    await touchTrigger.click();\n    await menu.waitFor();\n    return;\n  }\n";
if (!source.includes(oldMenu)) throw new Error('Native QA chart-menu helper changed; update compatibility runner deliberately.');
source = source.replace(oldMenu, newMenu);

try {
  fs.writeFileSync(tempPath, source);
  const run = spawnSync(process.execPath, [tempPath], { stdio: 'inherit', env: process.env });
  if (run.error) throw run.error;
  process.exitCode = run.status ?? 1;
} finally {
  fs.rmSync(tempPath, { force: true });
}
