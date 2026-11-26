// Tela do Atlas: cartões das sessões à esquerda, terminal da sessão escolhida à direita.
'use strict';

const { tempoRelativo, caminhosArrastados, atalho, pastaCurta, agruparCartoes, formatarDuracao, textoSalvar,
  caixaDoClaude, numerosDeImagem, ligarMiniaturas, ehImagem, AUSENCIA } = window.AtlasUtil;
const { limparTitulo } = window.AtlasNome;
const ponte = window.atlas; // "atlas" já é global (contextBridge)
const $ = (id) => document.getElementById(id);

const OPCOES_TERMINAL = {
  fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
  fontSize: 13, // o tamanho de verdade vem da config (tamanhoFonte), lida antes do primeiro terminal
  // 1.0 como no Terminal: com mais, as bordas (│ ╭ ╮) do claude ficam com frestas.
  lineHeight: 1.0,
  scrollback: 10000,
  allowTransparency: true, // fundo transparente: aparece o vidro da janela (tela.css)
  macOptionIsMeta: true, // ⌥ é Meta, como no perfil do Terminal (useOptionAsMetaKey): ⌥← e ⌥→ pulam palavras
  theme: {
    background: 'rgba(23, 23, 22, 0)', // grafite com alfa 0: o fundo é o da janela
    foreground: '#f4f3f0', // giz
    cursor: '#f4f3f0',
    cursorAccent: '#171716',
    selectionBackground: 'rgba(185, 182, 175, 0.32)', // névoa
  },
  // Link do terminal (OSC 8): ⌘ clique abre no navegador, como no Terminal.
  linkHandler: { activate: (ev, uri) => { if (ev.metaKey) window.open(uri); } },
};

const FONTE_MIN = 10;
const FONTE_MAX = 24;
const FONTE_PADRAO = 13;
let tamanhoFonte = FONTE_PADRAO; // config.tamanhoFonte: vale para todos os terminais

const terminais = new Map(); // id -> { term, fit, el, cols, rows, titulo, pendente, timerTitulo }
const pendentes = new Map(); // id -> saída que chegou antes do terminal existir
let cartoes = [];
let selecionadaId = null;
let grupos = []; // [{ id, nome, descricao }], na ordem dos blocos
let ordemVisual = []; // ids dos cartões à vista (blocos abertos), de cima para baixo: ⌘1 a ⌘9
let pagina = null; // 'configuracoes' | 'estatisticas' | null (terminal à vista)

// Blocos recolhidos ficam guardados no navegador. Sem armazenamento (ou estragado): todos abertos.
const CHAVE_RECOLHIDOS = 'atlas.blocosRecolhidos';
const recolhidos = (() => {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_RECOLHIDOS) || '[]');
    return new Set(Array.isArray(salvo) ? salvo.filter((v) => v === null || typeof v === 'string') : []);
  } catch { return new Set(); }
})();

// Terminais

function criarTerminal(id) {
  const el = document.createElement('div');
  el.className = 'tela-terminal';
  $('terminais').appendChild(el);
  const term = new Terminal({ ...OPCOES_TERMINAL, fontSize: tamanhoFonte });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(el);
  // WebGL (como no VS Code): desenha as bordas │ ╭ ╮ do claude sem frestas. Se o contexto
  // cair (o Chromium limita ~16 por página), volta sozinho ao desenho por DOM.
  try {
    const webgl = new WebglAddon.WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    term.loadAddon(webgl);
  } catch { /* sem WebGL: fica o DOM */ }
  // XTVERSION (CSI > 0 q): o xterm.js não responde, e sem resposta o claude não sabe que é um
  // xterm.js. Respondendo, ele usa o modo feito para o xterm.js (o do VS Code): rolagem do
  // fullscreen com 3 linhas por giro e aceleração suave, e o redesenho certo para este terminal.
  term.parser.registerCsiHandler({ prefix: '>', final: 'q' }, (params) => {
    if (params.length <= 1 && !params[0]) ponte.identificarTerminal(id);
    return true;
  });
  term.onData((d) => ponte.escrever(id, d));
  term.onBinary((d) => ponte.escrever(id, d));
  term.attachCustomKeyEventHandler((ev) => {
    // ⌃V: o claude cola a imagem da área de transferência; o Atlas guarda a miniatura dela.
    if (ev.type === 'keydown' && ev.ctrlKey && !ev.metaKey && !ev.altKey && ev.key.toLowerCase() === 'v') {
      guardarColada(id, ponte.miniaturaDaArea());
    }
    return !atalho(ev);
  });
  const t = { term, fit, el, cols: 0, rows: 0, titulo: null, pendente: null, timerTitulo: null };
  // Título que o claude põe no terminal (OSC 0/2). Vale também para os terminais escondidos.
  term.onTitleChange((bruto) => avisarTitulo(id, t, bruto));
  terminais.set(id, t);
  for (const d of pendentes.get(id) || []) term.write(d, () => { if (id === selecionadaId) conferirGravando(); });
  pendentes.delete(id);
  ajustar(id, t);
  return t;
}

// O claude troca o título a cada quadro do spinner ("⠂ X", "⠐ X"): quadro com o mesmo
// título limpo (já enviado ou já agendado) não mexe no timer, senão o spinner rápido nunca
// deixaria o timer disparar. Título novo vai ao main 300 ms depois.
function avisarTitulo(id, t, bruto) {
  const limpo = limparTitulo(bruto);
  if (!limpo || limpo === (t.pendente !== null ? t.pendente : t.titulo)) return;
  clearTimeout(t.timerTitulo);
  t.pendente = limpo;
  t.timerTitulo = setTimeout(() => {
    t.pendente = null;
    if (limpo === t.titulo || terminais.get(id) !== t) return;
    t.titulo = limpo;
    ponte.definirTitulo(id, limpo.slice(0, 200));
  }, 300);
}

function ajustar(id, t) {
  try { t.fit.fit(); } catch { return; }
  const { cols, rows } = t.term;
  if (cols === t.cols && rows === t.rows) return;
  t.cols = cols;
  t.rows = rows;
  ponte.redimensionar(id, cols, rows);
}

// Tamanho do texto mudou (menu ou Configurações): todos os terminais, ao vivo. O refit manda
// as colunas e linhas novas ao pty como numa mudança de janela, e o claude redesenha.
function aplicarTamanhoFonte(n) {
  if (!Number.isInteger(n) || n < FONTE_MIN || n > FONTE_MAX) return;
  tamanhoFonte = n;
  for (const [id, t] of terminais) {
    t.term.options.fontSize = n;
    ajustar(id, t);
  }
  const valor = document.querySelector('.tamanho__valor');
  if (valor) valor.textContent = String(n);
  for (const [sel, desligado] of [['.tamanho__menos', n <= FONTE_MIN], ['.tamanho__mais', n >= FONTE_MAX]]) {
    const b = document.querySelector(sel);
    if (b) b.disabled = desligado;
  }
}
ponte.aoTamanhoFonte(aplicarTamanhoFonte);

