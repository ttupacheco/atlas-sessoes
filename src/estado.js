const MINUTOS_NAO_VISTA = 3;
const SEGUNDOS_SEM_SINAL = 90;
const LIMITE_PEDIDO = 80;
// Sem nenhum evento desta execução, o claude ainda não rodou hook nenhum. Na pasta pessoal
// isso é o diálogo de confiança, que aparece em toda abertura e só passa com um Enter.
const SEGUNDOS_ABRINDO = 10;

function lerEventos(texto) {
  const eventos = [];
  for (const linha of String(texto).split('\n')) {
    if (!linha.trim()) continue;
    try {
      const ev = JSON.parse(linha);
      if (ev && typeof ev === 'object') eventos.push(ev);
    } catch (_) {
      // linha inválida, ignorada
    }
  }
  return eventos;
}

function cortar(texto) {
  const s = String(texto);
  return s.length > LIMITE_PEDIDO ? s.slice(0, LIMITE_PEDIDO) + '…' : s;
}

// Stop de verdade ou a falha_stop (StopFailure: um erro da API, como o limite do plano,
// acabou a vez). Para a cor do cartão os dois são o fim da vez; para o /salvar só o stop salva.
const ehStop = (ev) => ev.tipo === 'stop' || ev.tipo === 'falha_stop';

// Fim da vez do claude: o stop, a falha_stop, ou o idle_prompt (parado esperando você), que
// também chega quando a vez acaba sem stop (aprovação recusada, Esc no meio do trabalho).
function encerraVez(ev) {
  return ehStop(ev) || (ev.tipo === 'notificacao' && ev.notificacao === 'idle_prompt');
}

// Avisos do Claude Code (tipos conferidos no binário 2.1.330) que esperam o usuário, além do
// permission_prompt: permissão de um agente da equipe, formulário ou link de um conector
// (elicitation) e diálogos de agente que precisam de resposta.
const ROTULO_AVISO = {
  worker_permission_prompt: 'pede aprovação',
  elicitation_dialog: 'precisa de você',
  elicitation_url_dialog: 'precisa de você',
  agent_needs_input: 'precisa de você',
};

function ehRelevante(ev) {
  if (ev.tipo === 'notificacao') {
    return ev.notificacao === 'permission_prompt' || ev.notificacao === 'idle_prompt' ||
      Object.hasOwn(ROTULO_AVISO, ev.notificacao);
  }
  return ['prompt', 'pre_tool', 'post_tool', 'permissao', 'stop', 'falha_stop'].includes(ev.tipo);
}

const ROTULO_PENDENCIA = { aprovacao: 'pede aprovação', pergunta: 'te fez uma pergunta' };

const agenteDe = (ev) => (ev.agente == null ? null : ev.agente);

// O post_tool responde a pendência da mesma chamada. O permissao não diz de qual chamada é:
// com várias abertas da mesma ferramenta no mesmo agente (em paralelo), qualquer uma pode ser
// a do diálogo, então a pendência guarda todas e só sai quando a última terminar. Sem
// tool_use_id (eventos antigos), vale a mesma ferramenta no mesmo agente.
// Devolve true quando a pendência acabou.
function responde(pendencia, post) {
  if (pendencia.origem === 'notificacao') return false; // sem ferramenta: só a resposta limpa
  if (pendencia.candidatos.size && post.tool_use_id) {
    if (!pendencia.candidatos.delete(post.tool_use_id)) return false;
    return pendencia.candidatos.size === 0;
  }
  return pendencia.agente === agenteDe(post) && pendencia.ferramenta === post.ferramenta;
}

