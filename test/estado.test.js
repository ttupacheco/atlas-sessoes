const test = require('node:test');
const assert = require('node:assert');
const { lerEventos, calcularEstado, ordenar } = require('../src/estado');

const MIN = 60000;
const ctx = (o = {}) => ({ agora: 1000, vistaEm: null, saidaTerminalEm: null, processoVivo: true, ...o });

test('prompt deixa amarelo trabalhando', () => {
  const e = calcularEstado([{ t: 0, tipo: 'prompt', texto: 'ajustar etiqueta' }], ctx({ agora: 1000 }));
  assert.strictEqual(e.cor, 'amarelo');
  assert.strictEqual(e.rotulo, 'trabalhando');
  assert.strictEqual(e.ultimoPedido, 'ajustar etiqueta');
});

test('prompt longo é cortado em 80 caracteres com reticências', () => {
  const e = calcularEstado([{ t: 0, tipo: 'prompt', texto: 'a'.repeat(120) }], ctx());
  assert.strictEqual(e.ultimoPedido.length, 81);
  assert.ok(e.ultimoPedido.endsWith('…'));
});

test('permissao vira vermelho e post_tool volta a amarelo', () => {
  const base = [{ t: 0, tipo: 'prompt', texto: 'x' }, { t: 10, tipo: 'permissao' }];
  const e = calcularEstado(base, ctx({ agora: 20 }));
  assert.strictEqual(e.cor, 'vermelho');
  assert.strictEqual(e.rotulo, 'pede aprovação');
  const e2 = calcularEstado([...base, { t: 30, tipo: 'post_tool' }], ctx({ agora: 40 }));
  assert.strictEqual(e2.cor, 'amarelo');
});

test('notificacao permission_prompt vira vermelho; outra notificação é ignorada', () => {
  const e = calcularEstado([{ t: 0, tipo: 'prompt' }, { t: 5, tipo: 'notificacao', notificacao: 'permission_prompt' }], ctx({ agora: 10 }));
  assert.strictEqual(e.rotulo, 'pede aprovação');
  const e2 = calcularEstado([{ t: 0, tipo: 'prompt' }, { t: 5, tipo: 'notificacao', notificacao: 'outra' }], ctx({ agora: 10 }));
  assert.strictEqual(e2.cor, 'amarelo');
});

test('idle_prompt encerra a vez: aprovação recusada ou Esc no meio voltam a verde pronta', () => {
  const recusou = [{ t: 0, tipo: 'prompt' }, { t: 10, tipo: 'permissao' }, { t: 20, tipo: 'notificacao', notificacao: 'idle_prompt' }];
  const a = calcularEstado(recusou, ctx({ agora: 30 }));
  assert.strictEqual(a.cor, 'verde');
  assert.strictEqual(a.rotulo, 'pronta');
  assert.strictEqual(a.desde, 20);
  const esc = [{ t: 0, tipo: 'prompt' }, { t: 10, tipo: 'pre_tool' }, { t: 20, tipo: 'notificacao', notificacao: 'idle_prompt' }];
  assert.strictEqual(calcularEstado(esc, ctx({ agora: 5 * MIN })).rotulo, 'pronta, você ainda não viu');
  assert.strictEqual(calcularEstado(esc, ctx({ agora: 5 * MIN, vistaEm: 25 })).rotulo, 'pronta');
});

test('idle_prompt depois de um stop já visto não volta a "não viu"', () => {
  const ev = [{ t: 0, tipo: 'prompt' }, { t: 10, tipo: 'stop' }, { t: 70000, tipo: 'notificacao', notificacao: 'idle_prompt' }];
  const e = calcularEstado(ev, ctx({ agora: 10 * MIN, vistaEm: 20 }));
  assert.strictEqual(e.cor, 'verde');
  assert.strictEqual(e.desde, 10, 'a vez terminou no stop');
  const naoVista = calcularEstado(ev, ctx({ agora: 10 * MIN }));
  assert.strictEqual(naoVista.rotulo, 'pronta, você ainda não viu');
  assert.strictEqual(naoVista.desde, 10 + 3 * MIN);
});

test('idle_prompt sem nada antes (sessão parada desde que abriu) fica verde pronta', () => {
  const e = calcularEstado([{ t: 0, tipo: 'inicio' }, { t: 60000, tipo: 'notificacao', notificacao: 'idle_prompt' }], ctx({ agora: 30 * MIN }));
  assert.strictEqual(e.rotulo, 'pronta');
});