let ajusteMarcado = false;
new ResizeObserver(() => {
  if (ajusteMarcado) return;
  ajusteMarcado = true;
  requestAnimationFrame(() => {
    ajusteMarcado = false;
    for (const [id, t] of terminais) ajustar(id, t);
  });
}).observe($('terminais'));

ponte.aoDados((id, dados) => {
  const t = terminais.get(id);
  if (t) t.term.write(dados, () => { if (id === selecionadaId) conferirGravando(); });
  else pendentes.set(id, [...(pendentes.get(id) || []), dados]);
});

// Microfone: o botão e o ⌘D mandam o mesmo toque da barra de espaço (voz no modo tap). O
// estado vem do rodapé que o claude desenha na sessão selecionada: "REC · tap to send" gravando,
// "Transcribing…" transcrevendo. 🔴 São textos do claude 2.1.330: se mudarem numa versão nova,
// o botão para de ficar vermelho (a voz segue funcionando).
const botaoMicrofone = $('botao-microfone');
const GRAVANDO = /REC\s*·\s*tap to send/;
const TRANSCREVENDO = /Transcribing…/;
const MS_ENTRE_TOQUES = 400; // ⌘D segurado e clique duplo: um toque só
let estadoMicrofone = 'parado'; // 'parado' | 'gravando' | 'transcrevendo'
let ultimoToque = 0;
let quadroGravando = 0;

function lerMicrofone(t) {
  const b = t.term.buffer.active;
  // A tela inteira: em sessão curta o rodapé fica no meio dela, não nas últimas linhas.
  for (let i = b.baseY; i < b.baseY + t.term.rows; i++) {
    const linha = b.getLine(i);
    if (!linha) continue;
    const texto = linha.translateToString(true);
    if (GRAVANDO.test(texto)) return 'gravando';
    if (TRANSCREVENDO.test(texto)) return 'transcrevendo';
  }
  return 'parado';
}

function conferirGravando() {
  if (quadroGravando) return;
  quadroGravando = requestAnimationFrame(() => {
    quadroGravando = 0;
    const t = terminais.get(selecionadaId);
    const c = cartoes.find((x) => x.id === selecionadaId);
    const viva = Boolean(t && c && c.estado.cor !== 'preto');
    estadoMicrofone = viva ? lerMicrofone(t) : 'parado';
    botaoMicrofone.hidden = !viva;
    botaoMicrofone.disabled = estadoMicrofone === 'transcrevendo';
    botaoMicrofone.classList.toggle('botao-microfone--gravando', estadoMicrofone === 'gravando');
    botaoMicrofone.setAttribute('aria-pressed', String(estadoMicrofone === 'gravando'));
    botaoMicrofone.setAttribute('aria-label', estadoMicrofone === 'gravando' ? 'Parar e enviar (⌘D)' : 'Falar (⌘D)');
    conferirMiniaturas(viva ? t : null);
  });
}

// Mesmas travas das teclas: nada com página aberta ou renomeando um cartão, nem no meio da
// transcrição (o espaço iria para a caixa e o claude jogaria a fala fora).
function tocarMicrofone() {
  if (pagina || editando || estadoMicrofone === 'transcrevendo') return;
  const agora = Date.now();
  if (agora - ultimoToque < MS_ENTRE_TOQUES) return;
  ultimoToque = agora;
  ponte.microfone();
  const t = terminais.get(selecionadaId);
  if (t) t.term.focus();
}
botaoMicrofone.addEventListener('mousedown', (ev) => ev.preventDefault()); // não tira o foco do terminal
botaoMicrofone.addEventListener('click', tocarMicrofone);
ponte.aoMicrofone(tocarMicrofone);

// Miniaturas das imagens coladas: faixa logo acima da caixa do claude na sessão selecionada.
// A caixa diz quais "[Image #N]" estão no pedido; cada número novo pega a imagem colada (⌃V,
// ⌘V com imagem, arquivo de imagem arrastado) mais antiga ainda sem número. Pedido enviado ou
// imagem apagada da caixa: a miniatura sai. Sem caixa à vista (pergunta, menu), a faixa só
// some e o estado fica, porque o rascunho volta depois.
const faixaMiniaturas = $('miniaturas');
const imagensPorSessao = new Map(); // id -> { porNumero, coladas }
let faixaDesenhada = '';

let timerAusencia = 0;

function estadoImagens(id) {
  if (!imagensPorSessao.has(id)) imagensPorSessao.set(id, { porNumero: new Map(), coladas: [], vistos: new Set(), ausentes: new Map() });
  return imagensPorSessao.get(id);
}

function linhasDaTela(t) {
  const b = t.term.buffer.active;
  const linhas = [];
  for (let i = b.viewportY; i < b.viewportY + t.term.rows; i++) {
    const linha = b.getLine(i);
    linhas.push(linha ? linha.translateToString(true) : '');
  }
  return linhas;
}

// promessa: data URL (ou null) da miniatura. A colada entra na fila na hora, para valer a
// ordem das colagens; sem imagem, sai da fila e do número que tiver pego.
function guardarColada(id, promessa) {
  // Sem a caixa à vista (pergunta, menu) a colagem não vira imagem no pedido.
  const t = terminais.get(id);
  const caixa = t && caixaDoClaude(linhasDaTela(t));
  if (!caixa) return;
  const est = estadoImagens(id);
  // Registra o que já está na caixa antes de a colada entrar: um "[Image #N]" antigo (pedido
  // do ↑, número que entrou com a faixa sem varrer) não pode pegar a imagem nova.
  ligarMiniaturas(est, numerosDeImagem(caixa.texto), Date.now());
  const colada = { imagem: null, t: Date.now() };
  est.coladas.push(colada);
  Promise.resolve(promessa).catch(() => null).then((imagem) => {
    if (imagem) colada.imagem = imagem;
    else {
      est.coladas = est.coladas.filter((c) => c !== colada);
      for (const [n, c] of est.porNumero) if (c === colada) est.porNumero.delete(n);
    }
    if (id === selecionadaId) conferirGravando();
  });
}

function esconderMiniaturas() {
  faixaMiniaturas.hidden = true;
  faixaDesenhada = '';
}

