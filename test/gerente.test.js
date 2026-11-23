const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarGerente, textoConfirmacao } = require('../src/gerente.js');
const { salvarLista, carregarLista } = require('../src/sessoes.js');
const { PALETA } = require('../src/projetos.js');

const UA = '0a1b2c3d-0000-4000-8000-00000000000a';
const UB = '0a1b2c3d-0000-4000-8000-00000000000b';
const UC = '0a1b2c3d-0000-4000-8000-00000000000c';

function montar({ lista, casa, ...extra } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-gerente-'));
  const pastaEventos = path.join(d, 'eventos');
  fs.mkdirSync(pastaEventos);
  const arquivoLista = path.join(d, 'sessoes.json');
  const pastaProjetos = path.join(d, 'projects');
  fs.mkdirSync(pastaProjetos);
  if (lista) salvarLista(arquivoLista, lista);
  const relogio = { t: 1000000 };
  const ptys = [];
  const emitidos = [];
  const dados = [];
  const retomados = [];
  const avisos = [];
  const abrirPty = (sessao, cfg, aoDados, aoSair) => {
    const p = {
      sessao: { ...sessao }, cfg, aoDados, aoSair, escrito: [], tamanho: null, morto: false,
      escrever(s) { p.escrito.push(s); },
      redimensionar(c, r) { p.tamanho = [c, r]; },
      matar() { p.morto = true; },
    };
    ptys.push(p);
    return p;
  };
  const g = criarGerente({
    abrirPty,
    agora: () => relogio.t,
    pastaEventos,
    arquivoLista,
    aoCartoes: (c) => emitidos.push(c),
    aoDados: (id, s) => dados.push([id, s]),
    aoRetomar: (id) => retomados.push([id, ptys.length]),
    casa: casa || '/Users/m',
    pastaProjetos,
    aoAvisar: (a) => avisos.push(a),
    ...extra,
  });
  // Lista vazia: já pronta para nova sessão (sem lista no disco, restaurar não abre nada).
  if (!lista && !extra.semRestaurar) g.restaurar();
  const evento = (id, ev) => {
    fs.appendFileSync(path.join(pastaEventos, id + '.jsonl'), JSON.stringify(ev) + '\n');
    g.aoMudarEventos(id);
  };
  const cartao = (id) => g.listar().find((c) => c.id === id);
  return { g, relogio, ptys, emitidos, dados, retomados, avisos, evento, cartao, arquivoLista, pastaEventos, pastaProjetos, pasta: d };
}

test('nova sessão entra na lista salva e abre pty com a sessão (id do ATLAS_SESSAO_ID)', () => {
  const { g, ptys, emitidos, arquivoLista, cartao } = montar();
  const id = g.nova('/x/Pedidos');
  assert.match(id, /^[a-z0-9]{8}$/);
  assert.equal(ptys.length, 1);
  assert.equal(ptys[0].sessao.id, id);
  assert.equal(ptys[0].sessao.pasta, '/x/Pedidos');
  assert.deepEqual(ptys[0].cfg.argv, ['claude']);
  const salva = carregarLista(arquivoLista);
  assert.equal(salva.length, 1);
  assert.equal(salva[0].id, id);
  const c = cartao(id);
  assert.equal(c.nome, 'Pedidos', 'fora da pasta pessoal, sem nome nem título: nome da pasta');
  assert.equal(c.numero, undefined);
  assert.equal(c.cor, PALETA[0]);
  assert.equal(salva[0].cor, PALETA[0]);
  assert.equal(c.estado.rotulo, 'abrindo', 'até o inicio desta execução');
  assert.ok(emitidos.length >= 1);
});

test('mudança no arquivo de eventos atualiza o cartão', () => {
  const { g, relogio, evento, cartao, emitidos } = montar();
  const id = g.nova('/x/a');
  const antes = emitidos.length;
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'prompt', texto: 'oi' });
  assert.equal(cartao(id).estado.cor, 'amarelo');
  assert.equal(cartao(id).estado.ultimoPedido, 'oi');
  assert.ok(emitidos.length > antes);
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'stop', session_id: 'u-1' });
  assert.equal(cartao(id).estado.cor, 'verde');
});

test('id desconhecido no observador é ignorado', () => {
  const { g } = montar();
  assert.doesNotThrow(() => g.aoMudarEventos('naoexiste'));
});

test('selecionar com a janela focada grava vistaEm; sem foco não', () => {
  const { g, relogio, evento, cartao } = montar();
  const id = g.nova('/x/a');
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'stop' });
  g.marcarFoco(false);
  g.selecionar(id);
  relogio.t += 4 * 60000;
  g.recalcular();
  assert.equal(cartao(id).estado.cor, 'vermelho');
  g.marcarFoco(true); // foco na janela marca a selecionada como vista
  assert.equal(cartao(id).estado.cor, 'verde');

  const outra = g.nova('/x/b');
  relogio.t += 10;
  evento(outra, { t: relogio.t, tipo: 'stop' });
  g.selecionar(outra); // janela focada
  relogio.t += 4 * 60000;
  g.recalcular();
  assert.equal(cartao(outra).estado.cor, 'verde');
});

test('saída do pty vira cartão preto e guarda as últimas 5 linhas sem ANSI', () => {
  const { g, ptys, cartao, dados } = montar();
  const id = g.nova('/x/a');
  ptys[0].aoDados('\x1b[31mlinha 1\x1b[0m\r\nlinha 2\r\nlinha 3\r\n');
  ptys[0].aoDados('linha 4\r\nlinha 5\r\nerro: opção desconhecida\r\n\r\n');
  assert.equal(dados.length, 2);
  assert.equal(dados[0][0], id);
  ptys[0].aoSair(1);
  const c = cartao(id);
  assert.equal(c.estado.cor, 'preto');
  assert.deepEqual(c.ultimasLinhas, ['linha 2', 'linha 3', 'linha 4', 'linha 5', 'erro: opção desconhecida']);
});

test('falha ao abrir o pty vira cartão preto com a mensagem', () => {
  const g2 = criarGerente({
    abrirPty: () => { throw new Error('posix_spawnp failed'); },
    agora: () => 1,
    pastaEventos: fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-ev-')),
    arquivoLista: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-l-')), 's.json'),
  });
  g2.restaurar();
  const id = g2.nova('/x/a');
  const c = g2.listar().find((x) => x.id === id);
  assert.equal(c.estado.cor, 'preto');
  assert.deepEqual(c.ultimasLinhas, ['posix_spawnp failed']);
});

test('fechar mata o pty e tira a sessão da lista salva', () => {
  const { g, ptys, arquivoLista } = montar();
  const a = g.nova('/x/a');
  const b = g.nova('/x/b');
  g.fechar(a);
  assert.equal(ptys[0].morto, true);
  assert.equal(ptys[1].morto, false);
  assert.deepEqual(carregarLista(arquivoLista).map((s) => s.id), [b]);
  assert.deepEqual(g.listar().map((c) => c.id), [b]);
});

test('restaurar abre cada sessão salva, com --resume quando tem claudeSessionId', () => {
  const lista = [
    { id: 'aaaa1111', pasta: '/x/a', criadoEm: 1, claudeSessionId: UA, numero: 1 },
    { id: 'bbbb2222', pasta: '/x/b', criadoEm: 2, claudeSessionId: null, numero: 1 },
    { id: 'cccc3333', pasta: '/x/c', criadoEm: 3, claudeSessionId: 'nao-e-uuid' },
  ];
  const { g, ptys } = montar({ lista });
  g.restaurar();
  assert.equal(ptys.length, 3);
  assert.deepEqual(ptys[0].cfg.argv, ['claude', '--resume', UA]);
  assert.deepEqual(ptys[1].cfg.argv, ['claude']);
  assert.deepEqual(ptys[2].cfg.argv, ['claude'], 'id fora do formato: conversa nova');
  assert.deepEqual(g.listar().map((c) => c.id).sort(), ['aaaa1111', 'bbbb2222', 'cccc3333']);
});

test('restaurar ignora estado antigo do arquivo (ex.: pedido de aprovação de antes) mas mantém o último pedido', () => {
  const lista = [{ id: 'aaaa1111', pasta: '/x/a', criadoEm: 1, claudeSessionId: 'u-a', numero: 1 }];
  const m = montar({ lista });
  const arq = path.join(m.pastaEventos, 'aaaa1111.jsonl');
  fs.writeFileSync(arq, [
    JSON.stringify({ t: 10, tipo: 'prompt', texto: 'arruma o tema' }),
    JSON.stringify({ t: 11, tipo: 'permissao', ferramenta: 'Bash' }),
  ].join('\n') + '\n');
  m.g.restaurar();
  const c = m.cartao('aaaa1111');
  assert.equal(c.estado.rotulo, 'abrindo', 'nada de vermelho de antes');
  assert.equal(c.estado.ultimoPedido, 'arruma o tema');
});

test('claudeSessionId do último prompt, ferramenta ou stop vai para a lista salva (não do inicio)', () => {
  const { g, relogio, ptys, evento, arquivoLista, cartao, retomados } = montar();
  const id = g.nova('/x/a');
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'inicio', session_id: UB });
  assert.equal(carregarLista(arquivoLista)[0].claudeSessionId, null, 'inicio não grava');
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'prompt', texto: 'oi', session_id: UA });
  assert.equal(carregarLista(arquivoLista)[0].claudeSessionId, UA, 'prompt sem stop já grava');
  // Fechou o app no meio do trabalho: restaurar retoma a conversa.
  ptys[0].aoSair(0);
  assert.equal(cartao(id).estado.cor, 'preto');
  relogio.t += 10;
  g.retomar(id);
  assert.equal(ptys.length, 2);
  assert.deepEqual(retomados, [[id, 1]], 'a tela é avisada antes do pty novo');
  assert.deepEqual(ptys[1].cfg.argv, ['claude', '--resume', UA]);
  assert.equal(cartao(id).estado.rotulo, 'abrindo');
  assert.deepEqual(cartao(id).ultimasLinhas, []);
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'pre_tool', ferramenta: 'Bash', session_id: UC });
  assert.equal(carregarLista(arquivoLista)[0].claudeSessionId, UC);
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'notificacao', notificacao: 'idle_prompt', session_id: UB });
  evento(id, { t: relogio.t, tipo: 'post_tool', session_id: 'lixo' });
  assert.equal(carregarLista(arquivoLista)[0].claudeSessionId, UC, 'notificação e id fora do formato não gravam');
});

test('restaurar sem stop retoma pela conversa do último prompt', () => {
  const lista = [{ id: 'aaaa1111', pasta: '/x/a', criadoEm: 1, claudeSessionId: null }];
  const m = montar({ lista });
  fs.writeFileSync(path.join(m.pastaEventos, 'aaaa1111.jsonl'), JSON.stringify({ t: 5, tipo: 'prompt', texto: 'x', session_id: UA }) + '\n');
  m.g.restaurar();
  assert.equal(carregarLista(m.arquivoLista)[0].claudeSessionId, UA);
  m.ptys[0].aoSair(0);
  m.g.retomar('aaaa1111');
  assert.deepEqual(m.ptys[1].cfg.argv, ['claude', '--resume', UA]);
});

test('eventos lidos aos pedaços: só o que foi acrescentado, linha incompleta espera o resto', () => {
  const { g, relogio, cartao, pastaEventos } = montar();
  const id = g.nova('/x/a');
  const arq = path.join(pastaEventos, id + '.jsonl');
  relogio.t += 10;
  const primeira = JSON.stringify({ t: relogio.t, tipo: 'prompt', texto: 'aa' });
  fs.writeFileSync(arq, primeira + '\n');
  g.aoMudarEventos(id);
  assert.equal(cartao(id).estado.ultimoPedido, 'aa');
  // Mexer no começo do arquivo não muda nada: o que já foi lido não é lido de novo.
  const fd = fs.openSync(arq, 'r+');
  fs.writeSync(fd, primeira.replace('"aa"', '"bb"'), 0);
  fs.closeSync(fd);
  relogio.t += 10;
  const stop = JSON.stringify({ t: relogio.t, tipo: 'stop' });
  fs.appendFileSync(arq, stop.slice(0, 7));
  g.aoMudarEventos(id);
  assert.equal(cartao(id).estado.cor, 'amarelo', 'meia linha ainda não conta');
  fs.appendFileSync(arq, stop.slice(7) + '\n');
  g.aoMudarEventos(id);
  assert.equal(cartao(id).estado.cor, 'verde');
  assert.equal(cartao(id).estado.ultimoPedido, 'aa');
  // Arquivo menor que o já lido (apagado e recriado): lê do começo.
  relogio.t += 10;
  fs.writeFileSync(arq, JSON.stringify({ t: relogio.t, tipo: 'prompt', texto: 'cc' }) + '\n');
  g.aoMudarEventos(id);
  assert.equal(cartao(id).estado.ultimoPedido, 'cc');
  assert.equal(cartao(id).estado.cor, 'amarelo');
});

test('fechar apaga o arquivo de eventos da sessão', () => {
  const { g, relogio, evento, pastaEventos } = montar();
  const a = g.nova('/x/a');
  const b = g.nova('/x/b');
  relogio.t += 10;
  evento(a, { t: relogio.t, tipo: 'prompt', texto: 'x' });
  evento(b, { t: relogio.t, tipo: 'prompt', texto: 'y' });
  g.fechar(a);
  assert.deepEqual(fs.readdirSync(pastaEventos), [b + '.jsonl']);
});

test('restaurar apaga só os .jsonl de sessões que não estão mais na lista', () => {
  const lista = [{ id: 'aaaa1111', pasta: '/x/a', criadoEm: 1, claudeSessionId: null }];
  const m = montar({ lista });
  for (const n of ['aaaa1111.jsonl', 'zzzz9999.jsonl', 'uso.json', '.uso.12.tmp', 'Outra.jsonl', 'notas.txt']) {
    fs.writeFileSync(path.join(m.pastaEventos, n), '');
  }
  m.g.restaurar();
  assert.deepEqual(fs.readdirSync(m.pastaEventos).sort(), ['.uso.12.tmp', 'Outra.jsonl', 'aaaa1111.jsonl', 'notas.txt', 'uso.json']);
});

