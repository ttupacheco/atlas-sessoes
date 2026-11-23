// Modelos dos menus nativos (sem Electron aqui: o main transforma com Menu.buildFromTemplate).
const { FONTE_MIN, FONTE_MAX, FONTE_PADRAO } = require('./config.js');

const NOMES_CORES = {
  '#7f9bb5': 'Azul',
  '#6fa597': 'Verde-água',
  '#93a86b': 'Oliva',
  '#c9a45c': 'Ocre',
  '#c47f5e': 'Terracota',
  '#b9788c': 'Rosa',
  '#8f86b3': 'Lavanda',
  '#9a958b': 'Pedra',
};

// Verde (pronta), preto (encerrada) ou claude que nem carregou (abrindo, confirme a pasta):
// nada a perder, fecha direto.
const ABRINDO = new Set(['abrindo', 'confirme a pasta']);

function precisaConfirmarFechar(cartao) {
  const estado = (cartao && cartao.estado) || {};
  if (ABRINDO.has(estado.rotulo)) return false;
  return estado.cor !== 'verde' && estado.cor !== 'preto';
}

// `grupos` (lista do gerente) liga o "Mover para grupo": os grupos e "Sem grupo", com o atual marcado.
function modeloMenuCartao(cartao, { paleta, icone = () => undefined, renomear, trocarCor, retomar, recomecar, fechar, grupos, moverParaGrupo, naoFechar = () => {} }) {
  const atual = String(cartao.cor).toLowerCase();
  const itens = [{ label: 'Renomear', click: () => renomear(cartao.id) }, {
    label: 'Trocar cor',
    submenu: paleta.map((cor) => ({
      label: NOMES_CORES[cor] || cor,
      type: 'checkbox',
      checked: cor === atual,
      icon: icone(cor),
      click: () => trocarCor(cartao.id, cor),
    })),
  }];
  if (Array.isArray(grupos)) {
    const atualGrupo = grupos.some((g) => g.id === cartao.grupoId) ? cartao.grupoId : null;
    const item = (id, label) => ({ label, type: 'checkbox', checked: id === atualGrupo, click: () => moverParaGrupo(cartao.id, id) });
    itens.push({
      label: 'Mover para grupo',
      submenu: [...grupos.map((g) => item(g.id, g.nome)), ...(grupos.length ? [{ type: 'separator' }] : []), item(null, 'Sem grupo')],
    });
  }
  if (cartao.estado.cor === 'preto') itens.push({ label: 'Retomar', click: () => retomar(cartao.id) });
  if (cartao.estado.cor === 'preto' && cartao.podeRecomecar) {
    itens.push({ label: 'Começar conversa nova', click: () => recomecar(cartao.id) });
  }
  itens.push({ type: 'separator' });
  // Salvar e fechar esperando o fim do /salvar: dá para desistir de fechar.
  if (cartao.salvando === 'fechar') itens.push({ label: 'Não fechar', click: () => naoFechar(cartao.id) });
  itens.push({ label: 'Fechar sessão', click: () => fechar(cartao.id) });
  return itens;
}

const MIN = 60000;

// Há quanto tempo a sessão foi fechada, para o menu "Fechadas recentemente".
function tempoRelativo(ms) {
  const min = Math.floor(Math.max(0, ms) / MIN);
  if (min < 1) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'há 1 dia' : `há ${d} dias`;
}