function conferirMiniaturas(t) {
  if (!t || pagina) return esconderMiniaturas();
  const est = imagensPorSessao.get(selecionadaId);
  // Sessão que nunca colou imagem: nada a ler.
  if (!est) return esconderMiniaturas();
  const caixa = caixaDoClaude(linhasDaTela(t));
  if (!caixa) return esconderMiniaturas();
  const { lista: ligadas, esperando } = ligarMiniaturas(est, numerosDeImagem(caixa.texto), Date.now());
  // Número sumido da caixa: confere de novo quando a ausência vence, mesmo sem saída nova.
  clearTimeout(timerAusencia);
  if (esperando) timerAusencia = setTimeout(conferirGravando, AUSENCIA + 50);
  const lista = ligadas.filter(([, c]) => c.imagem);
  if (!lista.length) return esconderMiniaturas();
  const tela = t.el.querySelector('.xterm-screen');
  const alturaLinha = tela ? tela.getBoundingClientRect().height / t.term.rows : 0;
  const chave = lista.map(([n, c]) => n + ':' + c.t).join(',') + '@' + caixa.topo + 'x' + alturaLinha.toFixed(1);
  if (chave === faixaDesenhada && !faixaMiniaturas.hidden) return;
  faixaDesenhada = chave;
  faixaMiniaturas.replaceChildren(...lista.map(([n, c]) => {
    const item = el('figure', 'miniatura');
    const img = document.createElement('img');
    img.src = c.imagem;
    img.alt = `Imagem #${n}`;
    item.append(img, el('figcaption', 'miniatura__numero', `#${n}`));
    return item;
  }));
  faixaMiniaturas.hidden = false;
  // Encostada em cima da régua de cima da caixa, alinhada à esquerda do terminal.
  faixaMiniaturas.style.left = t.el.offsetLeft + 'px';
  const topo = t.el.offsetTop + caixa.topo * alturaLinha - faixaMiniaturas.offsetHeight - 6;
  faixaMiniaturas.style.top = Math.max(0, topo) + 'px';
}

// Clique na faixa não tira o foco do terminal (como o botão do microfone).
faixaMiniaturas.addEventListener('mousedown', (ev) => ev.preventDefault());

// ⌘V com só uma imagem na área de transferência: o xterm não teria texto para colar, então
// o Atlas manda o ⌃V, que é como o claude cola imagem.
$('terminais').addEventListener('paste', (ev) => {
  const dados = ev.clipboardData;
  if (!dados || !selecionadaId || dados.getData('text/plain')) return;
  const temImagem = [...dados.items].some((i) => i.kind === 'file' && i.type.startsWith('image/'));
  if (!temImagem) return;
  ev.preventDefault();
  ev.stopImmediatePropagation();
  ponte.escrever(selecionadaId, '\x16');
  guardarColada(selecionadaId, ponte.miniaturaDaArea());
}, true);

// Seleção

function selecionar(id) {
  if (!terminais.has(id)) return;
  selecionadaId = id;
  abrirBlocoDe(id);
  for (const [tid, t] of terminais) t.el.classList.toggle('tela-terminal--ativo', tid === id);
  const t = terminais.get(id);
  ajustar(id, t);
  if (!pagina) t.term.focus(); // com uma página aberta, as teclas não podem ir ao terminal escondido
  ponte.selecionar(id);
  desenhar();
  conferirGravando();
}

function sincronizar() {
  const ids = new Set(cartoes.map((c) => c.id));
  for (const [id, t] of [...terminais]) {
    if (ids.has(id)) continue;
    // Tira do mapa antes: um erro no dispose (ex.: WebGL perdido) não pode travar a lista.
    terminais.delete(id);
    clearTimeout(t.timerTitulo);
    if (editando === id) editando = null;
    try { t.term.dispose(); } catch (err) { console.error('dispose:', err); }
    t.el.remove();
  }
  for (const id of pendentes.keys()) if (!ids.has(id)) pendentes.delete(id);
  for (const id of imagensPorSessao.keys()) if (!ids.has(id)) imagensPorSessao.delete(id);
  for (const c of cartoes) if (!terminais.has(c.id)) criarTerminal(c.id);
  if (!ids.has(selecionadaId)) {
    selecionadaId = null;
    const alvo = cartoes.find((c) => c.selecionada) || cartoes[0];
    if (alvo) selecionar(alvo.id);
  }
  conferirGravando();
}

// Cartões

function el(tag, classe, texto) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto != null) e.textContent = texto;
  return e;
}

// Cartões são atualizados no lugar, por id: o botão é o mesmo entre atualizações (o main
// emite a cada 5 s), então clique, foco e tooltip não se perdem. Só muda o que mudou.
const botoes = new Map(); // id -> { b, chave }

function chaveCartao(c, indice) {
  const desde = c.estado.cor === 'preto' ? null : c.estado.desde; // no preto o desde é "agora"
  return JSON.stringify([indice, c.id === selecionadaId, c.nome, c.cor, c.pasta,
    c.estado.cor, c.estado.rotulo, desde, c.estado.ultimoPedido, c.podeRecomecar, c.salva, c.salvando, c.rascunho]);
}

function criarBotao(id) {
  const b = el('button');
  b.type = 'button';
  b.setAttribute('role', 'listitem');
  b.addEventListener('click', () => {
    if (editando === id) return;
    fecharPagina();
    selecionar(id);
  });
  b.addEventListener('contextmenu', (ev) => { ev.preventDefault(); ponte.menuCartao(id); });
  return b;
}

function preencherCartao(b, c, indice) {
  b.className = `cartao cartao--${c.estado.cor}`;
  if (c.id === selecionadaId) b.classList.add('cartao--selecionado');
  b.style.setProperty('--cor-projeto', c.cor);

  const topo = el('span', 'cartao__topo');
  topo.append(el('span', 'cartao__nome', c.nome));
  if (c.estado.cor !== 'preto') {
    const tempo = el('span', 'cartao__tempo', tempoRelativo(c.estado.desde, Date.now()));
    tempo.dataset.desde = c.estado.desde;
    topo.append(tempo);
  }

  const estado = el('span', 'cartao__estado');
  estado.append(el('span', 'bolinha'), el('span', 'cartao__rotulo', c.estado.rotulo));

  b.replaceChildren(topo, estado);
  // Sinal do /salvar no começo da linha do pedido, discreto e fora das cores de estado: não
  // disputa espaço com o rótulo do estado.
  const salvar = textoSalvar(c);
  if (c.estado.ultimoPedido || salvar) {
    const pedido = el('span', 'cartao__pedido');
    if (salvar) pedido.append(el('span', 'cartao__salvar', salvar), c.estado.ultimoPedido ? ' · ' : '');
    if (c.estado.ultimoPedido) pedido.append(c.estado.ultimoPedido);
    b.append(pedido);
  }
  const titulo = indice >= 0 && indice < 9 ? `${pastaCurta(c.pasta)}  (⌘${indice + 1})` : pastaCurta(c.pasta);
  if (b.title !== titulo) b.title = titulo;
}

// Um bloco por grupo com cartão, também atualizado no lugar (chave: id do grupo, '' = Sem grupo).
const blocosEl = new Map(); // chave -> { el, titulo, nome, conta, lista }
const chaveBloco = (grupoId) => (grupoId === null ? '' : grupoId);

