'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('../apps/mobile/node_modules/@babel/parser');
const root = path.resolve(__dirname, '..');
const excluded = new Set(['node_modules', '.git', '.gradle', 'build', 'Pods', 'coverage', '.verification', '.qa']);
let parsed = 0;
function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(target);
    else if (entry.name.endsWith('.js')) {
      parse(fs.readFileSync(target, 'utf8'), { sourceType: 'unambiguous', plugins: ['jsx'] });
      parsed += 1;
    }
  }
}
visit(root);
process.stdout.write(`Parsed ${parsed} JavaScript files successfully. Native compilation is a separate check.\n`);