test('saída no terminal não tira do vermelho', () => {
  const e = calcularEstado([{ t: 0, tipo: 'prompt' }, { t: 10, tipo: 'permissao' }], ctx({ agora: 200000, saidaTerminalEm: 199000 }));
  assert.strictEqual(e.cor, 'vermelho');
});

test('AskUserQuestion vira vermelho te fez uma pergunta', () => {
  const e = calcularEstado([{ t: 0, tipo: 'prompt' }, { t: 5, tipo: 'pre_tool', ferramenta: 'AskUserQuestion' }], ctx({ agora: 10 }));
  assert.strictEqual(e.cor, 'vermelho');
  assert.strictEqual(e.rotulo, 'te fez uma pergunta');
});

test('stop: verde, depois vermelho se não vista em 3 min', () => {
  const ev = [{ t: 0, tipo: 'prompt' }, { t: 0, tipo: 'stop' }];
  const a = calcularEstado(ev, ctx({ agora: 2 * MIN }));
  assert.strictEqual(a.cor, 'verde');
  assert.strictEqual(a.rotulo, 'pronta');
  const b = calcularEstado(ev, ctx({ agora: 3 * MIN }));
  assert.strictEqual(b.cor, 'vermelho');
  assert.strictEqual(b.rotulo, 'pronta, você ainda não viu');
  assert.strictEqual(b.desde, 3 * MIN);
  const c = calcularEstado(ev, ctx({ agora: 10 * MIN, vistaEm: MIN }));
  assert.strictEqual(c.cor, 'verde');
});

test('sem sinal: cinza após 90 s, amarelo se houve saída no terminal', () => {
  const ev = [{ t: 0, tipo: 'prompt' }];
  const a = calcularEstado(ev, ctx({ agora: 91000 }));
  assert.strictEqual(a.cor, 'cinza');
  assert.strictEqual(a.rotulo, 'sem sinal');
  const b = calcularEstado(ev, ctx({ agora: 91000, saidaTerminalEm: 80000 }));
  assert.strictEqual(b.cor, 'amarelo');
});

test('processo morto vira preto encerrada', () => {
  const e = calcularEstado([{ t: 0, tipo: 'prompt' }], ctx({ processoVivo: false }));
  assert.strictEqual(e.cor, 'preto');
  assert.strictEqual(e.rotulo, 'encerrada');
});

test('claudeSessionId é o último session_id visto', () => {
  const e = calcularEstado([{ t: 0, tipo: 'inicio', session_id: 'a' }, { t: 1, tipo: 'prompt', session_id: 'b' }], ctx({ agora: 2 }));
  assert.strictEqual(e.claudeSessionId, 'b');
});

test('lerEventos ignora linhas inválidas', () => {
  assert.strictEqual(lerEventos('{"t":1,"tipo":"prompt"}\n{quebrado\n{"t":2,"tipo":"stop"}').length, 2);
});

test('ordenar: vermelhos primeiro, mais antigo no topo, resto por criadoEm', () => {
  const v10 = { estado: { cor: 'vermelho', desde: 10 }, criadoEm: 3 };
  const v50 = { estado: { cor: 'vermelho', desde: 50 }, criadoEm: 2 };
  const verde = { estado: { cor: 'verde', desde: 0 }, criadoEm: 1 };
  assert.deepStrictEqual(ordenar([verde, v50, v10]), [v10, v50, verde]);
});

test('sessão sem nenhum evento desta execução: abrindo, e depois de 10 s confirme a pasta (I3)', () => {
  const a = calcularEstado([], ctx({ agora: 9999, iniciadoEm: 0 }));
  assert.strictEqual(a.cor, 'cinza');
  assert.strictEqual(a.rotulo, 'abrindo');
  assert.strictEqual(a.desde, 0);
  const b = calcularEstado([], ctx({ agora: 10 * MIN, iniciadoEm: 0 }));
  assert.strictEqual(b.cor, 'vermelho');
  assert.strictEqual(b.rotulo, 'confirme a pasta');
  assert.strictEqual(b.desde, 10000, 'na fila dos vermelhos, desde que passou o prazo');
  assert.strictEqual(calcularEstado([], ctx({ agora: 10 * MIN, iniciadoEm: 0, processoVivo: false })).cor, 'preto');
});