function criarBloco(grupoId) {
  const raiz = el('div', 'bloco');
  raiz.setAttribute('role', 'group');
  const titulo = el('button', 'bloco__titulo');
  titulo.type = 'button';
  const nome = el('span', 'bloco__nome');
  const conta = el('span', 'bloco__conta');
  titulo.append(el('span', 'bloco__seta'), nome, conta);
  // O título não fica com o foco (como os cartões): o clique não o tira do terminal, e o
  // foco volta para ele depois, então Espaço e Enter seguintes vão para o claude.
  titulo.addEventListener('mousedown', (e) => e.preventDefault());
  titulo.addEventListener('click', () => { alternarBloco(grupoId); focarTerminal(); });
  const lista = el('div', 'bloco__cartoes');
  raiz.append(titulo, lista);
  return { el: raiz, titulo, nome, conta, lista };
}

function guardarRecolhidos() {
  try { localStorage.setItem(CHAVE_RECOLHIDOS, JSON.stringify([...recolhidos])); } catch { /* só nesta abertura */ }
}

function alternarBloco(grupoId) {
  if (recolhidos.has(grupoId)) recolhidos.delete(grupoId);
  else recolhidos.add(grupoId);
  guardarRecolhidos();
  desenhar();
}

// Sessão selecionada (aviso clicado, ⌘⇧T) num bloco recolhido: o bloco abre, senão ela some da coluna.
function abrirBlocoDe(id) {
  const c = cartoes.find((x) => x.id === id);
  if (!c) return;
  const gid = c.grupoId != null && grupos.some((g) => g.id === c.grupoId) ? c.grupoId : null;
  if (!recolhidos.has(gid)) return;
  recolhidos.delete(gid);
  guardarRecolhidos();
}

// Põe `filho` na posição `i` de `pai` sem perder o foco de quem está dentro dele.
function colocar(pai, filho, i) {
  if (pai.children[i] === filho) return;
  const foco = document.activeElement;
  pai.insertBefore(filho, pai.children[i] || null);
  if (foco && filho.contains(foco) && document.activeElement !== foco) foco.focus();
}

function desenhar() {
  const lista = $('cartoes');
  const blocos = agruparCartoes(cartoes, grupos, recolhidos);
  // Só "Sem grupo" na coluna: o título não diz nada, fica escondido.
  const soSemGrupo = blocos.length === 1 && blocos[0].grupoId === null;
  ordemVisual = blocos.flatMap((b) => (b.recolhido && !soSemGrupo ? [] : b.cartoes.map((c) => c.id)));

  blocos.forEach((bl, bi) => {
    const chaveB = chaveBloco(bl.grupoId);
    let rb = blocosEl.get(chaveB);
    if (!rb) { rb = criarBloco(bl.grupoId); blocosEl.set(chaveB, rb); }
    const recolhido = bl.recolhido && !soSemGrupo;
    rb.el.classList.toggle('bloco--sem-titulo', soSemGrupo);
    rb.el.classList.toggle('bloco--recolhido', recolhido);
    rb.el.setAttribute('aria-label', bl.nome);
    rb.nome.textContent = bl.nome;
    rb.titulo.setAttribute('aria-expanded', String(!recolhido));
    const vermelhos = recolhido && bl.vermelhos > 0;
    rb.conta.classList.toggle('bloco__conta--vermelho', vermelhos);
    rb.conta.textContent = recolhido ? String(vermelhos ? bl.vermelhos : bl.cartoes.length) : '';
    rb.titulo.title = vermelhos
      ? `${bl.vermelhos === 1 ? '1 sessão precisa' : `${bl.vermelhos} sessões precisam`} de você. Clique para abrir.`
      : (recolhido ? 'Clique para abrir' : 'Clique para recolher');
    rb.lista.hidden = recolhido;
    colocar(lista, rb.el, bi);

    bl.cartoes.forEach((c, i) => {
      let r = botoes.get(c.id);
      if (!r) { r = { b: criarBotao(c.id), chave: null }; botoes.set(c.id, r); }
      const chave = chaveCartao(c, ordemVisual.indexOf(c.id));
      // Cartão em edição fica como está até confirmar ou cancelar.
      if (chave !== r.chave && editando !== c.id) { preencherCartao(r.b, c, ordemVisual.indexOf(c.id)); r.chave = chave; }
      colocar(rb.lista, r.b, i);
    });
  });

  // Por último o que saiu: um cartão vivo que trocou de bloco já foi para o bloco novo.
  const vivos = new Set(cartoes.map((c) => c.id));
  for (const [id, r] of botoes) {
    if (vivos.has(id)) continue;
    r.b.remove();
    botoes.delete(id);
  }
  const blocosVivos = new Set(blocos.map((b) => chaveBloco(b.grupoId)));
  for (const [chaveB, rb] of blocosEl) {
    if (blocosVivos.has(chaveB)) continue;
    rb.el.remove();
    blocosEl.delete(chaveB);
  }

  const c = cartoes.find((x) => x.id === selecionadaId);
  const cab = $('cabecalho');
  cab.style.setProperty('--cor-projeto', c ? c.cor : 'transparent');
  $('cab-nome').textContent = c ? c.nome : '';
  $('cab-pasta').textContent = c ? pastaCurta(c.pasta) : '';
  const tituloJanela = c ? c.nome : 'Atlas';
  if (document.title !== tituloJanela) document.title = tituloJanela;
  $('encerrada').hidden = !c || c.estado.cor !== 'preto';
  conferirGravando();
  const recomecar = Boolean(c && c.estado.cor === 'preto' && c.podeRecomecar);
  $('botao-recomecar').hidden = !recomecar;
  $('encerrada-texto').textContent = recomecar
    ? 'A conversa salva não abriu. Tente de novo ou comece uma conversa nova.'
    : 'Esta sessão foi encerrada.';
  $('vazio').hidden = cartoes.length > 0;
}

setInterval(() => {
  for (const t of document.querySelectorAll('.cartao__tempo')) t.textContent = tempoRelativo(Number(t.dataset.desde), Date.now());
}, 15000);

// O xterm mede a grade na criação: só cria terminais com a JetBrains Mono carregada.
// O tamanho salvo também é lido antes: os terminais já nascem com ele.
const fontesProntas = Promise.all([
  document.fonts.load('13px "JetBrains Mono"'),
  document.fonts.load('bold 13px "JetBrains Mono"'),
  ponte.lerConfig().then((cfg) => { if (cfg && Number.isInteger(cfg.tamanhoFonte)) tamanhoFonte = cfg.tamanhoFonte; }),
]).catch(() => {});
let fila = fontesProntas;

