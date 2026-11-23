const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const G = require('../src/grupos.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-grupos-'));

test('arquivo ausente cria os grupos iniciais, na ordem, com id estável', () => {
  const caminho = path.join(tmp(), 'grupos.json');
  const lista = G.carregarGrupos(caminho);
  assert.deepEqual(lista.map((g) => g.nome), ['Pedidos', 'Vendas', 'Financeiro', 'Marketing', 'Impostos', 'Relatórios', 'Freelas', 'Geral']);
  assert.deepEqual(G.GRUPOS_INICIAIS, lista.map((g) => g.nome));
  for (const g of lista) assert.match(g.id, /^[a-z0-9]{8}$/);
  assert.deepEqual(G.carregarGrupos(caminho), lista, 'segunda leitura devolve os mesmos ids');
});

test('arquivo corrompido volta aos padrões e guarda o estragado', () => {
  const d = tmp();
  const caminho = path.join(d, 'grupos.json');
  fs.writeFileSync(caminho, '[{"id":"a1","nome":');
  const lista = G.carregarGrupos(caminho);
  assert.equal(lista.length, G.GRUPOS_INICIAIS.length);
  assert.equal(fs.readdirSync(d).filter((n) => n.startsWith('grupos.json.corrompido-')).length, 1);
});

test('entradas mal formadas são descartadas; lista toda ruim vira padrões', () => {
  const d = tmp();
  const caminho = path.join(d, 'grupos.json');
  fs.writeFileSync(caminho, JSON.stringify([{ id: 'abc12345', nome: 'Um' }, null, { id: 'x' }, { nome: 'Sem id' }]));
  assert.deepEqual(G.carregarGrupos(caminho), [{ id: 'abc12345', nome: 'Um', descricao: '' }]);
  fs.writeFileSync(caminho, '{"a":1}');
  assert.equal(G.carregarGrupos(caminho).length, G.GRUPOS_INICIAIS.length);
});

test('salvar e carregar, sem sobras de temporário', () => {
  const d = tmp();
  const caminho = path.join(d, 'sub', 'grupos.json');
  const lista = [{ id: 'aaaa1111', nome: 'Café', descricao: 'Bebidas' }];
  G.salvarGrupos(caminho, lista);
  assert.deepEqual(G.carregarGrupos(caminho), lista);
  assert.deepEqual(fs.readdirSync(path.dirname(caminho)), ['grupos.json']);
});

test('criar, renomear e apagar', () => {
  let lista = [{ id: 'aaaa1111', nome: 'Pedidos' }];
  const r = G.criarGrupo(lista, '  Novo  ');
  assert.equal(r.grupo.nome, 'Novo');
  assert.match(r.grupo.id, /^[a-z0-9]{8}$/);
  assert.equal(r.lista.length, 2);
  assert.equal(lista.length, 1, 'não muda a lista original');
  lista = G.renomearGrupo(r.lista, r.grupo.id, 'Outro');
  assert.equal(lista[1].nome, 'Outro');
  assert.equal(lista[1].id, r.grupo.id);
  assert.deepEqual(G.apagarGrupo(lista, r.grupo.id), [{ id: 'aaaa1111', nome: 'Pedidos' }]);
});

test('nomes inválidos: vazio, 41 caracteres, duplicado sem diferenciar caixa', () => {
  const lista = [{ id: 'aaaa1111', nome: 'Pedidos' }, { id: 'bbbb2222', nome: 'Vendas' }];
  for (const ruim of ['', '   ', 'pedidos', ' PEDIDOS ', 'x'.repeat(41), 7, null]) {
    assert.throws(() => G.criarGrupo(lista, ruim), /nome inválido/, String(ruim));
  }
  assert.equal(G.criarGrupo(lista, 'x'.repeat(40)).grupo.nome.length, 40);
  assert.throws(() => G.renomearGrupo(lista, 'bbbb2222', 'pedidos'), /nome inválido/);
  assert.throws(() => G.renomearGrupo(lista, 'bbbb2222', ''), /nome inválido/);
  // renomear para o mesmo nome (só a caixa) do próprio grupo é permitido
  assert.equal(G.renomearGrupo(lista, 'bbbb2222', 'FOCO')[1].nome, 'FOCO');
});

test('lista vazia salva é estado legítimo (apagou todos os grupos): não volta aos padrões', () => {
  const d = tmp();
  const caminho = path.join(d, 'grupos.json');
  G.salvarGrupos(caminho, []);
  assert.deepEqual(G.carregarGrupos(caminho), []);
  assert.deepEqual(JSON.parse(fs.readFileSync(caminho, 'utf8')), [], 'o arquivo continua vazio');
  assert.deepEqual(fs.readdirSync(d), ['grupos.json'], 'nada guardado como corrompido');
});

test('descrição: padrões dos iniciais, criar com descrição, descrever e limite de 200', () => {
  const d = tmp();
  const ini = G.carregarGrupos(path.join(d, 'g.json'));
  assert.equal(ini.find((g) => g.nome === 'Relatórios').descricao, 'Relatórios gerenciais da empresa');
  assert.ok(ini.every((g) => g.descricao !== ''));
  const lista = [{ id: 'aaaa1111', nome: 'Pedidos', descricao: '' }];
  assert.equal(G.criarGrupo(lista, 'Novo').grupo.descricao, '');
  assert.equal(G.criarGrupo(lista, 'Novo', ' algo ').grupo.descricao, 'algo');
  assert.equal(G.descreverGrupo(lista, 'aaaa1111', 'x'.repeat(200))[0].descricao.length, 200);
  assert.throws(() => G.descreverGrupo(lista, 'aaaa1111', 'x'.repeat(201)), /descrição inválida/);
  assert.throws(() => G.criarGrupo(lista, 'Novo', 5), /descrição inválida/);
});

test('o nome "nenhum" é reservado, sem diferenciar caixa', () => {
  const lista = [{ id: 'aaaa1111', nome: 'Pedidos', descricao: '' }];
  for (const n of ['nenhum', 'Nenhum', ' NENHUM ']) assert.throws(() => G.criarGrupo(lista, n), /nome inválido/, n);
  assert.throws(() => G.renomearGrupo(lista, 'aaaa1111', 'Nenhum'), /nome inválido/);
});
