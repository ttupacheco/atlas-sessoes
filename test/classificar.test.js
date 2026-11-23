const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { montarPergunta, interpretarResposta, criarClassificador, ambienteDoClassificador, executarClaude, ARGUMENTOS } = require('../src/classificar.js');

const GRUPOS = [
  { id: 'a1', nome: 'Pedidos' }, { id: 'b2', nome: 'Financeiro' },
  { id: 'c3', nome: 'Relatórios' }, { id: 'd4', nome: 'Freelas' },
];

test('interpretarResposta: nome exato, com ou sem decoração', () => {
  assert.equal(interpretarResposta('Pedidos', GRUPOS), 'a1');
  assert.equal(interpretarResposta('pedidos.', GRUPOS), 'a1');
  assert.equal(interpretarResposta('`Financeiro`', GRUPOS), 'b2');
  assert.equal(interpretarResposta('  "Relatórios"\n', GRUPOS), 'c3');
  assert.equal(interpretarResposta('Freelas', GRUPOS), 'd4');
});

test('interpretarResposta: nenhum, frase, vazio ou fora da lista dá null', () => {
  assert.equal(interpretarResposta('nenhum', GRUPOS), null);
  assert.equal(interpretarResposta('Acho que é Pedidos', GRUPOS), null);
  assert.equal(interpretarResposta('', GRUPOS), null);
  assert.equal(interpretarResposta(undefined, GRUPOS), null);
  assert.equal(interpretarResposta('Logística', GRUPOS), null);
});

test('montarPergunta traz todos os grupos, o cartão e o pedido', () => {
  const p = montarPergunta(GRUPOS.map((g) => g.nome), 'Etiqueta', 'ajustar o frete do pedido');
  for (const n of ['Pedidos', 'Financeiro', 'Relatórios', 'Freelas', 'nenhum', 'Etiqueta', 'ajustar o frete do pedido']) {
    assert.ok(p.includes(n), n);
  }
  assert.ok(!/[\u2013\u2014]/.test(p));
});

test('montarPergunta lista "Nome: descrição" e pede só o nome', () => {
  const p = montarPergunta([{ nome: 'Pedidos', descricao: 'App de expedição: etiquetas' }, { nome: 'Geral', descricao: '' }], 'C', 'x');
  assert.ok(p.includes('- Pedidos: App de expedição: etiquetas'));
  assert.ok(p.includes('- Geral\n'));
  assert.ok(p.includes('só o nome'));
});

test('classificador resolve o id e roda uma chamada por vez', async () => {
  let ativas = 0; let maximo = 0; const ordem = [];
  const executar = async (pergunta) => {
    ativas++; maximo = Math.max(maximo, ativas); ordem.push(pergunta);
    await new Promise((r) => setTimeout(r, 15));
    ativas--;
    return 'Pedidos';
  };
  const cl = criarClassificador({ executar, grupos: () => GRUPOS });
  const res = await Promise.all([1, 2, 3].map((i) => cl({ nomeCartao: 'C' + i }, 'pedido ' + i)));
  assert.deepEqual(res, ['a1', 'a1', 'a1']);
  assert.equal(maximo, 1);
  assert.equal(ordem.length, 3);
  assert.ok(ordem[0].includes('pedido 1') && ordem[2].includes('pedido 3'));
});

test('executar rejeitado ou travado vira null e a fila segue', async () => {
  let n = 0;
  const executar = async () => { n++; if (n === 1) throw new Error('falhou'); return 'Financeiro'; };
  const cl = criarClassificador({ executar, grupos: () => GRUPOS });
  assert.equal(await cl({ nomeCartao: 'x' }, 'a'), null);
  assert.equal(await cl({ nomeCartao: 'x' }, 'b'), 'b2');
});

test('sem grupos não chama o executar', async () => {
  let chamou = false;
  const cl = criarClassificador({ executar: async () => { chamou = true; return 'x'; }, grupos: () => [] });
  assert.equal(await cl({ nomeCartao: 'x' }, 'a'), null);
  assert.equal(chamou, false);
});

test('ambienteDoClassificador tira ATLAS_SESSAO_ID e variáveis do Claude', () => {
  const e = ambienteDoClassificador({ PATH: '/x', ATLAS_SESSAO_ID: 's', CLAUDECODE: '1', CLAUDE_CODE_FOO: '1', HOME: '/h' });
  assert.deepEqual(e, { PATH: '/x', HOME: '/h' });
});

test('interpretarResposta: "nenhum" dá null mesmo com um grupo chamado Nenhum; nomes comparados normalizados', () => {
  const g = [{ id: 'n1', nome: 'Nenhum' }, { id: 'p1', nome: ' Pedidos. ' }];
  assert.equal(interpretarResposta('nenhum', g), null);
  assert.equal(interpretarResposta('pedidos', g), 'p1');
});

test('executarClaude usa os argumentos restritos', () => {
  for (const a of ['--tools', '--strict-mcp-config', '--disable-slash-commands', '--setting-sources', '--no-session-persistence']) {
    assert.ok(ARGUMENTOS.includes(a), a);
  }
  assert.ok(!ARGUMENTOS.includes('--mcp-config'));
});

// claude falso no PATH: o script recebe a pergunta no stdin.
function comFalso(corpo, fn) {
  return async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-falso-'));
    const bin = path.join(dir, 'claude');
    fs.writeFileSync(bin, '#!/bin/sh\n' + corpo + '\n', { mode: 0o755 });
    const amb = { env: { PATH: dir + ':/usr/bin:/bin', ATLAS_SESSAO_ID: 'x' }, cwd: os.tmpdir(), tempoLimite: 400 };
    try { await fn(amb, dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };
}

test('executarClaude devolve a saída e entrega a pergunta no stdin', comFalso('cat > "$(dirname "$0")/stdin.txt"; echo Pedidos', async (amb, dir) => {
  assert.equal((await executarClaude('pergunta ç', amb)).trim(), 'Pedidos');
  assert.equal(fs.readFileSync(path.join(dir, 'stdin.txt'), 'utf8'), 'pergunta ç');
}));

test('executarClaude mata e rejeita um script lento', comFalso('sleep 5', async (amb) => {
  const t = Date.now();
  await assert.rejects(executarClaude('p', amb), /tempo esgotado/);
  assert.ok(Date.now() - t < 2500);
}));

test('executarClaude limita a saída em bytes, não em caracteres', comFalso('i=0; while [ $i -lt 400 ]; do printf "ççççç"; i=$((i+1)); done; sleep 1', async (amb) => {
  // 1500 caracteres = 3000 bytes (> 2048): passaria no limite por caracteres.
  await assert.rejects(executarClaude('p', { ...amb, tempoLimite: 3000 }), /grande demais/);
}));

test('executarClaude rejeita saída com código 1 e saída vazia', comFalso('echo erro; exit 1', async (amb) => {
  await assert.rejects(executarClaude('p', amb), /código 1/);
}));

test('executarClaude rejeita quando o claude não existe (erro de spawn)', async () => {
  const amb = { env: { PATH: '/nao/existe' }, cwd: os.tmpdir(), tempoLimite: 400 };
  await assert.rejects(executarClaude('p', amb));
});
