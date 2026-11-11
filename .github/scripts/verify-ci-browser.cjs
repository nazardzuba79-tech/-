'use strict';

// CI tooling only. Browser launch must succeed before any acceptance test runs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

async function main() {
  const [modulePath, expectedVersion, mode] = process.argv.slice(2);
  assert(modulePath && expectedVersion, 'Expected Playwright module path and pinned version');
  assert(['preinstalled', 'download'].includes(mode), 'Unknown browser provisioning mode');
  const directory = path.resolve(modulePath);
  const installedVersion = require(path.join(directory, 'package.json')).version;
  assert.equal(installedVersion, expectedVersion, 'Playwright package/image version mismatch');

  if (mode === 'download') {
    // PostgreSQL jobs retain the hosted runner and its native database tools.
    // Its Chromium system libraries are verified by the launch below, without apt.
    execFileSync(process.execPath, [path.join(directory, 'cli.js'), 'install', 'chromium'], {
      stdio: 'inherit',
      timeout: 180000,
    });
  }

  const { chromium } = require(directory);
  assert(fs.existsSync(chromium.executablePath()), 'Pinned Chromium executable is missing');
  const browser = await chromium.launch({ headless: true, timeout: 30000 });
  try {
    const page = await browser.newPage();
    await page.setContent('<main>VOLTEX CI browser ready</main>');
    assert.equal(await page.locator('main').innerText(), 'VOLTEX CI browser ready');
    console.log(JSON.stringify({
      playwright: installedVersion,
      chromium: browser.version(),
      mode,
      executable: chromium.executablePath(),
      launchAndRender: 'PASS',
    }));
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
