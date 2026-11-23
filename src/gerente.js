// Núcleo do processo principal, sem Electron: sessões, ptys, eventos e cartões.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { lerEventos, calcularEstado, ordenar, encerraVez, ehRelevante } = require('./estado.js');
const { novaSessao, comandoClaude, idValido, salvarLista, carregarLista, gerarId } = require('./sessoes.js');
const { PALETA } = require('./projetos.js');
const { limparTitulo, nomeDoCartao } = require('./nome.js');
const G = require('./grupos.js');
const F = require('./fechadas.js');
const { carregarConfig, salvarConfig, tamanhoFonteValido, FONTE_PADRAO } = require('./config.js');
const { pedacosDoTurno, criarHistorico, resumir } = require('./historico.js');
const { ehSalvar, passoSalvar, faseSalva, passoCaixa, temTextoNaCaixa } = require('./salvar.js');

// Espaço sozinho com a caixa vazia: começa a voz (/voice no modo tap).
const ESPACO_VOZ = ' ';

const LINHAS_GUARDADAS = 5;
const MAX_NOME = 80;
const MAX_BUFFER = 8000;
// Eventos guardados em memória por sessão (o arquivo é lido aos pedaços, só o acrescentado).
const MAX_EVENTOS = 2000;
// Eventos que dizem qual é a conversa do claude (o inicio não: pode ser de uma conversa
// que nem chegou a ter pedido).
const TIPOS_COM_CONVERSA = new Set(['prompt', 'pre_tool', 'post_tool', 'permissao', 'stop', 'falha_stop']);
const ARQUIVO_DE_SESSAO = /^[a-z0-9]+\.jsonl$/;
// Teclas que respondem um diálogo do claude: Enter, um número de opção ou Esc sozinho
// (setas e outras sequências começam com Esc mas não respondem).
const RESPOSTA = /[\r\n]|^[0-9]$|^\x1b$/;
const MAX_RESPOSTAS = 50;
const SEM_NADA_A_PERDER = new Set(['pronta, você ainda não viu', 'confirme a pasta']);
const DIA = 24 * 60 * 60 * 1000;
const DIAS_ESTATISTICAS = new Set([7, 30]);
// Vermelhos que pedem o usuário (aviso Glass). "Confirme a pasta" fica fora: ao reabrir o
// Atlas várias sessões da pasta pessoal ficariam nele ao mesmo tempo, e "não viu" é o Pop
// que já saiu no fim da vez.
const MOTIVO_PRECISA = {
  'pede aprovação': 'Pede aprovação.',
  'te fez uma pergunta': 'Te fez uma pergunta.',
  'precisa de você': 'Precisa de você.',
};
const TEXTO_TERMINOU = 'Terminou. A resposta está pronta.';
const TEXTO_TERMINOU_SUBAGENTE = 'Terminou, mas um subagente ainda pede aprovação.';
const TEXTO_FALHOU = 'Parou com um erro. Confira a sessão.';
// Entre o /salvar e o Enter: o claude abre a lista de comandos com a barra e o Enter precisa
// chegar depois do texto, não junto (junto ele pode entrar como texto colado).
const MS_ANTES_DO_ENTER = 150;

const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[P^_][^\x1b]*\x1b\\|\x1b[@-Z\\-_]/g;

function ultimasLinhas(bruto) {
  const limpo = bruto.replace(ANSI, '');
  return limpo.split(/\r?\n/)
    .map((l) => l.slice(l.lastIndexOf('\r') + 1).trimEnd())
    .filter((l) => l.trim() !== '')
    .slice(-LINHAS_GUARDADAS);
}

const contarVermelhosDe = (cartoes) => cartoes.filter((c) => c.estado.cor === 'vermelho').length;

function textoConfirmacao(n) {
  return n === 1 ? 'Tem 1 sessão trabalhando, fechar mesmo?' : `Tem ${n} sessões trabalhando, fechar mesmo?`;
}