test('nome do cartão: pasta pessoal fica "Novo", outra pasta mostra o nome dela', () => {
  const { g, cartao } = montar({ casa: '/Users/m' });
  assert.equal(cartao(g.nova('/Users/m')).nome, 'Novo');
  assert.equal(cartao(g.nova('/Users/m/Projetos/Pedidos/')).nome, 'Pedidos');
});

test('idle_prompt com a sessão na tela e o app na frente conta como vista', () => {
  const { g, relogio, evento, cartao } = montar();
  const id = g.nova('/x/a');
  g.selecionar(id);
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'prompt', texto: 'oi' });
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'permissao', ferramenta: 'Bash' });
  assert.equal(cartao(id).estado.cor, 'vermelho');
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'notificacao', notificacao: 'idle_prompt' });
  relogio.t += 4 * 60000;
  g.recalcular();
  assert.equal(cartao(id).estado.cor, 'verde');
});

test('retomar sessão viva não abre outro pty', () => {
  const { g, ptys } = montar();
  const id = g.nova('/x/a');
  g.retomar(id);
  assert.equal(ptys.length, 1);
});

test('contarAtivas soma amarelo e vermelho, menos "pronta, você ainda não viu"', () => {
  const { g, relogio, evento, cartao } = montar();
  const a = g.nova('/x/a');
  const b = g.nova('/x/b');
  const c = g.nova('/x/c');
  g.marcarFoco(false);
  assert.equal(g.contarAtivas(), 0);
  relogio.t += 10;
  evento(c, { t: relogio.t, tipo: 'prompt', texto: 'z' });
  evento(c, { t: relogio.t, tipo: 'stop' });
  evento(a, { t: relogio.t, tipo: 'prompt', texto: 'x' });
  evento(b, { t: relogio.t, tipo: 'permissao', ferramenta: 'Bash' });
  assert.equal(g.contarAtivas(), 2);
  relogio.t += 4 * 60000;
  evento(a, { t: relogio.t, tipo: 'pre_tool', ferramenta: 'Bash' });
  g.recalcular();
  assert.equal(cartao(c).estado.rotulo, 'pronta, você ainda não viu');
  assert.equal(g.contarAtivas(), 2);
});

test('saída do pty atualiza saidaTerminalEm (evita "sem sinal")', () => {
  const { g, relogio, ptys, evento, cartao } = montar();
  const id = g.nova('/x/a');
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'pre_tool', ferramenta: 'Bash' });
  relogio.t += 80 * 1000;
  ptys[0].aoDados('rodando...');
  relogio.t += 80 * 1000;
  g.recalcular();
  assert.equal(cartao(id).estado.cor, 'amarelo');
  relogio.t += 20 * 1000;
  g.recalcular();
  assert.equal(cartao(id).estado.cor, 'cinza');
});

test('escrever e redimensionar vão para o pty certo; id inválido é ignorado', () => {
  const { g, ptys } = montar();
  const a = g.nova('/x/a');
  g.escrever(a, 'oi\r');
  g.redimensionar(a, 120, 40);
  g.escrever('zzz', 'x');
  assert.deepEqual(ptys[0].escrito, ['oi\r']);
  assert.deepEqual(ptys[0].tamanho, [120, 40]);
});

test('encerrarTudo mata todos os ptys e salva a lista', () => {
  const { g, ptys, arquivoLista } = montar();
  g.nova('/x/a');
  g.nova('/x/b');
  fs.rmSync(arquivoLista);
  g.encerrarTudo();
  assert.ok(ptys.every((p) => p.morto));
  assert.equal(carregarLista(arquivoLista).length, 2);
});

test('texto de confirmação no singular e plural', () => {
  assert.equal(textoConfirmacao(1), 'Tem 1 sessão trabalhando, fechar mesmo?');
  assert.equal(textoConfirmacao(3), 'Tem 3 sessões trabalhando, fechar mesmo?');
});

test('sessão selecionada com a janela focada que termina conta como vista e fica verde', () => {
  const { g, relogio, evento, cartao } = montar();
  const id = g.nova('/x/a');
  g.selecionar(id);
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'prompt', texto: 'oi' });
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'stop' });
  relogio.t += 4 * 60000;
  g.recalcular();
  assert.equal(cartao(id).estado.cor, 'verde');
});

test('recalcular relê o arquivo de eventos mesmo sem aviso do observador', () => {
  const { g, relogio, evento, cartao, pastaEventos } = montar();
  const id = g.nova('/x/a');
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'prompt', texto: 'oi' });
  assert.equal(cartao(id).estado.cor, 'amarelo');
  relogio.t += 10;
  fs.appendFileSync(path.join(pastaEventos, id + '.jsonl'), JSON.stringify({ t: relogio.t, tipo: 'stop', session_id: 'u-2' }) + '\n');
  g.recalcular();
  assert.equal(cartao(id).estado.cor, 'verde');
});

test('cada sessão nova pega a cor menos usada', () => {
  const { g, cartao } = montar();
  const ids = [g.nova('/h'), g.nova('/h'), g.nova('/h')];
  assert.deepEqual(ids.map((id) => cartao(id).cor), [PALETA[0], PALETA[1], PALETA[2]]);
  g.fechar(ids[1]);
  assert.equal(cartao(g.nova('/h')).cor, PALETA[1]);
});

test('definirTitulo limpa, persiste e vira o nome; genérico e repetido não gravam', () => {
  const { g, cartao, arquivoLista, emitidos } = montar();
  const id = g.nova('/h');
  g.definirTitulo(id, '✳ Conferir Impostos');
  assert.equal(cartao(id).nome, 'Conferir Impostos');
  assert.equal(carregarLista(arquivoLista)[0].titulo, 'Conferir Impostos');
  const antes = emitidos.length;
  fs.rmSync(arquivoLista);
  g.definirTitulo(id, '⠂ Conferir Impostos'); // outro quadro do spinner
  g.definirTitulo(id, '✳ Claude Code'); // genérico: mantém o anterior
  g.definirTitulo('naoexiste', 'X');
  assert.equal(fs.existsSync(arquivoLista), false, 'não regravou');
  assert.equal(emitidos.length, antes);
  assert.equal(cartao(id).nome, 'Conferir Impostos');
});

test('renomear vence o título; vazio ou null volta ao automático', () => {
  const { g, cartao, arquivoLista } = montar();
  const id = g.nova('/h');
  g.definirTitulo(id, '✳ Conferir Impostos');
  g.renomear(id, '  Minha sessão  ');
  assert.equal(cartao(id).nome, 'Minha sessão');
  assert.equal(carregarLista(arquivoLista)[0].nome, 'Minha sessão');
  g.definirTitulo(id, '✳ Outro assunto');
  assert.equal(cartao(id).nome, 'Minha sessão');
  assert.equal(carregarLista(arquivoLista)[0].titulo, 'Outro assunto');
  g.renomear(id, '   ');
  assert.equal(cartao(id).nome, 'Outro assunto');
  g.renomear(id, 'De novo');
  g.renomear(id, null);
  assert.equal(cartao(id).nome, 'Outro assunto');
  assert.equal(carregarLista(arquivoLista)[0].nome, null);
});

test('nome e título voltam ao restaurar', () => {
  const lista = [{ id: 'aaaa1111', pasta: '/h', criadoEm: 1, claudeSessionId: 'u-a', nome: null, titulo: 'Do Claude', cor: PALETA[4] }];
  const { g, cartao } = montar({ lista });
  g.restaurar();
  assert.equal(cartao('aaaa1111').nome, 'Do Claude');
  assert.equal(cartao('aaaa1111').cor, PALETA[4]);
});

test('trocarCor vale só para a sessão e só com cor da paleta', () => {
  const { g, cartao, arquivoLista } = montar();
  const a = g.nova('/h');
  const b = g.nova('/h');
  g.trocarCor(a, PALETA[5]);
  g.trocarCor(b, '#123456');
  g.trocarCor('naoexiste', PALETA[5]);
  assert.equal(cartao(a).cor, PALETA[5]);
  assert.equal(cartao(b).cor, PALETA[1]);
  assert.equal(carregarLista(arquivoLista).find((s) => s.id === a).cor, PALETA[5]);
});

test('aprovação respondida no terminal: amarelo enquanto a ferramenta roda (I2)', () => {
  const { g, relogio, ptys, evento, cartao } = montar();
  const id = g.nova('/x/a');
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'inicio' });
  evento(id, { t: relogio.t, tipo: 'prompt', texto: 'build' });
  evento(id, { t: relogio.t, tipo: 'pre_tool', ferramenta: 'Bash', tool_use_id: 'b1' });
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'permissao', ferramenta: 'Bash' });
  assert.equal(cartao(id).estado.cor, 'vermelho');
  relogio.t += 1000;
  g.escrever(id, '\x1b[B'); // seta para baixo: só mexe no diálogo
  ptys[0].aoDados('redesenho');
  assert.equal(cartao(id).estado.cor, 'vermelho', 'seta não responde');
  relogio.t += 1000;
  g.escrever(id, '\r');
  assert.equal(cartao(id).estado.cor, 'vermelho', 'sem saída depois da tecla ainda');
  relogio.t += 100;
  ptys[0].aoDados('rodando');
  assert.equal(cartao(id).estado.cor, 'amarelo');
  relogio.t += 10 * 60000;
  ptys[0].aoDados('ainda rodando');
  g.recalcular();
  assert.equal(cartao(id).estado.rotulo, 'trabalhando');
});

test('Esc numa sessão e troca de cartão: o idle_prompt depois não vira "não viu" (M9)', () => {
  const { g, relogio, evento, cartao } = montar();
  const a = g.nova('/x/a');
  const b = g.nova('/x/b');
  g.selecionar(a);
  relogio.t += 10;
  evento(a, { t: relogio.t, tipo: 'inicio' });
  evento(a, { t: relogio.t, tipo: 'prompt', texto: 'x' });
  evento(a, { t: relogio.t, tipo: 'pre_tool', ferramenta: 'Bash' });
  relogio.t += 1000;
  g.escrever(a, '\x1b');
  g.selecionar(b);
  relogio.t += 60000;
  evento(a, { t: relogio.t, tipo: 'notificacao', notificacao: 'idle_prompt' });
  relogio.t += 4 * 60000;
  g.recalcular();
  assert.equal(cartao(a).estado.cor, 'verde');
  assert.equal(cartao(a).estado.rotulo, 'pronta');
});

test('digitar na sessão conta como vista', () => {
  const { g, relogio, evento, cartao } = montar();
  const a = g.nova('/x/a');
  g.marcarFoco(false);
  relogio.t += 10;
  evento(a, { t: relogio.t, tipo: 'prompt', texto: 'x' });
  evento(a, { t: relogio.t, tipo: 'stop' });
  g.marcarFoco(true); // sem sessão selecionada: não marca nada
  relogio.t += 1000;
  g.escrever(a, 'o');
  relogio.t += 4 * 60000;
  g.recalcular();
  assert.equal(cartao(a).estado.rotulo, 'pronta');
});

test('restaurar na pasta pessoal: sem inicio, confirme a pasta depois de 10 s; ordem e "não viu" seguem (I3)', () => {
  const lista = [
    { id: 'aaaa1111', pasta: '/Users/m', criadoEm: 1, claudeSessionId: null },
    { id: 'bbbb2222', pasta: '/Users/m', criadoEm: 2, claudeSessionId: null },
    { id: 'cccc3333', pasta: '/x/c', criadoEm: 3, claudeSessionId: null },
  ];
  const m = montar({ lista });
  m.g.restaurar();
  const t0 = m.relogio.t;
  assert.deepEqual(m.g.listar().map((c) => c.estado.rotulo), ['abrindo', 'abrindo', 'abrindo']);
  assert.equal(m.g.contarAtivas(), 0);
  m.relogio.t = t0 + 2000;
  m.evento('cccc3333', { t: m.relogio.t, tipo: 'inicio' });
  m.relogio.t = t0 + 5000;
  m.evento('cccc3333', { t: m.relogio.t, tipo: 'prompt', texto: 'x' });
  m.evento('cccc3333', { t: m.relogio.t, tipo: 'permissao', ferramenta: 'Bash' });
  m.relogio.t = t0 + 11000;
  m.g.recalcular();
  const cartoes = m.g.listar();
  assert.deepEqual(cartoes.map((c) => c.id), ['cccc3333', 'aaaa1111', 'bbbb2222'], 'aprovação mais antiga no topo');
  assert.deepEqual(cartoes.map((c) => c.estado.rotulo), ['pede aprovação', 'confirme a pasta', 'confirme a pasta']);
  assert.equal(m.g.contarAtivas(), 1, 'confirme a pasta não tem nada a perder ao fechar');
  // Confirmou a pasta: inicio, e nada de "não viu" depois (não houve vez).
  m.relogio.t = t0 + 15000;
  m.evento('aaaa1111', { t: m.relogio.t, tipo: 'inicio' });
  assert.equal(m.cartao('aaaa1111').estado.rotulo, 'pronta');
  m.relogio.t += 60000;
  m.evento('aaaa1111', { t: m.relogio.t, tipo: 'notificacao', notificacao: 'idle_prompt' });
  m.relogio.t += 10 * 60000;
  m.g.recalcular();
  assert.equal(m.cartao('aaaa1111').estado.rotulo, 'pronta');
});