test('sessão com só o inicio fica verde pronta', () => {
  const b = calcularEstado([{ t: 0, tipo: 'inicio', session_id: 's' }], ctx({ agora: 10 * MIN }));
  assert.strictEqual(b.cor, 'verde');
  assert.strictEqual(b.rotulo, 'pronta');
  assert.strictEqual(b.claudeSessionId, 's');
});

// I1: pedido de aprovação gruda até a resposta, não até o próximo evento.

const pedido = [{ t: 0, tipo: 'prompt', texto: 'x' }];

test('aprovação pendente não some com ferramenta de outro agente rodando', () => {
  const ev = [...pedido,
    { t: 10, tipo: 'pre_tool', ferramenta: 'Bash', tool_use_id: 'b1' },
    { t: 20, tipo: 'permissao', ferramenta: 'Bash' },
    { t: 30, tipo: 'pre_tool', ferramenta: 'Read', tool_use_id: 'r1', agente: 'ag1' },
    { t: 40, tipo: 'post_tool', ferramenta: 'Read', tool_use_id: 'r1', agente: 'ag1' }];
  const e = calcularEstado(ev, ctx({ agora: 50 }));
  assert.strictEqual(e.cor, 'vermelho');
  assert.strictEqual(e.rotulo, 'pede aprovação');
  assert.strictEqual(e.desde, 20);
  assert.strictEqual(calcularEstado(ev, ctx({ agora: 200000 })).cor, 'vermelho', 'nem vira sem sinal');
  const aprovado = calcularEstado([...ev, { t: 60, tipo: 'post_tool', ferramenta: 'Bash', tool_use_id: 'b1' }], ctx({ agora: 70 }));
  assert.strictEqual(aprovado.cor, 'amarelo');
});

test('a mesma ferramenta num subagente não limpa a aprovação da conversa principal', () => {
  const ev = [...pedido,
    { t: 10, tipo: 'pre_tool', ferramenta: 'Bash', tool_use_id: 'b1' },
    { t: 20, tipo: 'permissao', ferramenta: 'Bash' },
    { t: 30, tipo: 'pre_tool', ferramenta: 'Bash', tool_use_id: 'b2', agente: 'ag1' },
    { t: 40, tipo: 'post_tool', ferramenta: 'Bash', tool_use_id: 'b2', agente: 'ag1' }];
  assert.strictEqual(calcularEstado(ev, ctx({ agora: 50 })).cor, 'vermelho');
});

test('eventos antigos sem tool_use_id: limpa pela mesma ferramenta, não por outra', () => {
  const base = [...pedido, { t: 10, tipo: 'permissao', ferramenta: 'Bash' }];
  assert.strictEqual(calcularEstado([...base, { t: 20, tipo: 'post_tool', ferramenta: 'Read' }], ctx({ agora: 30 })).cor, 'vermelho');
  assert.strictEqual(calcularEstado([...base, { t: 20, tipo: 'post_tool', ferramenta: 'Bash' }], ctx({ agora: 30 })).cor, 'amarelo');
});

test('ferramenta aprovada que falhou (post_tool com falhou) limpa a aprovação', () => {
  const ev = [...pedido,
    { t: 10, tipo: 'pre_tool', ferramenta: 'Bash', tool_use_id: 'b1' },
    { t: 20, tipo: 'permissao', ferramenta: 'Bash' },
    { t: 30, tipo: 'post_tool', ferramenta: 'Bash', tool_use_id: 'b1', falhou: true }];
  assert.strictEqual(calcularEstado(ev, ctx({ agora: 40 })).cor, 'amarelo');
});

test('prompt e idle_prompt limpam a aprovação; stop limpa só a da conversa principal', () => {
  const principal = [...pedido, { t: 10, tipo: 'permissao', ferramenta: 'Bash' }];
  assert.strictEqual(calcularEstado([...principal, { t: 20, tipo: 'prompt', texto: 'y' }], ctx({ agora: 30 })).cor, 'amarelo');
  assert.strictEqual(calcularEstado([...principal, { t: 20, tipo: 'stop' }], ctx({ agora: 30 })).cor, 'verde');
  const sub = [...pedido,
    { t: 10, tipo: 'pre_tool', ferramenta: 'Bash', tool_use_id: 'b9', agente: 'ag1' },
    { t: 20, tipo: 'permissao', ferramenta: 'Bash', agente: 'ag1' }];
  const e = calcularEstado([...sub, { t: 30, tipo: 'stop' }], ctx({ agora: 40 }));
  assert.strictEqual(e.cor, 'vermelho', 'subagente em segundo plano segue esperando depois do stop');
  assert.strictEqual(e.rotulo, 'pede aprovação');
  assert.strictEqual(calcularEstado([...sub, { t: 30, tipo: 'stop' }, { t: 90, tipo: 'notificacao', notificacao: 'idle_prompt' }], ctx({ agora: 100 })).cor, 'verde');
});

