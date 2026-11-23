const test = require('node:test');
const assert = require('node:assert/strict');
const { instanciaUnica } = require('../src/instancia.js');

function appFalso(trava) {
  const a = { saiu: null, ouvintes: {}, pedidos: 0 };
  a.requestSingleInstanceLock = () => { a.pedidos++; return trava; };
  a.exit = (codigo) => { a.saiu = codigo; };
  a.on = (nome, fn) => { a.ouvintes[nome] = fn; };
  return a;
}

test('primeira cópia fica com a trava e traz a janela quando abrem outra', () => {
  const app = appFalso(true);
  let focou = 0;
  assert.equal(instanciaUnica(app, { aoSegunda: () => focou++ }), true);
  assert.equal(app.saiu, null);
  app.ouvintes['second-instance']();
  assert.equal(focou, 1);
});

test('segunda cópia sai na hora, sem will-quit (que salvaria a lista vazia)', () => {
  const app = appFalso(false);
  assert.equal(instanciaUnica(app, { aoSegunda: () => {} }), false);
  assert.equal(app.saiu, 0);
  assert.equal(app.ouvintes['second-instance'], undefined);
});

test('modo demo não pede a trava (roda ao lado do Atlas de verdade)', () => {
  const app = appFalso(false);
  assert.equal(instanciaUnica(app, { demo: true, aoSegunda: () => {} }), true);
  assert.equal(app.pedidos, 0);
});