ponte.aoCartoes((lista) => {
  // Um erro numa atualização não pode travar as seguintes.
  // Os grupos vêm junto: criar, renomear ou apagar um grupo também manda a lista nova.
  fila = fila.then(async () => {
    try { grupos = await ponte.listarGrupos(); } catch (err) { console.error('grupos:', err); }
    cartoes = lista;
    sincronizar();
    desenhar();
  }).catch((err) => console.error('atualizar cartões:', err));
});

// Uso do plano (vem do main a cada 5 s, junto com o timer dos cartões)

function desenharUso(linhas) {
  if (!Array.isArray(linhas)) return;
  $('uso').replaceChildren(...linhas.map((l) => {
    const linha = el('div', `uso__linha uso__linha--${l.semDado ? 'vazia' : l.faixa}`);
    const barra = el('span', 'uso__barra');
    const cheio = el('span', 'uso__cheio');
    cheio.style.width = l.semDado ? '0' : `${l.pct}%`;
    barra.append(cheio);
    linha.append(
      el('span', 'uso__rotulo', l.rotulo),
      el('span', 'uso__reset', l.semDado ? 'sem dado recente' : l.reset),
      el('span', 'uso__pct', l.semDado ? '' : `${l.pct}%`),
      barra,
    );
    return linha;
  }));
}

ponte.aoUso(desenharUso);
ponte.uso().then(desenharUso).catch((err) => console.error('uso:', err));

// Retomar reaproveita o terminal: limpa a tela e o histórico da execução anterior antes
// da saída nova (o main avisa antes de abrir o pty).
ponte.aoRetomar((id) => {
  const t = terminais.get(id);
  if (t) t.term.reset();
});

// Clique num aviso do Mac ou sessão reaberta: mostra a sessão. Entra na fila dos cartões,
// porque o terminal de uma sessão recém-reaberta só existe depois da lista nova chegar.
ponte.aoSelecionar((id) => {
  fila = fila.then(() => { fecharPagina(); selecionar(id); }).catch((err) => console.error('selecionar:', err));
});

$('botao-retomar').addEventListener('click', () => {
  if (selecionadaId) ponte.retomar(selecionadaId);
  focarTerminal();
});

$('botao-recomecar').addEventListener('click', () => {
  if (selecionadaId) ponte.recomecar(selecionadaId);
  focarTerminal();
});

function focarTerminal() {
  if (pagina) return;
  const t = terminais.get(selecionadaId);
  if (t) t.term.focus();
}

// + Nova sessão: abre na hora, na pasta pessoal, como uma aba nova do Terminal.

async function abrirSessao() {
  fecharPagina();
  const id = await ponte.nova();
  if (!id) return;
  if (!terminais.has(id)) {
    cartoes = await ponte.listar();
    sincronizar();
  }
  selecionar(id);
}

$('botao-nova').addEventListener('click', abrirSessao);
$('vazio-nova').addEventListener('click', abrirSessao);

// Renomear (botão direito no cartão): o nome vira campo. Enter confirma, Esc cancela,
// vazio volta ao automático (título da conversa ou "Novo").

let editando = null; // id do cartão em edição

function iniciarRenomear(id) {
  const r = botoes.get(id);
  const c = cartoes.find((x) => x.id === id);
  if (!r || !c) return;
  if (editando) terminarRenomear(false);
  const nomeEl = r.b.querySelector('.cartao__nome');
  if (!nomeEl) return;
  editando = id;
  const campo = document.createElement('input');
  campo.className = 'cartao__editar';
  campo.type = 'text';
  campo.maxLength = 80;
  campo.value = c.nome;
  campo.placeholder = 'Nome automático';
  campo.setAttribute('aria-label', 'Nome da sessão');
  campo.spellcheck = false;
  campo.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.isComposing || ev.keyCode === 229) return; // Enter/Esc da composição (acentos, IME)
    if (ev.key === 'Enter') { ev.preventDefault(); terminarRenomear(true); }
    else if (ev.key === 'Escape') { ev.preventDefault(); terminarRenomear(false); }
  });
  for (const tipo of ['click', 'mousedown', 'dblclick']) campo.addEventListener(tipo, (ev) => ev.stopPropagation());
  // Clicar fora confirma, como no Finder. Mudar o cartão de lugar também tira o foco: espera um instante.
  campo.addEventListener('blur', () => setTimeout(() => {
    if (editando === id && document.activeElement !== campo) terminarRenomear(true);
  }, 0));
  nomeEl.replaceWith(campo);
  campo.focus();
  campo.select();
}

function terminarRenomear(confirmar) {
  const id = editando;
  if (!id) return;
  editando = null;
  const r = botoes.get(id);
  const campo = r && r.b.querySelector('.cartao__editar');
  const c = cartoes.find((x) => x.id === id);
  const valor = campo ? campo.value.trim() : '';
  if (r) r.chave = null; // redesenha o cartão com o nome de volta
  // Confirmar sem mudar nada não fixa o nome automático como manual.
  if (confirmar && c && valor !== c.nome) ponte.renomear(id, valor ? valor.slice(0, 80) : null);
  desenhar();
  focarTerminal();
}

ponte.aoPedirRenomear(iniciarRenomear);

// Atalhos do app: só ⌘1 a ⌘9, ⌘T e ⌘W. Antes do terminal (fase de captura).

document.addEventListener('keydown', (ev) => {
  // Esc numa página volta ao terminal. Num campo com texto mudado, o Esc é do campo (desfaz).
  // Renomeando um cartão: o Esc é do campo do nome (cancela), não da página.
  const noNome = editando || (ev.target && ev.target.classList && ev.target.classList.contains('cartao__editar'));
  if (pagina && !noNome && ev.key === 'Escape' && !ev.isComposing && ev.keyCode !== 229) {
    const campo = ev.target && ev.target.dataset && ev.target.dataset.original !== undefined ? ev.target : null;
    if (campo && campo.value !== campo.dataset.original) return;
    ev.preventDefault();
    ev.stopPropagation();
    fecharPagina();
    return;
  }
  // Renomeando: as teclas são do campo (⌘W, ⌘T e ⌘1 a ⌘9 não agem no meio da edição).
  if (editando || (ev.target && ev.target.classList && ev.target.classList.contains('cartao__editar'))) return;
  const a = atalho(ev);
  if (!a) return;
  ev.preventDefault();
  ev.stopPropagation();
  // Tecla segurada: só o primeiro toque conta (⌘W segurado não fecha várias sessões).
  if (ev.repeat) return;
  if (a.acao === 'selecionar') {
    // Ordem da coluna como está na tela: blocos recolhidos ficam de fora.
    const id = ordemVisual[a.indice];
    if (id) { fecharPagina(); selecionar(id); }
  } else if (a.acao === 'nova') {
    abrirSessao();
  } else if (a.acao === 'fechar' && pagina) {
    fecharPagina(); // numa página, ⌘W fecha a página, nunca a sessão escondida atrás dela
  } else if (a.acao === 'fechar' && selecionadaId) {
    ponte.pedirFechar(selecionadaId).then(focarTerminal);
  }
}, true);

