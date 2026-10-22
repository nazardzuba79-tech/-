// Test-only build. No production flag, route or entrypoint imports this fixture.
import { fileURLToPath } from 'node:url';
import { mergeConfig } from 'vite';
import config from './vite.config';

// Match the ordinary frontend build's cwd for PostCSS/Tailwind content paths.
process.chdir(fileURLToPath(new URL('.', import.meta.url)));

export default mergeConfig(config, {
  plugins: [{
    name: 'otc-legacy-fixture-only', enforce: 'pre',
    resolveId(source: string, importer?: string) {
      if (source === './pages/OtcPage' && importer?.replaceAll('\\', '/').endsWith('/src/App.tsx')) {
        return fileURLToPath(new URL('./src/pages/otc/__fixtures__/LegacyOtcPage.tsx', import.meta.url));
      }
    },
  }],
  build: { outDir: 'dist-otc-legacy' },
});