test('pergunta (AskUserQuestion) também gruda e o rótulo vence o da aprovação', () => {
  const ev = [...pedido,
    { t: 10, tipo: 'pre_tool', ferramenta: 'AskUserQuestion', tool_use_id: 'q1' },
    { t: 11, tipo: 'permissao', ferramenta: 'AskUserQuestion' },
    { t: 30, tipo: 'pre_tool', ferramenta: 'Read', tool_use_id: 'r1', agente: 'ag1' },
    { t: 40, tipo: 'post_tool', ferramenta: 'Read', tool_use_id: 'r1', agente: 'ag1' }];
  const e = calcularEstado(ev, ctx({ agora: 50 }));
  assert.strictEqual(e.cor, 'vermelho');
  assert.strictEqual(e.rotulo, 'te fez uma pergunta');
  assert.strictEqual(e.desde, 10);
  const respondeu = [...ev, { t: 60, tipo: 'post_tool', ferramenta: 'AskUserQuestion', tool_use_id: 'q1' }];
  assert.strictEqual(calcularEstado(respondeu, ctx({ agora: 70 })).cor, 'amarelo');
});

test('duas pendências: o cartão mostra a mais antiga; limpar uma deixa a outra', () => {
  const ev = [...pedido,
    { t: 10, tipo: 'pre_tool', ferramenta: 'Bash', tool_use_id: 'b1' },
    { t: 20, tipo: 'permissao', ferramenta: 'Bash' },
    { t: 30, tipo: 'pre_tool', ferramenta: 'Write', tool_use_id: 'w1', agente: 'ag1' },
    { t: 40, tipo: 'permissao', ferramenta: 'Write', agente: 'ag1' }];
  assert.strictEqual(calcularEstado(ev, ctx({ agora: 50 })).desde, 20);
  const uma = calcularEstado([...ev, { t: 60, tipo: 'post_tool', ferramenta: 'Bash', tool_use_id: 'b1' }], ctx({ agora: 70 }));
  assert.strictEqual(uma.cor, 'vermelho');
  assert.strictEqual(uma.desde, 40);
});

test('permission_prompt logo depois de um permissao é o mesmo diálogo, não uma pendência nova', () => {
  const ev = [...pedido,
    { t: 10, tipo: 'pre_tool', ferramenta: 'Bash', tool_use_id: 'b1' },
    { t: 20, tipo: 'permissao', ferramenta: 'Bash' },
    { t: 6020, tipo: 'notificacao', notificacao: 'permission_prompt' },
    { t: 9000, tipo: 'post_tool', ferramenta: 'Bash', tool_use_id: 'b1' }];
  assert.strictEqual(calcularEstado(ev, ctx({ agora: 9100 })).cor, 'amarelo');
});

// I2: depois de aprovar, a ferramenta roda sem evento nenhum até o post_tool.

const aprovacaoBash = [...pedido,
  { t: 10, tipo: 'pre_tool', ferramenta: 'Bash', tool_use_id: 'b1' },
  { t: 20, tipo: 'permissao', ferramenta: 'Bash' }];

test('resposta no terminal depois do pedido, com saída depois dela, volta a amarelo', () => {
  const e = calcularEstado(aprovacaoBash, ctx({ agora: 10 * MIN, respostasEm: [5000], saidaTerminalEm: 10 * MIN - 1000 }));
  assert.strictEqual(e.cor, 'amarelo');
  assert.strictEqual(e.rotulo, 'trabalhando');
  assert.strictEqual(e.desde, 5000, 'trabalhando desde a resposta');
});

test('resposta sem saída depois, ou antes do pedido, não tira do vermelho', () => {
  assert.strictEqual(calcularEstado(aprovacaoBash, ctx({ agora: 6000, respostasEm: [5000], saidaTerminalEm: 4000 })).cor, 'vermelho');
  assert.strictEqual(calcularEstado(aprovacaoBash, ctx({ agora: 6000, respostasEm: [5000] })).cor, 'vermelho');
  assert.strictEqual(calcularEstado(aprovacaoBash, ctx({ agora: 6000, respostasEm: [15], saidaTerminalEm: 5900 })).cor, 'vermelho');
});