// Arrastar arquivo para o terminal: insere o caminho entre aspas, como o Terminal.

const areaTerminais = $('terminais');
document.addEventListener('dragover', (ev) => ev.preventDefault());
document.addEventListener('drop', (ev) => ev.preventDefault());
areaTerminais.addEventListener('dragover', (ev) => {
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'copy';
  areaTerminais.classList.add('terminais--soltar');
});
areaTerminais.addEventListener('dragleave', () => areaTerminais.classList.remove('terminais--soltar'));
areaTerminais.addEventListener('drop', (ev) => {
  ev.preventDefault();
  areaTerminais.classList.remove('terminais--soltar');
  if (!selecionadaId) return;
  const caminhos = [...ev.dataTransfer.files].map((f) => ponte.caminhoDoArquivo(f));
  // Só quando todos são imagem: com outro arquivo no meio, o claude não converte nenhum.
  if (caminhos.length && caminhos.every(ehImagem)) for (const c of caminhos) guardarColada(selecionadaId, ponte.miniaturaDoArquivo(c));
  const texto = caminhosArrastados(caminhos) || ev.dataTransfer.getData('text/plain');
  // Como colar: com bracketed paste o claude reconhece o caminho de imagem.
  if (texto) terminais.get(selecionadaId).term.paste(texto);
  focarTerminal();
});

// Páginas (Configurações e Estatísticas): no lugar do terminal. Esc ou Voltar retorna.

const TITULOS_PAGINA = { configuracoes: 'Configurações', estatisticas: 'Estatísticas' };

function abrirPagina(nome) {
  if (!TITULOS_PAGINA[nome]) return;
  if (editando) terminarRenomear(true);
  pagina = nome;
  esconderMiniaturas();
  // O gerente passa a avisar e a não marcar como vista a sessão escondida atrás da página.
  ponte.marcarPagina(true).catch((err) => console.error('marcarPagina:', err));
  document.querySelector('.principal').classList.add('principal--pagina');
  $('pagina').hidden = false;
  $('pagina-titulo').textContent = TITULOS_PAGINA[nome];
  $('botao-engrenagem').classList.toggle('botao-engrenagem--ativo', nome === 'configuracoes');
  $('botao-estatisticas').classList.toggle('botao-engrenagem--ativo', nome === 'estatisticas');
  $('pagina-corpo').scrollTop = 0;
  // O foco sai do terminal: o que for digitado aqui não chega ao claude.
  $('pagina-corpo').focus();
  const desenho = nome === 'configuracoes' ? desenharConfiguracoes() : desenharEstatisticas();
  desenho.catch((err) => console.error('página:', err));
}

function fecharPagina() {
  if (!pagina) return;
  // Campo com texto mudado se salva antes de a página sumir (o blur faz isso).
  if ($('pagina').contains(document.activeElement)) document.activeElement.blur();
  pagina = null;
  conferirGravando(); // miniaturas de volta, se houver
  ponte.marcarPagina(false).catch((err) => console.error('marcarPagina:', err));
  document.querySelector('.principal').classList.remove('principal--pagina');
  $('pagina').hidden = true;
  $('pagina-corpo').replaceChildren();
  $('botao-engrenagem').classList.remove('botao-engrenagem--ativo');
  $('botao-estatisticas').classList.remove('botao-engrenagem--ativo');
  for (const [id, t] of terminais) ajustar(id, t);
  const t = terminais.get(selecionadaId);
  if (t) t.term.refresh(0, t.term.rows - 1);
  focarTerminal();
}

ponte.aoAbrirPagina(abrirPagina);
$('pagina-voltar').addEventListener('click', fecharPagina);
$('botao-engrenagem').addEventListener('click', () => (pagina === 'configuracoes' ? fecharPagina() : abrirPagina('configuracoes')));
$('botao-estatisticas').addEventListener('click', () => (pagina === 'estatisticas' ? fecharPagina() : abrirPagina('estatisticas')));

// Cada desenho de página leva um número: uma resposta atrasada (ex.: trocar 7 por 30 dias
// duas vezes rápido) não pinta por cima da mais nova.
let vezPagina = 0;

function secao(titulo, texto) {
  const s = el('section', 'secao');
  s.append(el('h2', 'secao__titulo', titulo));
  if (texto) s.append(el('p', 'secao__texto', texto));
  return s;
}

// Teclas em <kbd>; "a" e "e" entre elas são texto ("⌘1 a ⌘9").
function teclas(lista) {
  const f = document.createDocumentFragment();
  for (const t of lista) f.append(t === 'a' || t === 'e' || t === 'ou' ? ` ${t} ` : el('kbd', 'tecla', t));
  return f;
}

const ATALHOS = [
  ['Sessões', [
    [['⌘1', 'a', '⌘9'], 'Mostrar a sessão nessa posição da coluna (blocos recolhidos ficam de fora)'],
    [['⌘T'], 'Nova sessão, na pasta pessoal'],
    [['⌘W'], 'Fechar a sessão selecionada'],
    [['⌘⇧T'], 'Reabrir a última sessão fechada'],
  ]],
  ['Páginas', [
    [['⌘,'], 'Configurações'],
    [['⌘⇧E'], 'Estatísticas'],
    [['esc'], 'Voltar ao terminal'],
  ]],
  ['Texto do terminal', [
    [['⌘+', 'ou', '⌘='], 'Aumentar o texto'],
    [['⌘−'], 'Diminuir o texto'],
    [['⌘0'], 'Voltar ao tamanho padrão'],
  ]],
  ['Edição e terminal', [
    [['⌘C'], 'Copiar'],
    [['⌘V'], 'Colar'],
    [['⌘A'], 'Selecionar tudo'],
    [['⌘Z'], 'Desfazer (no nome da sessão)'],
    [['⌥←', 'e', '⌥→'], 'Pular uma palavra no terminal'],
    [['⌘ clique'], 'Abrir no navegador um link do terminal'],
  ]],
];

function secaoAtalhos() {
  const s = secao('Atalhos');
  const tabela = el('table', 'atalhos');
  for (const [grupo, linhas] of ATALHOS) {
    const corpo = el('tbody');
    const cab = el('tr', 'atalhos__grupo');
    const th = el('th', null, grupo);
    th.colSpan = 2;
    th.scope = 'colgroup';
    cab.append(th);
    corpo.append(cab);
    for (const [ks, descricao] of linhas) {
      const tr = el('tr');
      const td = el('td', 'atalhos__teclas');
      td.append(teclas(ks));
      tr.append(td, el('td', 'atalhos__acao', descricao));
      corpo.append(tr);
    }
    tabela.append(corpo);
  }
  s.append(tabela);
  return s;
}