// Menu do app: o padrão do macOS sem ⌘W (fechar janela) e sem ⌘R (recarregar),
// que ficam com a tela ou apagariam os terminais. O menu Editar dá ⌘Z, ⌘X, ⌘C, ⌘V e ⌘A
// ao campo do nome; no terminal o xterm trata as teclas antes (⌘A seleciona a tela, não
// manda nada ao claude). ⌘⇧T, ⌘,, ⌘⇧E e ⌘D são do Atlas: o Terminal nunca passa ⌘ ao claude.
function modeloMenuApp(nome, {
  fechadas = [], agora = Date.now(), reabrir = () => {}, abrirConfiguracoes = () => {}, abrirEstatisticas = () => {}, microfone = () => {},
  tamanhoFonte = () => FONTE_PADRAO, definirTamanhoFonte = () => {},
} = {}) {
  // Cada passo é 1, sempre dentro de 10 a 24 (o main recusa o que sair disso).
  const passo = (d) => () => definirTamanhoFonte(Math.max(FONTE_MIN, Math.min(FONTE_MAX, tamanhoFonte() + d)));
  const recentes = fechadas.length
    ? fechadas.map((f) => ({ label: `${f.nome} · ${tempoRelativo(agora - f.fechadaEm)}`, click: () => reabrir(f.id) }))
    : [{ label: 'Nenhuma', enabled: false }];
  return [
    {
      label: nome,
      submenu: [
        { role: 'about', label: `Sobre o ${nome}` },
        { type: 'separator' },
        { label: 'Configurações…', accelerator: 'CmdOrCtrl+,', click: () => abrirConfiguracoes() },
        { type: 'separator' },
        { role: 'hide', label: `Ocultar ${nome}` },
        { role: 'hideOthers', label: 'Ocultar outros' },
        { role: 'unhide', label: 'Mostrar tudo' },
        { type: 'separator' },
        { role: 'quit', label: `Sair do ${nome}` },
      ],
    },
    {
      label: 'Arquivo',
      submenu: [
        { label: 'Reabrir sessão fechada', accelerator: 'CmdOrCtrl+Shift+T', enabled: fechadas.length > 0, click: () => reabrir() },
        { label: 'Fechadas recentemente', submenu: recentes },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Desfazer' },
        { role: 'redo', label: 'Refazer' },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { role: 'selectAll', label: 'Selecionar tudo' },
        { type: 'separator' },
        // /voice no modo tap: ⌘D começa a gravar; de novo, para e envia.
        { label: 'Microfone (falar / enviar)', accelerator: 'CmdOrCtrl+D', click: () => microfone() },
      ],
    },
    {
      // Sem os papéis de zoom do Electron: ⌘+ e ⌘− mexem só no texto do terminal, não na interface.
      label: 'Visualizar',
      submenu: [
        { label: 'Aumentar texto', accelerator: 'CmdOrCtrl+Plus', click: passo(1) },
        // ⌘= é a mesma tecla do + no teclado, sem o ⇧: escondido, só para responder a ela.
        { label: 'Aumentar texto (⌘=)', accelerator: 'CmdOrCtrl+=', visible: false, click: passo(1) },
        { label: 'Diminuir texto', accelerator: 'CmdOrCtrl+-', click: passo(-1) },
        { label: 'Tamanho padrão do texto', accelerator: 'CmdOrCtrl+0', click: () => definirTamanhoFonte(FONTE_PADRAO) },
      ],
    },
    {
      label: 'Janela',
      submenu: [
        { role: 'minimize', label: 'Minimizar' },
        { role: 'zoom', label: 'Zoom' },
        { role: 'togglefullscreen', label: 'Tela cheia' },
        { type: 'separator' },
        { label: 'Estatísticas', accelerator: 'CmdOrCtrl+Shift+E', click: () => abrirEstatisticas() },
      ],
    },
  ];
}

// Bolinha colorida em BGRA (pré-multiplicado), para o ícone dos itens da paleta.
function bolinha(hex, lado) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const buf = Buffer.alloc(lado * lado * 4);
  const c = lado / 2;
  const raio = lado / 2 - 1;
  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      const dist = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      const a = Math.max(0, Math.min(1, raio - dist + 0.5));
      const i = (y * lado + x) * 4;
      buf[i] = Math.round(b * a);
      buf[i + 1] = Math.round(g * a);
      buf[i + 2] = Math.round(r * a);
      buf[i + 3] = Math.round(255 * a);
    }
  }
  return buf;
}

module.exports = { NOMES_CORES, precisaConfirmarFechar, modeloMenuCartao, modeloMenuApp, bolinha, tempoRelativo };
