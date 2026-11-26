const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const {
  tempoRelativo, caminhosArrastados, atalho, pastaCurta, textoSalvar,
} = require('../src/tela/util.js');

const MIN = 60000;

test('tempo relativo em português', () => {
  const agora = 10 * 24 * 60 * MIN;
  assert.equal(tempoRelativo(agora, agora), 'agora');
  assert.equal(tempoRelativo(agora - 59000, agora), 'agora');
  assert.equal(tempoRelativo(agora - MIN, agora), 'há 1 min');
  assert.equal(tempoRelativo(agora - 2 * MIN - 30000, agora), 'há 2 min');
  assert.equal(tempoRelativo(agora - 59 * MIN, agora), 'há 59 min');
  assert.equal(tempoRelativo(agora - 60 * MIN, agora), 'há 1 h');
  assert.equal(tempoRelativo(agora - 23 * 60 * MIN, agora), 'há 23 h');
  assert.equal(tempoRelativo(agora - 24 * 60 * MIN, agora), 'há 1 dia');
  assert.equal(tempoRelativo(agora - 3 * 24 * 60 * MIN, agora), 'há 3 dias');
});

test('tempo relativo: futuro (relógio adiantado) e valor inválido viram "agora"', () => {
  assert.equal(tempoRelativo(5000, 1000), 'agora');
  assert.equal(tempoRelativo(undefined, 1000), 'agora');
});

test('arquivos arrastados: caminhos entre aspas simples, o zsh devolve intactos', () => {
  const caminhos = ['/Users/m/Área de Trabalho/foto 1.png', "/tmp/it's.txt", '/tmp/$HOME `x`.md'];
  const texto = caminhosArrastados(caminhos);
  assert.ok(texto.endsWith(' '), 'termina com espaço, como o Terminal');
  const saida = execFileSync('/bin/zsh', ['-f', '-c', 'printf "%s\\n" ' + texto], { encoding: 'utf8' });
  assert.deepEqual(saida.split('\n').slice(0, -1), caminhos);
});

test('arquivos arrastados: nada para inserir', () => {
  assert.equal(caminhosArrastados([]), '');
  assert.equal(caminhosArrastados(['', null]), '');
});

