import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// Only the ONE existing Render review branch selects the isolated build.
// Production keeps the same tsc -b && vite build sequence and env handling.
const [command, ...args] = process.argv.slice(2);
const review = command === 'build-review' || (command === 'build' && process.env.RENDER_GIT_BRANCH === 'claude/review-ready');
function run(file, params) {
  const result = spawnSync(process.execPath, [file, ...params], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (command === 'build' || command === 'build-review') {
  run('node_modules/typescript/bin/tsc', ['-b']);
  run('node_modules/vite/bin/vite.js', ['build', ...(review ? ['--mode', 'review', '--config', 'vite.review.config.ts'] : [])]);
} else if (command === 'preview') {
  run('node_modules/vite/bin/vite.js', ['preview', ...(existsSync('dist/review-build.json') ? ['--config', 'vite.review.config.ts'] : []), ...args]);
} else {
  throw new Error('Expected build, build-review or preview');
}
