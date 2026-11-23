const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('../src/historico.js');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-historico-')), 'historico.jsonl');
const DIA = 24 * 60 * 60 * 1000;
const semFim = { processoSaiuEm: null, cinzaDesde: null };

// Pedaços do turno

test('prompt e stop dão um pedaço', () => {
  const ev = [{ t: 100, tipo: 'prompt', texto: 'oi' }, { t: 500, tipo: 'stop' }];
  assert.deepEqual(H.pedacosDoTurno(ev, semFim), [{ inicio: 100, fim: 500 }]);
});

test('a espera da aprovação fica de fora: dois pedaços', () => {
  const ev = [
    { t: 100, tipo: 'prompt', texto: 'x' },
    { t: 200, tipo: 'pre_tool', ferramenta: 'Bash', tool_use_id: 'a' },
    { t: 210, tipo: 'permissao', ferramenta: 'Bash' },
    { t: 900, tipo: 'post_tool', ferramenta: 'Bash', tool_use_id: 'a' },
    { t: 1000, tipo: 'stop' },
  ];
  assert.deepEqual(H.pedacosDoTurno(ev, semFim), [{ inicio: 100, fim: 210 }, { inicio: 900, fim: 1000 }]);
});

test('prompt e pre_tool, depois cinza: o pedaço acaba no pre_tool', () => {
  const ev = [{ t: 100, tipo: 'prompt' }, { t: 300, tipo: 'pre_tool', ferramenta: 'Bash', tool_use_id: 'a' }];
  assert.deepEqual(H.pedacosDoTurno(ev, { processoSaiuEm: null, cinzaDesde: 90300 }), [{ inicio: 100, fim: 300 }]);
});

test('saída do processo fecha no último evento', () => {
  const ev = [{ t: 100, tipo: 'prompt' }, { t: 400, tipo: 'post_tool', ferramenta: 'Read' }];
  assert.deepEqual(H.pedacosDoTurno(ev, { processoSaiuEm: 5000, cinzaDesde: null }), [{ inicio: 100, fim: 400 }]);
});

test('prompt sem fim não devolve pedaço', () => {
  const ev = [{ t: 100, tipo: 'prompt' }, { t: 300, tipo: 'pre_tool', ferramenta: 'Bash' }];
  assert.deepEqual(H.pedacosDoTurno(ev, semFim), []);
});

test('idle_prompt fecha o pedaço no último trabalho antes dele', () => {
  const ev = [
    { t: 100, tipo: 'prompt' },
    { t: 400, tipo: 'post_tool', ferramenta: 'Read' },
    { t: 700, tipo: 'notificacao', notificacao: 'idle_prompt' },
  ];
  assert.deepEqual(H.pedacosDoTurno(ev, semFim), [{ inicio: 100, fim: 400 }]);
});

test('Esc no meio da vez: os 60 s até o idle_prompt ficam de fora (M2)', () => {
  const ev = [
    { t: 1000, tipo: 'prompt', texto: 'x' },
    { t: 3000, tipo: 'pre_tool', ferramenta: 'Bash', tool_use_id: 'a' },
    { t: 5000, tipo: 'post_tool', ferramenta: 'Bash', tool_use_id: 'a' },
    { t: 65000, tipo: 'notificacao', notificacao: 'idle_prompt' },
  ];
  assert.deepEqual(H.pedacosDoTurno(ev, semFim), [{ inicio: 1000, fim: 5000 }]);
});

test('stop segue fechando no horário dele', () => {
  const ev = [
    { t: 100, tipo: 'prompt' },
    { t: 400, tipo: 'post_tool', ferramenta: 'Read' },
    { t: 900, tipo: 'stop' },
  ];
  assert.deepEqual(H.pedacosDoTurno(ev, semFim), [{ inicio: 100, fim: 900 }]);
});