test('uma resposta vale para um diálogo só: o segundo pedido segue vermelho', () => {
  const ev = [...aprovacaoBash,
    { t: 30, tipo: 'pre_tool', ferramenta: 'Write', tool_use_id: 'w1', agente: 'ag1' },
    { t: 40, tipo: 'permissao', ferramenta: 'Write', agente: 'ag1' }];
  const e = calcularEstado(ev, ctx({ agora: 6000, respostasEm: [5000], saidaTerminalEm: 5500 }));
  assert.strictEqual(e.cor, 'vermelho');
  assert.strictEqual(e.desde, 40);
  assert.strictEqual(calcularEstado(ev, ctx({ agora: 6000, respostasEm: [5000, 5200], saidaTerminalEm: 5500 })).cor, 'amarelo');
});

test('pergunta só sai do vermelho pelo post_tool (tem várias telas de resposta)', () => {
  const ev = [...pedido, { t: 10, tipo: 'pre_tool', ferramenta: 'AskUserQuestion', tool_use_id: 'q1' }];
  assert.strictEqual(calcularEstado(ev, ctx({ agora: 6000, respostasEm: [5000], saidaTerminalEm: 5500 })).cor, 'vermelho');
});

// M5: outros pedidos de atenção do Claude Code 2.1.330 (tipos conferidos no binário).

test('worker_permission_prompt pede aprovação; elicitation e agent_needs_input precisam de você', () => {
  const casos = [
    ['worker_permission_prompt', 'pede aprovação'],
    ['elicitation_dialog', 'precisa de você'],
    ['elicitation_url_dialog', 'precisa de você'],
    ['agent_needs_input', 'precisa de você'],
  ];
  for (const [tipo, rotulo] of casos) {
    const ev = [...pedido, { t: 10, tipo: 'notificacao', notificacao: tipo },
      { t: 20, tipo: 'pre_tool', ferramenta: 'Read', tool_use_id: 'r1' },
      { t: 30, tipo: 'post_tool', ferramenta: 'Read', tool_use_id: 'r1' },
      { t: 40, tipo: 'stop' }];
    const e = calcularEstado(ev, ctx({ agora: 200000 }));
    assert.strictEqual(e.cor, 'vermelho', tipo);
    assert.strictEqual(e.rotulo, rotulo, tipo);
    assert.strictEqual(e.desde, 10, tipo);
    const respondeu = calcularEstado(ev, ctx({ agora: 6000, respostasEm: [5000], saidaTerminalEm: 5500 }));
    assert.strictEqual(respondeu.cor, 'verde', tipo + ': a resposta no terminal limpa');
    const ocioso = calcularEstado([...ev, { t: 100000, tipo: 'notificacao', notificacao: 'idle_prompt' }], ctx({ agora: 100010 }));
    assert.notStrictEqual(ocioso.cor + ocioso.rotulo, 'vermelho' + rotulo, tipo + ': idle_prompt limpa');
  }
});

test('o mesmo aviso repetido não vira duas pendências; tipo desconhecido é ignorado', () => {
  const ev = [...pedido,
    { t: 10, tipo: 'notificacao', notificacao: 'agent_needs_input' },
    { t: 20, tipo: 'notificacao', notificacao: 'agent_needs_input' }];
  assert.strictEqual(calcularEstado(ev, ctx({ agora: 6000, respostasEm: [5000], saidaTerminalEm: 5500 })).cor, 'amarelo');
  assert.strictEqual(calcularEstado([...pedido, { t: 10, tipo: 'notificacao', notificacao: 'auth_success' }], ctx({ agora: 20 })).cor, 'amarelo');
});

// M9: Esc é do próprio usuário; o fim da vez só pelo idle_prompt não vira "não viu".