test('claude rodado de dentro da sessão (outro pid) não muda estado nem conversa (I4)', () => {
  const { g, relogio, evento, cartao, arquivoLista } = montar();
  const id = g.nova('/x/a');
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'inicio', session_id: UA, pid: 100 });
  evento(id, { t: relogio.t, tipo: 'prompt', texto: 'roda o script', session_id: UA, pid: 100 });
  evento(id, { t: relogio.t, tipo: 'pre_tool', ferramenta: 'Bash', session_id: UA, pid: 100 });
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'inicio', session_id: UB, pid: 200 });
  evento(id, { t: relogio.t, tipo: 'prompt', texto: 'aninhado', session_id: UB, pid: 200 });
  evento(id, { t: relogio.t, tipo: 'stop', session_id: UB, pid: 200 });
  const c = cartao(id);
  assert.equal(c.estado.cor, 'amarelo', 'o de fora segue no Bash');
  assert.equal(c.estado.ultimoPedido, 'roda o script');
  assert.equal(carregarLista(arquivoLista)[0].claudeSessionId, UA);
  // Evento sem pid (hook antigo) continua valendo.
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'stop', session_id: UA });
  assert.equal(cartao(id).estado.cor, 'verde');
});

test('ao restaurar, conversa já salva não é trocada por evento antigo do arquivo (I4)', () => {
  const lista = [{ id: 'aaaa1111', pasta: '/x/a', criadoEm: 1, claudeSessionId: UA }];
  const m = montar({ lista });
  fs.writeFileSync(path.join(m.pastaEventos, 'aaaa1111.jsonl'), [
    JSON.stringify({ t: 5, tipo: 'prompt', texto: 'x', session_id: UA, pid: 100 }),
    JSON.stringify({ t: 6, tipo: 'stop', session_id: UB, pid: 200 }),
  ].join('\n') + '\n');
  m.g.restaurar();
  assert.equal(carregarLista(m.arquivoLista)[0].claudeSessionId, UA);
  assert.deepEqual(m.ptys[0].cfg.argv, ['claude', '--resume', UA]);
});

test('encerrarTudo antes de restaurar não apaga a lista salva (I5)', () => {
  const lista = [{ id: 'aaaa1111', pasta: '/x/a', criadoEm: 1, claudeSessionId: UA }];
  const m = montar({ lista });
  m.g.encerrarTudo();
  assert.deepEqual(carregarLista(m.arquivoLista).map((s) => s.id), ['aaaa1111']);
});

test('--resume que sai sem nenhum evento oferece começar conversa nova (M3)', () => {
  const lista = [{ id: 'aaaa1111', pasta: '/x/a', criadoEm: 1, claudeSessionId: UA }];
  const m = montar({ lista });
  fs.writeFileSync(path.join(m.pastaEventos, 'aaaa1111.jsonl'), JSON.stringify({ t: 5, tipo: 'prompt', texto: 'antigo', session_id: UA }) + '\n');
  m.g.restaurar();
  assert.equal(m.cartao('aaaa1111').podeRecomecar, false, 'vivo');
  m.ptys[0].aoDados('No conversation found with session ID: ' + UA + '\r\n');
  m.ptys[0].aoSair(1);
  assert.equal(m.cartao('aaaa1111').estado.cor, 'preto');
  assert.equal(m.cartao('aaaa1111').podeRecomecar, true);
  m.g.recomecar('aaaa1111');
  assert.deepEqual(m.ptys[1].cfg.argv, ['claude'], 'conversa nova');
  assert.deepEqual(m.retomados, [['aaaa1111', 1]], 'a tela limpa o terminal antes');
  assert.equal(carregarLista(m.arquivoLista)[0].claudeSessionId, null);
  assert.equal(fs.existsSync(path.join(m.pastaEventos, 'aaaa1111.jsonl')), false, 'eventos velhos não trazem o id morto de volta');
  m.g.recomecar('aaaa1111'); // viva: não faz nada
  assert.equal(m.ptys.length, 2);
});

test('sessão que chegou a ter evento, ou sem --resume, não oferece conversa nova (M3)', () => {
  const { g, ptys, cartao } = montar();
  const a = g.nova('/x/a');
  ptys[0].aoSair(1);
  assert.equal(cartao(a).podeRecomecar, false, 'sem --resume');
  const lista = [{ id: 'bbbb2222', pasta: '/x/b', criadoEm: 1, claudeSessionId: UA }];
  const m = montar({ lista });
  m.g.restaurar();
  m.relogio.t += 10;
  m.evento('bbbb2222', { t: m.relogio.t, tipo: 'inicio', session_id: UA });
  m.ptys[0].aoSair(0);
  assert.equal(m.cartao('bbbb2222').podeRecomecar, false);
});

test('--resume que morreu no diálogo de confiança, com a conversa no disco, não oferece apagar (N3)', () => {
  const lista = [{ id: 'aaaa1111', pasta: '/Users/m', criadoEm: 1, claudeSessionId: UA }];
  const m = montar({ lista });
  const projeto = path.join(m.pastaProjetos, '-Users-m');
  fs.mkdirSync(projeto);
  fs.writeFileSync(path.join(projeto, UA + '.jsonl'), '{}\n');
  m.g.restaurar();
  m.ptys[0].aoSair(130); // Ctrl+C no diálogo de confiança
  const c = m.cartao('aaaa1111');
  assert.equal(c.estado.cor, 'preto');
  assert.equal(c.podeRecomecar, false, 'a conversa existe: só Retomar');
  m.g.recomecar('aaaa1111');
  assert.equal(m.ptys.length, 1, 'recomecar também recusa');
  assert.equal(carregarLista(m.arquivoLista)[0].claudeSessionId, UA);
});

// Funções novas: grupos, fechadas, histórico, avisos e classificação.

const lerHistorico = (pasta) => {
  const caminho = path.join(pasta, 'historico.jsonl');
  if (!fs.existsSync(caminho)) return [];
  return fs.readFileSync(caminho, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
};
const esperarPromessas = () => new Promise((r) => setImmediate(r));

test('fechar sessão com conversa (UUID) entra nas fechadas; sem conversa não', () => {
  const { g, relogio, evento } = montar();
  const a = g.nova('/x/a');
  const b = g.nova('/x/b');
  relogio.t += 10;
  evento(a, { t: relogio.t, tipo: 'prompt', texto: 'oi', session_id: UA });
  g.renomear(a, 'Etiqueta');
  g.fechar(a);
  g.fechar(b);
  const f = g.listarFechadas();
  assert.equal(f.length, 1);
  assert.equal(f[0].id, a);
  assert.equal(f[0].nome, 'Etiqueta');
  assert.equal(f[0].fechadaEm, relogio.t);
});

test('fechadas sobrevivem a abrir o gerente de novo (mesmo arquivo)', () => {
  const m = montar();
  const a = m.g.nova('/x/a');
  m.relogio.t += 10;
  m.evento(a, { t: m.relogio.t, tipo: 'prompt', texto: 'oi', session_id: UA });
  m.g.fechar(a);
  const g2 = criarGerente({
    abrirPty: () => ({ escrever() {}, redimensionar() {}, matar() {} }), agora: () => m.relogio.t,
    pastaEventos: m.pastaEventos, arquivoLista: m.arquivoLista, pastaProjetos: m.pastaProjetos,
  });
  assert.deepEqual(g2.listarFechadas().map((f) => f.id), [a]);
});

test('reabrirFechada sem id reabre a mais nova com nome, cor e --resume da conversa', () => {
  const { g, relogio, evento, cartao, ptys, arquivoLista } = montar();
  const a = g.nova('/x/a');
  const b = g.nova('/x/b');
  relogio.t += 10;
  evento(a, { t: relogio.t, tipo: 'prompt', texto: 'oi', session_id: UA });
  evento(b, { t: relogio.t, tipo: 'prompt', texto: 'oi', session_id: UB });
  g.renomear(a, 'Etiqueta');
  g.trocarCor(a, PALETA[5]);
  g.fechar(b);
  relogio.t += 10;
  g.fechar(a);
  const id = g.reabrirFechada();
  assert.equal(id, a);
  const c = cartao(a);
  assert.equal(c.nome, 'Etiqueta');
  assert.equal(c.cor, PALETA[5]);
  assert.deepEqual(ptys[ptys.length - 1].cfg.argv, ['claude', '--resume', UA]);
  assert.deepEqual(g.listarFechadas().map((f) => f.id), [b]);
  assert.ok(carregarLista(arquivoLista).some((s) => s.id === a && s.claudeSessionId === UA));
  // Com id: reabre aquela.
  assert.equal(g.reabrirFechada(b), b);
  assert.deepEqual(ptys[ptys.length - 1].cfg.argv, ['claude', '--resume', UB]);
  assert.deepEqual(g.listarFechadas(), []);
  assert.equal(g.reabrirFechada(), null, 'lista vazia: nada a reabrir');
  assert.equal(g.reabrirFechada('naoexiste'), null);
});

test('reabrir fechada cujo grupo foi apagado volta sem grupo (Review Focus 2)', () => {
  const { g, relogio, evento, cartao } = montar();
  const a = g.nova('/x/a');
  const b = g.nova('/x/b');
  relogio.t += 10;
  evento(a, { t: relogio.t, tipo: 'prompt', texto: 'oi', session_id: UA });
  evento(b, { t: relogio.t, tipo: 'prompt', texto: 'oi', session_id: UB });
  const { id: gx } = g.criarGrupo('Viagem');
  const gy = g.listarGrupos()[0].id;
  g.moverParaGrupo(a, gx);
  g.moverParaGrupo(b, gy);
  assert.equal(cartao(a).grupoId, gx);
  g.fechar(a);
  g.fechar(b);
  g.apagarGrupo(gx);
  g.reabrirFechada(a);
  g.reabrirFechada(b);
  assert.equal(cartao(a).grupoId, null);
  assert.equal(cartao(b).grupoId, gy, 'grupo que existe fica');
});

test('descreverGrupo grava a descrição e rejeita grupo inexistente ou texto longo', () => {
  const { g } = montar();
  const { id } = g.criarGrupo('Viagem');
  g.descreverGrupo(id, 'Passeios e reservas');
  assert.equal(g.listarGrupos().find((x) => x.id === id).descricao, 'Passeios e reservas');
  assert.throws(() => g.descreverGrupo('nada', 'x'), /grupo não encontrado/);
  assert.throws(() => g.descreverGrupo(id, 'x'.repeat(201)), /descrição inválida/);
});

test('grupos: iniciais, criar, renomear, apagar (sessões vão para Sem grupo), nome inválido dá erro', () => {
  const { g, cartao } = montar();
  assert.deepEqual(g.listarGrupos().map((x) => x.nome), ['Pedidos', 'Vendas', 'Financeiro', 'Marketing', 'Impostos', 'Relatórios', 'Freelas', 'Geral']);
  const novo = g.criarGrupo('  Viagem ');
  assert.equal(novo.nome, 'Viagem');
  assert.throws(() => g.criarGrupo('viagem'), /nome inválido/);
  assert.throws(() => g.criarGrupo(''), /nome inválido/);
  g.renomearGrupo(novo.id, 'Viagens');
  assert.equal(g.listarGrupos().find((x) => x.id === novo.id).nome, 'Viagens');
  const a = g.nova('/x/a');
  g.moverParaGrupo(a, novo.id);
  g.apagarGrupo(novo.id);
  assert.equal(cartao(a).grupoId, null);
  assert.ok(!g.listarGrupos().some((x) => x.id === novo.id));
  // Apagar todos: a lista vazia fica salva.
  for (const x of g.listarGrupos()) g.apagarGrupo(x.id);
  assert.deepEqual(g.listarGrupos(), []);
});

test('moverParaGrupo grava grupoManual; grupo desconhecido é ignorado; null tira do grupo', () => {
  const { g, cartao, arquivoLista } = montar();
  const a = g.nova('/x/a');
  const gid = g.listarGrupos()[1].id;
  g.moverParaGrupo(a, 'naoexiste');
  assert.equal(cartao(a).grupoId, null);
  assert.equal(carregarLista(arquivoLista)[0].grupoManual, false);
  g.moverParaGrupo(a, gid);
  assert.equal(cartao(a).grupoId, gid);
  assert.equal(carregarLista(arquivoLista)[0].grupoManual, true);
  g.moverParaGrupo(a, null);
  assert.equal(cartao(a).grupoId, null);
  assert.equal(carregarLista(arquivoLista)[0].grupoManual, true, 'Sem grupo escolhido à mão também é definitivo');
});

test('prompt e stop gravam um registro só no histórico, por mais releituras que haja', () => {
  const { g, relogio, evento, pasta } = montar();
  const a = g.nova('/x/a');
  g.renomear(a, 'Etiqueta');
  const t0 = relogio.t + 10;
  evento(a, { t: t0, tipo: 'prompt', texto: 'oi', pid: 7 });
  evento(a, { t: t0 + 5000, tipo: 'stop', pid: 7 });
  g.recalcular();
  g.aoMudarEventos(a);
  relogio.t += 6 * 60000;
  g.recalcular();
  const h = lerHistorico(pasta);
  assert.equal(h.length, 1);
  assert.deepEqual(h[0], { sessaoId: a, nome: 'Etiqueta', grupoId: null, inicio: t0, fim: t0 + 5000 });
});

test('histórico: hook atrasado depois da saída do processo não grava o pedaço de novo', () => {
  const { g, relogio, evento, ptys, pasta } = montar();
  const a = g.nova('/x/a');
  const t0 = relogio.t + 10;
  evento(a, { t: t0, tipo: 'prompt', texto: 'oi' });
  evento(a, { t: t0 + 1000, tipo: 'pre_tool', ferramenta: 'Bash' });
  relogio.t = t0 + 2000;
  ptys[0].aoSair(0);
  assert.deepEqual(lerHistorico(pasta).map((r) => [r.inicio, r.fim]), [[t0, t0 + 1000]]);
  evento(a, { t: t0 + 3000, tipo: 'post_tool', ferramenta: 'Bash' });
  g.recalcular();
  assert.deepEqual(lerHistorico(pasta).map((r) => [r.inicio, r.fim]), [[t0, t0 + 1000]]);
});

test('histórico e avisos só contam eventos do claude da sessão (filtro de pid)', () => {
  const { g, relogio, evento, pasta, avisos } = montar();
  const a = g.nova('/x/a');
  g.marcarFoco(false);
  const t0 = relogio.t + 10;
  evento(a, { t: t0, tipo: 'prompt', texto: 'roda', pid: 100 });
  evento(a, { t: t0 + 10, tipo: 'pre_tool', ferramenta: 'Bash', pid: 100 });
  evento(a, { t: t0 + 20, tipo: 'prompt', texto: 'aninhado', pid: 200 });
  evento(a, { t: t0 + 30, tipo: 'permissao', ferramenta: 'Bash', pid: 200 });
  evento(a, { t: t0 + 40, tipo: 'stop', pid: 200 });
  g.recalcular();
  assert.deepEqual(lerHistorico(pasta), []);
  assert.deepEqual(avisos, []);
  evento(a, { t: t0 + 50, tipo: 'stop', pid: 100 });
  assert.deepEqual(lerHistorico(pasta).map((r) => [r.inicio, r.fim]), [[t0, t0 + 50]]);
  assert.deepEqual(avisos.map((x) => x.tipo), ['terminou']);
});

test('fechar e encerrarTudo fecham o pedaço aberto no último evento', () => {
  const { g, relogio, evento, pasta } = montar();
  const a = g.nova('/x/a');
  const b = g.nova('/x/b');
  const t0 = relogio.t + 10;
  evento(a, { t: t0, tipo: 'prompt', texto: 'oi' });
  evento(a, { t: t0 + 100, tipo: 'pre_tool', ferramenta: 'Bash' });
  evento(b, { t: t0, tipo: 'prompt', texto: 'oi' });
  evento(b, { t: t0 + 200, tipo: 'pre_tool', ferramenta: 'Bash' });
  g.fechar(a);
  g.encerrarTudo();
  assert.deepEqual(lerHistorico(pasta).map((r) => [r.sessaoId, r.fim - r.inicio]).sort(), [[a, 100], [b, 200]].sort());
});

test('estatisticas soma pelo grupo atual da sessão; dias só 7 ou 30', () => {
  const { g, relogio, evento } = montar();
  const a = g.nova('/x/a');
  const gid = g.listarGrupos()[0].id;
  const t0 = relogio.t + 10;
  evento(a, { t: t0, tipo: 'prompt', texto: 'oi' });
  evento(a, { t: t0 + 60000, tipo: 'stop' });
  g.moverParaGrupo(a, gid); // depois do registro: vale o grupo atual
  relogio.t = t0 + 120000;
  const e = g.estatisticas(7);
  assert.equal(e.totalMs, 60000);
  assert.deepEqual(e.porGrupo.map((x) => [x.grupoId, x.nome, x.ms]), [[gid, 'Pedidos', 60000]]);
  assert.equal(e.topSessoes[0].sessaoId, a);
  assert.equal(g.estatisticas(30).totalMs, 60000);
  relogio.t = t0 + 8 * 24 * 3600000;
  assert.equal(g.estatisticas(7).totalMs, 0);
  assert.equal(g.estatisticas(30).totalMs, 60000);
  assert.throws(() => g.estatisticas(15), /dias/);
});

test('aprovação e depois duas ferramentas e releituras: um aviso "precisa" só (Review Focus 5)', () => {
  const { g, relogio, evento, avisos } = montar();
  const a = g.nova('/x/a');
  g.renomear(a, 'Etiqueta');
  g.marcarFoco(false);
  relogio.t += 10;
  evento(a, { t: relogio.t, tipo: 'prompt', texto: 'oi' });
  evento(a, { t: relogio.t + 1, tipo: 'pre_tool', ferramenta: 'Bash', tool_use_id: 'u1' });
  evento(a, { t: relogio.t + 2, tipo: 'permissao', ferramenta: 'Bash' });
  evento(a, { t: relogio.t + 3, tipo: 'pre_tool', ferramenta: 'Read', tool_use_id: 'u2', agente: 'x' });
  evento(a, { t: relogio.t + 4, tipo: 'pre_tool', ferramenta: 'Grep', tool_use_id: 'u3', agente: 'x' });
  evento(a, { t: relogio.t + 6000, tipo: 'notificacao', notificacao: 'permission_prompt' });
  for (let i = 0; i < 3; i++) { relogio.t += 5000; g.recalcular(); }
  assert.equal(avisos.length, 1);
  assert.deepEqual(avisos[0], { sessaoId: a, tipo: 'precisa', titulo: 'Etiqueta', texto: 'Pede aprovação.' });
  // Respondida e outra aprovação depois: novo aviso.
  evento(a, { t: relogio.t, tipo: 'post_tool', ferramenta: 'Bash', tool_use_id: 'u1' });
  g.recalcular();
  evento(a, { t: relogio.t + 1, tipo: 'pre_tool', ferramenta: 'Bash', tool_use_id: 'u4' });
  evento(a, { t: relogio.t + 2, tipo: 'permissao', ferramenta: 'Bash' });
  assert.equal(avisos.length, 2);
  assert.equal(avisos[1].tipo, 'precisa');
});

test('pergunta do claude dá aviso "precisa" com o motivo', () => {
  const { g, relogio, evento, avisos } = montar();
  const a = g.nova('/x/a');
  g.marcarFoco(false);
  relogio.t += 10;
  evento(a, { t: relogio.t, tipo: 'prompt', texto: 'oi' });
  evento(a, { t: relogio.t + 1, tipo: 'pre_tool', ferramenta: 'AskUserQuestion', tool_use_id: 'q1' });
  assert.deepEqual(avisos.map((x) => [x.tipo, x.texto]), [['precisa', 'Te fez uma pergunta.']]);
});

test('stop dá um aviso "terminou" só, nem o idle_prompt depois nem as releituras repetem', () => {
  const { g, relogio, evento, avisos } = montar();
  const a = g.nova('/x/a');
  g.marcarFoco(false);
  relogio.t += 10;
  evento(a, { t: relogio.t, tipo: 'prompt', texto: 'oi' });
  evento(a, { t: relogio.t + 10, tipo: 'stop' });
  g.recalcular();
  relogio.t += 60000;
  evento(a, { t: relogio.t, tipo: 'notificacao', notificacao: 'idle_prompt' });
  relogio.t += 4 * 60000;
  g.recalcular(); // vira "não viu": não avisa de novo
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].tipo, 'terminou');
  assert.equal(avisos[0].sessaoId, a);
  // Próxima vez: outro aviso.
  evento(a, { t: relogio.t, tipo: 'prompt', texto: 'de novo' });
  evento(a, { t: relogio.t + 10, tipo: 'stop' });
  assert.deepEqual(avisos.map((x) => x.tipo), ['terminou', 'terminou']);
});

