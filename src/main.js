const { app, BrowserWindow, clipboard, ipcMain, dialog, Menu, Notification, nativeImage, nativeTheme, shell } = require('electron');
const os = require('node:os');
const path = require('node:path');
const { criarGerente, textoConfirmacao, contarVermelhosDe } = require('./gerente.js');
const { abrir, prepararAmbiente, ambienteDoUsuario } = require('./pty.js');
const { criarClassificador, executarClaude } = require('./classificar.js');
const { observar } = require('./observador.js');
const { SESSOES_PADRAO } = require('./sessoes.js');
const { PALETA } = require('./projetos.js');
const { lerUso, paraTela } = require('./uso.js');
const { precisaConfirmarFechar, modeloMenuCartao, modeloMenuApp, bolinha } = require('./menus.js');
const { instanciaUnica } = require('./instancia.js');
const { dialogoFechar, dialogoSair } = require('./salvar.js');
const jarvis = require('./jarvis.js');
const { tamanhoFonteValido } = require('./config.js');
const { execFile } = require('node:child_process');

const ehDemo = process.env.ATLAS_DEMO === '1';

let janela = null;

// Já tem um Atlas aberto: ele vem para a frente e esta cópia sai antes de abrir qualquer coisa.
function trazerJanela() {
  if (!janela || janela.isDestroyed()) return;
  if (janela.isMinimized()) janela.restore();
  janela.show();
  janela.focus();
}
if (!instanciaUnica(app, { demo: ehDemo, aoSegunda: trazerJanela })) return;

// ATLAS_DEMO=1: sessões falsas, sem claude e sem tocar nos arquivos de verdade.
const demo = ehDemo ? require('./demo.js').preparar() : null;

const PASTA_EVENTOS = demo ? demo.pastaEventos : path.join(os.homedir(), '.claude', 'atlas');
// Gravado pela status line do claude (hook/instalar.py põe a linha em ~/.claude/statusline-uso.sh).
const ARQUIVO_USO = demo ? demo.arquivoUso : path.join(os.homedir(), '.claude', 'atlas', 'uso.json');
// Modo Jarvis: pasta fixa (em demo, uma temporária). A tela só manda um booleano, nunca um caminho.
const PASTA_JARVIS = demo ? demo.pastaJarvis : path.join(os.homedir(), '.claude', 'jarvis');
const matarSay = () => { execFile('killall', ['say'], () => {}); };
const usoAgora = () => paraTela(lerUso(ARQUIVO_USO, Date.now()), Date.now());

let podeFechar = false;
let perguntando = false;
// "Salvar todas e sair" escolhido: a janela fica aberta até a última sessão salvar.
let saindo = false;
const enviar = (canal, ...args) => {
  if (janela && !janela.isDestroyed()) janela.webContents.send(canal, ...args);
};

// Número de vermelhos no ícone do Dock (zero: sem número). Só troca quando muda.
let badge = null;
function atualizarDock(cartoes) {
  const n = contarVermelhosDe(cartoes);
  if (n === badge || !app.dock) return;
  badge = n;
  app.dock.setBadge(n ? String(n) : '');
}

// Traz a janela com a sessão na tela. Gerente e tela precisam ter a mesma selecionada: o
// gerente trata a selecionada com a janela em foco como vista (sem vermelho, sem aviso).
function mostrarSessao(id) {
  if (!id) return id;
  trazerJanela();
  gerente.selecionar(id);
  enviar('selecionar', id);
  return id;
}
const reabrirFechada = (id) => mostrarSessao(gerente.reabrirFechada(id));