const tecla = (key, mods = {}) => ({ key, code: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

test('atalhos do app: só ⌘1 a ⌘9, ⌘T e ⌘W', () => {
  assert.deepEqual(atalho(tecla('1', { metaKey: true })), { acao: 'selecionar', indice: 0 });
  assert.deepEqual(atalho(tecla('9', { metaKey: true })), { acao: 'selecionar', indice: 8 });
  assert.deepEqual(atalho(tecla('t', { metaKey: true })), { acao: 'nova' });
  assert.deepEqual(atalho(tecla('T', { metaKey: true })), { acao: 'nova' });
  assert.deepEqual(atalho(tecla('w', { metaKey: true })), { acao: 'fechar' });
  // pelo código da tecla, se o layout mudar o key
  assert.deepEqual(atalho(tecla('†', { metaKey: true, code: 'KeyT' })), { acao: 'nova' });
});

test('atalhos do app: todo o resto vai para o terminal', () => {
  assert.equal(atalho(tecla('0', { metaKey: true })), null);
  assert.equal(atalho(tecla('c', { metaKey: true })), null);
  assert.equal(atalho(tecla('v', { metaKey: true })), null);
  assert.equal(atalho(tecla('k', { metaKey: true })), null);
  assert.equal(atalho(tecla('c', { ctrlKey: true })), null);
  assert.equal(atalho(tecla('1')), null);
  assert.equal(atalho(tecla('Escape')), null);
  assert.equal(atalho(tecla('t', { metaKey: true, shiftKey: true })), null);
  assert.equal(atalho(tecla('w', { metaKey: true, altKey: true })), null);
  assert.equal(atalho(tecla('1', { metaKey: true, ctrlKey: true })), null);
});

test('pasta curta troca a pasta do usuário por ~', () => {
  assert.equal(pastaCurta('/Users/voce/Projetos/loja-impostos'), '~/Projetos/loja-impostos');
  assert.equal(pastaCurta('/Users/voce'), '~');
  assert.equal(pastaCurta('/tmp/x'), '/tmp/x');
});

const { agruparCartoes, formatarDuracao } = require('../src/tela/util.js');

const GRUPOS = [
  { id: 'pedidos', nome: 'Pedidos', descricao: '' },
  { id: 'fin', nome: 'Financeiro', descricao: '' },
  { id: 'vazio', nome: 'Marketing', descricao: '' },
];
const c = (id, grupoId, cor = 'verde', extra = {}) => ({ id, grupoId, criadoEm: 0, estado: { cor, desde: 0 }, ...extra });

test('grupos na coluna: bloco com vermelho sobe, vazio some, "Sem grupo" no fim', () => {
  const cartoes = [c('a', null), c('b', 'pedidos'), c('d', 'fin', 'vermelho'), c('e', 'fin')];
  const blocos = agruparCartoes(cartoes, GRUPOS, new Set());
  assert.deepEqual(blocos.map((b) => b.nome), ['Financeiro', 'Pedidos', 'Sem grupo']);
  assert.deepEqual(blocos.map((b) => b.grupoId), ['fin', 'pedidos', null]);
  assert.ok(!blocos.some((b) => b.nome === 'Marketing'), 'grupo vazio não aparece');
  assert.deepEqual(blocos[0].cartoes.map((x) => x.id), ['d', 'e']);
  assert.equal(blocos[0].vermelhos, 1);
  assert.equal(blocos[2].recolhido, false);
});

test('grupos na coluna: sem vermelho vale a ordem dos grupos; grupo apagado cai em "Sem grupo"', () => {
  const cartoes = [c('a', 'fin'), c('b', 'pedidos'), c('x', 'sumiu')];
  const blocos = agruparCartoes(cartoes, GRUPOS, new Set());
  assert.deepEqual(blocos.map((b) => b.nome), ['Pedidos', 'Financeiro', 'Sem grupo']);
  assert.deepEqual(blocos[2].cartoes.map((x) => x.id), ['x']);
});

test('grupos na coluna: recolhido com 2 vermelhos conta 2; dentro do bloco vale ordenar', () => {
  const cartoes = [
    c('v1', 'pedidos', 'verde', { criadoEm: 1 }),
    c('r2', 'pedidos', 'vermelho', { estado: { cor: 'vermelho', desde: 50 } }),
    c('r1', 'pedidos', 'vermelho', { estado: { cor: 'vermelho', desde: 10 } }),
    c('v0', 'pedidos', 'verde', { criadoEm: 0 }),
  ];
  const [bloco] = agruparCartoes(cartoes, GRUPOS, new Set(['pedidos']));
  assert.equal(bloco.recolhido, true);
  assert.equal(bloco.vermelhos, 2);
  assert.deepEqual(bloco.cartoes.map((x) => x.id), ['r1', 'r2', 'v0', 'v1']);
});

test('grupos na coluna: "Sem grupo" também recolhe (id null)', () => {
  const [bloco] = agruparCartoes([c('a', null)], GRUPOS, new Set([null]));
  assert.equal(bloco.recolhido, true);
});

test('duração em horas e minutos', () => {
  assert.equal(formatarDuracao(24000000), '6h 40');
  assert.equal(formatarDuracao(2100000), '35 min');
  assert.equal(formatarDuracao(0), '0 min');
  assert.equal(formatarDuracao(59000), '0 min');
  assert.equal(formatarDuracao(3600000), '1h');
  assert.equal(formatarDuracao(3900000), '1h 05');
  assert.equal(formatarDuracao(-5), '0 min');
  assert.equal(formatarDuracao(NaN), '0 min');
});

test('textoSalvar: não salva, salvando e fechando, salvando; salva não mostra nada', () => {
  assert.equal(textoSalvar({ salva: false, salvando: null }), 'não salva');
  assert.equal(textoSalvar({ salva: true, salvando: null }), '');
  assert.equal(textoSalvar({ salva: false, salvando: 'fechar' }), 'salvando e fechando');
  assert.equal(textoSalvar({ salva: false, salvando: 'sair' }), 'salvando');
  assert.equal(textoSalvar({}), '', 'cartão de antes desta versão');
});

test('I1: textoSalvar avisa quando o /salvar não terminou; salvando e rascunho vêm antes', () => {
  assert.equal(textoSalvar({ salva: false, salvando: null, falhaSalvar: true }), 'o /salvar não terminou, tente de novo');
  assert.equal(textoSalvar({ salva: false, salvando: 'sair', falhaSalvar: true }), 'salvando');
  assert.equal(textoSalvar({ salva: false, salvando: null, rascunho: true, falhaSalvar: true }), 'rascunho na caixa, apague com ⌃U e tente de novo');
  assert.equal(textoSalvar({ salva: true, salvando: null, falhaSalvar: false }), '');
});

test('caixa do claude: entre as duas últimas réguas, com o ❯', () => {
  const { caixaDoClaude } = require('../src/tela/util.js');
  const r = '─'.repeat(100);
  const tela = ['', 'você: [Image #1] antigo', r, '❯ oi [Image', '  #2] e mais', r, '  Opus 5.5 · atlas'];
  assert.deepEqual(caixaDoClaude(tela), { topo: 2, base: 5, texto: '❯ oi [Image   #2] e mais' });
  assert.equal(caixaDoClaude(['', 'Quer rodar este comando?', '❯ 1. Sim']), null);
  assert.equal(caixaDoClaude([r, 'só uma régua']), null);
  // diálogo entre duas réguas (ou um --- da conversa): não é a caixa
  assert.equal(caixaDoClaude([r, ' Quer rodar?', '❯ 1. Sim', r]), null);
  assert.equal(caixaDoClaude([r, '❯ 1. Sim', '  2. Não', r]), null);
  // pedido que começa com lista numerada é a caixa
  assert.equal(caixaDoClaude([r, '❯ 1. faz isso [Image #1]', r]).texto, '❯ 1. faz isso [Image #1]');
  assert.equal(caixaDoClaude([r, 'texto da resposta', r]), null);
});

test('números de imagem na caixa, mesmo com a quebra de linha', () => {
  const { numerosDeImagem } = require('../src/tela/util.js');
  assert.deepEqual([...numerosDeImagem('❯ oi [Image #1] e [Image #12] [Image   #3] [Image #1]')], [1, 12, 3]);
  assert.equal(numerosDeImagem('❯ sem imagem').size, 0);
});

const novoEstado = (coladas = []) => ({ porNumero: new Map(), coladas, vistos: new Set(), ausentes: new Map() });

test('miniaturas: número novo pega a colada mais antiga; sai depois da ausência', () => {
  const { ligarMiniaturas, AUSENCIA } = require('../src/tela/util.js');
  const a = { imagem: 'a', t: 1000 };
  const b = { imagem: 'b', t: 1100 };
  const est = novoEstado([a, b]);
  assert.deepEqual(ligarMiniaturas(est, new Set([3]), 1200).lista, [[3, a]]);
  assert.deepEqual(ligarMiniaturas(est, new Set([3, 4]), 1300).lista, [[3, a], [4, b]]);
  // #3 apagada: fica durante a ausência, sai depois
  const r = ligarMiniaturas(est, new Set([4]), 1400);
  assert.deepEqual(r.lista, [[3, a], [4, b]]);
  assert.equal(r.esperando, true);
  assert.deepEqual(ligarMiniaturas(est, new Set([4]), 1400 + AUSENCIA).lista, [[4, b]]);
  // quadro pela metade: some e volta antes da ausência vencer
  assert.deepEqual(ligarMiniaturas(est, new Set(), 2000).lista, [[4, b]]);
  const volta = ligarMiniaturas(est, new Set([4]), 2100);
  assert.deepEqual(volta.lista, [[4, b]]);
  assert.equal(volta.esperando, false);
});

test('miniaturas: número que já estava sem miniatura não pega a colada nova', () => {
  const { ligarMiniaturas } = require('../src/tela/util.js');
  const est = novoEstado();
  assert.deepEqual(ligarMiniaturas(est, new Set([1]), 1000).lista, []); // pedido antigo do ↑
  const nova = { imagem: 'n', t: 1100 };
  est.coladas.push(nova);
  assert.deepEqual(ligarMiniaturas(est, new Set([1]), 1150).lista, []); // claude ainda não desenhou
  assert.deepEqual(ligarMiniaturas(est, new Set([1, 2]), 1200).lista, [[2, nova]]);
});

test('miniaturas: colada vencida não liga', () => {
  const { ligarMiniaturas, VALIDADE_COLADA } = require('../src/tela/util.js');
  const est = novoEstado([{ imagem: 'v', t: 0 }]);
  assert.deepEqual(ligarMiniaturas(est, new Set([1]), VALIDADE_COLADA + 1).lista, []);
  assert.equal(est.coladas.length, 0);
});

test('arquivo arrastado que o claude transforma em imagem', () => {
  const { ehImagem } = require('../src/tela/util.js');
  assert.ok(ehImagem('/Users/x/Print 1.PNG'));
  assert.ok(ehImagem('/a/foto.jpeg'));
  assert.ok(!ehImagem('/a/foto.heic'));
  assert.ok(!ehImagem('/a/planilha.xlsx'));
});

test('miniaturas: primeira colagem da sessão com número antigo já na caixa', () => {
  const { ligarMiniaturas } = require('../src/tela/util.js');
  const est = novoEstado();
  // como guardarColada: registra a caixa antes de enfileirar
  ligarMiniaturas(est, new Set([1]), 1000);
  const nova = { imagem: 'n', t: 1000 };
  est.coladas.push(nova);
  assert.deepEqual(ligarMiniaturas(est, new Set([1, 2]), 1100).lista, [[2, nova]]);
});