test('sessão selecionada com a janela em foco não avisa; sem foco avisa', () => {
  const { g, relogio, evento, avisos } = montar();
  const a = g.nova('/x/a');
  g.selecionar(a);
  relogio.t += 10;
  evento(a, { t: relogio.t, tipo: 'prompt', texto: 'oi' });
  evento(a, { t: relogio.t + 1, tipo: 'permissao', ferramenta: 'Bash' });
  evento(a, { t: relogio.t + 2, tipo: 'stop' });
  assert.deepEqual(avisos, []);
  const b = g.nova('/x/b'); // outra sessão, com a mesma janela focada: avisa
  evento(b, { t: relogio.t + 3, tipo: 'prompt', texto: 'oi' });
  evento(b, { t: relogio.t + 4, tipo: 'stop' });
  assert.deepEqual(avisos.map((x) => [x.sessaoId, x.tipo]), [[b, 'terminou']]);
  g.marcarFoco(false);
  evento(a, { t: relogio.t + 5, tipo: 'prompt', texto: 'oi' });
  evento(a, { t: relogio.t + 6, tipo: 'stop' });
  assert.deepEqual(avisos.map((x) => [x.sessaoId, x.tipo]), [[b, 'terminou'], [a, 'terminou']]);
});

test('eventos de antes desta execução não avisam (restaurar)', () => {
  const m = montar({ lista: [{ id: 'aaaa1111', pasta: '/x/a', criadoEm: 1, claudeSessionId: UA }] });
  fs.writeFileSync(path.join(m.pastaEventos, 'aaaa1111.jsonl'),
    JSON.stringify({ t: 10, tipo: 'prompt', texto: 'oi' }) + '\n' + JSON.stringify({ t: 20, tipo: 'stop' }) + '\n' +
    JSON.stringify({ t: 30, tipo: 'permissao', ferramenta: 'Bash' }) + '\n');
  m.g.marcarFoco(false);
  m.g.restaurar();
  m.g.recalcular();
  assert.deepEqual(m.avisos, []);
  assert.deepEqual(lerHistorico(m.pasta), []);
});

test('"confirme a pasta" conta no Dock mas não avisa; contarVermelhos soma todos os vermelhos', () => {
  const { g, relogio, evento, avisos } = montar({ casa: '/Users/m' });
  g.marcarFoco(false);
  g.nova('/Users/m');
  const b = g.nova('/x/b');
  assert.equal(g.contarVermelhos(), 0);
  relogio.t += 11000;
  g.recalcular();
  assert.equal(g.contarVermelhos(), 2, 'as duas sem nenhum evento ficam em confirme a pasta');
  assert.deepEqual(avisos, []);
  evento(b, { t: relogio.t, tipo: 'prompt', texto: 'oi' });
  evento(b, { t: relogio.t + 1, tipo: 'permissao', ferramenta: 'Bash' });
  assert.equal(g.contarVermelhos(), 2);
  assert.deepEqual(avisos.map((x) => x.tipo), ['precisa']);
});

test('primeiro pedido chama classificar uma vez e grava o grupo; correção manual depois vence', async () => {
  const chamadas = [];
  let devolver = null;
  const m = montar({ classificar: (s, pedido) => { chamadas.push([s.id, s.nomeCartao, pedido]); return Promise.resolve(devolver); } });
  const { g, relogio, evento, cartao, arquivoLista } = m;
  const gid = g.listarGrupos()[0].id;
  devolver = gid;
  const a = g.nova('/x/Pedidos');
  relogio.t += 10;
  evento(a, { t: relogio.t, tipo: 'prompt', texto: 'etiqueta da filial' });
  evento(a, { t: relogio.t + 1, tipo: 'stop' });
  evento(a, { t: relogio.t + 2, tipo: 'prompt', texto: 'outro' });
  await esperarPromessas();
  assert.deepEqual(chamadas, [[a, 'Pedidos', 'etiqueta da filial']]);
  assert.equal(cartao(a).grupoId, gid);
  assert.equal(carregarLista(arquivoLista)[0].classificada, 1);
  assert.equal(carregarLista(arquivoLista)[0].grupoManual, false);
  const outro = g.listarGrupos()[2].id;
  g.moverParaGrupo(a, outro);
  g.renomear(a, 'Nome novo');
  evento(a, { t: relogio.t + 3, tipo: 'prompt', texto: 'mais' });
  await esperarPromessas();
  assert.equal(chamadas.length, 1);
  assert.equal(cartao(a).grupoId, outro);
});

test('resposta do classificar que chega depois da correção manual não muda o grupo', async () => {
  let resolver;
  const m = montar({ classificar: () => new Promise((r) => { resolver = r; }) });
  const { g, relogio, evento, cartao } = m;
  const [g1, g2] = g.listarGrupos();
  const a = g.nova('/x/a');
  evento(a, { t: relogio.t + 10, tipo: 'prompt', texto: 'oi' });
  g.moverParaGrupo(a, g2.id);
  resolver(g1.id);
  await esperarPromessas();
  assert.equal(cartao(a).grupoId, g2.id);
});

test('classificar: sem resposta, tenta mais uma vez quando o nome muda; desligado não chama', async () => {
  const chamadas = [];
  const m = montar({ classificar: (s, pedido) => { chamadas.push([s.nomeCartao, pedido]); return Promise.resolve(null); } });
  const { g, relogio, evento, cartao, arquivoLista } = m;
  const a = g.nova('/x/a');
  evento(a, { t: relogio.t + 10, tipo: 'prompt', texto: 'oi' });
  await esperarPromessas();
  assert.equal(chamadas.length, 1);
  g.definirTitulo(a, '✳ Etiqueta da filial');
  await esperarPromessas();
  assert.deepEqual(chamadas[1], ['Etiqueta da filial', 'oi']);
  assert.equal(carregarLista(arquivoLista)[0].classificada, 2);
  g.renomear(a, 'Terceiro nome');
  await esperarPromessas();
  assert.equal(chamadas.length, 2, 'só uma segunda tentativa');
  assert.equal(cartao(a).grupoId, null);

  // Configuração desligada: nenhuma chamada.
  assert.deepEqual(g.lerConfig(), { classificar: true, tamanhoFonte: 13 });
  g.definirConfig({ classificar: false });
  assert.deepEqual(g.lerConfig(), { classificar: false, tamanhoFonte: 13 });
  g.definirConfig({ tamanhoFonte: 16 });
  assert.deepEqual(g.lerConfig(), { classificar: false, tamanhoFonte: 16 }, 'campo ausente mantém o outro');
  assert.throws(() => g.definirConfig({ tamanhoFonte: 25 }));
  assert.equal(g.lerConfig().tamanhoFonte, 16);
  g.definirConfig({ classificar: true, tamanhoFonte: 13 });
  g.definirConfig({ classificar: false });
  const b = g.nova('/x/b');
  evento(b, { t: relogio.t + 20, tipo: 'prompt', texto: 'oi' });
  await esperarPromessas();
  assert.equal(chamadas.length, 2);
});

test('classificar que falha deixa Sem grupo calado', async () => {
  const m = montar({ classificar: () => Promise.reject(new Error('sem rede')) });
  const a = m.g.nova('/x/a');
  m.evento(a, { t: m.relogio.t + 10, tipo: 'prompt', texto: 'oi' });
  await esperarPromessas();
  assert.equal(m.cartao(a).grupoId, null);
});

// Rodada 1 de correções.

