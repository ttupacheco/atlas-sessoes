const test = require('node:test');
const assert = require('node:assert/strict');
const { precisaConfirmarFechar, modeloMenuCartao, modeloMenuApp, bolinha, NOMES_CORES, tempoRelativo } = require('../src/menus.js');
const { PALETA } = require('../src/projetos.js');

const cartao = (cor, extra = {}) => ({ id: 'abc', pasta: '/p/x', cor: '#7f9bb5', estado: { cor }, ...extra });

test('fechar pede confirmação só se não estiver verde ou preto', () => {
  assert.equal(precisaConfirmarFechar(cartao('verde')), false);
  assert.equal(precisaConfirmarFechar(cartao('preto')), false);
  for (const cor of ['amarelo', 'vermelho', 'cinza']) assert.equal(precisaConfirmarFechar(cartao(cor)), true, cor);
});

test('sessão abrindo ou esperando confirmar a pasta fecha direto (o claude nem carregou)', () => {
  assert.equal(precisaConfirmarFechar({ estado: { cor: 'cinza', rotulo: 'abrindo' } }), false);
  assert.equal(precisaConfirmarFechar({ estado: { cor: 'vermelho', rotulo: 'confirme a pasta' } }), false);
  assert.equal(precisaConfirmarFechar({ estado: { cor: 'cinza', rotulo: 'sem sinal' } }), true);
});

function acoes() {
  const feitas = [];
  return {
    feitas,
    trocarCor: (id, cor) => feitas.push(['cor', id, cor]),
    renomear: (id) => feitas.push(['renomear', id]),
    retomar: (id) => feitas.push(['retomar', id]),
    recomecar: (id) => feitas.push(['recomecar', id]),
    fechar: (id) => feitas.push(['fechar', id]),
  };
}

test('menu do cartão: renomear, trocar cor, fechar; retomar só se preto', () => {
  const a = acoes();
  const vivo = modeloMenuCartao(cartao('amarelo'), { paleta: PALETA, ...a });
  assert.deepEqual(vivo.map((i) => i.label || i.type), ['Renomear', 'Trocar cor', 'separator', 'Fechar sessão']);
  const morto = modeloMenuCartao(cartao('preto'), { paleta: PALETA, ...a });
  assert.deepEqual(morto.map((i) => i.label || i.type), ['Renomear', 'Trocar cor', 'Retomar', 'separator', 'Fechar sessão']);
  morto[0].click();
  morto[2].click();
  morto[4].click();
  assert.deepEqual(a.feitas, [['renomear', 'abc'], ['retomar', 'abc'], ['fechar', 'abc']]);
});

test('menu do cartão: conversa que não abriu oferece começar uma nova (M3)', () => {
  const a = acoes();
  const morto = modeloMenuCartao(cartao('preto', { podeRecomecar: true }), { paleta: PALETA, ...a });
  assert.deepEqual(morto.map((i) => i.label || i.type), ['Renomear', 'Trocar cor', 'Retomar', 'Começar conversa nova', 'separator', 'Fechar sessão']);
  morto[3].click();
  assert.deepEqual(a.feitas, [['recomecar', 'abc']]);
});

test('menu do cartão: paleta com nome, marca a cor atual e troca a da sessão', () => {
  const a = acoes();
  const [, cores] = modeloMenuCartao(cartao('verde', { cor: '#6FA597' }), { paleta: PALETA, ...a });
  assert.equal(cores.submenu.length, PALETA.length);
  assert.ok(cores.submenu.every((i) => NOMES_CORES[PALETA[cores.submenu.indexOf(i)]] === i.label));
  assert.deepEqual(cores.submenu.filter((i) => i.checked).map((i) => i.label), ['Verde-água']);
  cores.submenu[0].click();
  assert.deepEqual(a.feitas, [['cor', 'abc', PALETA[0]]]);
});