// Pedidos de aprovação e perguntas abertos. Gruda até a resposta: só limpam o post_tool da
// mesma chamada, um prompt (a caixa de texto aceitou o pedido, então não há diálogo), o
// idle_prompt (o claude só manda sem diálogo na tela) e o stop (só os da conversa principal:
// um subagente em segundo plano segue esperando depois do stop). Ferramentas de outros
// agentes no meio não limpam nada.
function acompanharPendencias() {
  let pendencias = [];
  const abertas = new Map(); // tool_use_id -> pre_tool sem post_tool ainda

  function aoEvento(ev) {
    if (ev.tipo === 'prompt' || (ev.tipo === 'notificacao' && ev.notificacao === 'idle_prompt')) {
      pendencias = [];
      return;
    }
    if (ehStop(ev)) {
      pendencias = pendencias.filter((p) => p.agente !== null);
      return;
    }
    if (ev.tipo === 'pre_tool') {
      if (ev.tool_use_id) abertas.set(ev.tool_use_id, ev);
      if (ev.ferramenta === 'AskUserQuestion') {
        pendencias.push({ t: ev.t, tipo: 'pergunta', ferramenta: ev.ferramenta, agente: agenteDe(ev), candidatos: new Set(ev.tool_use_id ? [ev.tool_use_id] : []) });
      }
      return;
    }
    if (ev.tipo === 'permissao') {
      // A chamada que pediu é uma das abertas da mesma ferramenta e agente.
      const candidatos = new Set();
      for (const [id, pre] of abertas) {
        if (pre.ferramenta === ev.ferramenta && agenteDe(pre) === agenteDe(ev)) candidatos.add(id);
      }
      const jaTem = pendencias.some((p) => p.tipo === 'pergunta' && p.ferramenta === ev.ferramenta &&
        p.agente === agenteDe(ev));
      if (!jaTem) pendencias.push({ t: ev.t, tipo: 'aprovacao', ferramenta: ev.ferramenta, agente: agenteDe(ev), candidatos });
      return;
    }
    if (ev.tipo === 'post_tool') {
      if (ev.tool_use_id) abertas.delete(ev.tool_use_id);
      const i = pendencias.findIndex((p) => responde(p, ev));
      if (i >= 0) pendencias.splice(i, 1);
      return;
    }
    // O permission_prompt sai 6 s depois de o diálogo abrir e é cancelado se alguém responde
    // antes: se chegou, há um diálogo aberto. Só não cria outra pendência se já há uma.
    if (ev.tipo === 'notificacao' && ev.notificacao === 'permission_prompt') {
      const jaAberta = pendencias.some((p) => p.tipo === 'aprovacao' || p.tipo === 'pergunta');
      if (!jaAberta) pendencias.push({ t: ev.t, tipo: 'aprovacao', origem: 'notificacao', agente: undefined, candidatos: new Set() });
      return;
    }
    // Sem ferramenta para casar com um post_tool: limpa com a resposta no terminal, um prompt
    // ou o idle_prompt. Não limpa com o stop (pode ser de um agente em segundo plano).
    if (ev.tipo === 'notificacao' && Object.hasOwn(ROTULO_AVISO, ev.notificacao)) {
      if (!pendencias.some((p) => p.notificacao === ev.notificacao)) {
        pendencias.push({ t: ev.t, tipo: 'aviso', origem: 'notificacao', notificacao: ev.notificacao, rotulo: ROTULO_AVISO[ev.notificacao], agente: undefined });
      }
    }
  }

  // Tecla de resposta no terminal (Enter, número, Esc): responde o diálogo mais antigo que
  // abriu antes dela. A pergunta não conta: tem várias telas, só o post_tool encerra.
  function aoResposta(a) {
    let i = -1;
    pendencias.forEach((p, j) => {
      if (p.tipo !== 'pergunta' && p.t < a && (i < 0 || p.t < pendencias[i].t)) i = j;
    });
    if (i < 0) return false;
    pendencias.splice(i, 1);
    return true;
  }

  // Para quem não vê as teclas (o histórico): trabalho que volta depois de um aviso sem
  // ferramenta quer dizer que ele foi respondido. Só o terminal ou um prompt o limpariam.
  function soltarAvisos() {
    pendencias = pendencias.filter((p) => p.origem !== 'notificacao');
  }

  return { aoEvento, aoResposta, soltarAvisos, abertas: () => pendencias };
}