function criarGerente(opcoes) {
  const {
    abrirPty, agora = Date.now, pastaEventos, arquivoLista, paleta = PALETA,
    aoCartoes = () => {}, aoDados = () => {}, aoRetomar = () => {}, casa = os.homedir(),
    pastaProjetos = path.join(os.homedir(), '.claude', 'projects'),
    aoAvisar = () => {}, aoFechadas = () => {}, classificar = () => Promise.resolve(null),
    adiar = (fn, ms) => setTimeout(fn, ms),
  } = opcoes;
  // Os arquivos novos ficam ao lado do sessoes.json (nos testes, a pasta temporária).
  const pastaDados = path.dirname(arquivoLista);
  const {
    caminhoGrupos = path.join(pastaDados, 'grupos.json'),
    caminhoFechadas = path.join(pastaDados, 'fechadas.json'),
    caminhoHistorico = path.join(pastaDados, 'historico.jsonl'),
    caminhoConfig = path.join(pastaDados, 'config.json'),
  } = opcoes;

  let grupos = G.carregarGrupos(caminhoGrupos);
  let fechadas = F.carregarFechadas(caminhoFechadas);
  let config = carregarConfig(caminhoConfig);
  const historico = criarHistorico(caminhoHistorico, agora);
  // Por sessão, o que já foi para o histórico nesta abertura do app: os inicios gravados e o
  // fim do último pedaço. Pedaço com inicio já gravado, ou antes desse fim, não volta (um
  // hook atrasado depois da saída do processo devolve o mesmo pedaço com fim maior).
  const gravados = new Map();
  // Primeiro pedido e nome do cartão usados na classificação, para a segunda tentativa.
  const classificacao = new Map();

  let lista = [];
  const rt = new Map(); // id -> { pty, vistaEm, saidaTerminalEm, processoVivo, buffer, ultimasLinhas, eventos, iniciadoEm, tamanho }
  let selecionada = null;
  let focada = true;
  // Configurações ou Estatísticas aberta: a página cobre o terminal da selecionada.
  let paginaAberta = false;
  // A selecionada está à vista: janela na frente e nenhuma página por cima.
  const naTela = () => focada && !paginaAberta;
  let carregada = false; // a lista do disco já foi lida (restaurar)
  // "Salvar todas e sair" em curso: { aoFim } até a última sessão terminar o /salvar.
  let sair = null;

  const salvar = () => salvarLista(arquivoLista, lista);
  const sessao = (id) => lista.find((s) => s.id === id);
  const atuaisDe = (r) => r.eventos.filter((ev) => typeof ev.t === 'number' && ev.t >= r.iniciadoEm);
  const grupoExiste = (id) => grupos.some((g) => g.id === id);

  const arquivoDe = (id) => path.join(pastaEventos, id + '.jsonl');

  // Lê só o que foi acrescentado desde a última leitura; a linha sem \n no fim fica para a
  // próxima. Arquivo trocado ou menor que o já lido: começa do zero. Devolve os eventos novos.
  function lerNovos(id, r) {
    let st;
    try {
      st = fs.statSync(arquivoDe(id));
    } catch {
      return [];
    }
    if (st.ino !== r.ino || st.size < r.lido) {
      r.ino = st.ino;
      r.lido = 0;
      r.resto = Buffer.alloc(0);
      r.eventos = [];
      r.fase = r.faseBase;
      r.salvarDestaExecucao = false;
      r.falhaSalvar = false;
    }
    if (st.size === r.lido) return [];
    const bytes = Buffer.alloc(st.size - r.lido);
    let n = 0;
    try {
      const fd = fs.openSync(arquivoDe(id), 'r');
      try { n = fs.readSync(fd, bytes, 0, bytes.length, r.lido); } finally { fs.closeSync(fd); }
    } catch {
      return [];
    }
    r.lido += n;
    const junto = Buffer.concat([r.resto, bytes.subarray(0, n)]);
    const fim = junto.lastIndexOf(0x0a);
    if (fim < 0) {
      r.resto = junto;
      return [];
    }
    r.resto = Buffer.from(junto.subarray(fim + 1));
    const novos = lerEventos(junto.subarray(0, fim).toString('utf8')).filter((ev) => doClaudeDaSessao(r, ev));
    r.eventos = r.eventos.concat(novos).slice(-MAX_EVENTOS);
    // A fase do /salvar anda evento a evento, de todo o arquivo (também de antes desta
    // execução): o limite de eventos na memória não muda o resultado.
    for (const ev of novos) {
      const antes = r.fase;
      r.fase = passoSalvar(r.fase, ev);
      const destaExecucao = typeof ev.t === 'number' && ev.t >= r.iniciadoEm; // e do pid dela (doClaudeDaSessao)
      // A vez do /salvar acabou sem stop (Esc, recusa, erro da API): o registro não terminou.
      // O cartão avisa até o próximo pedido, e a espera do Atlas por ele para (conferirSalvar).
      if (destaExecucao && antes === 'salvando' && r.fase === 'pedido' && ev.tipo !== 'prompt') r.falhaSalvar = true;
      if (ev.tipo === 'prompt') {
        if (destaExecucao) r.falhaSalvar = false;
        // Fala enviada pela voz (escrever, ESPACO_VOZ): o pedido chegou, a caixa esvaziou.
        if (destaExecucao && r.voz) {
          r.voz = false;
          r.caixa = 0;
          r.rascunho = false;
        }
        // Só um /salvar desta execução pode estar rodando: um de antes ficou sem stop quando o
        // app ou o claude saiu no meio, e esperar por ele travaria o Salvar e fechar.
        r.salvarDestaExecucao = destaExecucao && ehSalvar(ev.texto);
        if (r.salvarEscrito && ehSalvar(ev.texto)) r.viuSalvar = true;
        // Pedido do usuário durante o /salvar que o Atlas esperava (ex.: na fila): ele voltou a
        // usar a sessão. A espera desiste deste cartão (não fecha, não segura a saída) e a
        // sessão fica não salva; o ⌘Q seguinte pergunta de novo e digita outro /salvar.
        else if (destaExecucao && r.salvando && r.viuSalvar && !ehSalvar(ev.texto)) r.salvarCancelado = true;
      }
    }
    return novos;
  }

  // Um claude rodado de dentro da sessão (claude -p num script) herda o ATLAS_SESSAO_ID e
  // grava no mesmo arquivo. O hook grava o pid do claude: vale o do primeiro evento desta
  // execução (o de fora começa antes de poder rodar outro), e os de outro pid ficam de fora.
  // Evento sem pid (hook antigo) ou de antes desta execução passa.
  function doClaudeDaSessao(r, ev) {
    if (typeof ev.t !== 'number' || ev.t < r.iniciadoEm || !Number.isInteger(ev.pid)) return true;
    if (r.pidClaude == null) r.pidClaude = ev.pid;
    return ev.pid === r.pidClaude;
  }

  function estadoDe(s) {
    const r = rt.get(s.id);
    // Só os eventos desta execução decidem a cor: um pedido de aprovação de antes
    // de fechar o app não pode deixar a sessão retomada vermelha.
    const estado = calcularEstado(atuaisDe(r), {
      agora: agora(), vistaEm: r.vistaEm, saidaTerminalEm: r.saidaTerminalEm, processoVivo: r.processoVivo,
      respostasEm: r.respostasEm, digitadoEm: r.digitadoEm, iniciadoEm: r.iniciadoEm,
    });
    if (estado.ultimoPedido == null) estado.ultimoPedido = calcularEstado(r.eventos, { agora: agora(), processoVivo: true }).ultimoPedido;
    if (estado.claudeSessionId == null) estado.claudeSessionId = s.claudeSessionId;
    return estado;
  }

  // A transcrição da conversa está no disco (~/.claude/projects/<pasta>/<id>.jsonl)?
  function conversaExiste(id) {
    let pastas = [];
    try { pastas = fs.readdirSync(pastaProjetos); } catch { return false; }
    return pastas.some((p) => fs.existsSync(path.join(pastaProjetos, p, id + '.jsonl')));
  }

  // `claude --resume` que saiu sem nenhum evento e cuja conversa não está no disco (apagada
  // pela limpeza do claude, ou nunca gravada): Retomar repetiria o erro, o cartão oferece uma
  // nova. Com a conversa no disco (ex.: Ctrl+C no diálogo de confiança), só Retomar, porque
  // começar outra apagaria o id salvo. Conferido uma vez por execução encerrada.
  function podeRecomecar(s, r) {
    if (r.processoVivo || !r.comResume) return false;
    if (r.eventos.some((ev) => typeof ev.t === 'number' && ev.t >= r.iniciadoEm)) return false;
    if (r.conversaSumiu == null) r.conversaSumiu = !idValido(s.claudeSessionId) || !conversaExiste(s.claudeSessionId);
    return r.conversaSumiu;
  }

  function listar() {
    const cartoes = lista.filter((s) => rt.has(s.id)).map((s) => ({
      id: s.id,
      pasta: s.pasta,
      nome: nomeDoCartao(s, casa),
      cor: s.cor,
      grupoId: s.grupoId == null ? null : s.grupoId,
      criadoEm: s.criadoEm,
      selecionada: s.id === selecionada,
      estado: estadoDe(s),
      podeRecomecar: podeRecomecar(s, rt.get(s.id)),
      ultimasLinhas: rt.get(s.id).ultimasLinhas,
      salva: faseSalva(rt.get(s.id).fase),
      salvando: rt.get(s.id).salvando,
      rascunho: rt.get(s.id).rascunho,
      falhaSalvar: rt.get(s.id).falhaSalvar,
    }));
    return ordenar(cartoes);
  }

  const emitir = () => aoCartoes(listar());

  function iniciar(s) {
    const anterior = rt.get(s.id);
    const r = {
      pty: null, vistaEm: anterior ? anterior.vistaEm : null, saidaTerminalEm: null, processoVivo: true,
      buffer: '', ultimasLinhas: [], eventos: [], ino: null, lido: 0, resto: Buffer.alloc(0), iniciadoEm: agora(),
      respostasEm: [], digitadoEm: null, pidClaude: null,
      tamanho: anterior ? anterior.tamanho : null,
      saiuEm: null, vezAberta: false, pendenciaAvisada: -Infinity,
      // /salvar: fase da conversa (salvar.js) e o Salvar e fechar / Salvar todas e sair.
      // faseBase: de onde a fase parte. Reaberta com ⌘⇧T sem estar salva, a conversa já teve
      // pedido que o arquivo de eventos novo não mostra (fechar apaga o antigo).
      faseBase: s.naoSalva === true ? 'pedido' : 'nada',
      fase: s.naoSalva === true ? 'pedido' : 'nada', salvando: null, salvarEscrito: false, viuSalvar: false, enterPendente: false,
      // caixa: estimativa do texto na caixa do claude (salvar.js passoCaixa); null = não se sabe.
      salvarDestaExecucao: false, caixa: 0, rascunho: false,
      // falhaSalvar: o último /salvar desta execução acabou sem stop (o cartão avisa).
      falhaSalvar: false,
      // salvarCancelado: pedido do usuário no meio do /salvar esperado (conferirSalvar desiste).
      salvarCancelado: false,
      // escPerguntaEm: último Esc sozinho com uma pergunta na tela (perguntaDispensada).
      escPerguntaEm: null,
    };
    rt.set(s.id, r);
    reler(s.id);
    // Um /salvar de antes desta execução sem fim da vez foi interrompido (o app ou o claude
    // saiu no meio): a conversa não está salva e nenhum stop novo pode completá-lo.
    if (r.fase === 'salvando') r.fase = 'pedido';
    const argv = comandoClaude(s);
    r.comResume = argv.includes('--resume');
    const cfg = { argv, cols: r.tamanho && r.tamanho[0], rows: r.tamanho && r.tamanho[1] };
    try {
      r.pty = abrirPty(s, cfg,
        (dados) => {
          if (rt.get(s.id) !== r) return;
          r.saidaTerminalEm = agora();
          r.buffer = (r.buffer + dados).slice(-MAX_BUFFER);
          aoDados(s.id, dados);
        },
        () => {
          if (rt.get(s.id) !== r) return;
          r.processoVivo = false;
          r.saiuEm = agora();
          r.pty = null;
          r.ultimasLinhas = ultimasLinhas(r.buffer);
          anotarHistorico(s, r);
          // Sem claude não há /salvar: o cartão fica (preto, não salvo) e não segura a saída.
          pararSalvar(r);
          r.enterPendente = false;
          conferirSair();
          emitir();
        });
    } catch (err) {
      r.processoVivo = false;
      r.saiuEm = agora();
      r.ultimasLinhas = [String(err && err.message ? err.message : err)];
    }
  }

  // Pedaços de trabalho terminados vão para o histórico, cada um uma vez só. Só os eventos
  // desta execução (os de antes já foram gravados na abertura anterior), já filtrados por pid.
  // saindo: o cartão vai fechar ou o app vai sair, o pedaço aberto fecha no último evento.
  function anotarHistorico(s, r, saindo = false) {
    const atuais = atuaisDe(r);
    if (!atuais.length) return;
    const estado = estadoDe(s);
    const saiu = saindo || !r.processoVivo;
    const pedacos = pedacosDoTurno(atuais, {
      processoSaiuEm: saiu ? (r.saiuEm == null ? agora() : r.saiuEm) : null,
      cinzaDesde: estado.cor === 'cinza' && estado.rotulo === 'sem sinal' ? estado.desde : null,
    });
    let g = gravados.get(s.id);
    if (!g) {
      g = { inicios: new Set(), fim: -Infinity };
      gravados.set(s.id, g);
    }
    for (const p of pedacos) {
      if (g.inicios.has(p.inicio) || p.inicio < g.fim) continue;
      try {
        historico.registrar({ sessaoId: s.id, nome: nomeDoCartao(s, casa), grupoId: s.grupoId, inicio: p.inicio, fim: p.fim });
      } catch {
        continue; // sem disco agora: tenta de novo na próxima releitura
      }
      g.inicios.add(p.inicio);
      g.fim = Math.max(g.fim, p.fim);
    }
  }

  // Aviso do Mac. Nunca para a sessão que está na tela com a janela na frente.
  function avisar(s, tipo, texto) {
    if (s.id === selecionada && naTela()) return;
    try {
      aoAvisar({ sessaoId: s.id, tipo, titulo: nomeDoCartao(s, casa), texto });
    } catch { /* o aviso nunca derruba o gerente */ }
  }

  // "Terminou": no primeiro fim da vez (stop ou idle_prompt) depois de algum trabalho. O
  // idle_prompt que chega depois do stop não repete. Só eventos novos, então a releitura de
  // 5 s não repete nada.
  function vigiarFimDaVez(s, r, novos) {
    for (const ev of novos) {
      if (typeof ev.t !== 'number' || ev.t < r.iniciadoEm || !ehRelevante(ev)) continue;
      if (encerraVez(ev)) {
        // A vez do /salvar de um cartão que vai fechar (ou do app que vai sair): sem "Terminou".
        if (r.vezAberta && !(r.salvando && r.viuSalvar)) {
          // Stop com um subagente ainda esperando: o cartão segue vermelho.
          const estado = estadoDe(s);
          const esperando = estado.cor === 'vermelho' && MOTIVO_PRECISA[estado.rotulo] !== undefined;
          const texto = ev.tipo === 'falha_stop' ? TEXTO_FALHOU : (esperando ? TEXTO_TERMINOU_SUBAGENTE : TEXTO_TERMINOU);
          avisar(s, 'terminou', texto);
        }
        r.vezAberta = false;
      } else {
        r.vezAberta = true;
      }
    }
  }

  // "Precisa": quando o cartão entra num vermelho de aprovação, pergunta ou aviso. A pendência
  // é a mesma enquanto o "desde" do vermelho não muda: ferramentas no meio, o
  // permission_prompt de 6 s depois e as releituras não avisam de novo.
  function vigiarPendencia(s, r) {
    if (!r.processoVivo) return;
    const estado = estadoDe(s);
    const motivo = estado.cor === 'vermelho' ? MOTIVO_PRECISA[estado.rotulo] : undefined;
    if (!motivo || !(estado.desde > r.pendenciaAvisada)) return;
    r.pendenciaAvisada = estado.desde;
    avisar(s, 'precisa', motivo);
  }

  // Classificação automática: no primeiro pedido de uma sessão sem grupo, uma vez. Escolha
  // manual vence sempre, inclusive uma resposta que chega depois dela.
  function pedirClassificacao(s, pedido) {
    const nome = nomeDoCartao(s, casa);
    classificacao.set(s.id, { pedido, nome, rodando: true });
    s.classificada += 1;
    salvar();
    let resposta;
    try {
      resposta = Promise.resolve(classificar({ ...s, nomeCartao: nome }, pedido));
    } catch {
      resposta = Promise.resolve(null);
    }
    resposta.catch(() => null).then((grupoId) => {
      const c = classificacao.get(s.id);
      if (c) c.rodando = false;
      const atual = sessao(s.id);
      if (!atual || atual.grupoManual || atual.grupoId != null) return;
      if (typeof grupoId === 'string' && grupoExiste(grupoId)) {
        atual.grupoId = grupoId;
        salvar();
        emitir();
        return;
      }
      tentarDeNovo(atual);
    });
  }

  function classificarSePrimeiro(s, r, novos) {
    if (!config.classificar || s.grupoManual || s.grupoId != null || s.classificada !== 0) return;
    const prompt = novos.find((ev) => ev.tipo === 'prompt' && typeof ev.t === 'number' && ev.t >= r.iniciadoEm);
    if (!prompt) return;
    pedirClassificacao(s, typeof prompt.texto === 'string' ? prompt.texto : '');
  }

  // O nome do cartão mudou e a sessão segue sem grupo depois da primeira tentativa: mais uma.
  function tentarDeNovo(s) {
    const c = classificacao.get(s.id);
    if (!c || c.rodando || !config.classificar || s.grupoManual || s.grupoId != null || s.classificada !== 1) return;
    if (nomeDoCartao(s, casa) === c.nome) return;
    pedirClassificacao(s, c.pedido);
  }

  // Antes de restaurar a lista em memória está vazia: gravar agora apagaria as sessões do
  // disco (o menu e o ⌘T já funcionam enquanto a tela carrega). Devolve null.
  function nova(pasta) {
    if (!carregada) return null;
    const s = novaSessao(lista, pasta, agora(), paleta);
    lista.push(s);
    salvar();
    iniciar(s);
    emitir();
    return s.id;
  }

  // Lê o que chegou no arquivo de eventos, grava o histórico e manda os avisos. Não emite.
  function reler(id) {
    const s = sessao(id);
    const r = rt.get(id);
    if (!s || !r) return;
    const novos = lerNovos(id, r);
    if (novos.length) aoLerNovos(s, r, id, novos);
    anotarHistorico(s, r); // também sem evento novo: o cinza chega com o tempo
    vigiarPendencia(s, r);
    conferirSalvar(s, r);
  }

  function aoLerNovos(s, r, id, novos) {
    // A vez terminou com a sessão aberta na tela e o app na frente: conta como vista.
    if (novos.some(encerraVez) && id === selecionada && naTela()) r.vistaEm = agora();
    // Conversa do claude: a do último evento que tem uma, para retomar mesmo sem stop.
    // Eventos de antes desta execução só servem se a lista não tem a conversa: a que foi salva
    // já passou pelo filtro de pid, e o arquivo pode terminar num claude aninhado.
    const comId = novos.filter((ev) => TIPOS_COM_CONVERSA.has(ev.tipo) && idValido(ev.session_id) &&
      (s.claudeSessionId == null || (typeof ev.t === 'number' && ev.t >= r.iniciadoEm)));
    const ultimoId = comId.length ? comId[comId.length - 1].session_id : null;
    if (ultimoId && ultimoId !== s.claudeSessionId) {
      s.claudeSessionId = ultimoId;
      salvar();
    }
    vigiarFimDaVez(s, r, novos);
    classificarSePrimeiro(s, r, novos);
  }

  function aoMudarEventos(id) {
    if (!rt.has(id)) return;
    reler(id);
    emitir();
  }

  // Timer de 5 s: relê os arquivos (o fs.watch pode perder avisos) e recalcula.
  function recalcular() {
    for (const id of rt.keys()) reler(id);
    emitir();
  }

  function selecionar(id) {
    if (!rt.has(id)) return;
    selecionada = id;
    if (naTela()) rt.get(id).vistaEm = agora();
    emitir();
  }

  function marcarFoco(f) {
    focada = Boolean(f);
    if (naTela() && rt.has(selecionada)) rt.get(selecionada).vistaEm = agora();
    emitir();
  }

  // A tela avisa quando abre e fecha uma página. Fechar com a janela na frente devolve a
  // selecionada à vista, como o foco voltando.
  function marcarPagina(aberta) {
    paginaAberta = Boolean(aberta);
    if (naTela() && rt.has(selecionada)) rt.get(selecionada).vistaEm = agora();
    emitir();
  }

  function fechar(id) {
    const r = rt.get(id);
    if (!r) return;
    const s = sessao(id);
    if (s) {
      anotarHistorico(s, r, true);
      // A fechada lembra se estava salva: ao reabrir o arquivo de eventos já não existe.
      const { naoSalva, ...resto } = s; // eslint-disable-line no-unused-vars
      gravarFechadas(F.registrarFechada(fechadas, { ...resto, salva: faseSalva(r.fase) }, agora()));
    }
    gravados.delete(id);
    classificacao.delete(id);
    rt.delete(id); // antes de matar: o aoSair desta execução é ignorado
    if (r.pty) r.pty.matar();
    lista = lista.filter((s) => s.id !== id);
    if (selecionada === id) selecionada = null;
    salvar();
    apagarEventos(id);
    conferirSair();
    emitir();
  }

  // Salvar e fechar / Salvar todas e sair

  // Digitar agora é seguro? Só com a sessão parada no fim de uma vez: verde (pronta) ou
  // "pronta, você ainda não viu". Trabalhando ou sem sinal (vez aberta), espera o fim dela:
  // no meio, um diálogo pode abrir antes de o hook chegar e o Enter o responderia. Aprovação,
  // pergunta, abrindo e confirme a pasta (o Enter confiaria na pasta) também esperam.
  function podeDigitar(s, r) {
    if (!r.processoVivo || !r.pty) return false;
    const estado = estadoDe(s);
    return estado.cor === 'verde' || (estado.cor === 'vermelho' && estado.rotulo === 'pronta, você ainda não viu');
  }

  // Escrita do Atlas, direto no pty: não passa pelo escrever(), então não conta como tecla
  // do usuário (resposta de diálogo, vista, digitada) nem tira o vermelho de ninguém.
  function digitarSalvar(s, r) {
    r.salvarEscrito = true;
    r.pty.escrever('/salvar');
    adiar(() => {
      if (rt.get(s.id) !== r || !r.pty) return;
      r.enterPendente = true;
      if (podeDigitar(s, r)) mandarEnter(r);
      // senão um diálogo abriu ou uma vez começou nesse meio tempo: espera (conferirSalvar)
    }, MS_ANTES_DO_ENTER);
  }

  // O Enter do /salvar digitado. Antes confere a caixa: o "/salvar" do Atlas não conta nela,
  // então qualquer coisa ali é do usuário, digitada depois, e o Enter mandaria "/salvarabc".
  // Nesse caso não tecla, avisa no cartão e para a espera (a caixa fica desconhecida).
  function mandarEnter(r) {
    if (r.caixa !== 0) {
      pararSalvar(r); // com o Enter pendente, a caixa vira desconhecida
      r.rascunho = true;
      conferirSair();
      emitir();
      return;
    }
    r.enterPendente = false;
    r.pty.escrever('\r');
  }

  // Para a espera. O Enter pendente vai junto: o Atlas não tecla depois que o usuário desistiu
  // (o /salvar fica na caixa, sem Enter).
  function pararSalvar(r) {
    r.salvando = null;
    r.salvarEscrito = false;
    r.viuSalvar = false;
    r.salvarCancelado = false;
    // "/salvar" ficou na caixa sem Enter: a conta vira desconhecida e bloqueia a próxima tentativa.
    if (r.enterPendente) r.caixa = null;
    r.enterPendente = false;
  }

  // Texto pela metade na caixa do claude (ou não dá para saber): o /salvar grudaria nele e o
  // claude rodaria "rascunho/salvar". Cada tentativa confere de novo.
  const temRascunho = (r) => temTextoNaCaixa(r.caixa);

  // Diálogo do claude na tela (aprovação, pergunta, confiança da pasta): as teclas vão para
  // ele, não para a caixa. Um "Other" digitado também fica no diálogo.
  function dialogoNaTela(s) {
    const estado = estadoDe(s);
    if (estado.rotulo === 'abrindo' || estado.rotulo === 'confirme a pasta') return true;
    return estado.cor === 'vermelho' && MOTIVO_PRECISA[estado.rotulo] !== undefined;
  }

  // A cada releitura: digita quando for seguro e fecha (ou libera a saída) quando o turno do
  // /salvar que o Atlas pediu termina.
  function conferirSalvar(s, r) {
    if (r.enterPendente && podeDigitar(s, r)) mandarEnter(r);
    if (!r.salvando) return;
    if (!r.processoVivo) {
      pararSalvar(r);
      conferirSair();
      return;
    }
    // O /salvar que o Atlas esperava acabou sem stop, ou o usuário mandou outro pedido no meio:
    // nada fecha nem sai como salvo. O cartão fica aberto ("o /salvar não terminou" ou "não
    // salva") e, na saída, o diálogo volta listando esta sessão.
    if ((r.viuSalvar && r.falhaSalvar) || r.salvarCancelado) {
      pararSalvar(r);
      conferirSair();
      return;
    }
    if (!r.salvarEscrito) {
      if (r.fase === 'salvando' && r.salvarDestaExecucao) {
        // O /salvar já está rodando (o usuário digitou antes): só espera ele terminar.
        r.salvarEscrito = true;
        r.viuSalvar = true;
      } else if (faseSalva(r.fase)) {
        r.viuSalvar = true;
        r.salvarEscrito = true;
      } else if (podeDigitar(s, r)) {
        if (temRascunho(r)) {
          // Não digita: avisa no cartão, para a espera e deixa o cartão aberto.
          r.rascunho = true;
          pararSalvar(r);
          conferirSair();
          return;
        }
        digitarSalvar(s, r);
      } else {
        return;
      }
    }
    if (!r.viuSalvar || !faseSalva(r.fase)) return;
    if (r.salvando === 'fechar') {
      fechar(s.id);
      return;
    }
    pararSalvar(r);
    conferirSair();
  }

  function conferirSair() {
    if (!sair) return;
    for (const r of rt.values()) if (r.salvando) return;
    const { aoFim } = sair;
    sair = null;
    try { aoFim(); } catch { /* quem sai é o main */ }
  }

  function salvarEFechar(id) {
    const s = sessao(id);
    const r = rt.get(id);
    if (!s || !r || !r.processoVivo) return;
    // Já salvando (ex.: no Salvar todas e sair): o /salvar não é digitado de novo, só passa a fechar.
    if (!r.salvando) r.falhaSalvar = false; // tentativa nova
    r.salvando = 'fechar';
    conferirSalvar(s, r);
    if (rt.has(id)) emitir();
  }

  // "Não fechar" no menu do cartão: o /salvar digitado segue, o cartão fica. Com a saída em
  // curso, a sessão continua segurando a saída até o /salvar terminar.
  function naoFechar(id) {
    const r = rt.get(id);
    if (!r || r.salvando !== 'fechar') return;
    if (sair) r.salvando = 'sair';
    else pararSalvar(r);
    emitir();
  }

  // Vivas e não salvas: o que o "Salvar todas e sair" espera. A encerrada não conta (sair
  // não fecha o cartão, e sem claude não há /salvar).
  const naoSalvas = () => lista.filter((s) => {
    const r = rt.get(s.id);
    return r && r.processoVivo && !faseSalva(r.fase);
  });
  const contarNaoSalvas = () => naoSalvas().length;
  // Não salvas barradas por texto na caixa (o diálogo de saída explica).
  const contarRascunhos = () => naoSalvas().filter((s) => rt.get(s.id).rascunho).length;
  // Não salvas cujo último /salvar não terminou (Esc, recusa, erro da API).
  const contarFalhas = () => naoSalvas().filter((s) => rt.get(s.id).falhaSalvar).length;

  function salvarTodas(aoFim) {
    for (const s of naoSalvas()) {
      const r = rt.get(s.id);
      if (!r.salvando) {
        r.falhaSalvar = false; // tentativa nova
        r.salvando = 'sair';
      }
    }
    sair = { aoFim: typeof aoFim === 'function' ? aoFim : () => {} };
    for (const s of [...lista]) {
      const r = rt.get(s.id);
      if (r && r.salvando) conferirSalvar(s, r);
    }
    conferirSair();
    emitir();
  }

  function cancelarSair() {
    sair = null;
    for (const r of rt.values()) if (r.salvando === 'sair') pararSalvar(r);
    emitir();
  }

  function apagarEventos(id) {
    try { fs.rmSync(arquivoDe(id), { force: true }); } catch { /* fica para a limpeza ao abrir */ }
  }

  // Ao abrir: arquivos de eventos de sessões que já não estão na lista (só os <id>.jsonl).
  function limparOrfaos() {
    let nomes = [];
    try { nomes = fs.readdirSync(pastaEventos); } catch { return; }
    const ids = new Set(lista.map((s) => s.id));
    for (const n of nomes) {
      if (ARQUIVO_DE_SESSAO.test(n) && !ids.has(n.slice(0, -'.jsonl'.length))) apagarEventos(n.slice(0, -'.jsonl'.length));
    }
  }

  function retomar(id) {
    const s = sessao(id);
    const r = rt.get(id);
    if (!s || !r || r.processoVivo) return;
    aoRetomar(id); // a tela limpa o terminal antes da saída nova
    iniciar(s);
    emitir();
  }

  // Esquece a conversa salva e abre o claude sem --resume. Os eventos velhos vão junto:
  // sem conversa na lista, o reler pegaria o id morto deles de volta.
  function recomecar(id) {
    const s = sessao(id);
    const r = rt.get(id);
    if (!s || !r || !podeRecomecar(s, r)) return;
    s.claudeSessionId = null;
    delete s.naoSalva; // conversa nova: nada a salvar ainda
    salvar();
    apagarEventos(id);
    aoRetomar(id);
    iniciar(s);
    emitir();
  }

  // Botão do microfone e ⌘D: o mesmo espaço da barra, na selecionada (voz no modo tap: toca
  // para gravar, toca de novo para parar e enviar). Não age com página por cima, sem o claude
  // pronto (diálogo, abrindo, encerrada: o espaço responderia a ele) nem com o /salvar do Atlas
  // na caixa. Devolve se mandou.
  function microfone() {
    const s = sessao(selecionada);
    const r = rt.get(selecionada);
    if (!s || !r || !r.pty || !r.processoVivo || paginaAberta) return false;
    if (dialogoNaTela(s) || r.salvando || r.enterPendente) return false;
    escrever(selecionada, ' ');
    return true;
  }

  function escrever(id, dados) {
    const r = rt.get(id);
    if (!r || !r.pty) return;
    const texto = String(dados);
    r.pty.escrever(texto);
    // Quem digita na sessão está olhando para ela.
    r.digitadoEm = agora();
    if (naTela()) r.vistaEm = r.digitadoEm;
    if (RESPOSTA.test(texto)) r.respostasEm = [...r.respostasEm, agora()].slice(-MAX_RESPOSTAS);
    // Caixa de texto do claude (o rascunho do /salvar). Com um diálogo na tela, nada muda,
    // menos depois de uma pergunta dispensada com Esc.
    const s = sessao(id);
    if (s && (!dialogoNaTela(s) || perguntaDispensada(s, r, texto))) {
      // Espaço com a caixa vazia é a voz começando (no modo tap a barra não escreve nada nesse
      // caso). Enquanto grava, o claude põe a fala na caixa; com menos de 3 palavras ela fica lá
      // sem enviar. Então a caixa fica desconhecida até o pedido chegar pelo hook (reler) ou
      // até Enter, ⌃C ou ⌃U: o lado seguro, nunca 0 com texto dentro.
      if (texto === ESPACO_VOZ && r.caixa === 0) {
        r.voz = true;
        r.caixa = null;
      } else {
        r.caixa = passoCaixa(r.caixa, texto);
        if (r.caixa === 0) r.voz = false;
      }
      if (!temRascunho(r)) r.rascunho = false;
    }
  }

  // Esc sozinho numa pergunta (AskUserQuestion) a dispensa, e o claude redesenha a tela. O
  // cartão só sai de "te fez uma pergunta" com o idle_prompt, 60 s depois, mas o que se digita
  // depois do Esc com saída no terminal já vai para a caixa. Se a pergunta seguia na tela, a
  // conta fica maior que a caixa: o lado seguro (bloqueia o /salvar até Enter, ⌃C ou ⌃U).
  function perguntaDispensada(s, r, texto) {
    const estado = estadoDe(s);
    if (estado.cor !== 'vermelho' || estado.rotulo !== 'te fez uma pergunta') return false;
    if (texto === '\x1b') {
      r.escPerguntaEm = agora();
      return false;
    }
    return r.escPerguntaEm != null && r.escPerguntaEm > estado.desde &&
      r.saidaTerminalEm != null && r.saidaTerminalEm >= r.escPerguntaEm;
  }

  function redimensionar(id, cols, rows) {
    const r = rt.get(id);
    if (!r || !Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) return;
    r.tamanho = [cols, rows];
    if (r.pty) r.pty.redimensionar(cols, rows);
  }

  function restaurar() {
    lista = carregarLista(arquivoLista, paleta);
    carregada = true;
    try { historico.podar(); } catch { /* fica para a próxima abertura */ }
    limparOrfaos();
    for (const s of lista) iniciar(s);
    emitir();
  }

  function encerrarTudo() {
    for (const [id, r] of rt) {
      const s = sessao(id);
      if (s) anotarHistorico(s, r, true);
      rt.delete(id);
      if (r.pty) r.pty.matar();
    }
    // Saiu antes de restaurar (ex.: fechou na espera do ambiente): a lista em memória está
    // vazia e gravá-la apagaria as sessões do disco.
    if (carregada || lista.length) salvar();
  }

  function contarAtivas() {
    // "Pronta, você ainda não viu" e "confirme a pasta" são vermelhos sem nada a perder.
    return listar().filter((c) => c.estado.cor === 'amarelo' ||
      (c.estado.cor === 'vermelho' && !SEM_NADA_A_PERDER.has(c.estado.rotulo))).length;
  }

  // Nome dado pelo usuário; vazio ou null volta ao automático (título, pasta ou "Novo").
  function renomear(id, nome) {
    const s = sessao(id);
    if (!s || !rt.has(id)) return;
    const limpo = typeof nome === 'string' ? nome.replace(/\s+/g, ' ').trim().slice(0, MAX_NOME) : '';
    const novo = limpo || null;
    if (novo === s.nome) return;
    s.nome = novo;
    salvar();
    tentarDeNovo(s);
    emitir();
  }

  // Título do terminal (o claude troca a cada quadro do spinner): só grava quando o
  // título limpo muda; genérico ("Claude Code", shell) mantém o anterior.
  function definirTitulo(id, bruto) {
    const s = sessao(id);
    if (!s || !rt.has(id)) return;
    const limpo = limparTitulo(bruto);
    if (!limpo || limpo === s.titulo) return;
    s.titulo = limpo;
    salvar();
    tentarDeNovo(s);
    emitir();
  }

  function trocarCor(id, cor) {
    const s = sessao(id);
    if (!s || !rt.has(id) || !paleta.includes(cor) || s.cor === cor) return;
    s.cor = cor;
    salvar();
    emitir();
  }

  // Grupos

  const listarGrupos = () => grupos.map((g) => ({ ...g }));

  function gravarGrupos(nova) {
    G.salvarGrupos(caminhoGrupos, nova);
    grupos = nova;
  }

  // Erro('nome inválido') para nome vazio, longo ou repetido.
  function criarGrupo(nome) {
    const r = G.criarGrupo(grupos, nome);
    gravarGrupos(r.lista);
    emitir();
    return { ...r.grupo };
  }

  function renomearGrupo(id, nome) {
    if (!grupoExiste(id)) throw new Error('grupo não encontrado');
    gravarGrupos(G.renomearGrupo(grupos, id, nome));
    emitir();
  }

  function descreverGrupo(id, descricao) {
    if (!grupoExiste(id)) throw new Error('grupo não encontrado');
    gravarGrupos(G.descreverGrupo(grupos, id, descricao));
    emitir();
  }

  // As sessões do grupo vão para "Sem grupo"; as fechadas se acertam ao reabrir.
  function apagarGrupo(id) {
    if (!grupoExiste(id)) return;
    gravarGrupos(G.apagarGrupo(grupos, id));
    let mudou = false;
    for (const s of lista) {
      if (s.grupoId === id) { s.grupoId = null; mudou = true; }
    }
    if (mudou) salvar();
    emitir();
  }

  // Escolha do usuário (grupo ou "Sem grupo"): a classificação nunca mais mexe nesta sessão.
  function moverParaGrupo(sessaoId, grupoId) {
    const s = sessao(sessaoId);
    if (!s || !rt.has(sessaoId)) return;
    if (grupoId !== null && !grupoExiste(grupoId)) return;
    s.grupoId = grupoId;
    s.grupoManual = true;
    salvar();
    emitir();
  }

  // Fechadas

  function gravarFechadas(nova) {
    fechadas = nova;
    try { F.salvarFechadas(caminhoFechadas, fechadas); } catch { /* segue em memória */ }
    try { aoFechadas(listarFechadas()); } catch { /* o menu se refaz na próxima */ }
  }

  const listarFechadas = () => fechadas.map((f) => ({
    id: f.id, nome: nomeDoCartao(f, casa), cor: f.cor, grupoId: f.grupoId == null ? null : f.grupoId, fechadaEm: f.fechadaEm,
  }));

  // Sem id, a mais nova. Volta com a conversa (--resume), o nome, a cor e o grupo de antes
  // (grupo apagado nesse meio tempo: Sem grupo). Devolve o id, que fica selecionado, ou null.
  function reabrirFechada(id) {
    if (!carregada) return null; // ver nova()
    const alvo = id === undefined || id === null ? (fechadas[0] && fechadas[0].id) : id;
    if (typeof alvo !== 'string') return null;
    const r = F.retirarFechada(fechadas, alvo);
    if (!r.sessao) return null;
    // A conversa já está aberta noutro cartão (retomada nele): mostra esse, sem outro --resume.
    const aberta = lista.find((s) => s.claudeSessionId === r.sessao.claudeSessionId && rt.has(s.id));
    if (aberta) {
      gravarFechadas(r.lista);
      selecionar(aberta.id);
      return aberta.id;
    }
    const f = F.limparGrupoInexistente(r.sessao, grupos);
    let novoId = f.id;
    while (lista.some((s) => s.id === novoId)) novoId = gerarId();
    const s = {
      id: novoId,
      pasta: f.pasta,
      criadoEm: typeof f.criadoEm === 'number' ? f.criadoEm : agora(),
      claudeSessionId: f.claudeSessionId,
      nome: typeof f.nome === 'string' && f.nome ? f.nome : null,
      titulo: typeof f.titulo === 'string' && f.titulo ? f.titulo : null,
      cor: paleta.includes(f.cor) ? f.cor : paleta[0],
      grupoId: typeof f.grupoId === 'string' ? f.grupoId : null,
      grupoManual: f.grupoManual === true,
      classificada: f.classificada === 1 || f.classificada === 2 ? f.classificada : 0,
    };
    // Fechada sem a marca (de antes desta versão) volta não salva: o lado seguro.
    if (f.salva !== true) s.naoSalva = true;
    lista.push(s);
    salvar();
    gravarFechadas(r.lista);
    iniciar(s);
    // A reaberta fica selecionada (como no Chrome). O main manda a tela mostrar o mesmo id.
    selecionar(s.id);
    return s.id;
  }

  // Estatísticas

  function estatisticas(dias) {
    if (!DIAS_ESTATISTICAS.has(dias)) throw new Error('dias deve ser 7 ou 30');
    const ate = agora();
    const desde = ate - dias * DIA;
    // Sessão conhecida (aberta ou nas fechadas): vale o grupo e o nome de agora.
    const conhecida = (sid) => lista.find((s) => s.id === sid) || fechadas.find((f) => f.id === sid);
    const nomesGrupos = new Map(grupos.map((g) => [g.id, g.nome]));
    return resumir(historico.ler(desde), {
      desde,
      ate,
      grupoAtual: (sid) => { const s = conhecida(sid); return s ? (s.grupoId == null ? null : s.grupoId) : undefined; },
      nomeAtual: (sid) => { const s = conhecida(sid); return s ? nomeDoCartao(s, casa) : undefined; },
      nomesGrupos,
    });
  }

  // Número do Dock: todos os vermelhos, inclusive "confirme a pasta" e "não viu".
  const contarVermelhos = () => contarVermelhosDe(listar());

  // Configurações

  const lerConfig = () => ({ ...config });

  function definirConfig(cfg) {
    // Campo ausente mantém o valor atual; tamanho fora de 10 a 24 é recusado.
    if (cfg && cfg.tamanhoFonte !== undefined && !tamanhoFonteValido(cfg.tamanhoFonte)) throw new Error('tamanho inválido');
    const novo = {
      classificar: cfg && cfg.classificar !== undefined ? cfg.classificar !== false : config.classificar,
      tamanhoFonte: cfg && cfg.tamanhoFonte !== undefined ? cfg.tamanhoFonte : (config.tamanhoFonte || FONTE_PADRAO),
    };
    salvarConfig(caminhoConfig, novo);
    config = novo;
  }

  return {
    listar, nova, selecionar, fechar, retomar, recomecar, escrever, microfone, redimensionar, marcarFoco, marcarPagina,
    restaurar, encerrarTudo, contarAtivas, aoMudarEventos, recalcular, renomear, definirTitulo, trocarCor,
    listarGrupos, criarGrupo, renomearGrupo, descreverGrupo, apagarGrupo, moverParaGrupo, listarFechadas, reabrirFechada,
    estatisticas, contarVermelhos, lerConfig, definirConfig,
    salvarEFechar, naoFechar, contarNaoSalvas, contarRascunhos, contarFalhas, salvarTodas, cancelarSair,
  };
}

module.exports = { criarGerente, textoConfirmacao, ultimasLinhas, contarVermelhosDe };