test('pergunta pausa até o post_tool dela', () => {
  const ev = [
    { t: 100, tipo: 'prompt' },
    { t: 200, tipo: 'pre_tool', ferramenta: 'AskUserQuestion', tool_use_id: 'q' },
    { t: 5000, tipo: 'post_tool', ferramenta: 'AskUserQuestion', tool_use_id: 'q' },
    { t: 5600, tipo: 'stop' },
  ];
  assert.deepEqual(H.pedacosDoTurno(ev, semFim), [{ inicio: 100, fim: 200 }, { inicio: 5000, fim: 5600 }]);
});

test('aviso sem ferramenta (elicitation) retoma no próximo pre_tool', () => {
  const ev = [
    { t: 100, tipo: 'prompt' },
    { t: 200, tipo: 'notificacao', notificacao: 'elicitation_dialog' },
    { t: 3000, tipo: 'pre_tool', ferramenta: 'Read', tool_use_id: 'r' },
    { t: 3500, tipo: 'stop' },
  ];
  assert.deepEqual(H.pedacosDoTurno(ev, semFim), [{ inicio: 100, fim: 200 }, { inicio: 3000, fim: 3500 }]);
});

test('ferramenta em paralelo não retoma enquanto a aprovação segue aberta', () => {
  const ev = [
    { t: 100, tipo: 'prompt' },
    { t: 150, tipo: 'pre_tool', ferramenta: 'Read', tool_use_id: 'r' },
    { t: 160, tipo: 'pre_tool', ferramenta: 'Bash', tool_use_id: 'b' },
    { t: 170, tipo: 'permissao', ferramenta: 'Bash' },
    { t: 180, tipo: 'post_tool', ferramenta: 'Read', tool_use_id: 'r' },
    { t: 4000, tipo: 'post_tool', ferramenta: 'Bash', tool_use_id: 'b' },
    { t: 4200, tipo: 'stop' },
  ];
  assert.deepEqual(H.pedacosDoTurno(ev, semFim), [{ inicio: 100, fim: 170 }, { inicio: 4000, fim: 4200 }]);
});

test('ferramenta depois do stop, sem vermelho, não abre pedaço', () => {
  const ev = [{ t: 100, tipo: 'prompt' }, { t: 200, tipo: 'stop' }, { t: 300, tipo: 'post_tool', ferramenta: 'Read' }];
  assert.deepEqual(H.pedacosDoTurno(ev, semFim), [{ inicio: 100, fim: 200 }]);
});

test('vários turnos dão vários pedaços', () => {
  const ev = [
    { t: 100, tipo: 'inicio' }, { t: 110, tipo: 'prompt' }, { t: 200, tipo: 'stop' },
    { t: 900, tipo: 'prompt' }, { t: 1000, tipo: 'stop' },
  ];
  assert.deepEqual(H.pedacosDoTurno(ev, semFim), [{ inicio: 110, fim: 200 }, { inicio: 900, fim: 1000 }]);
});

// Arquivo

test('registra e lê de volta, pulando linha estragada', () => {
  const arq = tmp();
  const h = H.criarHistorico(arq, () => 0);
  h.registrar({ sessaoId: 'a1', nome: 'Um', grupoId: 'g1', inicio: 10, fim: 20 });
  fs.appendFileSync(arq, '{isto não é json\n');
  fs.appendFileSync(arq, '{"sessaoId":"b2","inicio":"x","fim":5}\n');
  h.registrar({ sessaoId: 'b2', nome: 'Dois', grupoId: null, inicio: 30, fim: 40 });
  assert.deepEqual(h.ler(), [
    { sessaoId: 'a1', nome: 'Um', grupoId: 'g1', inicio: 10, fim: 20 },
    { sessaoId: 'b2', nome: 'Dois', grupoId: null, inicio: 30, fim: 40 },
  ]);
  assert.deepEqual(h.ler(25).map((r) => r.sessaoId), ['b2']);
});

test('arquivo ausente lê vazio', () => {
  assert.deepEqual(H.criarHistorico(tmp(), () => 0).ler(), []);
});

