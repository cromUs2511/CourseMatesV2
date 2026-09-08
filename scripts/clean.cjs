const fs = require('node:fs');
const path = require('node:path');
for (const name of ['dist', 'server.js']) {
  const target = path.resolve(__dirname, '..', name);
  if (path.dirname(target) !== path.resolve(__dirname, '..')) throw new Error('Invalid cleanup path');
  fs.rmSync(target, { recursive: true, force: true });
}