test('antes de restaurar, ⌘⇧T e ⌘T não fazem nada e não apagam a lista salva', () => {
  const lista = [{ id: 'aaaa1111', pasta: '/x/A', criadoEm: 1, claudeSessionId: UA }, { id: 'bbbb2222', pasta: '/x/B', criadoEm: 2, claudeSessionId: UB }];
  const m = montar({ lista });
  fs.writeFileSync(path.join(m.pasta, 'fechadas.json'), JSON.stringify([{ id: 'cccc3333', pasta: '/x/C', claudeSessionId: UC, fechadaEm: 5 }]));
  const g = criarGerente({
    abrirPty: (s, cfg) => { m.ptys.push({ sessao: s, cfg }); return { escrever() {}, redimensionar() {}, matar() {} }; },
    agora: () => m.relogio.t, pastaEventos: m.pastaEventos, arquivoLista: m.arquivoLista, pastaProjetos: m.pastaProjetos,
  });
  assert.equal(g.reabrirFechada(), null);
  assert.equal(g.nova('/x/D'), null);
  assert.deepEqual(m.ptys.length, 0);
  assert.deepEqual(carregarLista(m.arquivoLista).map((s) => s.id), ['aaaa1111', 'bbbb2222']);
  assert.deepEqual(g.listarFechadas().map((f) => f.id), ['cccc3333'], 'a fechada continua na lista');
  g.restaurar();
  assert.deepEqual(m.ptys.map((p) => p.sessao.id), ['aaaa1111', 'bbbb2222']);
  assert.equal(g.reabrirFechada(), 'cccc3333');
  assert.deepEqual(carregarLista(m.arquivoLista).map((s) => s.id), ['aaaa1111', 'bbbb2222', 'cccc3333']);
});

test('stop com subagente ainda pedindo aprovação: Pop com o texto do subagente', () => {
  const { g, relogio, evento, avisos } = montar();
  const a = g.nova('/x/a');
  g.marcarFoco(false);
  relogio.t += 10;
  evento(a, { t: relogio.t, tipo: 'prompt', texto: 'oi' });
  evento(a, { t: relogio.t + 1, tipo: 'pre_tool', ferramenta: 'Bash', tool_use_id: 's1', agente: 'x' });
  evento(a, { t: relogio.t + 2, tipo: 'permissao', ferramenta: 'Bash', agente: 'x' });
  evento(a, { t: relogio.t + 3, tipo: 'stop' });
  assert.deepEqual(avisos.map((x) => [x.tipo, x.texto]), [
    ['precisa', 'Pede aprovação.'],
    ['terminou', 'Terminou, mas um subagente ainda pede aprovação.'],
  ]);
});

test('reabrir fechada cuja conversa já está aberta noutro cartão: seleciona esse e tira da lista', () => {
  const { g, relogio, evento, ptys, cartao } = montar();
  const a = g.nova('/x/a');
  const b = g.nova('/x/b');
  relogio.t += 10;
  evento(a, { t: relogio.t, tipo: 'prompt', texto: 'oi', session_id: UA });
  g.fechar(a);
  evento(b, { t: relogio.t + 1, tipo: 'prompt', texto: 'oi', session_id: UA }); // retomou a mesma conversa
  const antes = ptys.length;
  assert.equal(g.reabrirFechada(), b);
  assert.equal(ptys.length, antes, 'nenhum --resume a mais');
  assert.equal(cartao(b).selecionada, true);
  assert.equal(cartao(a), undefined);
  assert.deepEqual(g.listarFechadas(), []);
});

test('renomearGrupo de id desconhecido dá "grupo não encontrado"', () => {
  const { g } = montar();
  assert.throws(() => g.renomearGrupo('naoexiste', 'Outro'), /grupo não encontrado/);
});

test('reabrirFechada devolve sempre a sessão que ficou selecionada (os dois caminhos)', () => {
  const { g, relogio, evento, cartao } = montar();
  const a = g.nova('/x/a');
  const b = g.nova('/x/b');
  const c = g.nova('/x/c');
  relogio.t += 10;
  evento(a, { t: relogio.t, tipo: 'prompt', texto: 'oi', session_id: UA });
  evento(b, { t: relogio.t, tipo: 'prompt', texto: 'oi', session_id: UB });
  g.fechar(a);
  g.fechar(b);
  evento(c, { t: relogio.t + 1, tipo: 'prompt', texto: 'oi', session_id: UA });
  g.selecionar(c);
  const reaberta = g.reabrirFechada(b); // caminho normal
  assert.equal(reaberta, b);
  assert.deepEqual(g.listar().filter((x) => x.selecionada).map((x) => x.id), [b]);
  const jaAberta = g.reabrirFechada(a); // conversa aberta no cartão c
  assert.equal(jaAberta, c);
  assert.deepEqual(g.listar().filter((x) => x.selecionada).map((x) => x.id), [c]);
  assert.equal(cartao(a), undefined);
});

test('página aberta: a selecionada não conta como na tela, avisa e não vira vista (M1)', () => {
  const { g, relogio, evento, cartao, avisos } = montar();
  const a = g.nova('/x/a');
  g.selecionar(a); // janela focada
  g.marcarPagina(true);
  relogio.t += 10;
  evento(a, { t: relogio.t, tipo: 'prompt', texto: 'oi' });
  evento(a, { t: relogio.t + 10, tipo: 'stop' });
  assert.deepEqual(avisos.map((x) => x.tipo), ['terminou']);
  relogio.t += 4 * 60000;
  g.recalcular();
  assert.equal(cartao(a).estado.cor, 'vermelho', 'pronta, você ainda não viu');
  // Aprovação com a página aberta também avisa.
  evento(a, { t: relogio.t, tipo: 'prompt', texto: 'mais' });
  evento(a, { t: relogio.t + 1, tipo: 'pre_tool', ferramenta: 'Bash', tool_use_id: 'u1' });
  evento(a, { t: relogio.t + 2, tipo: 'permissao', ferramenta: 'Bash' });
  assert.deepEqual(avisos.map((x) => x.tipo), ['terminou', 'precisa']);
  // Página fechada com a janela na frente: a sessão volta à tela.
  evento(a, { t: relogio.t + 3, tipo: 'post_tool', ferramenta: 'Bash', tool_use_id: 'u1' });
  evento(a, { t: relogio.t + 20, tipo: 'stop' });
  assert.equal(avisos.length, 3);
  relogio.t += 30;
  g.marcarPagina(false);
  relogio.t += 4 * 60000;
  g.recalcular();
  assert.equal(cartao(a).estado.cor, 'verde');
  relogio.t += 10;
  evento(a, { t: relogio.t, tipo: 'prompt', texto: 'outra' });
  evento(a, { t: relogio.t + 10, tipo: 'stop' });
  assert.equal(avisos.length, 3, 'na tela de novo: não avisa');
});

test('fechar a página sem a janela em foco não marca como vista', () => {
  const { g, relogio, evento, cartao } = montar();
  const a = g.nova('/x/a');
  g.selecionar(a);
  g.marcarPagina(true);
  g.marcarFoco(false);
  relogio.t += 10;
  evento(a, { t: relogio.t, tipo: 'prompt', texto: 'oi' });
  evento(a, { t: relogio.t + 10, tipo: 'stop' });
  g.marcarPagina(false);
  relogio.t += 4 * 60000;
  g.recalcular();
  assert.equal(cartao(a).estado.cor, 'vermelho');
});

// Não fechar sem /salvar.

const adiarNaHora = { adiar: (fn) => fn() };

function sessaoComPedido(m, pasta = '/x/a') {
  const id = m.g.nova(pasta);
  m.relogio.t += 10;
  m.evento(id, { t: m.relogio.t, tipo: 'inicio', session_id: UA });
  m.evento(id, { t: m.relogio.t, tipo: 'prompt', texto: 'ajustar etiqueta', session_id: UA });
  m.relogio.t += 10;
  m.evento(id, { t: m.relogio.t, tipo: 'stop', session_id: UA });
  return id;
}

test('cartão diz se a sessão está salva: sem pedido sim, com pedido não, depois do /salvar sim', () => {
  const m = montar();
  const { g, relogio, evento, cartao } = m;
  const vazia = g.nova('/x/v');
  assert.equal(cartao(vazia).salva, true);
  assert.equal(cartao(vazia).salvando, null);
  const id = sessaoComPedido(m);
  assert.equal(cartao(id).salva, false);
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'prompt', texto: '/salvar' });
  assert.equal(cartao(id).salva, false, 'o turno do /salvar ainda roda');
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'stop' });
  assert.equal(cartao(id).salva, true);
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'prompt', texto: 'mais uma coisa' });
  assert.equal(cartao(id).salva, false);
  assert.equal(g.contarNaoSalvas(), 1);
});

test('estado salvo sobrevive a reabrir o app (vem do arquivo de eventos)', () => {
  const m = montar();
  const id = sessaoComPedido(m);
  m.relogio.t += 10;
  m.evento(id, { t: m.relogio.t, tipo: 'prompt', texto: '/salvar resumo' });
  m.evento(id, { t: m.relogio.t + 1, tipo: 'stop' });
  const g2 = criarGerente({
    abrirPty: () => ({ escrever() {}, redimensionar() {}, matar() {} }), agora: () => m.relogio.t + 100,
    pastaEventos: m.pastaEventos, arquivoLista: m.arquivoLista, pastaProjetos: m.pastaProjetos, casa: '/Users/m',
  });
  g2.restaurar();
  assert.equal(g2.listar().find((c) => c.id === id).salva, true);
});

test('Salvar e fechar digita /salvar e Enter, e fecha só depois do fim do turno do /salvar', () => {
  const m = montar(adiarNaHora);
  const { g, relogio, evento, cartao, ptys } = m;
  const id = sessaoComPedido(m);
  g.salvarEFechar(id);
  assert.deepEqual(ptys[0].escrito, ['/salvar', '\r']);
  assert.equal(cartao(id).salvando, 'fechar');
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'prompt', texto: '/salvar' });
  evento(id, { t: relogio.t, tipo: 'pre_tool', ferramenta: 'Write', tool_use_id: 'w1' });
  assert.ok(cartao(id), 'ainda salvando');
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'post_tool', ferramenta: 'Write', tool_use_id: 'w1' });
  evento(id, { t: relogio.t, tipo: 'stop', session_id: UA });
  assert.equal(cartao(id), undefined, 'fechou');
  assert.equal(ptys[0].morto, true);
  assert.deepEqual(g.listarFechadas().map((f) => f.id), [id], 'vai para as fechadas como um fechar comum');
});

test('Salvar e fechar não conta como resposta, não marca como vista nem digitada', () => {
  const m = montar(adiarNaHora);
  const { g, relogio, evento, cartao, ptys } = m;
  const id = sessaoComPedido(m);
  g.marcarFoco(false);
  relogio.t += 4 * 60000;
  g.recalcular();
  assert.equal(cartao(id).estado.rotulo, 'pronta, você ainda não viu');
  g.salvarEFechar(id);
  ptys[0].aoDados('eco');
  g.recalcular();
  assert.equal(cartao(id).estado.rotulo, 'pronta, você ainda não viu', 'o vermelho segue');
});

test('Salvar e fechar com aprovação aberta espera a resposta antes de digitar', () => {
  const m = montar(adiarNaHora);
  const { g, relogio, evento, cartao, ptys } = m;
  const id = g.nova('/x/a');
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'inicio' });
  evento(id, { t: relogio.t, tipo: 'prompt', texto: 'build' });
  evento(id, { t: relogio.t, tipo: 'pre_tool', ferramenta: 'Bash', tool_use_id: 'b1' });
  evento(id, { t: relogio.t, tipo: 'permissao', ferramenta: 'Bash' });
  g.salvarEFechar(id);
  assert.deepEqual(ptys[0].escrito, [], 'o Enter aprovaria o comando');
  assert.equal(cartao(id).salvando, 'fechar');
  assert.equal(cartao(id).estado.cor, 'vermelho');
  relogio.t += 1000;
  g.escrever(id, '1'); // o usuário responde
  ptys[0].aoDados('rodando');
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'post_tool', ferramenta: 'Bash', tool_use_id: 'b1' });
  assert.deepEqual(ptys[0].escrito, ['1'], 'trabalhando: espera o fim da vez');
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'stop' });
  assert.deepEqual(ptys[0].escrito, ['1', '/salvar', '\r'], 'digita no fim da vez');
  assert.ok(cartao(id), 'o stop é do pedido de antes: o /salvar ainda não começou');
  evento(id, { t: relogio.t, tipo: 'prompt', texto: '/salvar' });
  evento(id, { t: relogio.t + 5, tipo: 'stop' });
  assert.equal(cartao(id), undefined);
});

test('Salvar e fechar em confirme a pasta espera o usuário confirmar', () => {
  const lista = [{ id: 'aaaa1111', pasta: '/Users/m', criadoEm: 1, claudeSessionId: UA }];
  const m = montar({ lista, ...adiarNaHora });
  const { g, relogio, evento, cartao, ptys } = m;
  fs.writeFileSync(path.join(m.pastaEventos, 'aaaa1111.jsonl'), JSON.stringify({ t: 1, tipo: 'prompt', texto: 'x' }) + '\n');
  g.restaurar();
  relogio.t += 11000;
  g.recalcular();
  assert.equal(cartao('aaaa1111').estado.rotulo, 'confirme a pasta');
  assert.equal(cartao('aaaa1111').salva, false, 'vale o histórico da conversa');
  g.salvarEFechar('aaaa1111');
  const p = ptys[ptys.length - 1];
  assert.deepEqual(p.escrito, [], 'o Enter confiaria na pasta');
  relogio.t += 10;
  evento('aaaa1111', { t: relogio.t, tipo: 'inicio' });
  assert.deepEqual(p.escrito, ['/salvar', '\r']);
});

test('Não fechar cancela a espera; o cartão fica aberto', () => {
  const m = montar(adiarNaHora);
  const { g, relogio, evento, cartao } = m;
  const id = sessaoComPedido(m);
  g.salvarEFechar(id);
  g.naoFechar(id);
  assert.equal(cartao(id).salvando, null);
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'prompt', texto: '/salvar' });
  evento(id, { t: relogio.t + 5, tipo: 'stop' });
  assert.ok(cartao(id), 'não fechou');
  assert.equal(cartao(id).salva, true);
});