test('podar tira o que tem mais de 90 dias e reescreve o arquivo', () => {
  const arq = tmp();
  const agora = 200 * DIA;
  const h = H.criarHistorico(arq, () => agora);
  h.registrar({ sessaoId: 'velho', nome: 'V', grupoId: null, inicio: agora - 91 * DIA, fim: agora - 91 * DIA + 1000 });
  h.registrar({ sessaoId: 'novo', nome: 'N', grupoId: null, inicio: agora - 89 * DIA, fim: agora - 89 * DIA + 1000 });
  fs.appendFileSync(arq, 'lixo\n');
  h.podar(agora);
  assert.deepEqual(h.ler().map((r) => r.sessaoId), ['novo']);
  assert.equal(fs.readFileSync(arq, 'utf8').trim().split('\n').length, 1);
  h.registrar({ sessaoId: 'depois', nome: 'D', grupoId: null, inicio: agora, fim: agora + 1 });
  assert.deepEqual(h.ler().map((r) => r.sessaoId), ['novo', 'depois']);
});

// Resumo

const reg = (sessaoId, grupoId, inicio, fim, nome = sessaoId) => ({ sessaoId, nome, grupoId, inicio, fim });
const nomesGrupos = new Map([['g1', 'Loja'], ['g2', 'Atlas']]);
const opcoes = (extra = {}) => ({
  desde: 0, ate: 1e9, grupoAtual: () => undefined, nomeAtual: () => undefined, nomesGrupos, ...extra,
});

test('usa o grupo atual da sessão em vez da cópia', () => {
  const r = H.resumir([reg('a', 'g1', 0, 1000)], opcoes({ grupoAtual: (id) => (id === 'a' ? 'g2' : undefined) }));
  assert.equal(r.totalMs, 1000);
  assert.deepEqual(r.porGrupo, [{ grupoId: 'g2', nome: 'Atlas', ms: 1000 }]);
});

test('grupo atual null vai para Sem grupo mesmo com cópia', () => {
  const r = H.resumir([reg('a', 'g1', 0, 1000)], opcoes({ grupoAtual: () => null }));
  assert.deepEqual(r.porGrupo, [{ grupoId: null, nome: 'Sem grupo', ms: 1000 }]);
});

test('sessão desconhecida usa a cópia', () => {
  const r = H.resumir([reg('a', 'g1', 0, 1000, 'Cópia')], opcoes());
  assert.deepEqual(r.porGrupo, [{ grupoId: 'g1', nome: 'Loja', ms: 1000 }]);
  assert.deepEqual(r.topSessoes, [{ sessaoId: 'a', nome: 'Cópia', grupoNome: 'Loja', ms: 1000 }]);
});

test('grupo apagado vai para Sem grupo', () => {
  const r = H.resumir([reg('a', 'g9', 0, 1000), reg('b', null, 0, 500)], opcoes());
  assert.deepEqual(r.porGrupo, [{ grupoId: null, nome: 'Sem grupo', ms: 1500 }]);
  assert.equal(r.topSessoes[0].grupoNome, 'Sem grupo');
});

test('corta no desde e no ate', () => {
  const r = H.resumir([reg('a', 'g1', 0, 1000), reg('b', 'g1', 50, 80), reg('c', 'g1', 1500, 3000)],
    opcoes({ desde: 600, ate: 2000 }));
  assert.equal(r.totalMs, 400 + 500);
  assert.deepEqual(r.topSessoes.map((s) => [s.sessaoId, s.ms]), [['c', 500], ['a', 400]]);
});

test('grupos do maior para o menor e nome atual no top', () => {
  const r = H.resumir([reg('a', 'g1', 0, 100), reg('b', 'g2', 0, 300), reg('a', 'g1', 200, 300)],
    opcoes({ nomeAtual: (id) => (id === 'a' ? 'Nome novo' : undefined) }));
  assert.deepEqual(r.porGrupo.map((g) => [g.nome, g.ms]), [['Atlas', 300], ['Loja', 200]]);
  assert.deepEqual(r.topSessoes.map((s) => [s.nome, s.ms]), [['b', 300], ['Nome novo', 200]]);
});