// Aviso do Mac de uma sessão do Atlas (o avisar.py se cala dentro dele). Guardado até ser
// clicado ou fechado: sem referência o aviso pode ser coletado e o clique se perde.
const avisosAbertos = new Set();
function mostrarAviso({ sessaoId, tipo, titulo, texto: corpo }) {
  // Em demo o aviso só aparece no console: as sessões falsas não podem tocar som no Mac.
  if (demo) { console.log('aviso:', tipo, titulo, corpo); return; }
  if (!Notification.isSupported()) return;
  const aviso = new Notification({ title: titulo, body: corpo, sound: tipo === 'precisa' ? 'Glass' : 'Pop' });
  avisosAbertos.add(aviso);
  const soltar = () => avisosAbertos.delete(aviso);
  aviso.on('click', () => {
    soltar();
    mostrarSessao(sessaoId);
  });
  aviso.on('close', soltar);
  aviso.show();
}

const gerente = criarGerente({
  abrirPty: demo ? demo.abrirPty : abrir,
  agora: demo ? demo.agora : Date.now,
  pastaEventos: PASTA_EVENTOS,
  arquivoLista: demo ? demo.arquivoLista : SESSOES_PADRAO,
  aoCartoes: (cartoes) => {
    enviar('cartoes', cartoes);
    atualizarDock(cartoes);
  },
  aoDados: (id, dados) => enviar('dados', id, dados),
  // Retomar reaproveita o terminal da tela: ela limpa antes da saída nova chegar.
  aoRetomar: (id) => enviar('retomar', id),
  aoAvisar: mostrarAviso,
  aoFechadas: () => montarMenu(),
  // Haiku escolhe o grupo (em demo, sempre "Sem grupo"). `gerente` só é lido na hora da chamada.
  classificar: demo ? () => Promise.resolve(null) : criarClassificador({
    grupos: () => gerente.listarGrupos(),
    executar: (pergunta) => executarClaude(pergunta, { env: ambienteDoUsuario(), cwd: app.getPath('temp') }),
  }),
});

// ⌘+, ⌘− e ⌘0 (menu Visualizar): mesmo caminho do IPC, grava e avisa a tela.
function aplicarTamanhoFonte(n) {
  if (!tamanhoFonteValido(n)) return;
  tentar(() => {
    gerente.definirConfig({ tamanhoFonte: n });
    enviar('tamanhoFonte', n);
  });
}

// Menu do app, refeito quando a lista de fechadas muda e a cada minuto (o "há 5 min").
function montarMenu() {
  if (!app.isReady()) return;
  Menu.setApplicationMenu(Menu.buildFromTemplate(modeloMenuApp('Atlas', {
    fechadas: gerente.listarFechadas(),
    agora: Date.now(),
    reabrir: (id) => reabrirFechada(id),
    abrirConfiguracoes: () => { trazerJanela(); enviar('abrirPagina', 'configuracoes'); },
    abrirEstatisticas: () => { trazerJanela(); enviar('abrirPagina', 'estatisticas'); },
    microfone: () => enviar('microfone'),
    tamanhoFonte: () => gerente.lerConfig().tamanhoFonte,
    definirTamanhoFonte: (n) => aplicarTamanhoFonte(n),
  })));
}

// Ambiente do usuário (PATH do ~/.zshrc etc.), perguntado uma vez ao zsh. Em demo não precisa.
const ambientePronto = demo ? Promise.resolve() : prepararAmbiente();

const texto = (v) => (typeof v === 'string' ? v : '');
const curto = (v, max) => typeof v === 'string' && v.length <= max;
const ehId = (v) => curto(v, 64) && v !== '';
const NOME_GRUPO_MAX = 40;
const DESCRICAO_GRUPO_MAX = 200;
// Erro de validação vira texto para a tela mostrar (ex.: "nome inválido").
const tentar = (fn) => {
  try { return { ok: true, valor: fn() }; } catch (err) { return { ok: false, erro: String(err && err.message ? err.message : err) }; }
};
const cartao = (id) => gerente.listar().find((c) => c.id === id);
const icone = (cor) => nativeImage.createFromBitmap(bolinha(cor, 28), { width: 28, height: 28, scaleFactor: 2 });

