const fs = require('node:fs');
const path = require('node:path');
const { encerraVez, ehStop, ehRelevante, acompanharPendencias, SEGUNDOS_SEM_SINAL } = require('./estado.js');

const DIAS_GUARDADOS = 90;
const DIA = 24 * 60 * 60 * 1000;
const SEM_GRUPO = 'Sem grupo';
const TOP = 5;

// Pedaços em que o Claude trabalhou (o cartão em amarelo). Abre no prompt, ou no pre_tool /
// post_tool que volta depois de um vermelho. Fecha no fim da vez (stop, idle_prompt) ou ao
// entrar em vermelho (aprovação, pergunta, aviso), que vêm de estado.js. Sem as teclas do
// terminal, o vermelho só acaba com o evento que o responde; um aviso sem ferramenta acaba
// no próximo trabalho. Pedaço ainda aberto só sai se o processo saiu ou o cartão ficou
// cinza, e aí fecha no último evento: subcontar é aceito, sobrecontar não. Um silêncio de
// mais de 90 s entre dois eventos (o cinza) parte o pedaço: fecha no evento antes do
// silêncio e o seguinte abre outro. Assim o pedaço devolvido nunca muda depois.
// O idle_prompt chega 60 s depois da última coisa feita (é o caso do Esc, que não tem stop):
// fecha no último trabalho antes dele (prompt, pre_tool, post_tool), não no horário dele.
function pedacosDoTurno(eventos, { processoSaiuEm = null, cinzaDesde = null } = {}) {
  const pedacos = [];
  const pend = acompanharPendencias();
  let aberto = null;
  let esperando = false; // em vermelho: o próximo trabalho retoma
  let ultimo = null;
  let ultimoTrabalho = null;

  const fechar = (t) => {
    if (aberto != null && t > aberto) pedacos.push({ inicio: aberto, fim: t });
    aberto = null;
  };

  for (const ev of eventos) {
    if (!ev || typeof ev.t !== 'number' || !ehRelevante(ev)) continue;
    let aposSilencio = false;
    if (aberto != null && ev.t - ultimo > SEGUNDOS_SEM_SINAL * 1000) {
      fechar(ultimo);
      aposSilencio = true;
    }
    ultimo = ev.t;
    pend.aoEvento(ev);
    const trabalho = ev.tipo === 'pre_tool' || ev.tipo === 'post_tool';
    if (trabalho || ev.tipo === 'prompt') ultimoTrabalho = ev.t;
    // Só o trabalho da conversa principal mostra que o aviso foi respondido: um subagente
    // segue rodando com o diálogo ainda na tela.
    if (esperando && (trabalho || ehStop(ev)) && ev.agente == null) pend.soltarAvisos();
    const vermelho = pend.abertas().length > 0;

    if (encerraVez(ev)) {
      fechar(ehStop(ev) || ultimoTrabalho == null ? ev.t : ultimoTrabalho);
      esperando = vermelho; // stop com um subagente ainda esperando
      continue;
    }
    if (vermelho) {
      fechar(ev.t);
      esperando = true;
      continue;
    }
    if (ev.tipo === 'prompt' || (trabalho && (esperando || aposSilencio))) {
      if (aberto == null) aberto = ev.t;
      esperando = false;
    }
  }

  if (aberto != null && (processoSaiuEm != null || cinzaDesde != null)) fechar(ultimo);
  return pedacos;
}

const registroValido = (r) =>
  r !== null && typeof r === 'object' && typeof r.sessaoId === 'string' && r.sessaoId !== '' &&
  Number.isFinite(r.inicio) && Number.isFinite(r.fim) && r.fim > r.inicio;

const paraRegistro = ({ sessaoId, nome, grupoId, inicio, fim }) => ({
  sessaoId, nome: nome == null ? null : String(nome), grupoId: grupoId == null ? null : grupoId, inicio, fim,
});

