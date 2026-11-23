const test = require('node:test');
const assert = require('node:assert');
const { PALETA } = require('../src/projetos');

test('PALETA tem 8 cores hex distintas', () => {
  assert.strictEqual(PALETA.length, 8);
  assert.strictEqual(new Set(PALETA).size, 8);
  for (const c of PALETA) assert.match(c, /^#[0-9a-f]{6}$/);
});