test('vez interrompida por tecla no terminal (Esc) e terminada só pelo idle_prompt não vira "não viu"', () => {
  const esc = [...pedido, { t: 10, tipo: 'pre_tool', ferramenta: 'Bash' }, { t: 60015, tipo: 'notificacao', notificacao: 'idle_prompt' }];
  const e = calcularEstado(esc, ctx({ agora: 10 * MIN, digitadoEm: 15 }));
  assert.strictEqual(e.cor, 'verde');
  assert.strictEqual(e.rotulo, 'pronta');
  assert.strictEqual(calcularEstado(esc, ctx({ agora: 10 * MIN, digitadoEm: 5 })).rotulo, 'pronta, você ainda não viu',
    'tecla antes do último trabalho não explica o fim (ex.: erro da API)');
});

test('com stop, digitar antes do fim não conta como visto', () => {
  const ev = [...pedido, { t: 10, tipo: 'pre_tool', ferramenta: 'Bash' }, { t: 20, tipo: 'stop' }];
  assert.strictEqual(calcularEstado(ev, ctx({ agora: 10 * MIN, digitadoEm: 15 })).rotulo, 'pronta, você ainda não viu');
});

// N1: chamadas em paralelo da mesma ferramenta. O permissao não diz de qual chamada é.

test('paralelo: o post_tool da outra chamada não limpa a aprovação; só quando todas terminam', () => {
  const ev = [...pedido,
    { t: 3000, tipo: 'pre_tool', ferramenta: 'WebFetch', tool_use_id: 'a' },
    { t: 3010, tipo: 'pre_tool', ferramenta: 'WebFetch', tool_use_id: 'b' },
    { t: 3100, tipo: 'permissao', ferramenta: 'WebFetch' }];
  assert.strictEqual(calcularEstado(ev, ctx({ agora: 3200 })).rotulo, 'pede aprovação');
  ev.push({ t: 3500, tipo: 'post_tool', ferramenta: 'WebFetch', tool_use_id: 'b' });
  const e = calcularEstado(ev, ctx({ agora: 3600 }));
  assert.strictEqual(e.rotulo, 'pede aprovação', 'a chamada A segue com o diálogo aberto');
  assert.strictEqual(e.desde, 3100);
  ev.push({ t: 9100, tipo: 'notificacao', notificacao: 'permission_prompt' });
  assert.strictEqual(calcularEstado(ev, ctx({ agora: 110000, saidaTerminalEm: 9100 })).rotulo, 'pede aprovação');
  ev.push({ t: 120000, tipo: 'post_tool', ferramenta: 'WebFetch', tool_use_id: 'a' });
  assert.strictEqual(calcularEstado(ev, ctx({ agora: 120100 })).cor, 'amarelo');
});

test('permission_prompt nunca é descartado: sem aprovação aberta, vira vermelho mesmo logo depois de um permissao', () => {
  const ev = [...pedido,
    { t: 3000, tipo: 'pre_tool', ferramenta: 'Bash', tool_use_id: 'b1' },
    { t: 3100, tipo: 'permissao', ferramenta: 'Bash' },
    { t: 3500, tipo: 'post_tool', ferramenta: 'Bash', tool_use_id: 'b1' },
    { t: 9100, tipo: 'notificacao', notificacao: 'permission_prompt' }];
  const e = calcularEstado(ev, ctx({ agora: 9200 }));
  assert.strictEqual(e.cor, 'vermelho');
  assert.strictEqual(e.rotulo, 'pede aprovação');
  assert.strictEqual(e.desde, 9100);
});

// I1: StopFailure (erro da API) vira falha_stop: a vez acabou, como um stop.

test('falha_stop encerra a vez: sai do amarelo na hora e limpa as pendências da conversa principal', () => {
  const ev = [...pedido, { t: 10, tipo: 'pre_tool', ferramenta: 'Bash' }, { t: 20, tipo: 'falha_stop' }];
  const e = calcularEstado(ev, ctx({ agora: 30 }));
  assert.strictEqual(e.cor, 'verde');
  assert.strictEqual(e.rotulo, 'pronta');
  assert.strictEqual(calcularEstado(ev, ctx({ agora: 10 * MIN, digitadoEm: 15 })).rotulo, 'pronta, você ainda não viu',
    'o erro não foi o usuário que parou: vale como um stop para o "não viu"');
  const comAprovacao = [...pedido, { t: 10, tipo: 'pre_tool', ferramenta: 'Bash', tool_use_id: 'b' },
    { t: 11, tipo: 'permissao', ferramenta: 'Bash' }, { t: 20, tipo: 'falha_stop' }];
  assert.strictEqual(calcularEstado(comAprovacao, ctx({ agora: 30 })).cor, 'verde');
});