test('Salvar e fechar com o /salvar já rodando não digita de novo', () => {
  const m = montar(adiarNaHora);
  const { g, relogio, evento, cartao, ptys } = m;
  const id = sessaoComPedido(m);
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'prompt', texto: '/salvar' });
  g.salvarEFechar(id);
  g.salvarEFechar(id); // segundo ⌘W com Salvar e fechar
  assert.deepEqual(ptys[0].escrito, []);
  evento(id, { t: relogio.t + 5, tipo: 'stop' });
  assert.equal(cartao(id), undefined);
});

test('Salvar e fechar duas vezes digita uma vez só', () => {
  const m = montar(adiarNaHora);
  const id = sessaoComPedido(m);
  m.g.salvarEFechar(id);
  m.g.salvarEFechar(id);
  assert.deepEqual(m.ptys[0].escrito, ['/salvar', '\r']);
});

test('o claude saiu no meio do Salvar e fechar: o cartão fica, preto e não salvo', () => {
  const m = montar(adiarNaHora);
  const id = sessaoComPedido(m);
  m.g.salvarEFechar(id);
  m.ptys[0].aoSair(0);
  const c = m.cartao(id);
  assert.equal(c.estado.cor, 'preto');
  assert.equal(c.salvando, null);
  assert.equal(c.salva, false);
});

test('Enter vai depois do texto; se a sessão fechou nesse meio tempo, nada é digitado', () => {
  const adiados = [];
  const m = montar({ adiar: (fn) => adiados.push(fn) });
  const id = sessaoComPedido(m);
  m.g.salvarEFechar(id);
  assert.deepEqual(m.ptys[0].escrito, ['/salvar']);
  adiados.shift()();
  assert.deepEqual(m.ptys[0].escrito, ['/salvar', '\r']);
  const outra = sessaoComPedido(m, '/x/b');
  m.g.salvarEFechar(outra);
  m.g.fechar(outra);
  adiados.shift()();
  assert.deepEqual(m.ptys[1].escrito, ['/salvar']);
});

test('Enter segura se um diálogo abriu depois do texto e vai quando ele sai', () => {
  const adiados = [];
  const m = montar({ adiar: (fn) => adiados.push(fn) });
  const { g, relogio, evento, ptys } = m;
  const id = sessaoComPedido(m);
  g.salvarEFechar(id); // pronta: digita o texto, o Enter vem depois
  assert.deepEqual(ptys[0].escrito, ['/salvar']);
  evento(id, { t: relogio.t, tipo: 'prompt', texto: 'outra coisa' });
  evento(id, { t: relogio.t, tipo: 'pre_tool', ferramenta: 'Bash', tool_use_id: 'b1' });
  evento(id, { t: relogio.t, tipo: 'permissao', ferramenta: 'Bash' });
  adiados.shift()();
  assert.deepEqual(ptys[0].escrito, ['/salvar'], 'o Enter aprovaria o comando');
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'post_tool', ferramenta: 'Bash', tool_use_id: 'b1' });
  assert.deepEqual(ptys[0].escrito, ['/salvar'], 'trabalhando: o Enter também espera o fim da vez');
  evento(id, { t: relogio.t + 1, tipo: 'stop' });
  assert.deepEqual(ptys[0].escrito, ['/salvar', '\r']);
});

test('Salvar e fechar numa sessão trabalhando: digita só no stop da vez atual e fecha só no stop do /salvar', () => {
  const m = montar(adiarNaHora);
  const { g, relogio, evento, cartao, ptys } = m;
  const id = g.nova('/x/a');
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'inicio' });
  evento(id, { t: relogio.t, tipo: 'prompt', texto: 'build' });
  evento(id, { t: relogio.t, tipo: 'pre_tool', ferramenta: 'Bash', tool_use_id: 'b1' });
  assert.equal(cartao(id).estado.cor, 'amarelo');
  g.salvarEFechar(id);
  assert.deepEqual(ptys[0].escrito, [], 'trabalhando: nada é digitado');
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'post_tool', ferramenta: 'Bash', tool_use_id: 'b1' });
  relogio.t += 6 * 60000;
  ptys[0].aoDados('ainda');
  g.recalcular();
  assert.deepEqual(ptys[0].escrito, [], 'ainda trabalhando');
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'stop' });
  assert.deepEqual(ptys[0].escrito, ['/salvar', '\r'], 'digita no stop da vez atual');
  assert.ok(cartao(id), 'esse stop é da vez de antes');
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'notificacao', notificacao: 'idle_prompt' });
  assert.ok(cartao(id), 'idle_prompt antes do prompt do /salvar não conta');
  evento(id, { t: relogio.t, tipo: 'prompt', texto: '/salvar' });
  evento(id, { t: relogio.t, tipo: 'pre_tool', ferramenta: 'Write', tool_use_id: 'w1' });
  evento(id, { t: relogio.t, tipo: 'post_tool', ferramenta: 'Write', tool_use_id: 'w1' });
  assert.ok(cartao(id), 'o /salvar ainda roda');
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'stop' });
  assert.equal(cartao(id), undefined, 'fechou no stop do /salvar');
});

test('sessão sem sinal (vez aberta) também espera o fim da vez para digitar', () => {
  const m = montar(adiarNaHora);
  const { g, relogio, evento, cartao, ptys } = m;
  const id = g.nova('/x/a');
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'inicio' });
  evento(id, { t: relogio.t, tipo: 'prompt', texto: 'build' });
  relogio.t += 2 * 60000;
  g.recalcular();
  assert.equal(cartao(id).estado.rotulo, 'sem sinal');
  g.salvarEFechar(id);
  assert.deepEqual(ptys[0].escrito, []);
  evento(id, { t: relogio.t, tipo: 'stop' });
  assert.deepEqual(ptys[0].escrito, ['/salvar', '\r']);
});

test('Salvar todas e sair: digita em todas as vivas não salvas e avisa quando a última termina', () => {
  const m = montar(adiarNaHora);
  const { g, relogio, evento, cartao, ptys } = m;
  const a = sessaoComPedido(m, '/x/a');
  const b = sessaoComPedido(m, '/x/b');
  const salva = sessaoComPedido(m, '/x/c');
  evento(salva, { t: relogio.t, tipo: 'prompt', texto: '/salvar' });
  evento(salva, { t: relogio.t + 1, tipo: 'stop' });
  const morta = sessaoComPedido(m, '/x/d');
  ptys[3].aoSair(0);
  assert.equal(g.contarNaoSalvas(), 2, 'a encerrada não conta: sair não fecha o cartão');
  let fim = 0;
  g.salvarTodas(() => { fim += 1; });
  assert.deepEqual(ptys[0].escrito, ['/salvar', '\r']);
  assert.deepEqual(ptys[1].escrito, ['/salvar', '\r']);
  assert.deepEqual(ptys[2].escrito, []);
  assert.equal(cartao(a).salvando, 'sair');
  assert.equal(cartao(morta).salvando, null);
  relogio.t += 10;
  evento(a, { t: relogio.t, tipo: 'prompt', texto: '/salvar' });
  evento(a, { t: relogio.t + 1, tipo: 'stop' });
  assert.equal(fim, 0);
  assert.equal(cartao(a).salvando, null, 'a salva não fecha: o app sai com ela aberta');
  assert.ok(cartao(a));
  evento(b, { t: relogio.t, tipo: 'prompt', texto: '/salvar' });
  evento(b, { t: relogio.t + 1, tipo: 'stop' });
  assert.equal(fim, 1);
  g.recalcular();
  assert.equal(fim, 1, 'avisa uma vez');
});

test('Salvar todas e sair sem nenhuma não salva avisa na hora; cancelar para a espera', () => {
  const m = montar(adiarNaHora);
  let fim = 0;
  m.g.salvarTodas(() => { fim += 1; });
  assert.equal(fim, 1);
  const a = sessaoComPedido(m);
  fim = 0;
  m.g.salvarTodas(() => { fim += 1; });
  m.g.cancelarSair();
  assert.equal(m.cartao(a).salvando, null);
  m.evento(a, { t: m.relogio.t, tipo: 'prompt', texto: '/salvar' });
  m.evento(a, { t: m.relogio.t + 1, tipo: 'stop' });
  assert.equal(fim, 0);
});

test('Salvar todas e sair: sessão que fecha ou cujo claude sai deixa de segurar a saída', () => {
  const m = montar(adiarNaHora);
  const a = sessaoComPedido(m, '/x/a');
  const b = sessaoComPedido(m, '/x/b');
  let fim = 0;
  m.g.salvarTodas(() => { fim += 1; });
  m.ptys[0].aoSair(0);
  assert.equal(fim, 0);
  m.g.fechar(b);
  assert.equal(fim, 1);
  assert.equal(m.cartao(a).salvando, null);
});

test('Salvar todas e sair com um Salvar e fechar em curso: espera ele fechar', () => {
  const m = montar(adiarNaHora);
  const a = sessaoComPedido(m, '/x/a');
  m.g.salvarEFechar(a);
  let fim = 0;
  m.g.salvarTodas(() => { fim += 1; });
  assert.deepEqual(m.ptys[0].escrito, ['/salvar', '\r'], 'não digita de novo');
  assert.equal(m.cartao(a).salvando, 'fechar');
  m.evento(a, { t: m.relogio.t, tipo: 'prompt', texto: '/salvar' });
  m.evento(a, { t: m.relogio.t + 1, tipo: 'stop' });
  assert.equal(m.cartao(a), undefined);
  assert.equal(fim, 1);
});

test('saiu no meio do /salvar (Sair sem salvar): ao reabrir, Salvar e fechar digita o /salvar', () => {
  const m = montar(adiarNaHora);
  const id = sessaoComPedido(m);
  m.relogio.t += 10;
  m.evento(id, { t: m.relogio.t, tipo: 'prompt', texto: '/salvar', session_id: UA });
  m.evento(id, { t: m.relogio.t + 1, tipo: 'pre_tool', ferramenta: 'Write', tool_use_id: 'w1' });
  m.g.encerrarTudo(); // Sair sem salvar com o /salvar no meio
  m.relogio.t += 60000;
  const escritos = [];
  const g2 = criarGerente({
    abrirPty: () => ({ escrever: (x) => escritos.push(x), redimensionar() {}, matar() {} }), agora: () => m.relogio.t,
    pastaEventos: m.pastaEventos, arquivoLista: m.arquivoLista, pastaProjetos: m.pastaProjetos, casa: '/Users/m', adiar: (fn) => fn(),
  });
  g2.restaurar();
  m.relogio.t += 10;
  fs.appendFileSync(path.join(m.pastaEventos, id + '.jsonl'), JSON.stringify({ t: m.relogio.t, tipo: 'inicio', session_id: UA }) + '\n');
  g2.aoMudarEventos(id);
  const c = () => g2.listar().find((x) => x.id === id);
  assert.equal(c().salva, false);
  // Um idle_prompt sozinho não completa o /salvar interrompido.
  fs.appendFileSync(path.join(m.pastaEventos, id + '.jsonl'), JSON.stringify({ t: m.relogio.t + 1, tipo: 'notificacao', notificacao: 'idle_prompt' }) + '\n');
  g2.aoMudarEventos(id);
  assert.equal(c().salva, false);
  g2.salvarEFechar(id);
  assert.deepEqual(escritos, ['/salvar', '\r']);
});

test('rascunho na caixa: Salvar e fechar não digita, avisa no cartão, para e deixa aberto', () => {
  const m = montar(adiarNaHora);
  const { g, relogio, cartao, ptys } = m;
  const id = sessaoComPedido(m);
  relogio.t += 1000;
  g.escrever(id, 'meio pedido');
  g.salvarEFechar(id);
  assert.deepEqual(ptys[0].escrito, ['meio pedido'], 'o /salvar grudaria no rascunho');
  assert.equal(cartao(id).rascunho, true);
  assert.equal(cartao(id).salvando, null);
  assert.ok(cartao(id));
  g.salvarEFechar(id); // tentou de novo sem mexer na caixa: segue bloqueado
  assert.deepEqual(ptys[0].escrito, ['meio pedido']);
  relogio.t += 1000;
  g.escrever(id, '\x7f'.repeat(11)); // apagou
  assert.equal(cartao(id).rascunho, false);
  g.salvarEFechar(id);
  assert.deepEqual(ptys[0].escrito.slice(-2), ['/salvar', '\r']);
});

test('tecla de resposta (número, Enter, setas) não conta como rascunho; pedido enviado esvazia a caixa', () => {
  const m = montar(adiarNaHora);
  const { g, relogio, evento, ptys } = m;
  const id = sessaoComPedido(m);
  relogio.t += 1000;
  g.escrever(id, '1');
  g.escrever(id, '\x1b[B');
  g.escrever(id, '\r');
  g.salvarEFechar(id);
  assert.deepEqual(ptys[0].escrito.slice(-2), ['/salvar', '\r']);
  const outra = sessaoComPedido(m, '/x/b');
  relogio.t += 1000;
  g.escrever(outra, 'novo pedido');
  g.escrever(outra, '\r');
  relogio.t += 10;
  evento(outra, { t: relogio.t, tipo: 'prompt', texto: 'novo pedido' });
  evento(outra, { t: relogio.t + 5, tipo: 'stop' });
  g.salvarEFechar(outra);
  assert.deepEqual(ptys[1].escrito.slice(-2), ['/salvar', '\r']);
});

test('rascunho no Salvar todas e sair: a sessão fica não salva e a espera termina sem ela', () => {
  const m = montar(adiarNaHora);
  const { g, relogio, evento, cartao, ptys } = m;
  const a = sessaoComPedido(m, '/x/a');
  const b = sessaoComPedido(m, '/x/b');
  relogio.t += 1000;
  g.escrever(b, 'rascunho');
  let fim = 0;
  g.salvarTodas(() => { fim += 1; });
  assert.deepEqual(ptys[1].escrito, ['rascunho']);
  assert.equal(cartao(b).rascunho, true);
  evento(a, { t: relogio.t, tipo: 'prompt', texto: '/salvar' });
  evento(a, { t: relogio.t + 1, tipo: 'stop' });
  assert.equal(fim, 1);
  assert.equal(g.contarNaoSalvas(), 1, 'o main mostra o diálogo de novo com ela');
});

