const fs = require('node:fs');
const path = require('node:path');
fs.copyFileSync(
  require.resolve('sql.js/dist/sql-wasm.wasm'),
  path.join(process.cwd(), 'dist-electron', 'sql-wasm.wasm')
);