test('top de no máximo 5 sessões', () => {
  const regs = [1, 2, 3, 4, 5, 6, 7].map((n) => reg(`s${n}`, null, 0, n * 100));
  const r = H.resumir(regs, opcoes());
  assert.equal(r.topSessoes.length, 5);
  assert.deepEqual(r.topSessoes.map((s) => s.sessaoId), ['s7', 's6', 's5', 's4', 's3']);
  assert.equal(r.totalMs, 2800);
});

test('silêncio de mais de 90 s parte o pedaço e fica de fora', () => {
  const ev = [
    { t: 1000, tipo: 'prompt' },
    { t: 2000, tipo: 'pre_tool', ferramenta: 'Bash', tool_use_id: 'a' },
    { t: 2000 + 91000, tipo: 'post_tool', ferramenta: 'Bash', tool_use_id: 'a' },
    { t: 2000 + 95000, tipo: 'stop' },
  ];
  assert.deepEqual(H.pedacosDoTurno(ev, semFim), [{ inicio: 1000, fim: 2000 }, { inicio: 93000, fim: 97000 }]);
});

test('silêncio de até 90 s não parte', () => {
  const ev = [{ t: 0, tipo: 'prompt' }, { t: 90000, tipo: 'post_tool', ferramenta: 'Read' }, { t: 91000, tipo: 'stop' }];
  assert.deepEqual(H.pedacosDoTurno(ev, semFim), [{ inicio: 0, fim: 91000 }]);
});

test('pedaço fechado no cinza não volta diferente quando o trabalho retoma', () => {
  const antes = [{ t: 100, tipo: 'prompt' }, { t: 300, tipo: 'pre_tool', ferramenta: 'Bash', tool_use_id: 'a' }];
  const noCinza = H.pedacosDoTurno(antes, { processoSaiuEm: null, cinzaDesde: 90300 });
  assert.deepEqual(noCinza, [{ inicio: 100, fim: 300 }]);
  const depois = [...antes,
    { t: 200000, tipo: 'post_tool', ferramenta: 'Bash', tool_use_id: 'a' },
    { t: 200500, tipo: 'stop' }];
  const final = H.pedacosDoTurno(depois, semFim);
  assert.deepEqual(final, [{ inicio: 100, fim: 300 }, { inicio: 200000, fim: 200500 }]);
  assert.equal(final.filter((p) => p.inicio === 100).length, 1);
});

test('ferramenta de subagente não solta a aprovação vinda do permission_prompt', () => {
  const ev = [
    { t: 100, tipo: 'prompt' },
    { t: 150, tipo: 'pre_tool', ferramenta: 'Bash', tool_use_id: 'a' },
    { t: 6150, tipo: 'notificacao', notificacao: 'permission_prompt' },
    { t: 7000, tipo: 'pre_tool', ferramenta: 'Read', tool_use_id: 'r', agente: 'sub1' },
    { t: 60000, tipo: 'post_tool', ferramenta: 'Bash', tool_use_id: 'a' },
    { t: 61000, tipo: 'stop' },
  ];
  assert.deepEqual(H.pedacosDoTurno(ev, semFim), [{ inicio: 100, fim: 6150 }, { inicio: 60000, fim: 61000 }]);
});

test('podar não apaga o arquivo que não conseguiu ler', { skip: process.getuid && process.getuid() === 0 }, () => {
  const arq = tmp();
  const h = H.criarHistorico(arq, () => 0);
  h.registrar({ sessaoId: 'a1', nome: 'Um', grupoId: null, inicio: 10, fim: 20 });
  const antes = fs.readFileSync(arq, 'utf8');
  fs.chmodSync(arq, 0o000);
  try {
    h.podar(1e12);
  } finally {
    fs.chmodSync(arq, 0o644);
  }
  assert.equal(fs.readFileSync(arq, 'utf8'), antes);
});