// Erros do main em português para a tela.
const ERROS = {
  'nome inválido': 'Use um nome de 1 a 40 caracteres que ainda não exista.',
  'grupo não encontrado': 'Este grupo não existe mais.',
  'descrição inválida': 'A descrição vai até 200 caracteres.',
};
const textoErro = (r) => ERROS[r && r.erro] || 'Não deu para salvar. Tente de novo.';

// Campo que se salva no Enter ou ao sair; Esc desfaz o que foi digitado.
function campo({ valor, max, rotulo, classe, placeholder, salvar, erroEl }) {
  const c = el('input', `campo ${classe || ''}`);
  c.type = 'text';
  c.maxLength = max;
  c.value = valor;
  c.dataset.original = valor;
  c.spellcheck = false;
  c.setAttribute('aria-label', rotulo);
  if (placeholder) c.placeholder = placeholder;
  c.title = valor; // texto longo cortado no campo: o mouse mostra inteiro
  let salvando = false;
  const confirmar = async () => {
    const novo = c.value.trim();
    if (salvando || novo === c.dataset.original) { c.value = c.dataset.original; return; }
    salvando = true;
    const r = await salvar(novo).catch(() => null);
    salvando = false;
    if (r && r.ok) {
      c.dataset.original = novo;
      c.value = novo;
      c.title = novo;
      c.classList.remove('campo--erro');
      erroEl.textContent = '';
    } else {
      c.classList.add('campo--erro');
      erroEl.textContent = textoErro(r);
    }
  };
  c.addEventListener('keydown', (ev) => {
    if (ev.isComposing || ev.keyCode === 229) return;
    if (ev.key === 'Enter') { ev.preventDefault(); confirmar(); }
    else if (ev.key === 'Escape') {
      ev.preventDefault();
      c.value = c.dataset.original;
      c.classList.remove('campo--erro');
      erroEl.textContent = '';
    }
  });
  c.addEventListener('blur', confirmar);
  return c;
}

function linhaGrupo(g) {
  const linha = el('li', 'grupo');
  const erro = el('p', 'grupo__erro');
  erro.setAttribute('role', 'alert');
  const nome = campo({
    valor: g.nome, max: 40, rotulo: `Nome do grupo ${g.nome}`, classe: 'grupo__nome', erroEl: erro,
    salvar: (v) => ponte.renomearGrupo(g.id, v),
  });
  const descricao = campo({
    valor: g.descricao || '', max: 200, rotulo: `Descrição do grupo ${g.nome}`, classe: 'grupo__descricao',
    placeholder: 'O que entra neste grupo', erroEl: erro,
    salvar: (v) => ponte.descreverGrupo(g.id, v),
  });
  const apagar = el('button', 'grupo__apagar', 'Apagar');
  apagar.type = 'button';
  let confirmando = null;
  apagar.addEventListener('click', async () => {
    // Dois cliques: o primeiro só pede a confirmação (some em 4 s).
    if (!confirmando) {
      apagar.textContent = 'Confirmar';
      apagar.classList.add('grupo__apagar--confirmar');
      confirmando = setTimeout(() => {
        confirmando = null;
        apagar.textContent = 'Apagar';
        apagar.classList.remove('grupo__apagar--confirmar');
      }, 4000);
      return;
    }
    clearTimeout(confirmando);
    await ponte.apagarGrupo(g.id);
    desenharConfiguracoes();
  });
  apagar.title = 'As sessões deste grupo vão para Sem grupo';
  linha.append(nome, descricao, apagar, erro);
  return linha;
}

function secaoGrupos(lista) {
  const s = secao('Grupos', 'Cada grupo vira um bloco na coluna, nesta ordem. Apagar um grupo manda as sessões dele para Sem grupo.');
  const cab = el('div', 'grupos__cabecalho');
  cab.append(el('span', null, 'Nome'), el('span', null, 'Descrição'));
  const ajuda = el('span', 'grupos__ajuda', 'O que entra neste grupo. Ajuda a classificação automática.');
  cab.append(ajuda);
  const ul = el('ul', 'grupos');
  for (const g of lista) ul.append(linhaGrupo(g));
  if (!lista.length) ul.append(el('li', 'grupos__vazio', 'Nenhum grupo. Todas as sessões ficam em Sem grupo.'));

  const criar = el('form', 'grupo grupo--novo');
  const erro = el('p', 'grupo__erro');
  erro.setAttribute('role', 'alert');
  const nome = el('input', 'campo grupo__nome');
  nome.type = 'text';
  nome.maxLength = 40;
  nome.placeholder = 'Novo grupo';
  nome.spellcheck = false;
  nome.setAttribute('aria-label', 'Nome do grupo novo');
  const botao = el('button', 'botao botao--secundario botao--pequeno', 'Criar');
  botao.type = 'submit';
  criar.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const v = nome.value.trim();
    if (!v) { nome.focus(); return; }
    const r = await ponte.criarGrupo(v).catch(() => null);
    if (r && r.ok) {
      await desenharConfiguracoes();
      const novo = document.querySelector('.grupo--novo .grupo__nome');
      if (novo) novo.focus();
    } else {
      nome.classList.add('campo--erro');
      erro.textContent = textoErro(r);
    }
  });
  nome.addEventListener('input', () => { nome.classList.remove('campo--erro'); erro.textContent = ''; });
  criar.append(nome, botao, erro);
  s.append(cab, ul, criar);
  return s;
}

function secaoClassificacao(cfg) {
  const s = secao('Classificação automática');
  const linha = el('div', 'opcao');
  const textos = el('div', 'opcao__textos');
  textos.append(
    el('span', 'opcao__rotulo', 'Escolher o grupo das sessões novas'),
    el('span', 'opcao__texto', 'No primeiro pedido de uma sessão sem grupo, um Claude pequeno (Haiku) escolhe o grupo pela descrição. Na dúvida, ela fica em Sem grupo. Gasta um pouco do plano.'),
  );
  const chave = el('button', 'chave');
  chave.type = 'button';
  chave.setAttribute('role', 'switch');
  chave.setAttribute('aria-label', 'Classificação automática');
  const erro = el('p', 'grupo__erro');
  erro.setAttribute('role', 'alert');
  let ligado = Boolean(cfg && cfg.classificar);
  const pintar = () => chave.setAttribute('aria-checked', String(ligado));
  pintar();
  chave.addEventListener('click', async () => {
    const r = await ponte.definirConfig({ classificar: !ligado }).catch(() => null);
    if (r && r.ok) { ligado = !ligado; pintar(); erro.textContent = ''; }
    else erro.textContent = 'Não deu para salvar. Tente de novo.';
  });
  linha.append(textos, chave);
  s.append(linha, erro);
  return s;
}