// Diálogo nativo; devolve o índice do botão. Em demo o autoteste pode responder sozinho
// (demo.responder devolve o índice, ou null para mostrar o diálogo de verdade).
async function perguntar({ message, detail, buttons, defaultId, cancelId }) {
  if (demo) {
    const i = demo.responder({ message, detail, buttons, defaultId, cancelId });
    if (i != null) return i;
  }
  const opcoes = { type: 'warning', message, buttons, defaultId, cancelId };
  if (detail) opcoes.detail = detail;
  const { response } = await dialog.showMessageBox(janela, opcoes);
  return response;
}

// Sessão não salva: Salvar e fechar (digita /salvar e fecha quando o turno terminar),
// Fechar sem salvar ou Cancelar. Este diálogo vale no lugar do "Fechar esta sessão?".
async function pedirFechar(id) {
  const c = cartao(id);
  if (!c) return false;
  if (!c.salva) {
    const d = dialogoFechar(c);
    const acao = d.acoes[await perguntar(d)];
    if (acao === 'salvar') gerente.salvarEFechar(id);
    if (acao !== 'fechar') return false;
    gerente.fechar(id);
    return true;
  }
  if (precisaConfirmarFechar(c)) {
    const { response } = await dialog.showMessageBox(janela, {
      type: 'warning',
      message: 'Fechar esta sessão?',
      detail: 'O que ela está fazendo será interrompido.',
      buttons: ['Fechar', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
    });
    if (response !== 0) return false;
  }
  gerente.fechar(id);
  return true;
}

ipcMain.handle('listar', () => gerente.listar());
// Como uma aba nova do Terminal: sempre na pasta pessoal.
ipcMain.handle('nova', () => gerente.nova(os.homedir()));
ipcMain.handle('selecionar', (_e, id) => gerente.selecionar(texto(id)));
ipcMain.handle('retomar', (_e, id) => gerente.retomar(texto(id)));
ipcMain.handle('recomecar', (_e, id) => gerente.recomecar(texto(id)));
ipcMain.handle('escrever', (_e, id, dados) => gerente.escrever(texto(id), texto(dados)));
ipcMain.handle('microfone', () => gerente.microfone());
// Miniatura da imagem colada ou arrastada, para a faixa acima da caixa do claude. Só lê:
// o claude pega a imagem de verdade sozinho (⌃V lê a área de transferência, o caminho vira
// imagem). Volta um data URL pequeno ou null.
const LADO_MINIATURA = 256;
function emMiniatura(img) {
  if (!img || img.isEmpty()) return null;
  const { width, height } = img.getSize();
  const escala = Math.min(1, LADO_MINIATURA / Math.max(width, height));
  const menor = escala < 1 ? img.resize({ width: Math.round(width * escala), height: Math.round(height * escala), quality: 'good' }) : img;
  return menor.toDataURL();
}
// No Electron 45 a área de transferência é a da web: clipboard.read() devolve itens, e a
// imagem vem como Blob (não há mais clipboard.readImage()).
ipcMain.handle('miniaturaDaArea', async () => {
  try {
    // PNG e JPEG primeiro (os que o nativeImage lê de um buffer); um tipo que não abre passa
    // para o seguinte.
    const ordem = (t) => (t === 'image/png' ? 0 : t === 'image/jpeg' ? 1 : 2);
    for (const item of await clipboard.read()) {
      const tipos = item.types.filter((t) => t.startsWith('image/')).sort((a, b) => ordem(a) - ordem(b));
      for (const tipo of tipos) {
        try {
          const blob = await item.getType(tipo);
          const miniatura = emMiniatura(nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer())));
          if (miniatura) return miniatura;
        } catch { /* esse tipo não abriu: tenta o próximo */ }
      }
    }
  } catch { /* área de transferência ilegível */ }
  return null;
});
ipcMain.handle('miniaturaDoArquivo', async (_e, caminho) => {
  const c = texto(caminho);
  if (!path.isAbsolute(c) || !/\.(png|jpe?g|gif|webp)$/i.test(c)) return null;
  try { return emMiniatura(await nativeImage.createThumbnailFromPath(c, { width: LADO_MINIATURA, height: LADO_MINIATURA })); } catch { return null; }
});
ipcMain.handle('redimensionar', (_e, id, cols, rows) => gerente.redimensionar(texto(id), cols, rows));
ipcMain.handle('renomear', (_e, id, nome) => {
  if (nome === null || curto(nome, 80)) gerente.renomear(texto(id), nome);
});
ipcMain.handle('definirTitulo', (_e, id, titulo) => {
  if (curto(titulo, 200)) gerente.definirTitulo(texto(id), titulo);
});
ipcMain.handle('trocarCor', (_e, id, cor) => {
  if (PALETA.includes(cor)) gerente.trocarCor(texto(id), cor);
});
ipcMain.handle('uso', () => usoAgora());
ipcMain.handle('listarGrupos', () => gerente.listarGrupos());
ipcMain.handle('criarGrupo', (_e, nome) => {
  if (!curto(nome, NOME_GRUPO_MAX)) return { ok: false, erro: 'nome inválido' };
  return tentar(() => gerente.criarGrupo(nome));
});
ipcMain.handle('renomearGrupo', (_e, id, nome) => {
  if (!ehId(id)) return { ok: false, erro: 'grupo não encontrado' };
  if (!curto(nome, NOME_GRUPO_MAX)) return { ok: false, erro: 'nome inválido' };
  return tentar(() => gerente.renomearGrupo(id, nome));
});
ipcMain.handle('descreverGrupo', (_e, id, descricao) => {
  if (!ehId(id)) return { ok: false, erro: 'grupo não encontrado' };
  if (!curto(descricao, DESCRICAO_GRUPO_MAX)) return { ok: false, erro: 'descrição inválida' };
  return tentar(() => gerente.descreverGrupo(id, descricao));
});
ipcMain.handle('apagarGrupo', (_e, id) => {
  if (ehId(id)) gerente.apagarGrupo(id);
});
ipcMain.handle('moverParaGrupo', (_e, sessaoId, grupoId) => {
  if (ehId(sessaoId) && (grupoId === null || ehId(grupoId))) gerente.moverParaGrupo(sessaoId, grupoId);
});
ipcMain.handle('listarFechadas', () => gerente.listarFechadas());
ipcMain.handle('reabrirFechada', (_e, id) => {
  if (id === undefined || id === null) return reabrirFechada();
  return ehId(id) ? reabrirFechada(id) : null;
});
ipcMain.handle('estatisticas', (_e, dias) => (dias === 7 || dias === 30 ? gerente.estatisticas(dias) : null));
ipcMain.handle('contarVermelhos', () => gerente.contarVermelhos());
// Página aberta cobre o terminal: a selecionada deixa de contar como na tela.
ipcMain.handle('marcarPagina', (_e, aberta) => {
  if (typeof aberta === 'boolean') gerente.marcarPagina(aberta);
});
ipcMain.handle('lerConfig', () => gerente.lerConfig());
ipcMain.handle('definirConfig', (_e, cfg) => {
  if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) return;
  const novo = {};
  if (cfg.classificar !== undefined) {
    if (typeof cfg.classificar !== 'boolean') return;
    novo.classificar = cfg.classificar;
  }
  if (cfg.tamanhoFonte !== undefined) {
    if (!tamanhoFonteValido(cfg.tamanhoFonte)) return;
    novo.tamanhoFonte = cfg.tamanhoFonte;
  }
  if (!Object.keys(novo).length) return;
  return tentar(() => {
    gerente.definirConfig(novo);
    if (novo.tamanhoFonte !== undefined) enviar('tamanhoFonte', novo.tamanhoFonte);
  });
});
ipcMain.handle('lerJarvis', () => ({ ligado: jarvis.estaLigado(PASTA_JARVIS), voz: jarvis.vozAtual(PASTA_JARVIS) }));
ipcMain.handle('definirJarvis', (_e, ligado) => {
  if (typeof ligado !== 'boolean') return;
  return tentar(() => {
    if (ligado) jarvis.ligar(PASTA_JARVIS);
    else jarvis.desligar(PASTA_JARVIS, demo ? undefined : matarSay);
    return jarvis.estaLigado(PASTA_JARVIS);
  });
});
ipcMain.handle('pedirFechar', (_e, id) => pedirFechar(texto(id)));
ipcMain.handle('menuCartao', (_e, id) => {
  const c = cartao(texto(id));
  if (!c || !janela) return;
  Menu.buildFromTemplate(modeloMenuCartao(c, {
    paleta: PALETA,
    icone,
    renomear: (sid) => enviar('renomear', sid), // a edição é no próprio cartão
    trocarCor: (sid, cor) => gerente.trocarCor(sid, cor),
    retomar: (sid) => gerente.retomar(sid),
    recomecar: (sid) => gerente.recomecar(sid),
    fechar: (sid) => pedirFechar(sid),
    grupos: gerente.listarGrupos(),
    moverParaGrupo: (sid, gid) => gerente.moverParaGrupo(sid, gid),
    naoFechar: (sid) => gerente.naoFechar(sid),
  })).popup({ window: janela });
});