test('Não fechar descarta o Enter pendente: o Atlas não tecla depois da desistência', () => {
  const adiados = [];
  const m = montar({ adiar: (fn) => adiados.push(fn) });
  const { g, relogio, evento, ptys } = m;
  const id = sessaoComPedido(m);
  g.salvarEFechar(id);
  evento(id, { t: relogio.t, tipo: 'notificacao', notificacao: 'agent_needs_input' });
  adiados.shift()();
  g.naoFechar(id);
  evento(id, { t: relogio.t + 5, tipo: 'notificacao', notificacao: 'idle_prompt' });
  assert.deepEqual(ptys[0].escrito, ['/salvar']);
});

test('sem "Terminou" no fim do turno do /salvar de um cartão que vai fechar', () => {
  const m = montar(adiarNaHora);
  const { g, relogio, evento, avisos } = m;
  const id = sessaoComPedido(m);
  g.marcarFoco(false);
  const antes = avisos.length;
  g.salvarEFechar(id);
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'prompt', texto: '/salvar' });
  evento(id, { t: relogio.t, tipo: 'pre_tool', ferramenta: 'Write' });
  evento(id, { t: relogio.t + 1, tipo: 'stop' });
  assert.equal(avisos.length, antes);
});

// Rascunho: estimativa da caixa do claude, tecla a tecla.

function digitouSalvar(m, id, teclas) {
  const p = m.ptys.find((x) => x.sessao.id === id);
  for (const t of teclas) m.g.escrever(id, t);
  const antes = p.escrito.length;
  m.g.salvarEFechar(id);
  const digitou = p.escrito.slice(antes).join('') === '/salvar\r';
  if (!digitou) assert.equal(m.cartao(id).rascunho, true, 'bloqueado mostra o aviso no cartão');
  return digitou;
}

test('rascunho A1: aviso, depois pedido novo e outro rascunho: bloqueia de novo', () => {
  const m = montar(adiarNaHora);
  const id = sessaoComPedido(m);
  assert.equal(digitouSalvar(m, id, ['meio']), false);
  m.g.escrever(id, '\x7f'.repeat(4));
  m.g.escrever(id, 'outro pedido\r');
  m.relogio.t += 10;
  m.evento(id, { t: m.relogio.t, tipo: 'prompt', texto: 'outro pedido' });
  m.evento(id, { t: m.relogio.t + 5, tipo: 'stop' });
  assert.equal(digitouSalvar(m, id, ['outro rascunho']), false);
});

test('rascunho A2: aviso e o usuário segue escrevendo: bloqueia', () => {
  const m = montar(adiarNaHora);
  const id = sessaoComPedido(m);
  assert.equal(digitouSalvar(m, id, ['meio']), false);
  assert.equal(digitouSalvar(m, id, [' e mais']), false);
});

test('rascunho B: Enter com o claude trabalhando (fila) e depois msg2 sem Enter: bloqueia', () => {
  const m = montar(adiarNaHora);
  const { g, relogio, evento } = m;
  const id = sessaoComPedido(m);
  relogio.t += 10;
  g.escrever(id, 'pedido\r');
  evento(id, { t: relogio.t, tipo: 'prompt', texto: 'pedido' });
  g.escrever(id, 'msg1\r'); // vai para a fila
  g.escrever(id, 'msg2');
  evento(id, { t: relogio.t + 1, tipo: 'inicio' }); // auto-compact no meio
  evento(id, { t: relogio.t + 2, tipo: 'prompt', texto: 'msg1' });
  evento(id, { t: relogio.t + 3, tipo: 'stop' });
  assert.equal(digitouSalvar(m, id, []), false);
});

test('sem rascunho: ⌃C, foco, ⇧Tab, setas e ⌥←/→ não bloqueiam', () => {
  const m = montar(adiarNaHora);
  const a = sessaoComPedido(m, '/x/a');
  assert.equal(digitouSalvar(m, a, ['meio pedido', '\x03']), true, '⌃C limpa a caixa');
  const b = sessaoComPedido(m, '/x/b');
  assert.equal(digitouSalvar(m, b, ['\x1b[I', '\x1b[O', '\x1b[Z', '\x1b[C', '\x1b[D', '\x1bb', '\x1bf', '\x1b[12;5R', '\x1b']), true);
});

test('sem rascunho: resposta "Other" digitada numa pergunta, com Enter', () => {
  const m = montar(adiarNaHora);
  const { g, relogio, evento } = m;
  const id = g.nova('/x/a');
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'inicio' });
  evento(id, { t: relogio.t, tipo: 'prompt', texto: 'x' });
  evento(id, { t: relogio.t, tipo: 'pre_tool', ferramenta: 'AskUserQuestion', tool_use_id: 'q1' });
  assert.equal(m.cartao(id).estado.rotulo, 'te fez uma pergunta');
  g.escrever(id, '\x1b[B');
  g.escrever(id, 'prefiro a outra opção');
  g.escrever(id, '\r');
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'post_tool', ferramenta: 'AskUserQuestion', tool_use_id: 'q1' });
  evento(id, { t: relogio.t + 1, tipo: 'stop' });
  assert.equal(digitouSalvar(m, id, []), true);
});

test('rascunho guardado na caixa sobrevive a uma aprovação respondida no meio', () => {
  const m = montar(adiarNaHora);
  const { g, relogio, evento } = m;
  const id = g.nova('/x/a');
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'inicio' });
  evento(id, { t: relogio.t, tipo: 'prompt', texto: 'build' });
  g.escrever(id, 'rascunho');
  evento(id, { t: relogio.t, tipo: 'pre_tool', ferramenta: 'Bash', tool_use_id: 'b1' });
  evento(id, { t: relogio.t, tipo: 'permissao', ferramenta: 'Bash' });
  g.escrever(id, '\r'); // aprova: o Enter é do diálogo
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'post_tool', ferramenta: 'Bash', tool_use_id: 'b1' });
  evento(id, { t: relogio.t + 1, tipo: 'stop' });
  assert.equal(digitouSalvar(m, id, []), false);
});

test('rascunho colado bloqueia; apagar até 0 libera', () => {
  const m = montar(adiarNaHora);
  const a = sessaoComPedido(m, '/x/a');
  assert.equal(digitouSalvar(m, a, ['\x1b[200~um texto colado\x1b[201~']), false);
  const b = sessaoComPedido(m, '/x/b');
  assert.equal(digitouSalvar(m, b, ['abc']), false);
  assert.equal(digitouSalvar(m, b, ['\x7f', '\x7f']), false, 'ainda sobra 1');
  assert.equal(digitouSalvar(m, b, ['\x7f']), true);
  assert.equal(m.cartao(b).rascunho, false);
});

test('⌥⌫ deixa a caixa desconhecida: bloqueia até Enter ou ⌃C', () => {
  const m = montar(adiarNaHora);
  const a = sessaoComPedido(m, '/x/a');
  assert.equal(digitouSalvar(m, a, ['duas palavras', '\x1b\x7f', '\x7f'.repeat(30)]), false);
  assert.equal(digitouSalvar(m, a, ['\x03']), true);
  const b = sessaoComPedido(m, '/x/b');
  assert.equal(digitouSalvar(m, b, ['\x1b\x7f']), false);
  m.g.escrever(b, 'x\r');
  m.relogio.t += 10;
  m.evento(b, { t: m.relogio.t, tipo: 'prompt', texto: 'x' });
  m.evento(b, { t: m.relogio.t + 1, tipo: 'stop' });
  assert.equal(digitouSalvar(m, b, []), true);
});

test('contarRascunhos conta as não salvas barradas por texto na caixa', () => {
  const m = montar(adiarNaHora);
  const a = sessaoComPedido(m, '/x/a');
  sessaoComPedido(m, '/x/b');
  m.g.escrever(a, 'meio');
  m.g.salvarTodas(() => {});
  assert.equal(m.g.contarRascunhos(), 1);
});

test('↑ na caixa vazia bloqueia (histórico); ↑ e Enter zera; ↑ numa aprovação não mexe na caixa', () => {
  const m = montar(adiarNaHora);
  const a = sessaoComPedido(m, '/x/a');
  assert.equal(digitouSalvar(m, a, ['\x1b[A']), false);
  const b = sessaoComPedido(m, '/x/b');
  m.g.escrever(b, '\x1b[A');
  m.g.escrever(b, '\r');
  m.relogio.t += 10;
  m.evento(b, { t: m.relogio.t, tipo: 'prompt', texto: 'pedido antigo' });
  m.evento(b, { t: m.relogio.t + 1, tipo: 'stop' });
  assert.equal(digitouSalvar(m, b, []), true);
  const c = m.g.nova('/x/c');
  m.relogio.t += 10;
  m.evento(c, { t: m.relogio.t, tipo: 'inicio' });
  m.evento(c, { t: m.relogio.t, tipo: 'prompt', texto: 'build' });
  m.evento(c, { t: m.relogio.t, tipo: 'pre_tool', ferramenta: 'Bash', tool_use_id: 'b1' });
  m.evento(c, { t: m.relogio.t, tipo: 'permissao', ferramenta: 'Bash' });
  m.g.escrever(c, '\x1b[A'); // navega no diálogo
  m.g.escrever(c, '\x1b[B');
  m.g.escrever(c, '\r');
  m.relogio.t += 10;
  m.evento(c, { t: m.relogio.t, tipo: 'post_tool', ferramenta: 'Bash', tool_use_id: 'b1' });
  m.evento(c, { t: m.relogio.t + 1, tipo: 'stop' });
  assert.equal(digitouSalvar(m, c, []), true);
});

test('Enter pendente descartado: o "/salvar" que ficou na caixa bloqueia a próxima tentativa', () => {
  const adiados = [];
  const m = montar({ adiar: (fn) => adiados.push(fn) });
  const { g, relogio, evento, ptys, cartao } = m;
  const id = sessaoComPedido(m);
  g.salvarEFechar(id);
  evento(id, { t: relogio.t, tipo: 'notificacao', notificacao: 'agent_needs_input' });
  adiados.shift()(); // diálogo aberto: o Enter fica pendente
  g.naoFechar(id);
  evento(id, { t: relogio.t + 5, tipo: 'notificacao', notificacao: 'idle_prompt' });
  g.salvarEFechar(id);
  assert.deepEqual(ptys[0].escrito, ['/salvar'], 'não digita de novo em cima do que sobrou');
  assert.equal(cartao(id).rascunho, true);
  g.escrever(id, '\x15'); // ⌃U limpa
  g.salvarEFechar(id);
  adiados.shift()();
  assert.deepEqual(ptys[0].escrito.slice(-3), ['\x15', '/salvar', '\r']);
});

// I1: o /salvar que não termina (Esc, recusa, erro da API) não conta como salvo.

test('I1: Salvar e fechar com a aprovação recusada e só o idle_prompt depois: não fecha, não salva', () => {
  const m = montar(adiarNaHora);
  const { g, relogio, evento, cartao, ptys } = m;
  const id = sessaoComPedido(m);
  g.salvarEFechar(id);
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'prompt', texto: '/salvar' });
  evento(id, { t: relogio.t, tipo: 'pre_tool', ferramenta: 'Write', tool_use_id: 'w1' });
  evento(id, { t: relogio.t + 1, tipo: 'permissao', ferramenta: 'Write' });
  g.escrever(id, '\x1b'); // recusa
  ptys[0].aoDados('x');
  relogio.t += 60000;
  evento(id, { t: relogio.t, tipo: 'notificacao', notificacao: 'idle_prompt' });
  assert.ok(cartao(id), 'o cartão fica aberto');
  assert.equal(ptys[0].morto, false);
  assert.equal(cartao(id).salva, false);
  assert.equal(cartao(id).salvando, null, 'a espera parou');
  assert.equal(cartao(id).falhaSalvar, true);
  assert.equal(g.contarNaoSalvas(), 1);
  // Um stop solto que chegue depois não completa nada nem fecha.
  evento(id, { t: relogio.t + 1, tipo: 'stop' });
  assert.ok(cartao(id));
  assert.equal(cartao(id).salva, false);
});

test('I1: Salvar todas e sair com erro da API numa sessão: a espera termina e ela segue não salva', () => {
  const m = montar(adiarNaHora);
  const { g, relogio, evento, cartao } = m;
  const a = sessaoComPedido(m, '/x/a');
  const b = sessaoComPedido(m, '/x/b');
  let fim = 0;
  g.salvarTodas(() => { fim += 1; });
  relogio.t += 10;
  evento(a, { t: relogio.t, tipo: 'prompt', texto: '/salvar' });
  evento(b, { t: relogio.t, tipo: 'prompt', texto: '/salvar' });
  evento(a, { t: relogio.t + 1, tipo: 'falha_stop' });
  assert.equal(fim, 0, 'b ainda salvando');
  assert.equal(cartao(a).salvando, null);
  assert.equal(cartao(a).falhaSalvar, true);
  evento(b, { t: relogio.t + 2, tipo: 'stop' });
  assert.equal(fim, 1, 'a espera termina: o main mostra o diálogo de novo com a que sobrou');
  assert.equal(g.contarNaoSalvas(), 1);
  assert.equal(g.contarFalhas(), 1);
  assert.equal(cartao(b).salva, true);
});

test('I1: depois da falha, Salvar e fechar tenta de novo, digita e fecha no stop', () => {
  const m = montar(adiarNaHora);
  const { g, relogio, evento, cartao, ptys } = m;
  const id = sessaoComPedido(m);
  g.salvarEFechar(id);
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'prompt', texto: '/salvar' });
  evento(id, { t: relogio.t + 1, tipo: 'falha_stop' });
  assert.equal(cartao(id).falhaSalvar, true);
  g.salvarEFechar(id);
  assert.deepEqual(ptys[0].escrito, ['/salvar', '\r', '/salvar', '\r']);
  assert.equal(cartao(id).falhaSalvar, false, 'tentando de novo');
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'prompt', texto: '/salvar' });
  evento(id, { t: relogio.t + 1, tipo: 'stop' });
  assert.equal(cartao(id), undefined, 'fechou');
});