function secaoTamanhoTexto(cfg) {
  const s = secao('Tamanho do texto');
  const linha = el('div', 'opcao');
  const textos = el('div', 'opcao__textos');
  textos.append(el('span', 'opcao__texto', 'Vale para o terminal de todas as sessões.'));
  const erro = el('p', 'grupo__erro');
  erro.setAttribute('role', 'alert');
  const mudar = async (n) => {
    if (n < FONTE_MIN || n > FONTE_MAX) return;
    const r = await ponte.definirConfig({ tamanhoFonte: n }).catch(() => null);
    erro.textContent = r && r.ok ? '' : 'Não deu para salvar. Tente de novo.';
  };
  const menos = el('button', 'tamanho__passo tamanho__menos', 'A−');
  menos.type = 'button';
  menos.setAttribute('aria-label', 'Diminuir o texto');
  const valor = el('span', 'tamanho__valor', String(tamanhoFonte));
  valor.setAttribute('aria-live', 'polite');
  const mais = el('button', 'tamanho__passo tamanho__mais', 'A+');
  mais.type = 'button';
  mais.setAttribute('aria-label', 'Aumentar o texto');
  const padrao = el('button', 'tamanho__padrao', 'Padrão');
  padrao.type = 'button';
  menos.addEventListener('click', () => mudar(tamanhoFonte - 1));
  mais.addEventListener('click', () => mudar(tamanhoFonte + 1));
  padrao.addEventListener('click', () => mudar(FONTE_PADRAO));
  menos.disabled = tamanhoFonte <= FONTE_MIN;
  mais.disabled = tamanhoFonte >= FONTE_MAX;
  const controles = el('div', 'tamanho');
  controles.append(menos, valor, mais, padrao);
  linha.append(textos, controles);
  s.append(linha, erro);
  return s;
}

function secaoJarvis(estado) {
  const s = secao('Modo Jarvis');
  const linha = el('div', 'opcao');
  const textos = el('div', 'opcao__textos');
  textos.append(
    el('span', 'opcao__rotulo', 'Ler as respostas em voz alta'),
    el('span', 'opcao__texto', 'O Mac lê em voz alta o começo de cada resposta do Claude.'),
  );
  if (estado && estado.voz) textos.append(el('span', 'opcao__texto', `Voz: ${estado.voz}`));
  const chave = el('button', 'chave');
  chave.type = 'button';
  chave.setAttribute('role', 'switch');
  chave.setAttribute('aria-label', 'Modo Jarvis');
  const erro = el('p', 'grupo__erro');
  erro.setAttribute('role', 'alert');
  let ligado = Boolean(estado && estado.ligado);
  const pintar = () => chave.setAttribute('aria-checked', String(ligado));
  pintar();
  chave.addEventListener('click', async () => {
    const r = await ponte.definirJarvis(!ligado).catch(() => null);
    if (r && r.ok) { ligado = Boolean(r.valor); pintar(); erro.textContent = ''; }
    else erro.textContent = 'Não deu para mudar. Tente de novo.';
  });
  linha.append(textos, chave);
  s.append(linha, erro);
  return s;
}

async function desenharConfiguracoes() {
  const vez = ++vezPagina;
  const [lista, cfg, jarvis] = await Promise.all([ponte.listarGrupos(), ponte.lerConfig(), ponte.lerJarvis().catch(() => null)]);
  if (vez !== vezPagina || pagina !== 'configuracoes') return;
  const corpo = $('pagina-corpo');
  const rolagem = corpo.scrollTop;
  corpo.replaceChildren(secaoAtalhos(), secaoGrupos(lista), secaoClassificacao(cfg), secaoTamanhoTexto(cfg), secaoJarvis(jarvis));
  corpo.scrollTop = rolagem;
}

let diasEstatisticas = 7;

function seletorDias() {
  const g = el('div', 'segmentos');
  g.setAttribute('role', 'radiogroup');
  g.setAttribute('aria-label', 'Período');
  for (const d of [7, 30]) {
    const b = el('button', 'segmentos__item', `${d} dias`);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(d === diasEstatisticas));
    b.addEventListener('click', () => {
      if (d === diasEstatisticas) return;
      diasEstatisticas = d;
      desenharEstatisticas().then(() => {
        const ativo = document.querySelector('.segmentos__item[aria-checked="true"]');
        if (ativo) ativo.focus();
      });
    });
    g.append(b);
  }
  return g;
}

async function desenharEstatisticas() {
  const vez = ++vezPagina;
  const r = await ponte.estatisticas(diasEstatisticas);
  if (vez !== vezPagina || pagina !== 'estatisticas') return;
  const total = r && Number.isFinite(r.totalMs) ? r.totalMs : 0;

  const topo = el('div', 'resumo');
  const numero = el('div', 'resumo__numero');
  numero.append(
    el('span', 'resumo__total', formatarDuracao(total)),
    el('span', 'resumo__rotulo', `com o Claude trabalhando nos últimos ${diasEstatisticas} dias`),
  );
  topo.append(numero, seletorDias());

  const partes = [topo];
  const porGrupo = (r && r.porGrupo || []).filter((g) => g.ms > 0);
  if (!total || !porGrupo.length) {
    partes.push(el('p', 'estat-vazio', 'Ainda não há tempo registrado neste período.'));
  } else {
    const sGrupos = secao('Por grupo');
    const lista = el('ul', 'barras');
    const maior = Math.max(...porGrupo.map((g) => g.ms));
    for (const g of porGrupo) {
      const li = el('li', 'barras__linha');
      const trilho = el('span', 'barras__trilho');
      const cheio = el('span', 'barras__cheio');
      cheio.style.width = `${Math.max(1, (g.ms / maior) * 100)}%`;
      trilho.append(cheio);
      li.append(el('span', 'barras__nome', g.nome), trilho, el('span', 'barras__valor', formatarDuracao(g.ms)));
      li.title = `${g.nome}: ${Math.round((g.ms / total) * 100)}% do tempo`;
      lista.append(li);
    }
    sGrupos.append(lista);
    partes.push(sGrupos);

    const top = (r.topSessoes || []).slice(0, 5);
    if (top.length) {
      const sTop = secao('Sessões que mais trabalharam');
      const ol = el('ol', 'ranking');
      top.forEach((t, i) => {
        const li = el('li', 'ranking__linha');
        const nomes = el('span', 'ranking__nomes');
        nomes.append(el('span', 'ranking__nome', t.nome), el('span', 'ranking__grupo', t.grupoNome));
        li.append(el('span', 'ranking__pos', String(i + 1)), nomes, el('span', 'ranking__valor', formatarDuracao(t.ms)));
        ol.append(li);
      });
      sTop.append(ol);
      partes.push(sTop);
    }
  }
  $('pagina-corpo').replaceChildren(...partes);
}

// Começo: as sessões chegam pelo aoCartoes quando o main as abre.
desenhar();