function criarJanela() {
  janela = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 420,
    title: 'Atlas',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 14 },
    // Translúcida como o perfil Clear Dark do Terminal: desfoque nativo do que está atrás,
    // só com a janela ativa (followWindow tira o desfoque quando ela perde o foco). O grafite
    // em opacidade parcial vem da tela (tela.css, --opacidade-vidro).
    backgroundColor: '#00000000',
    vibrancy: 'under-window',
    visualEffectState: 'followWindow',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  // Nada de navegar para fora da tela nem abrir janelas: link vai para o navegador.
  janela.webContents.on('will-navigate', (e) => e.preventDefault());
  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // Sessões só abrem com a tela pronta, para ela receber a saída desde o começo.
  janela.webContents.once('did-finish-load', async () => {
    await ambientePronto; // nunca rejeita; no pior caso espera ~5 s
    gerente.restaurar();
    if (demo) demo.depoisDeRestaurar(gerente, janela);
  });
  if (demo) janela.webContents.on('console-message', (e) => console.log('tela:', e.message));
  janela.loadFile(path.join(__dirname, 'tela', 'index.html'));
  janela.on('focus', () => gerente.marcarFoco(true));
  janela.on('blur', () => gerente.marcarFoco(false));
  janela.on('close', async (e) => {
    if (podeFechar) return;
    // Em demo não pergunta, a não ser com ATLAS_DEMO_RESPOSTA (fechar|cancelar, e no diálogo
    // das não salvas também salvar|sair) ou com o autoteste respondendo (demo.responder).
    const respostaDemo = demo ? process.env.ATLAS_DEMO_RESPOSTA : undefined;
    const naoSalvas = gerente.contarNaoSalvas();
    if (naoSalvas > 0) {
      e.preventDefault();
      pedirSair(naoSalvas, respostaDemo);
      return;
    }
    if (saindo) {
      // Nenhuma não salva com a espera ainda em curso: nada a perguntar ("0 sessões"), sai.
      e.preventDefault();
      saindo = false;
      gerente.cancelarSair();
      sairDeVez();
      return;
    }
    const n = gerente.contarAtivas();
    if (n === 0 || (demo && !respostaDemo)) { podeFechar = true; return; }
    e.preventDefault();
    if (perguntando) return; // já tem uma confirmação aberta (ex.: SIGTERM repetido)
    perguntando = true;
    let response;
    try {
      if (respostaDemo) {
        console.log('confirmacao:', textoConfirmacao(n), 'resposta:', respostaDemo);
        response = respostaDemo === 'fechar' ? 0 : 1;
      } else {
        ({ response } = await dialog.showMessageBox(janela, {
          type: 'warning',
          message: textoConfirmacao(n),
          buttons: ['Fechar', 'Cancelar'],
          defaultId: 1,
          cancelId: 1,
        }));
      }
    } finally {
      perguntando = false;
    }
    if (response === 0) {
      podeFechar = true;
      janela.close();
    }
  });
  janela.on('closed', () => { janela = null; });
}

