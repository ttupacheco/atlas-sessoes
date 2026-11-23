const test = require('node:test');
const assert = require('node:assert/strict');
const { ehSalvar, passoSalvar, faseSalvar, estaSalva, dialogoFechar, dialogoSair, textoNaoSalvas, passoCaixa, textoRascunhos } = require('../src/salvar.js');

const p = (t, texto) => ({ t, tipo: 'prompt', texto });
const stop = (t) => ({ t, tipo: 'stop' });
const idle = (t) => ({ t, tipo: 'notificacao', notificacao: 'idle_prompt' });

test('ehSalvar: /salvar com ou sem argumentos, espaços antes; outras barras não', () => {
  assert.equal(ehSalvar('/salvar'), true);
  assert.equal(ehSalvar('/salvar resumo da call'), true);
  assert.equal(ehSalvar('  /salvar\n'), true);
  assert.equal(ehSalvar('/salvarx'), false);
  assert.equal(ehSalvar('salvar'), false);
  assert.equal(ehSalvar('por favor /salvar'), false);
  assert.equal(ehSalvar(undefined), false);
  assert.equal(ehSalvar(null), false);
});

test('sessão sem nenhum pedido não precisa salvar', () => {
  assert.equal(estaSalva([]), true);
  assert.equal(estaSalva([{ t: 1, tipo: 'inicio' }, stop(2)]), true);
});

test('pedido comum deixa não salva, mesmo depois do fim da vez', () => {
  assert.equal(estaSalva([p(1, 'ajustar etiqueta')]), false);
  assert.equal(estaSalva([p(1, 'ajustar etiqueta'), stop(2)]), false);
});

test('/salvar só conta depois do stop da conversa principal', () => {
  const base = [p(1, 'ajustar'), stop(2), p(3, '/salvar')];
  assert.equal(estaSalva(base), false, 'o /salvar ainda está rodando');
  assert.equal(faseSalvar(base), 'salvando');
  assert.equal(estaSalva([...base, { t: 4, tipo: 'pre_tool', ferramenta: 'Write' }]), false);
  assert.equal(estaSalva([...base, stop(5)]), true);
  assert.equal(estaSalva([...base, stop(5), idle(6)]), true, 'o idle_prompt depois do stop não muda nada');
});

test('I1: o turno do /salvar que acaba sem stop (Esc, recusa) ou com erro da API não salva', () => {
  const base = [p(1, 'ajustar'), stop(2), p(3, '/salvar')];
  assert.equal(faseSalvar([...base, idle(60003)]), 'pedido', 'idle_prompt sem stop: o /salvar não terminou');
  assert.equal(faseSalvar([...base, { t: 5, tipo: 'falha_stop' }]), 'pedido', 'StopFailure: erro da API');
  assert.equal(faseSalvar([...base, { t: 5, tipo: 'falha_stop', agente: 'a1' }]), 'salvando', 'falha de um subagente não encerra');
  assert.equal(faseSalvar([...base, { t: 5, tipo: 'falha_stop' }, stop(6)]), 'pedido', 'um stop solto depois não salva');
  assert.equal(passoSalvar('salva', idle(7)), 'salva');
  assert.equal(passoSalvar('salva', { t: 7, tipo: 'falha_stop' }), 'salva');
});

test('qualquer pedido depois do /salvar volta a não salva', () => {
  const salva = [p(1, '/salvar'), stop(2)];
  assert.equal(estaSalva(salva), true);
  assert.equal(estaSalva([...salva, p(3, 'mais uma coisa')]), false);
  assert.equal(estaSalva([...salva, p(3, 'mais uma coisa'), stop(4)]), false);
  assert.equal(estaSalva([...salva, p(3, 'mais'), stop(4), p(5, '/salvar'), stop(6)]), true);
});

test('passoSalvar é incremental: o resultado não depende de quantos eventos ficaram guardados', () => {
  let fase = 'nada';
  for (const ev of [p(1, 'x'), stop(2), p(3, '/salvar')]) fase = passoSalvar(fase, ev);
  assert.equal(fase, 'salvando');
  fase = passoSalvar(fase, { t: 4, tipo: 'post_tool' });
  assert.equal(fase, 'salvando');
  fase = passoSalvar(fase, stop(5));
  assert.equal(fase, 'salva');
  assert.equal(passoSalvar('salva', stop(6)), 'salva');
  assert.equal(passoSalvar('pedido', stop(6)), 'pedido');
});

test('diálogo de fechar: sessão viva oferece salvar e fechar como padrão', () => {
  const d = dialogoFechar({ estado: { cor: 'verde' } });
  assert.equal(d.message, 'Esta sessão não foi salva.');
  assert.deepEqual(d.buttons, ['Salvar e fechar', 'Fechar sem salvar', 'Cancelar']);
  assert.deepEqual(d.acoes, ['salvar', 'fechar', 'cancelar']);
  assert.equal(d.defaultId, 0);
  assert.equal(d.cancelId, 2);
});

test('diálogo de fechar: sessão encerrada só fecha sem salvar ou cancela', () => {
  const d = dialogoFechar({ estado: { cor: 'preto' } });
  assert.equal(d.message, 'Esta sessão não foi salva e o Claude já saiu.');
  assert.deepEqual(d.buttons, ['Fechar sem salvar', 'Cancelar']);
  assert.deepEqual(d.acoes, ['fechar', 'cancelar']);
  assert.equal(d.cancelId, 1);
  assert.equal(d.defaultId, 1);
});

