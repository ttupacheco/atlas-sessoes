const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { estaLigado, ligar, desligar, vozAtual } = require('../src/jarvis.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-jarvis-'));

test('sem arquivo: desligado', () => {
  assert.equal(estaLigado(tmp()), false);
  assert.equal(estaLigado(path.join(tmp(), 'nao-existe')), false);
});

test('ligar cria o arquivo vazio, inclusive com a pasta ausente', () => {
  const pasta = path.join(tmp(), 'jarvis');
  ligar(pasta);
  assert.equal(estaLigado(pasta), true);
  assert.equal(fs.readFileSync(path.join(pasta, 'ligado'), 'utf8'), '');
  ligar(pasta);
  assert.equal(estaLigado(pasta), true);
});

test('desligar apaga o arquivo e chama matarSay uma vez', () => {
  const pasta = tmp();
  ligar(pasta);
  let chamadas = 0;
  desligar(pasta, () => { chamadas++; });
  assert.equal(estaLigado(pasta), false);
  assert.equal(chamadas, 1);
});

test('desligar já desligado não falha; erro do matarSay é ignorado', () => {
  const pasta = tmp();
  assert.doesNotThrow(() => desligar(pasta, () => { throw new Error('sem say'); }));
  assert.equal(estaLigado(pasta), false);
  assert.doesNotThrow(() => desligar(pasta));
});

test('vozAtual lê o nome, ou null', () => {
  const pasta = tmp();
  assert.equal(vozAtual(pasta), null);
  fs.writeFileSync(path.join(pasta, 'voz'), 'Luciana\n');
  assert.equal(vozAtual(pasta), 'Luciana');
  fs.writeFileSync(path.join(pasta, 'voz'), '  \n');
  assert.equal(vozAtual(pasta), null);
});