// Um registro por linha (JSONL). Acrescentar é barato; só a poda, uma vez ao abrir, reescreve.
function criarHistorico(caminho, agora = Date.now) {
  // null quando não deu para ler (ausente, sem permissão): a poda não pode apagar o que não leu.
  function lerBruto() {
    try {
      return fs.readFileSync(caminho, 'utf8');
    } catch {
      return null;
    }
  }

  function lerTodos(bruto = lerBruto()) {
    if (bruto == null) return [];
    const registros = [];
    for (const linha of bruto.split('\n')) {
      if (!linha.trim()) continue;
      try {
        const r = JSON.parse(linha);
        if (registroValido(r)) registros.push(paraRegistro(r));
      } catch {
        // linha estragada (corte no meio de uma gravação), ignorada
      }
    }
    return registros;
  }

  function registrar(pedaco) {
    if (!registroValido(pedaco)) return;
    fs.mkdirSync(path.dirname(caminho), { recursive: true });
    fs.appendFileSync(caminho, JSON.stringify(paraRegistro(pedaco)) + '\n');
  }

  function ler(desde = -Infinity) {
    return lerTodos().filter((r) => r.fim > desde);
  }

  // Temporário + rename, como em arquivo.js: um corte no meio nunca deixa meio arquivo.
  function podar(momento = agora()) {
    const bruto = lerBruto();
    if (bruto == null) return;
    const limite = momento - DIAS_GUARDADOS * DIA;
    const ficam = lerTodos(bruto).filter((r) => r.fim >= limite);
    const temp = `${caminho}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temp, ficam.map((r) => JSON.stringify(r) + '\n').join(''));
      fs.renameSync(temp, caminho);
    } catch (err) {
      try { fs.rmSync(temp, { force: true }); } catch { /* nada */ }
      throw err;
    }
  }

  return { registrar, ler, podar };
}

// Soma por grupo e as sessões que mais trabalharam no período. Vale o grupo atual da sessão
// (undefined = sessão desconhecida, aí vale a cópia do registro). Grupo apagado vira Sem grupo.
function resumir(registros, { desde, ate, grupoAtual, nomeAtual, nomesGrupos }) {
  const porGrupo = new Map();
  const porSessao = new Map();
  let totalMs = 0;

  for (const r of registros) {
    const ms = Math.min(r.fim, ate) - Math.max(r.inicio, desde);
    if (!(ms > 0)) continue;
    const atual = grupoAtual(r.sessaoId);
    let grupoId = atual === undefined ? r.grupoId : atual;
    if (grupoId == null || !nomesGrupos.has(grupoId)) grupoId = null;
    const grupoNome = grupoId == null ? SEM_GRUPO : nomesGrupos.get(grupoId);

    totalMs += ms;
    const g = porGrupo.get(grupoId) || { grupoId, nome: grupoNome, ms: 0 };
    g.ms += ms;
    porGrupo.set(grupoId, g);

    const s = porSessao.get(r.sessaoId) || { sessaoId: r.sessaoId, nome: null, grupoNome, ms: 0, copiaEm: -Infinity };
    s.ms += ms;
    if (r.fim >= s.copiaEm) { s.copiaEm = r.fim; s.nome = r.nome; s.grupoNome = grupoNome; } // cópia mais recente
    porSessao.set(r.sessaoId, s);
  }

  const porMs = (a, b) => b.ms - a.ms;
  const topSessoes = [...porSessao.values()].sort(porMs).slice(0, TOP).map((s) => {
    const nome = nomeAtual(s.sessaoId);
    return { sessaoId: s.sessaoId, nome: nome === undefined ? s.nome : nome, grupoNome: s.grupoNome, ms: s.ms };
  });
  return { totalMs, porGrupo: [...porGrupo.values()].sort(porMs), topSessoes };
}

module.exports = { pedacosDoTurno, criarHistorico, resumir, DIAS_GUARDADOS };