test('I1: /salvar digitado pelo usuário e interrompido mostra que não terminou; pedido novo apaga o aviso', () => {
  const m = montar(adiarNaHora);
  const { relogio, evento, cartao } = m;
  const id = sessaoComPedido(m);
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'prompt', texto: '/salvar' });
  relogio.t += 60000;
  evento(id, { t: relogio.t, tipo: 'notificacao', notificacao: 'idle_prompt' });
  assert.equal(cartao(id).salva, false);
  assert.equal(cartao(id).falhaSalvar, true);
  evento(id, { t: relogio.t + 1, tipo: 'prompt', texto: 'outra coisa' });
  assert.equal(cartao(id).falhaSalvar, false);
});

test('I1: erro da API no fim da vez avisa que parou com erro, não que terminou', () => {
  const m = montar();
  const { g, relogio, evento, avisos } = m;
  const id = g.nova('/x/a');
  g.marcarFoco(false);
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'prompt', texto: 'ajustar' });
  evento(id, { t: relogio.t + 1, tipo: 'falha_stop' });
  assert.deepEqual(avisos.map((a) => a.texto), ['Parou com um erro. Confira a sessão.']);
});

// M1: a fechada guarda se estava salva, e o ⌘⇧T devolve isso (o arquivo de eventos foi apagado).

test('M1: fechada sem salvar e reaberta com ⌘⇧T segue não salva, também depois de reabrir o app', () => {
  const m = montar();
  const { g, relogio, evento, cartao } = m;
  const id = sessaoComPedido(m);
  g.fechar(id);
  const novo = g.reabrirFechada();
  relogio.t += 20000;
  evento(novo, { t: relogio.t, tipo: 'inicio', session_id: UA, pid: 11 });
  assert.equal(cartao(novo).salva, false);
  assert.equal(g.contarNaoSalvas(), 1);
  const g2 = criarGerente({
    abrirPty: () => ({ escrever() {}, redimensionar() {}, matar() {} }), agora: () => m.relogio.t + 100,
    pastaEventos: m.pastaEventos, arquivoLista: m.arquivoLista, pastaProjetos: m.pastaProjetos, casa: '/Users/m',
  });
  g2.restaurar();
  assert.equal(g2.listar().find((c) => c.id === novo).salva, false, 'sobrevive a reabrir o app');
  assert.equal(g2.contarNaoSalvas(), 1);
});

test('M1: fechada salva volta salva; a não salva reaberta fica salva depois do /salvar', () => {
  const m = montar();
  const { g, relogio, evento, cartao } = m;
  const a = sessaoComPedido(m, '/x/a');
  relogio.t += 10;
  evento(a, { t: relogio.t, tipo: 'prompt', texto: '/salvar', session_id: UA });
  evento(a, { t: relogio.t + 1, tipo: 'stop', session_id: UA });
  g.fechar(a);
  assert.equal(cartao(g.reabrirFechada()).salva, true);
  g.fechar(a);
  const b = g.nova('/x/b');
  relogio.t += 10;
  evento(b, { t: relogio.t, tipo: 'prompt', texto: 'oi', session_id: UB });
  g.fechar(b);
  g.reabrirFechada(b);
  assert.equal(cartao(b).salva, false);
  relogio.t += 10;
  evento(b, { t: relogio.t, tipo: 'prompt', texto: '/salvar', session_id: UB });
  evento(b, { t: relogio.t + 1, tipo: 'stop', session_id: UB });
  assert.equal(cartao(b).salva, true);
});

test('M1: fechada de antes desta versão (sem a marca) volta não salva, o lado seguro', () => {
  const m = montar();
  fs.writeFileSync(path.join(m.pasta, 'fechadas.json'), JSON.stringify([{ id: 'velha123', pasta: '/x/v', claudeSessionId: UC, fechadaEm: 1 }]));
  const g2 = criarGerente({
    abrirPty: () => ({ escrever() {}, redimensionar() {}, matar() {} }), agora: () => m.relogio.t,
    pastaEventos: m.pastaEventos, arquivoLista: m.arquivoLista, pastaProjetos: m.pastaProjetos, casa: '/Users/m',
  });
  g2.restaurar();
  const id = g2.reabrirFechada();
  assert.equal(g2.listar().find((c) => c.id === id).salva, false);
});

// M2: pedido do usuário durante o /salvar do Atlas desiste da espera daquele cartão.

test('M2: pedido novo durante o /salvar do Salvar todas e sair: a espera termina, a sessão fica não salva', () => {
  const m = montar(adiarNaHora);
  const { g, relogio, evento, cartao, ptys, pastaEventos } = m;
  const id = sessaoComPedido(m);
  let fim = 0;
  g.salvarTodas(() => { fim += 1; });
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'prompt', texto: '/salvar' });
  relogio.t += 10;
  // O stop do /salvar e o pedido da fila chegam na mesma leitura.
  fs.appendFileSync(path.join(pastaEventos, id + '.jsonl'),
    JSON.stringify({ t: relogio.t, tipo: 'stop' }) + '\n' + JSON.stringify({ t: relogio.t + 5, tipo: 'prompt', texto: 'mais uma coisa' }) + '\n');
  g.aoMudarEventos(id);
  assert.equal(fim, 1, 'a espera termina: o main pergunta de novo');
  assert.equal(cartao(id).salvando, null);
  assert.equal(cartao(id).salva, false);
  assert.equal(g.contarNaoSalvas(), 1);
  // Salvar todas e sair de novo: digita outra vez quando a vez do pedido acabar.
  g.salvarTodas(() => { fim += 1; });
  assert.deepEqual(ptys[0].escrito, ['/salvar', '\r'], 'trabalhando: ainda não');
  evento(id, { t: relogio.t + 20, tipo: 'stop' });
  assert.deepEqual(ptys[0].escrito, ['/salvar', '\r', '/salvar', '\r']);
  evento(id, { t: relogio.t + 30, tipo: 'prompt', texto: '/salvar' });
  evento(id, { t: relogio.t + 40, tipo: 'stop' });
  assert.equal(fim, 2);
  assert.equal(cartao(id).salva, true);
});

test('M2: pedido novo durante o /salvar do Salvar e fechar: o cartão não fecha e fica não salvo', () => {
  const m = montar(adiarNaHora);
  const { g, relogio, evento, cartao, ptys } = m;
  const id = sessaoComPedido(m);
  g.salvarEFechar(id);
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'prompt', texto: '/salvar' });
  evento(id, { t: relogio.t + 1, tipo: 'prompt', texto: 'espera, mais uma coisa' });
  assert.equal(cartao(id).salvando, null);
  evento(id, { t: relogio.t + 2, tipo: 'stop' });
  assert.ok(cartao(id), 'não fechou');
  assert.equal(ptys[0].morto, false);
  assert.equal(cartao(id).salva, false);
});

// M3: o Enter do Atlas confere a caixa antes: o usuário pode ter digitado depois do "/salvar".

test('M3: Enter pendente com texto digitado depois do "/salvar": não manda o Enter, avisa e para', () => {
  const adiados = [];
  const m = montar({ adiar: (fn) => adiados.push(fn) });
  const { g, relogio, evento, ptys, cartao } = m;
  const id = sessaoComPedido(m);
  g.salvarEFechar(id);
  relogio.t += 50;
  evento(id, { t: relogio.t, tipo: 'prompt', texto: 'pedido da fila' });
  adiados.shift()(); // trabalhando: o Enter fica pendente
  assert.deepEqual(ptys[0].escrito, ['/salvar']);
  relogio.t += 1000;
  g.escrever(id, 'abc');
  relogio.t += 5000;
  evento(id, { t: relogio.t, tipo: 'stop' });
  assert.deepEqual(ptys[0].escrito, ['/salvar', 'abc'], 'sem o Enter: o claude não recebe "/salvarabc"');
  assert.ok(cartao(id), 'o cartão fica');
  assert.equal(cartao(id).salvando, null);
  assert.equal(cartao(id).rascunho, true);
  g.salvarEFechar(id);
  assert.deepEqual(ptys[0].escrito, ['/salvar', 'abc'], 'a caixa ficou desconhecida: não digita de novo');
});

test('M3: texto digitado nos 150 ms entre o "/salvar" e o Enter: não manda o Enter', () => {
  const adiados = [];
  const m = montar({ adiar: (fn) => adiados.push(fn) });
  const { g, ptys, cartao } = m;
  const id = sessaoComPedido(m);
  g.salvarEFechar(id);
  g.escrever(id, 'x');
  adiados.shift()();
  assert.deepEqual(ptys[0].escrito, ['/salvar', 'x']);
  assert.equal(cartao(id).salvando, null);
  assert.equal(cartao(id).rascunho, true);
});

// M4: pergunta dispensada com Esc: o cartão segue "te fez uma pergunta" até o idle_prompt, mas
// o que se digita depois vai para a caixa.

function perguntaDispensada(m) {
  const id = sessaoComPedido(m);
  m.relogio.t += 10;
  m.evento(id, { t: m.relogio.t, tipo: 'prompt', texto: 'faz x' });
  m.evento(id, { t: m.relogio.t + 1, tipo: 'pre_tool', ferramenta: 'AskUserQuestion', tool_use_id: 'q' });
  m.relogio.t += 3000;
  m.g.escrever(id, '\x1b');
  m.ptys[0].aoDados('x');
  assert.equal(m.cartao(id).estado.rotulo, 'te fez uma pergunta');
  return id;
}

test('M4: rascunho digitado depois de dispensar a pergunta com Esc conta na caixa', () => {
  const m = montar(adiarNaHora);
  const id = perguntaDispensada(m);
  m.relogio.t += 5000;
  m.g.escrever(id, 'meu rascunho pela metade');
  m.relogio.t += 60000;
  m.evento(id, { t: m.relogio.t, tipo: 'notificacao', notificacao: 'idle_prompt' });
  assert.equal(digitouSalvar(m, id, []), false);
});

test('M4: depois do Esc, pedido enviado com Enter esvazia a caixa; sem saída do terminal o Esc não conta', () => {
  const m = montar(adiarNaHora);
  const id = perguntaDispensada(m);
  m.g.escrever(id, 'outra coisa');
  m.g.escrever(id, '\r');
  m.evento(id, { t: m.relogio.t, tipo: 'prompt', texto: 'outra coisa' });
  m.evento(id, { t: m.relogio.t + 1, tipo: 'stop' });
  assert.equal(digitouSalvar(m, id, []), true);

  const m2 = montar(adiarNaHora);
  const id2 = sessaoComPedido(m2);
  m2.relogio.t += 10;
  m2.evento(id2, { t: m2.relogio.t, tipo: 'prompt', texto: 'faz x' });
  m2.evento(id2, { t: m2.relogio.t + 1, tipo: 'pre_tool', ferramenta: 'AskUserQuestion', tool_use_id: 'q' });
  m2.relogio.t += 3000;
  m2.g.escrever(id2, '\x1b'); // sem saída depois: o claude não reagiu, segue no diálogo
  m2.g.escrever(id2, 'resposta');
  m2.evento(id2, { t: m2.relogio.t, tipo: 'post_tool', ferramenta: 'AskUserQuestion', tool_use_id: 'q' });
  m2.evento(id2, { t: m2.relogio.t + 1, tipo: 'stop' });
  assert.equal(digitouSalvar(m2, id2, []), true);
});

test('microfone: espaço na selecionada pronta; sem selecionada, página ou diálogo não faz nada', () => {
  const m = montar(adiarNaHora);
  const { g, relogio, evento, ptys } = m;
  assert.equal(g.microfone(), false);
  const id = sessaoComPedido(m);
  g.selecionar(id);
  g.marcarPagina(true);
  assert.equal(g.microfone(), false, 'página por cima: o espaço iria ao terminal escondido');
  g.marcarPagina(false);
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'permissao', ferramenta: 'Bash' });
  assert.equal(g.microfone(), false, 'o espaço responderia à aprovação');
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'post_tool', ferramenta: 'Bash' });
  evento(id, { t: relogio.t, tipo: 'stop', session_id: UA });
  assert.equal(g.microfone(), true);
  assert.deepEqual(ptys[0].escrito, [' ']);
});

test('voz: caixa desconhecida da fala até o pedido chegar; fala curta sem envio bloqueia o /salvar', () => {
  const m = montar(adiarNaHora);
  const { g, relogio, evento, cartao, ptys } = m;
  const id = sessaoComPedido(m);
  g.selecionar(id);
  g.microfone(); // grava
  g.microfone(); // para: "pode continuar" (2 palavras) fica na caixa, sem Enter
  g.salvarEFechar(id);
  assert.deepEqual(ptys[0].escrito, [' ', ' '], 'o /salvar grudaria na fala');
  assert.equal(cartao(id).rascunho, true);
  // Fala longa enviada sozinha: o pedido chega pelo hook e a caixa volta a 0.
  relogio.t += 1000;
  g.escrever(id, '\x15'); // ⌃U limpa a fala curta
  g.microfone();
  g.microfone();
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'prompt', texto: 'confere o faturamento de hoje', session_id: UA });
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'stop', session_id: UA });
  g.salvarEFechar(id);
  assert.deepEqual(ptys[0].escrito.slice(-2), ['/salvar', '\r']);
});

test('voz pela barra de espaço do teclado conta igual ao botão', () => {
  const m = montar(adiarNaHora);
  const { g, relogio, evento, ptys } = m;
  const id = sessaoComPedido(m);
  g.selecionar(id);
  g.microfone();
  g.escrever(id, ' '); // para pela barra
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'prompt', texto: 'confere o faturamento de hoje', session_id: UA });
  relogio.t += 10;
  evento(id, { t: relogio.t, tipo: 'stop', session_id: UA });
  g.salvarEFechar(id);
  assert.deepEqual(ptys[0].escrito.slice(-2), ['/salvar', '\r']);
});
