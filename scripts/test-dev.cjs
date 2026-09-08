const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(process.execPath, [path.resolve('node_modules/@playwright/test/cli.js'), 'test'], { stdio: 'inherit', env: { ...process.env, TEST_DEV: 'true' } });
process.exit(result.status ?? 1);
