const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const F = require('../src/fechadas.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-fechadas-'));
const uuid = (n) => `5f0c8a2e-1b3d-4c5e-8f9a-${String(n).padStart(12, '0')}`;
const sessao = (n, extra = {}) => ({
  id: `s${n}aaaaaa`.slice(0, 8), pasta: '/x', criadoEm: n, claudeSessionId: uuid(n),
  nome: null, titulo: null, cor: '#111111', grupoId: null, grupoManual: false, classificada: 0, ...extra,
});

test('registra a sessão inteira mais fechadaEm, a mais nova primeiro', () => {
  let lista = F.registrarFechada([], sessao(1), 100);
  lista = F.registrarFechada(lista, sessao(2), 200);
  assert.deepEqual(lista[0], { ...sessao(2), fechadaEm: 200 });
  assert.equal(lista[1].fechadaEm, 100);
});

test('11 entradas mantêm 10 (some a mais antiga)', () => {
  let lista = [];
  for (let n = 1; n <= 11; n++) lista = F.registrarFechada(lista, sessao(n), n);
  assert.equal(lista.length, 10);
  assert.equal(lista[0].claudeSessionId, uuid(11));
  assert.equal(lista.at(-1).claudeSessionId, uuid(2));
});

test('sem UUID válido é ignorada', () => {
  for (const ruim of [null, '', 'abc-123', '--help']) {
    assert.deepEqual(F.registrarFechada([], sessao(1, { claudeSessionId: ruim }), 1), []);
  }
});

test('mesma conversa registrada de novo não duplica e sobe ao topo', () => {
  let lista = F.registrarFechada([], sessao(1), 1);
  lista = F.registrarFechada(lista, sessao(2), 2);
  lista = F.registrarFechada(lista, sessao(1, { nome: 'Nova' }), 3);
  assert.equal(lista.length, 2);
  assert.equal(lista[0].nome, 'Nova');
  assert.equal(lista[0].fechadaEm, 3);
});

test('retirarFechada devolve a sessão sem fechadaEm e a lista sem ela', () => {
  const lista = F.registrarFechada(F.registrarFechada([], sessao(1), 1), sessao(2), 2);
  const r = F.retirarFechada(lista, sessao(1).id);
  assert.deepEqual(r.sessao, sessao(1));
  assert.equal(r.lista.length, 1);
  const nada = F.retirarFechada(lista, 'naoexiste');
  assert.equal(nada.sessao, null);
  assert.equal(nada.lista.length, 2);
});

test('limparGrupoInexistente zera o grupo apagado e mantém o existente', () => {
  const grupos = [{ id: 'g1', nome: 'A' }];
  assert.equal(F.limparGrupoInexistente(sessao(1, { grupoId: 'g2' }), grupos).grupoId, null);
  assert.equal(F.limparGrupoInexistente(sessao(1, { grupoId: 'g1' }), grupos).grupoId, 'g1');
  assert.equal(F.limparGrupoInexistente(sessao(1), grupos).grupoId, null);
});

test('salvar e carregar; ausente vira vazio; corrompido é guardado', () => {
  const d = tmp();
  const caminho = path.join(d, 'fechadas.json');
  assert.deepEqual(F.carregarFechadas(caminho), []);
  const lista = F.registrarFechada([], sessao(1), 1);
  F.salvarFechadas(caminho, lista);
  assert.deepEqual(F.carregarFechadas(caminho), lista);
  fs.writeFileSync(caminho, '[{quebrado');
  assert.deepEqual(F.carregarFechadas(caminho), []);
  assert.equal(fs.readdirSync(d).filter((n) => n.startsWith('fechadas.json.corrompido-')).length, 1);
});