function calcularEstado(eventos, ctx) {
  const { agora, vistaEm, saidaTerminalEm, processoVivo } = ctx;
  // Depois de aprovar, o claude não manda evento até a ferramenta terminar. Vale como
  // resposta a tecla seguida de saída no terminal (o claude estava vivo e a recebeu).
  const respostas = (ctx.respostasEm || [])
    .filter((a) => saidaTerminalEm != null && saidaTerminalEm > a)
    .sort((x, y) => x - y);
  let proxima = 0;
  let respondidaEm = -Infinity;

  let ultimoPedido = null;
  let claudeSessionId = null;
  let ultimo = null;
  let fimDaVez = null; // primeiro evento da sequência final de stop/idle_prompt
  let houveVez = false; // a sequência final tem um stop ou veio depois de algum trabalho
  let antes = false;
  let temStop = false; // a sequência final tem um stop
  let ultimoTrabalho = -Infinity; // último evento antes da sequência final
  let trabalhoAntesDoFim = -Infinity;
  const pend = acompanharPendencias();
  const responderAte = (t) => {
    for (; proxima < respostas.length && respostas[proxima] < t; proxima++) {
      if (pend.aoResposta(respostas[proxima])) respondidaEm = respostas[proxima];
    }
  };
  for (const ev of eventos) {
    if (ev.tipo === 'prompt' && ev.texto != null) ultimoPedido = cortar(ev.texto);
    if (ev.session_id) claudeSessionId = ev.session_id;
    if (!ehRelevante(ev)) continue;
    responderAte(ev.t);
    pend.aoEvento(ev);
    if (encerraVez(ev)) {
      if (!fimDaVez) { fimDaVez = ev; houveVez = antes; temStop = false; trabalhoAntesDoFim = ultimoTrabalho; }
      if (ehStop(ev)) { houveVez = true; temStop = true; }
    } else {
      fimDaVez = null;
      antes = true;
      ultimoTrabalho = ev.t;
    }
    ultimo = ev;
  }

  responderAte(Infinity);

  const base = { ultimoPedido, claudeSessionId };
  const fim = eventos.length ? eventos[eventos.length - 1].t : agora;

  if (!processoVivo) return { cor: 'preto', rotulo: 'encerrada', desde: agora, ...base };
  if (!eventos.length) {
    const inicio = ctx.iniciadoEm == null ? agora : ctx.iniciadoEm;
    const limite = inicio + SEGUNDOS_ABRINDO * 1000;
    if (agora < limite) return { cor: 'cinza', rotulo: 'abrindo', desde: inicio, ...base };
    return { cor: 'vermelho', rotulo: 'confirme a pasta', desde: limite, ...base };
  }
  if (!ultimo) return { cor: 'verde', rotulo: 'pronta', desde: fim, ...base };

  const pendencias = pend.abertas();
  if (pendencias.length) {
    const p = pendencias.reduce((a, b) => (b.t < a.t ? b : a));
    return { cor: 'vermelho', rotulo: p.rotulo || ROTULO_PENDENCIA[p.tipo], desde: p.t, ...base };
  }

  if (fimDaVez) {
    const limite = fimDaVez.t + MINUTOS_NAO_VISTA * 60000;
    // Sem stop, a vez acabou por Esc, recusa ou erro, e o idle_prompt chega 60 s depois. Se
    // o usuário digitou na sessão depois do último trabalho, foi ele quem parou: já viu.
    const parouEle = !temStop && ctx.digitadoEm != null && ctx.digitadoEm >= trabalhoAntesDoFim;
    const naoVista = !parouEle && (vistaEm == null || vistaEm < fimDaVez.t);
    if (houveVez && naoVista && agora >= limite) {
      return { cor: 'vermelho', rotulo: 'pronta, você ainda não viu', desde: limite, ...base };
    }
    return { cor: 'verde', rotulo: 'pronta', desde: fimDaVez.t, ...base };
  }

  // amarelo: sem sinal se nem evento nem saída de terminal nos últimos 90 s
  const ultimoSinal = Math.max(ultimo.t, saidaTerminalEm == null ? -Infinity : saidaTerminalEm);
  if (agora - ultimoSinal > SEGUNDOS_SEM_SINAL * 1000) {
    return { cor: 'cinza', rotulo: 'sem sinal', desde: ultimoSinal + SEGUNDOS_SEM_SINAL * 1000, ...base };
  }
  return { cor: 'amarelo', rotulo: 'trabalhando', desde: Math.max(ultimo.t, respondidaEm), ...base };
}

function ordenar(cartoes) {
  const vermelhos = cartoes.filter((c) => c.estado.cor === 'vermelho')
    .sort((a, b) => a.estado.desde - b.estado.desde);
  const resto = cartoes.filter((c) => c.estado.cor !== 'vermelho')
    .sort((a, b) => a.criadoEm - b.criadoEm);
  return [...vermelhos, ...resto];
}

module.exports = { lerEventos, calcularEstado, ordenar, encerraVez, ehStop, ehRelevante, acompanharPendencias, MINUTOS_NAO_VISTA, SEGUNDOS_SEM_SINAL, SEGUNDOS_ABRINDO };
