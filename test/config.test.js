const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { carregarConfig, salvarConfig, tamanhoFonteValido } = require('../src/config.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-config-'));

test('arquivo ausente: classificar ligado por padrão', () => {
  assert.deepEqual(carregarConfig(path.join(tmp(), 'config.json')), { classificar: true, tamanhoFonte: 13 });
});

test('salvar e carregar', () => {
  const caminho = path.join(tmp(), 'config.json');
  salvarConfig(caminho, { classificar: false, tamanhoFonte: 13 });
  assert.deepEqual(carregarConfig(caminho), { classificar: false, tamanhoFonte: 13 });
});

test('corrompido ou com tipo errado volta ao padrão, guardando o estragado', () => {
  const d = tmp();
  const caminho = path.join(d, 'config.json');
  fs.writeFileSync(caminho, '{quebrado');
  assert.deepEqual(carregarConfig(caminho), { classificar: true, tamanhoFonte: 13 });
  assert.equal(fs.readdirSync(d).filter((n) => n.startsWith('config.json.corrompido-')).length, 1);
  fs.writeFileSync(caminho, '{"classificar":"nao"}');
  assert.deepEqual(carregarConfig(caminho), { classificar: true, tamanhoFonte: 13 });
});

test('tamanhoFonte: padrão 13, salvo e carregado de 10 a 24', () => {
  const caminho = path.join(tmp(), 'config.json');
  fs.writeFileSync(caminho, '{"classificar":false}');
  assert.equal(carregarConfig(caminho).tamanhoFonte, 13, 'config antiga sem o campo');
  for (const n of [10, 17, 24]) {
    salvarConfig(caminho, { classificar: true, tamanhoFonte: n });
    assert.deepEqual(carregarConfig(caminho), { classificar: true, tamanhoFonte: n });
  }
});

test('tamanhoFonte inválido volta a 13 ao carregar e ao salvar', () => {
  const caminho = path.join(tmp(), 'config.json');
  for (const ruim of [9, 25, 13.5, '14', null, NaN, 0, -13, true]) {
    fs.writeFileSync(caminho, JSON.stringify({ classificar: true, tamanhoFonte: ruim }));
    assert.equal(carregarConfig(caminho).tamanhoFonte, 13, String(ruim));
    salvarConfig(caminho, { classificar: true, tamanhoFonte: ruim });
    assert.equal(carregarConfig(caminho).tamanhoFonte, 13, String(ruim));
    assert.equal(tamanhoFonteValido(ruim), false, String(ruim));
  }
  assert.equal(tamanhoFonteValido(10) && tamanhoFonteValido(24), true);
});