test('menu do app: sem ⌘W, ⌘T, ⌘R nem ⌘1 a ⌘9 (ficam com a tela); só ⌘⇧T, ⌘, ⌘⇧E e o texto (⌘+ ⌘= ⌘− ⌘0)', () => {
  const teclas = [];
  const varrer = (itens) => itens.forEach((i) => {
    if (i.accelerator) teclas.push(i.accelerator);
    if (Array.isArray(i.submenu)) varrer(i.submenu);
  });
  const modelo = modeloMenuApp('Atlas');
  varrer(modelo);
  const papeis = JSON.stringify(modelo);
  for (const proibido of ['close', 'reload', 'forceReload', 'toggleDevTools']) assert.ok(!papeis.includes(`"${proibido}"`), proibido);
  const editar = modelo.find((m) => m.label === 'Editar').submenu.map((i) => i.role).filter(Boolean);
  assert.deepEqual(editar, ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'], '⌘Z, ⌘X, ⌘C, ⌘V e ⌘A no campo do nome');
  assert.deepEqual(teclas.sort(), ['CmdOrCtrl+,', 'CmdOrCtrl+D', 'CmdOrCtrl+Shift+E', 'CmdOrCtrl+Shift+T', 'CmdOrCtrl+Plus', 'CmdOrCtrl+=', 'CmdOrCtrl+-', 'CmdOrCtrl+0'].sort());
  assert.ok(!papeis.includes('zoomIn') && !papeis.includes('zoomOut') && !papeis.includes('resetZoom'), 'sem os papéis de zoom do Electron');
});

const item = (modelo, menu, label) => modelo.find((m) => m.label === menu).submenu.find((i) => i.label === label);

test('menu do app: ⌘⇧T reabre, ⌘, abre Configurações e ⌘⇧E as Estatísticas', () => {
  const feitas = [];
  const modelo = modeloMenuApp('Atlas', {
    fechadas: [{ id: 'aaaa1111', nome: 'Etiqueta', fechadaEm: 1000 }],
    agora: 1000 + 5 * 60000,
    reabrir: (id) => feitas.push(['reabrir', id]),
    abrirConfiguracoes: () => feitas.push(['config']),
    abrirEstatisticas: () => feitas.push(['estat']),
  });
  const reabrir = item(modelo, 'Arquivo', 'Reabrir sessão fechada');
  assert.equal(reabrir.accelerator, 'CmdOrCtrl+Shift+T');
  assert.notEqual(reabrir.enabled, false);
  reabrir.click();
  const config = item(modelo, 'Atlas', 'Configurações…');
  assert.equal(config.accelerator, 'CmdOrCtrl+,');
  config.click();
  const estat = item(modelo, 'Janela', 'Estatísticas');
  assert.equal(estat.accelerator, 'CmdOrCtrl+Shift+E');
  estat.click();
  const recentes = item(modelo, 'Arquivo', 'Fechadas recentemente').submenu;
  assert.deepEqual(recentes.map((i) => i.label), ['Etiqueta · há 5 min']);
  recentes[0].click();
  assert.deepEqual(feitas, [['reabrir', undefined], ['config'], ['estat'], ['reabrir', 'aaaa1111']]);
  for (const t of JSON.stringify(modelo).match(/"label":"[^"]*"/g)) assert.ok(!/[\u2013\u2014]/.test(t), t);
});

test('menu do app sem fechadas: "Nenhuma" desativado e reabrir desativado', () => {
  const modelo = modeloMenuApp('Atlas', { fechadas: [] });
  assert.deepEqual(item(modelo, 'Arquivo', 'Fechadas recentemente').submenu, [{ label: 'Nenhuma', enabled: false }]);
  assert.equal(item(modelo, 'Arquivo', 'Reabrir sessão fechada').enabled, false);
});

test('tempo relativo das fechadas', () => {
  const m = 60000;
  assert.equal(tempoRelativo(30 * 1000), 'agora há pouco');
  assert.equal(tempoRelativo(m), 'há 1 min');
  assert.equal(tempoRelativo(59 * m), 'há 59 min');
  assert.equal(tempoRelativo(60 * m), 'há 1 h');
  assert.equal(tempoRelativo(23 * 60 * m), 'há 23 h');
  assert.equal(tempoRelativo(24 * 60 * m), 'há 1 dia');
  assert.equal(tempoRelativo(3 * 24 * 60 * m), 'há 3 dias');
});

test('bolinha: bitmap BGRA quadrado, cor no centro e canto transparente', () => {
  const lado = 32;
  const b = bolinha('#5b9bd5', lado);
  assert.equal(b.length, lado * lado * 4);
  const centro = ((lado / 2) * lado + lado / 2) * 4;
  assert.deepEqual([...b.subarray(centro, centro + 4)], [0xd5, 0x9b, 0x5b, 0xff]);
  assert.equal(b[3], 0);
});

test('menu do cartão: mover para grupo lista os grupos e "Sem grupo", com o atual marcado', () => {
  const feitas = [];
  const grupos = [{ id: 'g1', nome: 'Pedidos' }, { id: 'g2', nome: 'Impostos' }];
  const opcoes = { paleta: PALETA, ...acoes(), grupos, moverParaGrupo: (id, g) => feitas.push([id, g]) };
  const menu = modeloMenuCartao(cartao('verde', { grupoId: 'g2' }), opcoes);
  assert.deepEqual(menu.map((i) => i.label || i.type), ['Renomear', 'Trocar cor', 'Mover para grupo', 'separator', 'Fechar sessão']);
  const sub = menu[2].submenu;
  assert.deepEqual(sub.map((i) => i.label || i.type), ['Pedidos', 'Impostos', 'separator', 'Sem grupo']);
  assert.deepEqual(sub.filter((i) => i.checked).map((i) => i.label), ['Impostos']);
  sub[0].click();
  sub[3].click();
  assert.deepEqual(feitas, [['abc', 'g1'], ['abc', null]]);
  // Sem grupo (ou grupo apagado): "Sem grupo" marcado; sem grupos, só ele.
  const solto = modeloMenuCartao(cartao('verde', { grupoId: 'sumiu' }), opcoes)[2].submenu;
  assert.deepEqual(solto.filter((i) => i.checked).map((i) => i.label), ['Sem grupo']);
  const vazio = modeloMenuCartao(cartao('verde'), { ...opcoes, grupos: [] })[2].submenu;
  assert.deepEqual(vazio.map((i) => i.label), ['Sem grupo']);
});

test('menu do cartão: "Não fechar" só enquanto o Salvar e fechar espera', () => {
  const feitas = [];
  const a = { ...acoes(), naoFechar: (id) => feitas.push(['naoFechar', id]) };
  const esperando = modeloMenuCartao(cartao('amarelo', { salvando: 'fechar' }), { paleta: PALETA, ...a });
  assert.deepEqual(esperando.map((i) => i.label || i.type), ['Renomear', 'Trocar cor', 'separator', 'Não fechar', 'Fechar sessão']);
  esperando[3].click();
  assert.deepEqual(feitas, [['naoFechar', 'abc']]);
  const saindo = modeloMenuCartao(cartao('amarelo', { salvando: 'sair' }), { paleta: PALETA, ...a });
  assert.ok(!saindo.some((i) => i.label === 'Não fechar'));
});

test('menu Visualizar: ⌘+ e ⌘= sobem 1, ⌘− desce 1, ⌘0 volta a 13, sempre de 10 a 24', () => {
  let atual = 13;
  const pedidos = [];
  const modelo = modeloMenuApp('Atlas', {
    tamanhoFonte: () => atual,
    definirTamanhoFonte: (n) => { pedidos.push(n); atual = n; },
  });
  const v = modelo.find((m) => m.label === 'Visualizar').submenu;
  const por = (acc) => v.find((i) => i.accelerator === acc);
  por('CmdOrCtrl+Plus').click();
  por('CmdOrCtrl+=').click();
  por('CmdOrCtrl+-').click();
  assert.deepEqual(pedidos, [14, 15, 14]);
  por('CmdOrCtrl+0').click();
  assert.equal(atual, 13);
  atual = 24;
  por('CmdOrCtrl+Plus').click();
  assert.equal(atual, 24, 'teto 24');
  atual = 10;
  por('CmdOrCtrl+-').click();
  assert.equal(atual, 10, 'piso 10');
});