test('diálogo de sair: texto no singular e no plural, salvar todas como padrão', () => {
  assert.equal(textoNaoSalvas(1), '1 sessão não foi salva.');
  assert.equal(textoNaoSalvas(3), '3 sessões não foram salvas.');
  const d = dialogoSair(2);
  assert.equal(d.message, '2 sessões não foram salvas.');
  assert.deepEqual(d.buttons, ['Salvar todas e sair', 'Sair sem salvar', 'Cancelar']);
  assert.deepEqual(d.acoes, ['salvar', 'sair', 'cancelar']);
  assert.equal(d.defaultId, 0);
  assert.equal(d.cancelId, 2);
});

test('I1: diálogo de saída diz em quantas o /salvar não terminou', () => {
  assert.equal(dialogoSair(2, 0, 1).detail, 'O /salvar não terminou em 1 sessão. Salvar todas e sair tenta de novo.');
  assert.equal(dialogoSair(3, 0, 2).detail, 'O /salvar não terminou em 2 sessões. Salvar todas e sair tenta de novo.');
  assert.equal(dialogoSair(3, 1, 1).detail, `${textoRascunhos(1)} O /salvar não terminou em 1 sessão. Salvar todas e sair tenta de novo.`);
  assert.equal(dialogoSair(2, 0, 0).detail, undefined);
});

test('nenhum texto dos diálogos usa travessão', () => {
  const textos = [dialogoFechar({ estado: { cor: 'verde' } }), dialogoFechar({ estado: { cor: 'preto' } }), dialogoSair(1), dialogoSair(4), dialogoSair(4, 2, 3)]
    .flatMap((d) => [d.message, ...d.buttons, d.detail || '']);
  for (const t of textos) assert.doesNotMatch(t, /[–—]/);
});

test('stop de subagente não encerra o turno do /salvar', () => {
  assert.equal(estaSalva([p(1, '/salvar'), { t: 2, tipo: 'stop', agente: 'a1' }]), false);
  assert.equal(estaSalva([p(1, '/salvar'), { t: 2, tipo: 'stop', agente: 'a1' }, stop(3)]), true);
});

const caixa = (...teclas) => teclas.reduce(passoCaixa, 0);

test('caixa: texto soma, Enter, ⌃C e ⌃U zeram', () => {
  assert.equal(caixa('o', 'i'), 2);
  assert.equal(caixa('oi', '\r'), 0);
  assert.equal(caixa('oi', '\x03'), 0);
  assert.equal(caixa('oi', '\x15'), 0);
  assert.equal(caixa('ção'), 3, 'conta caracteres, não bytes');
  assert.equal(caixa('😀', '\x7f'), 0, 'emoji é um caractere');
  assert.equal(caixa('abc\r', 'de'), 2, 'pedaço com Enter no meio');
});

test('caixa: colar soma o texto sem os marcadores do bracketed paste', () => {
  assert.equal(caixa('\x1b[200~texto colado\x1b[201~'), 12);
  assert.equal(caixa('um texto colado sem bracketed'), 29);
});

test('caixa: Backspace tira 1 até 0', () => {
  assert.equal(caixa('ab', '\x7f'), 1);
  assert.equal(caixa('ab', '\x7f', '\x08', '\x7f'), 0);
});

test('caixa: sequências com Esc são ignoradas (setas, ⌥←/→, ⇧Tab, foco, posição do cursor, Esc)', () => {
  for (const seq of ['\x1b[C', '\x1b[D', '\x1bb', '\x1bf', '\x1b[1;3D', '\x1b[Z', '\x1b[I', '\x1b[O', '\x1b[12;5R', '\x1b', '\x1bOD']) {
    assert.equal(caixa(seq), 0, JSON.stringify(seq));
    assert.equal(caixa('ab', seq), 2, JSON.stringify(seq));
  }
});

test('caixa: ↑ e ↓ na caixa vazia trazem o histórico (desconhecida); com texto só movem', () => {
  for (const seq of ['\x1b[A', '\x1b[B', '\x1bOA', '\x1bOB']) {
    assert.equal(caixa(seq), null, JSON.stringify(seq));
    assert.equal(caixa(seq, '\r'), 0);
    assert.equal(caixa('ab', seq), 2);
    assert.equal(caixa('ab', '\x1b\x7f', seq), null);
  }
  assert.equal(caixa('\x1b[1;3A'), 0, 'com modificador não é o histórico');
});

test('caixa: ⌥⌫, ⌃W e Tab deixam a conta desconhecida até zerar', () => {
  for (const seq of ['\x1b\x7f', '\x17', '\t']) {
    assert.equal(caixa('ab', seq), null, JSON.stringify(seq));
    assert.equal(caixa('ab', seq, 'x', '\x7f'), null, 'segue desconhecida');
    assert.equal(caixa('ab', seq, '\r'), 0);
    assert.equal(caixa('ab', seq, '\x03'), 0);
  }
});

test('textoRascunhos: singular e plural', () => {
  assert.equal(textoRascunhos(1), 'Há texto pela metade na caixa de 1 sessão. Apague com ⌃U e tente de novo.');
  assert.equal(textoRascunhos(2), 'Há texto pela metade na caixa de 2 sessões. Apague com ⌃U e tente de novo.');
  assert.equal(dialogoSair(2, 1).detail, textoRascunhos(1));
  assert.equal(dialogoSair(2, 0).detail, undefined);
});
