const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { novaSessao, comandoClaude, salvarLista, carregarLista } = require('../src/sessoes.js');
const { PALETA } = require('../src/projetos.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-sessoes-'));

test('sessão nova: pasta, id seguro, sem nome nem título, cor da paleta', () => {
  const s = novaSessao([], os.homedir(), 1000, PALETA);
  assert.equal(s.pasta, os.homedir());
  assert.equal(s.criadoEm, 1000);
  assert.equal(s.claudeSessionId, null);
  assert.equal(s.nome, null);
  assert.equal(s.titulo, null);
  assert.equal(s.cor, PALETA[0]);
  assert.match(s.id, /^[a-z0-9]{8}$/);
});

test('cor é a menos usada entre as abertas, desempate pela ordem da paleta', () => {
  const lista = [{ cor: PALETA[0] }, { cor: PALETA[2] }, { cor: PALETA[1] }];
  assert.equal(novaSessao(lista, '/x', 1, PALETA).cor, PALETA[3]);
  const cheia = PALETA.map((cor) => ({ cor }));
  cheia.push({ cor: PALETA[0] }, { cor: PALETA[2] });
  assert.equal(novaSessao(cheia, '/x', 1, PALETA).cor, PALETA[1]);
});

test('comandoClaude fresco e com retomada', () => {
  const s = novaSessao([], '/x', 1, PALETA);
  assert.deepEqual(comandoClaude(s), ['claude']);
  const uuid = '5f0c8a2e-1b3d-4c5e-8f9a-0b1c2d3e4f5a';
  assert.deepEqual(comandoClaude({ ...s, claudeSessionId: uuid }), ['claude', '--resume', uuid]);
});

test('comandoClaude só retoma com id no formato UUID', () => {
  for (const ruim of ['abc-123', '--help', '5f0c8a2e-1b3d-4c5e-8f9a-0b1c2d3e4f5a; rm', '', 'x'.repeat(36)]) {
    assert.deepEqual(comandoClaude({ claudeSessionId: ruim }), ['claude'], ruim);
  }
  assert.deepEqual(comandoClaude({ claudeSessionId: '5F0C8A2E-1B3D-4C5E-8F9A-0B1C2D3E4F5A' })[1], '--resume');
});

test('salvarLista grava por arquivo temporário e troca de uma vez (sem sobras)', () => {
  const d = tmp();
  const caminho = path.join(d, 'sessoes.json');
  fs.writeFileSync(caminho, '[]');
  const ino = fs.statSync(caminho).ino;
  salvarLista(caminho, [novaSessao([], '/x', 1, PALETA)]);
  assert.notEqual(fs.statSync(caminho).ino, ino, 'arquivo novo trocado por rename');
  assert.equal(carregarLista(caminho).length, 1);
  assert.deepEqual(fs.readdirSync(d), ['sessoes.json']);
});

test('JSON quebrado é guardado como .corrompido-<data> antes de qualquer gravação', () => {
  const d = tmp();
  const caminho = path.join(d, 'sessoes.json');
  fs.writeFileSync(caminho, '[{"id":"aaaa1111","pasta":"/x"');
  assert.deepEqual(carregarLista(caminho), []);
  const guardados = fs.readdirSync(d).filter((n) => n.startsWith('sessoes.json.corrompido-'));
  assert.equal(guardados.length, 1);
  assert.equal(fs.readFileSync(path.join(d, guardados[0]), 'utf8'), '[{"id":"aaaa1111","pasta":"/x"');
  assert.equal(fs.existsSync(caminho), false);
  salvarLista(caminho, []);
  assert.equal(fs.readdirSync(d).filter((n) => n.startsWith('sessoes.json.corrompido-')).length, 1);
});

test('salvar e carregar com pasta acentuada, nome e título', () => {
  const caminho = path.join(tmp(), 'sub', 'sessoes.json');
  const pasta = path.join(os.homedir(), 'Documents', 'Notas');
  const a = { ...novaSessao([], pasta, 5, PALETA), claudeSessionId: 'u-1', nome: 'Notas', titulo: 'Resumo da call' };
  const lista = [a, novaSessao([a], '/a b/Café', 6, PALETA)];
  salvarLista(caminho, lista);
  assert.deepEqual(carregarLista(caminho), lista);
});

test('sessão antiga (sem nome, título e cor) ganha os campos e uma cor livre', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 's.json'), JSON.stringify([
    { id: 'aaaa1111', pasta: '/x/a', criadoEm: 1, claudeSessionId: null, numero: 1 },
    { id: 'bbbb2222', pasta: '/x/b', criadoEm: 2, claudeSessionId: 'u-b', numero: 2, cor: PALETA[0] },
    { id: 'cccc3333', pasta: '/x/c', criadoEm: 3, cor: '#123456', nome: 7, titulo: '' },
  ]));
  const [a, b, c] = carregarLista(path.join(d, 's.json'));
  assert.deepEqual(a, { id: 'aaaa1111', pasta: '/x/a', criadoEm: 1, claudeSessionId: null, nome: null, titulo: null, cor: PALETA[1], grupoId: null, grupoManual: false, classificada: 0 });
  assert.equal(b.cor, PALETA[0]);
  assert.equal(b.claudeSessionId, 'u-b');
  assert.equal(c.cor, PALETA[2]); // cor fora da paleta não vale
  assert.equal(c.nome, null);
  assert.equal(c.titulo, null);
});

test('sessão nova nasce sem grupo, automática e não classificada', () => {
  const s = novaSessao([], '/x', 1, PALETA);
  assert.equal(s.grupoId, null);
  assert.equal(s.grupoManual, false);
  assert.equal(s.classificada, 0);
});

test('campos de grupo salvos são lidos; valores estranhos viram o padrão', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 's.json'), JSON.stringify([
    { id: 'aaaa1111', pasta: '/x', grupoId: 'g1', grupoManual: true, classificada: 2 },
    { id: 'bbbb2222', pasta: '/y', grupoId: 5, grupoManual: 'sim', classificada: 9 },
  ]));
  const [a, b] = carregarLista(path.join(d, 's.json'));
  assert.deepEqual([a.grupoId, a.grupoManual, a.classificada], ['g1', true, 2]);
  assert.deepEqual([b.grupoId, b.grupoManual, b.classificada], [null, false, 0]);
});

test('arquivo ausente ou JSON quebrado vira lista vazia', () => {
  const d = tmp();
  assert.deepEqual(carregarLista(path.join(d, 'nao.json')), []);
  fs.writeFileSync(path.join(d, 'q.json'), '{quebrado');
  assert.deepEqual(carregarLista(path.join(d, 'q.json')), []);
  fs.writeFileSync(path.join(d, 'o.json'), '{"a":1}');
  assert.deepEqual(carregarLista(path.join(d, 'o.json')), []);
});

test('descarta entradas mal formadas', () => {
  const d = tmp();
  const boa = novaSessao([], '/x', 1, PALETA);
  fs.writeFileSync(path.join(d, 's.json'), JSON.stringify([boa, null, 3, { pasta: '/y' }, { id: 'a1' }, { id: '../x', pasta: '/z' }]));
  assert.deepEqual(carregarLista(path.join(d, 's.json')), [boa]);
});