function sairDeVez() {
  podeFechar = true;
  if (janela && !janela.isDestroyed()) janela.close();
  else app.quit();
}

// A espera acabou. Sobrou não salva (rascunho na caixa, claude que saiu e voltou, pedido
// novo no meio): o diálogo volta com as que restam, em vez de sair.
function fimDoSalvarTodas() {
  saindo = false;
  const n = gerente.contarNaoSalvas();
  // Sem a resposta fixa do demo: "salvar" de novo entraria em laço com um rascunho.
  if (n > 0) pedirSair(n, undefined);
  else sairDeVez();
}

const RESPOSTA_DEMO_SAIR = { salvar: 'salvar', sair: 'sair', fechar: 'sair', cancelar: 'cancelar' };

// Sessões não salvas na saída (⌘Q, fechar a janela, SIGTERM). Salvar todas e sair digita o
// /salvar em todas e sai quando a última terminar. Um segundo ⌘Q durante a espera mostra o
// diálogo de novo: Salvar todas e sair segue esperando, Sair sem salvar sai na hora e
// Cancelar desiste de sair (o /salvar já digitado continua). Com o diálogo aberto, ignorado.
async function pedirSair(naoSalvas, respostaDemo) {
  if (perguntando) return;
  if (!(naoSalvas > 0)) { sairDeVez(); return; }
  const d = dialogoSair(naoSalvas, gerente.contarRascunhos(), gerente.contarFalhas());
  let acao;
  perguntando = true;
  try {
    if (respostaDemo && RESPOSTA_DEMO_SAIR[respostaDemo]) {
      console.log('confirmacao:', d.message, 'resposta:', respostaDemo);
      acao = RESPOSTA_DEMO_SAIR[respostaDemo];
    } else if (demo) {
      const i = demo.responder(d);
      acao = i == null ? 'sair' : d.acoes[i]; // demo sem resposta: sai sem perguntar, como antes
    } else {
      acao = d.acoes[await perguntar(d)];
    }
  } finally {
    perguntando = false;
  }
  if (podeFechar) return; // a última terminou enquanto o diálogo estava aberto
  if (acao === 'sair') {
    sairDeVez();
  } else if (acao === 'salvar') {
    saindo = true;
    gerente.salvarTodas(fimDoSalvarTodas);
  } else if (saindo) {
    saindo = false;
    gerente.cancelarSair();
  }
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark'; // o desfoque nativo escuro mesmo com o Mac no modo claro
  montarMenu();
  observar(PASTA_EVENTOS, (id) => gerente.aoMudarEventos(id));
  setInterval(() => {
    gerente.recalcular(); // 3 min sem ver e 90 s sem sinal
    enviar('uso', usoAgora());
  }, 5000);
  setInterval(montarMenu, 60000);
  criarJanela();
});

// SIGTERM (o atualizar.sh fecha o Atlas assim) passa pelo mesmo caminho do botão fechar:
// com sessão ativa, a janela pergunta antes; Cancelar mantém tudo aberto.
process.on('SIGTERM', () => {
  if (janela && !janela.isDestroyed()) janela.close();
  else app.quit();
});

// Janela única: fechou a janela, encerra os ptys e sai.
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => gerente.encerrarTudo());
