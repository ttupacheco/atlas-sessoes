const test = require('node:test');
const assert = require('node:assert/strict');
const { limparTitulo, nomeDoCartao } = require('../src/nome.js');

test('limparTitulo tira o prefixo de status e os espaços', () => {
  assert.equal(limparTitulo('✳ Ajustar etiqueta do pedido'), 'Ajustar etiqueta do pedido');
  assert.equal(limparTitulo('⠂ Conferir Impostos'), 'Conferir Impostos');
  assert.equal(limparTitulo('✻  Revisar   o tema  '), 'Revisar o tema');
  assert.equal(limparTitulo('Conferência do Notas: ação'), 'Conferência do Notas: ação');
});

test('limparTitulo: genérico ou vazio conta como sem título', () => {
  for (const t of ['⠂ Claude Code', 'Claude Code', 'claude', '  ', '', '-zsh', 'zsh', 'bash', '✳', null, undefined, 3]) {
    assert.equal(limparTitulo(t), null, JSON.stringify(t));
  }
});

test('nomeDoCartao: manual, depois título, depois Novo', () => {
  assert.equal(nomeDoCartao({ nome: 'Meu', titulo: 'Do Claude' }), 'Meu');
  assert.equal(nomeDoCartao({ nome: null, titulo: 'Do Claude' }), 'Do Claude');
  assert.equal(nomeDoCartao({ nome: null, titulo: null }), 'Novo');
  assert.equal(nomeDoCartao({}), 'Novo');
  assert.equal(nomeDoCartao({ nome: '   ', titulo: 'Do Claude' }), 'Do Claude');
});

test('nomeDoCartao: sem nome nem título, fora da pasta pessoal, mostra o nome da pasta', () => {
  assert.equal(nomeDoCartao({ pasta: '/Users/m/Projetos/Pedidos' }, '/Users/m'), 'Pedidos');
  assert.equal(nomeDoCartao({ pasta: '/Users/m/Documents/Notas/' }, '/Users/m'), 'Notas');
  assert.equal(nomeDoCartao({ pasta: '/Users/m' }, '/Users/m'), 'Novo');
  assert.equal(nomeDoCartao({ pasta: '/Users/m/' }, '/Users/m'), 'Novo');
  assert.equal(nomeDoCartao({ pasta: '/Users/m/x', titulo: 'Do Claude' }, '/Users/m'), 'Do Claude');
  assert.equal(nomeDoCartao({ pasta: '/' }, '/Users/m'), 'Novo');
});
