// Modo demonstração (ATLAS_DEMO=1): sessões falsas para ver e testar a tela sem rodar o claude.
// Usa uma pasta temporária: não toca em sessoes.json nem ~/.claude/atlas.
//   ATLAS_CAPTURA=<arquivo.png>  tira um print ~2 s depois de abrir e sai
//   ATLAS_DEMO_JS=<código>       roda na tela antes do print (ex.: abrir a edição do nome de um cartão)
//   ATLAS_DEMO_TAMANHO=<LxA>     tamanho da janela
//   ATLAS_DEMO_TESTE=1           manda teclas de verdade para a tela, imprime o que o pty recebeu e sai
//                                (os diálogos do /salvar são respondidos pelo próprio autoteste)
//                                (inclui o liga/desliga do Modo Jarvis, numa pasta temporária,
//                                 e o tamanho do texto: ⌘+ vai a 14 com resize no pty, ⌘0 volta a 13)
//   ATLAS_DEMO_USO=<uso.json>    uso do plano lido deste arquivo (sem ele: um falso, 5 h a 42% e semana a 87%)
const { app, clipboard, Menu } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOME = os.homedir();
const MIN = 60000;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// Painel começa sem título (o pty falso põe um depois, com o terminal escondido); Geral é
// uma sessão de antes desta versão, sem nome, título nem cor.
const SESSOES = [
  { id: 'pedidos01', pasta: HOME, titulo: 'Etiqueta com CNPJ da filial', cor: '#7f9bb5', grupoId: 'gpedidos' },
  { id: 'impostos001', pasta: HOME, titulo: 'Publicar conferência por item', cor: '#6fa597', grupoId: 'gimpostos' },
  { id: 'notas1', pasta: path.join(HOME, 'Documents', 'Notas'), nome: 'Notas', titulo: 'Resumo da call da contabilidade', cor: '#93a86b', grupoId: 'ggeral' },
  { id: 'painel01', pasta: HOME, cor: '#c9a45c', grupoId: 'gvendas' },
  { id: 'geral001', pasta: HOME },
  { id: 'pedidos02', pasta: HOME, titulo: 'E-mail de Pronto para Envio', cor: '#b9788c', grupoId: 'gpedidos' },
];

// Os grupos iniciais com ids fixos (o autoteste e os prints se referem a eles).
const { GRUPOS_INICIAIS, DESCRICOES_INICIAIS } = require('./grupos.js');
const GRUPOS = GRUPOS_INICIAIS.map((nome) => ({
  id: 'g' + nome.toLowerCase().normalize('NFD').replace(/[^a-z]/g, ''),
  nome,
  descricao: DESCRICOES_INICIAIS[nome] || '',
}));

// Histórico falso para as Estatísticas: [sessão, nome, grupo, minutos, dias atrás]. Sessões
// que não estão abertas contam pela cópia do nome e do grupo.
const HISTORICO = [
  ['pedidos01', 'Etiqueta com CNPJ da filial', 'gpedidos', 140, 0.1],
  ['pedidos01', 'Etiqueta com CNPJ da filial', 'gpedidos', 95, 1],
  ['pedidos02', 'E-mail de Pronto para Envio', 'gpedidos', 120, 2],
  ['velha001', 'Devolução com vale-troca', 'gpedidos', 45, 4],
  ['impostos001', 'Publicar conferência por item', 'gimpostos', 110, 0.2],
  ['velha002', 'Guia de imposto do Paraná', 'gimpostos', 80, 3],
  ['velha003', 'DRE de outubro', 'gfinanceiro', 70, 2.5],
  ['velha003', 'DRE de outubro', 'gfinanceiro', 40, 5],
  ['painel01', 'Faturamento de novembro', 'gvendas', 55, 1.5],
  ['notas1', 'Notas', 'ggeral', 35, 0.5],
  ['geral001', 'Geral', null, 20, 6],
  ['velha004', 'Plano de mídia de dezembro', 'gmarketing', 160, 12],
  ['velha005', 'Fechamento de setembro', 'gfinanceiro', 210, 20],
  ['velha002', 'Guia de imposto do Paraná', 'gimpostos', 90, 15],
];

const titulo = (t) => `\x1b]0;${t}\x07`;

const PEDIDOS = {
  pedidos01: 'ajustar a etiqueta do pedido com brinde para sair com o CNPJ da filial',
  impostos001: 'rodar o build e publicar a correção da conferência por item',
  notas1: 'resumir a call de ontem com a contabilidade e salvar em Sessões',
  painel01: 'conferir se o faturamento de novembro bate com o painel de Vendas',
  geral001: 'listar os arquivos grandes da pasta Downloads',
  pedidos02: 'investigar por que o e-mail de Pronto para Envio não saiu',
};

// Eventos relativos a "agora" (minutos atrás), no formato do hook.
function eventos(id, t0) {
  const m = (min) => t0 - min * MIN;
  const p = (min) => ({ t: m(min), tipo: 'prompt', texto: PEDIDOS[id], session_id: 'demo-' + id });
  switch (id) {
    case 'pedidos01': return [p(2), { t: m(1.5), tipo: 'pre_tool', ferramenta: 'Edit' }];
    case 'impostos001': return [p(6), { t: m(1), tipo: 'permissao', ferramenta: 'Bash' }];
    case 'notas1': return [p(12), { t: m(1), tipo: 'stop', session_id: 'demo-' + id }];
    case 'painel01': return [p(20), { t: m(8), tipo: 'stop', session_id: 'demo-' + id }];
    case 'geral001': return [p(40), { t: m(35), tipo: 'stop', session_id: 'demo-' + id }];
    case 'pedidos02': return [p(4)];
    default: return [];
  }
}

const COR = { laranja: '\x1b[38;2;215;119;87m', cinza: '\x1b[90m', negrito: '\x1b[1m', fim: '\x1b[0m', verde: '\x1b[32m', azul: '\x1b[34m', amarelo: '\x1b[33m', vermelho: '\x1b[31m' };

// Caixa de largura fixa (as cores ANSI não contam na largura).
function caixa(titulo, linhas, largura = 56) {
  const visivel = (t) => t.replace(/\x1b\[[0-9;]*m/g, '').length;
  const topo = titulo ? `╭─ ${titulo} ${'─'.repeat(largura - titulo.length - 3)}╮` : `╭${'─'.repeat(largura)}╮`;
  return [
    COR.laranja + topo + COR.fim,
    ...linhas.map((t) => `${COR.laranja}│${COR.fim} ${t}${' '.repeat(Math.max(0, largura - 1 - visivel(t)))}${COR.laranja}│${COR.fim}`),
    `${COR.laranja}╰${'─'.repeat(largura)}╯${COR.fim}`,
  ];
}

function telaFalsa(s) {
  if (!PEDIDOS[s.id]) return telaNova(s);
  const l = [];
  const pasta = s.pasta.replace(HOME, '~');
  l.push(...caixa(null, [`${COR.laranja}✻${COR.fim} ${COR.negrito}Claude Code${COR.fim} (demonstração do Atlas, sem claude)`, `  ${COR.cinza}cwd: ${pasta}${COR.fim}`]));
  l.push('');
  l.push(`${COR.cinza}>${COR.fim} ${PEDIDOS[s.id]}`);
  l.push('');
  if (s.id === 'impostos001') {
    l.push(`${COR.verde}⏺${COR.fim} Vou rodar o build antes de publicar.`);
    l.push('');
    l.push(...caixa('Bash', [' npm run build && vercel --prod', '', ' Quer rodar este comando?', ` ${COR.azul}❯ 1. Sim${COR.fim}`,
      '   2. Sim, e não perguntar de novo', '   3. Não, e dizer o que fazer diferente (esc)']));
  } else {
    l.push(`${COR.verde}⏺${COR.fim} Vou olhar os arquivos envolvidos.`);
    l.push(`  ${COR.cinza}⎿  Leu src/etiqueta/gerar.ts (212 linhas)${COR.fim}`);
    l.push(`${COR.verde}⏺${COR.fim} ${COR.negrito}Update${COR.fim}(src/etiqueta/gerar.ts)`);
    l.push(`  ${COR.cinza}⎿${COR.fim}  ${COR.vermelho}-  const cnpj = MATRIZ.cnpj;${COR.fim}`);
    l.push(`     ${COR.verde}+  const cnpj = pedido.temBrinde ? FILIAL.cnpj : MATRIZ.cnpj;${COR.fim}`);
    l.push('');
    l.push(`${COR.laranja}✶${COR.fim} Trabalhando… ${COR.cinza}(esc para interromper)${COR.fim}`);
  }
  l.push('');
  let cores = '';
  for (let i = 0; i < 16; i++) cores += `\x1b[48;5;${i}m  `;
  l.push(`${cores}${COR.fim}  ${COR.cinza}cores ANSI 0 a 15${COR.fim}  acentuação: ção, ê, à, ü`);
  l.push(`${COR.cinza}${pasta} · Opus · 42% do contexto · status line${COR.fim}`);
  // Liga o bracketed paste, como o claude faz.
  return '\x1b[?2004h' + l.join('\r\n') + '\r\n';
}

// Sessão aberta pelo ⌘T: só a caixa de boas-vindas, como o claude recém aberto.
function telaNova(s) {
  const pasta = s.pasta.replace(HOME, '~');
  return '\x1b[?2004h' + titulo('✳ Claude Code') + caixa(null, [`${COR.laranja}✻${COR.fim} ${COR.negrito}Claude Code${COR.fim} (demonstração do Atlas, sem claude)`, `  ${COR.cinza}cwd: ${pasta}${COR.fim}`]).join('\r\n') + '\r\n\r\n';
}

// Eco legível do que chega ao pty: caractere comum aparece, controle vira ^X.
function eco(s) {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '\r') out += '\r\n';
    else if (ch === '\x7f') out += '\b \b';
    else if (c < 32) out += `${COR.amarelo}^${String.fromCharCode(c + 64)}${COR.fim}`;
    else out += ch;
  }
  return out;
}

function preparar() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-demo-'));
  const pastaEventos = path.join(base, 'eventos');
  fs.mkdirSync(pastaEventos);
  // Armazenamento da tela (localStorage dos blocos recolhidos) também na pasta temporária:
  // sem isto o demo dividiria a pasta do Atlas de verdade (atlas e Atlas são a mesma no Mac).
  app.setPath('userData', path.join(base, 'userData'));
  // Modo Jarvis numa pasta temporária: o ~/.claude/jarvis de verdade nunca é tocado.
  const pastaJarvis = path.join(base, 'jarvis');
  fs.mkdirSync(pastaJarvis);
  fs.writeFileSync(path.join(pastaJarvis, 'voz'), 'Luciana\n');
  const arquivoLista = path.join(base, 'sessoes.json');
  const t = Date.now();
  let arquivoUso = process.env.ATLAS_DEMO_USO;
  if (!arquivoUso) {
    arquivoUso = path.join(base, 'uso.json');
    fs.writeFileSync(arquivoUso, JSON.stringify({
      five_hour: { used_percentage: 42, resets_at: Math.floor((t + (2 * 60 + 5) * MIN + 30000) / 1000) },
      seven_day: { used_percentage: 87, resets_at: new Date(t + ((3 * 24 + 4) * 60 + 10) * MIN).toISOString() },
      t,
    }));
  }
  fs.writeFileSync(arquivoLista, JSON.stringify(SESSOES.map((s, i) => ({ ...s, criadoEm: t - 3600000 + i, claudeSessionId: null, grupoManual: Boolean(s.grupoId) }))));
  fs.writeFileSync(path.join(base, 'grupos.json'), JSON.stringify(GRUPOS));
  fs.writeFileSync(path.join(base, 'historico.jsonl'), HISTORICO.map(([sessaoId, nome, grupoId, min, dias]) => {
    const fim = Math.round(t - dias * 24 * 60 * MIN);
    return JSON.stringify({ sessaoId, nome, grupoId, inicio: fim - min * MIN, fim }) + '\n';
  }).join(''));

  // Começa uma hora atrás: os eventos "de minutos atrás" contam como desta execução.
  let atraso = 3600000;
  const agora = () => Date.now() - atraso;
  const recebido = {};
  const redimensionados = {}; // id -> [[cols, rows], ...] que o pty falso recebeu
  const saidas = {}; // id -> aoDados (o autoteste manda títulos por aqui)
  const chamadasTitulo = {}; // id -> vezes que a tela mandou definirTitulo
  // Diálogos nativos respondidos sem mostrar: o autoteste põe na fila o botão que escolhe.
  const respostas = [];
  const dialogos = []; // { message, buttons, escolha } de cada diálogo respondido

  // Índice do botão escolhido, ou null (fila vazia: o main mostra o diálogo de verdade).
  function responder({ message, detail, buttons, cancelId }) {
    if (!respostas.length) return null;
    const escolha = respostas.shift();
    dialogos.push({ message, detail, buttons, escolha });
    console.log('dialogo:', ...[message, detail && `(${detail})`, JSON.stringify(buttons)].filter(Boolean), 'resposta:', escolha);
    const i = buttons.indexOf(escolha);
    return i >= 0 ? i : cancelId;
  }

  function abrirPty(sessao, cfg, aoDados, aoSair) {
    recebido[sessao.id] = '';
    saidas[sessao.id] = aoDados;
    // Sessão nova: o claude põe o título da conversa com o spinner na frente, quadro a quadro.
    if (!PEDIDOS[sessao.id]) {
      ['⠂', '⠐', '⠂', '⠐', '✳'].forEach((q, i) => setTimeout(() => aoDados(titulo(`${q} Conferir Impostos`)), 500 + i * 80));
    }
    // Painel: o título chega com o terminal escondido.
    if (sessao.id === 'painel01') setTimeout(() => aoDados(titulo('✳ Faturamento de novembro')), 1200);
    // Pedidos 2 fica muda (sem saída nem evento: vira "sem sinal"); Geral encerra.
    if (sessao.id !== 'pedidos02') setTimeout(() => aoDados(telaFalsa(sessao)), 50);
    if (sessao.id === 'geral001') {
      setTimeout(() => {
        aoDados(`${COR.cinza}Sessão encerrada pelo usuário (/exit).${COR.fim}\r\n`);
        aoSair(0);
      }, 300);
    }
    return {
      escrever: (s) => { recebido[sessao.id] += s; aoDados(eco(s)); },
      redimensionar: (cols, rows) => { (redimensionados[sessao.id] = redimensionados[sessao.id] || []).push([cols, rows]); },
      matar: () => {},
    };
  }

  function depoisDeRestaurar(gerente, janela) {
    atraso = 0;
    const definir = gerente.definirTitulo;
    gerente.definirTitulo = (id, t) => {
      chamadasTitulo[id] = (chamadasTitulo[id] || 0) + 1;
      return definir(id, t);
    };
    const tam = /^(\d+)x(\d+)$/.exec(process.env.ATLAS_DEMO_TAMANHO || '');
    if (tam) janela.setSize(Number(tam[1]), Number(tam[2]));
    // Os eventos chegam depois que a tela escolheu o primeiro cartão (Pedidos).
    setTimeout(() => {
      const t0 = Date.now();
      for (const s of SESSOES) {
        fs.writeFileSync(path.join(pastaEventos, s.id + '.jsonl'), eventos(s.id, t0).map((e) => JSON.stringify(e)).join('\n') + '\n');
        gerente.aoMudarEventos(s.id);
      }
    }, 800);
    if (process.env.ATLAS_DEMO_TESTE === '1') {
      setTimeout(() => autoteste(janela, { gerente, recebido, redimensionados, saidas, chamadasTitulo, arquivoLista, respostas, dialogos, pastaEventos, pastaJarvis })
        .finally(() => app.quit()), 1800);
    } else if (process.env.ATLAS_CAPTURA) {
      setTimeout(async () => {
        try {
          if (process.env.ATLAS_DEMO_JS) await janela.webContents.executeJavaScript(process.env.ATLAS_DEMO_JS);
          await espera(500);
          const img = await janela.webContents.capturePage();
          fs.writeFileSync(process.env.ATLAS_CAPTURA, img.toPNG());
          console.log('captura:', process.env.ATLAS_CAPTURA);
        } catch (err) {
          console.error('captura falhou:', err);
        }
        app.quit();
      }, 2200);
    }
  }

  return { pastaEventos, pastaJarvis, arquivoLista, arquivoUso, agora, abrirPty, depoisDeRestaurar, responder };
}

// Teclas de verdade pela fila de entrada do Chromium, como se o usuário digitasse.
async function autoteste(janela, { gerente, recebido, redimensionados, saidas, chamadasTitulo, arquivoLista, respostas, dialogos, pastaEventos, pastaJarvis }) {
  const wc = janela.webContents;
  const js = (codigo) => wc.executeJavaScript(codigo);
  const tecla = async (keyCode, modifiers = []) => {
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await espera(80);
  };
  const letra = async (ch) => { wc.sendInputEvent({ type: 'char', keyCode: ch }); await espera(40); };
  const r = {};
  // ⌘A e ⌘Z chegam ao menu Editar pelo macOS (equivalente de teclado), caminho que o
  // sendInputEvent não percorre; o item do menu chama este mesmo comando da página.
  const comandoEditar = async (nome) => { wc[nome](); await espera(80); };
  janela.focus();
  wc.focus();
  await js('terminais.get(selecionadaId).term.focus()');
  r.selecionadaInicial = await js('selecionadaId');

  await letra('o'); await letra('i'); await letra('ç'); await letra('ã');
  await tecla('Escape');
  await tecla('Up'); await tecla('Down'); await tecla('Left'); await tecla('Right');
  await tecla('c', ['control']);
  await tecla('Enter');
  const longo = 'texto colado '.repeat(40).trim();
  await clipboard.writeText(longo);
  wc.paste();
  await espera(200);
  r.pty = JSON.stringify(recebido[r.selecionadaInicial]);
  r.coladoComBracketedPaste = recebido[r.selecionadaInicial].includes('\x1b[200~' + longo + '\x1b[201~');

  await tecla('2', ['meta']);
  r.depoisDeCmd2 = await js('selecionadaId');
  r.segundoCartao = await js('ordemVisual[1]');
  r.primeiroCartao = await js('ordemVisual[0]');
  await tecla('1', ['meta']);
  r.depoisDeCmd1 = await js('selecionadaId');

  await js('terminais.get(selecionadaId).term.selectAll()');
  await clipboard.writeText('');
  wc.copy();
  await espera(200);
  r.copiado = (await clipboard.readText()).split('\n')[0].slice(0, 60);

  // ⌘A no terminal (menu Editar > Selecionar tudo) não manda nada ao claude.
  const sel = r.depoisDeCmd1;
  await js('terminais.get(selecionadaId).term.clearSelection(); terminais.get(selecionadaId).term.focus()');
  const antesA = recebido[sel].length;
  await tecla('a', ['meta']);
  await tecla('z', ['meta']);
  await comandoEditar('selectAll');
  await comandoEditar('undo');
  await espera(150);
  r.cmdAeCmdZNaoMandamNadaAoPty = recebido[sel].length === antesA;
  r.focoSegueNoTerminal = await js('document.activeElement && document.activeElement.classList.contains("xterm-helper-textarea")');
  // ⌥ é Meta, como no perfil do Terminal: ⌥B manda ESC b; ⌥← manda ESC b também (palavra para trás).
  const antesAlt = recebido[sel].length;
  await tecla('b', ['alt']);
  await tecla('Left', ['alt']);
  r.opcaoComoMeta = JSON.stringify(recebido[sel].slice(antesAlt));

  // Grupos: ⌘1 a ⌘9 seguem a ordem da tela e pulam os blocos recolhidos.
  r.blocos = await js('[...document.querySelectorAll("#cartoes .bloco")].map((b) => b.querySelector(".bloco__nome").textContent + ":" + b.querySelectorAll(".cartao").length)');
  const primeiroBloco = await js('[...document.querySelectorAll("#cartoes .bloco")][0].querySelectorAll(".cartao").length');
  await js('document.querySelector("#cartoes .bloco__titulo").click()');
  await espera(100);
  r.recolhidoGuardado = await js('localStorage.getItem(CHAVE_RECOLHIDOS)');
  const esperadoCmd1 = await js(`[...document.querySelectorAll("#cartoes .bloco")][1].querySelector(".cartao") && ordemVisual[0]`);
  await tecla('1', ['meta']);
  r.cmd1PulouRecolhido = (await js('selecionadaId')) === esperadoCmd1 && (await js('ordemVisual.length')) === (await js('cartoes.length')) - primeiroBloco;
  await js('document.querySelector("#cartoes .bloco__titulo").click()');
  await espera(100);
  const primeiroDeVolta = await js('ordemVisual[0]');
  await tecla('1', ['meta']);
  r.cmd1DeVolta = (await js('selecionadaId')) === primeiroDeVolta && (await js('ordemVisual.length')) === (await js('cartoes.length'));
  await js('terminais.get(selecionadaId).term.focus()');
  // Clique de verdade (mouse) no título do bloco: o foco volta ao terminal, e Espaço e Enter
  // seguintes vão para o claude, sem abrir e fechar o bloco.
  const clicarTitulo = async () => {
    const [x, y] = await js('(() => { const b = document.querySelector("#cartoes .bloco__titulo").getBoundingClientRect(); return [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)]; })()');
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    await espera(150);
  };
  const recolhidosAntes = await js('JSON.stringify([...recolhidos])');
  await clicarTitulo();
  r.cliqueNoBlocoRecolheu = (await js('JSON.stringify([...recolhidos])')) !== recolhidosAntes;
  r.cliqueNoBlocoDevolveFoco = await js('document.activeElement === terminais.get(selecionadaId).term.textarea');
  const selBloco = await js('selecionadaId');
  const antesEspaco = recebido[selBloco].length;
  const recolhidosDepois = await js('JSON.stringify([...recolhidos])');
  await letra(' ');
  await tecla('Enter');
  r.espacoEEnterVaoAoClaude = recebido[selBloco].slice(antesEspaco) === ' \r' &&
    (await js('JSON.stringify([...recolhidos])')) === recolhidosDepois;
  await clicarTitulo();
  r.cliqueNoBlocoAbriuDeNovo = (await js('JSON.stringify([...recolhidos])')) === recolhidosAntes;
  await js('terminais.get(selecionadaId).term.focus()');

  // Mover para grupo (o menu chama isto): Geral sai de "Sem grupo" e entra em Pedidos.
  gerente.moverParaGrupo('geral001', 'gpedidos');
  await espera(300);
  r.movidoParaPedidos = await js('[...document.querySelectorAll("#cartoes .bloco")].find((b) => b.querySelector(".bloco__nome").textContent === "Pedidos").contains(botoes.get("geral001").b)');
  r.semGrupoSumiuVazio = await js('![...document.querySelectorAll("#cartoes .bloco__nome")].some((n) => n.textContent === "Sem grupo")');

  const cartaoDeId = (id) => js(`cartoes.find((c) => c.id === ${JSON.stringify(id)}).nome`);
  // Páginas: ⌘, (o menu manda abrirPagina). Tecla na página não chega ao pty; Esc volta ao terminal.
  wc.send('abrirPagina', 'configuracoes');
  await espera(400);
  r.paginaConfiguracoes = await js('pagina + " " + document.querySelectorAll(".atalhos tr").length + " linhas, " + document.querySelectorAll(".grupos .grupo").length + " grupos"');
  // Modo Jarvis: clique na chave liga e desliga o arquivo na pasta temporária.
  const jChave = 'document.querySelector(\'.chave[aria-label="Modo Jarvis"]\')';
  const jArq = path.join(pastaJarvis, 'ligado');
  r.jarvisInicial = await js(`${jChave}.getAttribute('aria-checked')`) + ' ' + fs.existsSync(jArq);
  r.jarvisVoz = await js('[...document.querySelectorAll(".opcao__texto")].map((e) => e.textContent).find((t) => t.startsWith("Voz:"))');
  await js(`${jChave}.click()`);
  await espera(200);
  r.jarvisLigou = await js(`${jChave}.getAttribute('aria-checked')`) + ' ' + fs.existsSync(jArq);
  await js(`${jChave}.click()`);
  await espera(200);
  r.jarvisDesligou = await js(`${jChave}.getAttribute('aria-checked')`) + ' ' + fs.existsSync(jArq);
  const atras = await js('selecionadaId');
  const antesPagina = recebido[atras].length;
  await letra('x');
  await tecla('Enter');
  r.teclaNaPaginaNaoVaiAoPty = recebido[atras].length === antesPagina;
  // Nome repetido: erro na própria linha, em português.
  await js('(() => { const c = document.querySelectorAll(".grupos .grupo__nome")[1]; c.focus(); c.value = "Pedidos"; })()');
  await tecla('Enter');
  await espera(200);
  r.erroNomeRepetido = await js('document.querySelectorAll(".grupos .grupo__erro")[1].textContent');
  await tecla('Escape'); // desfaz o campo; a página continua
  r.escNoCampoDesfez = await js('pagina === "configuracoes" && document.querySelectorAll(".grupos .grupo__nome")[1].value');
  await tecla('Escape');
  await espera(100);
  r.escVoltouAoTerminal = await js('pagina === null && document.activeElement.classList.contains("xterm-helper-textarea")');
  wc.send('abrirPagina', 'estatisticas');
  await espera(400);
  r.estatisticas = await js('document.querySelector(".resumo__total").textContent + " | " + [...document.querySelectorAll(".barras__linha")].map((l) => l.textContent).join(", ")');
  // Botão de gráfico ao lado da engrenagem: fecha a página e o clique abre as Estatísticas.
  await tecla('Escape');
  await espera(150);
  await js('document.getElementById("botao-estatisticas").click()');
  await espera(400);
  r.botaoEstatisticasAbre = await js('pagina === "estatisticas" && document.getElementById("botao-estatisticas").classList.contains("botao-engrenagem--ativo") && !document.getElementById("botao-engrenagem").classList.contains("botao-engrenagem--ativo") && !!document.querySelector(".resumo__total")');
  // Renomear com a página aberta: Esc cancela o nome e a página fica.
  wc.send('renomear', 'notas1');
  await espera(200);
  await letra('z');
  await tecla('Escape');
  await espera(200);
  r.escNoNomeComPaginaSoCancela = (await js('pagina === "estatisticas" && editando === null')) && (await cartaoDeId('notas1')) === 'Notas';
  // Seleção vinda do main (aviso, ⌘⇧T) num bloco recolhido abre o bloco.
  await js('if (!recolhidos.has("gvendas")) alternarBloco("gvendas"); 0');
  wc.send('selecionar', 'painel01');
  await espera(300);
  r.selecaoAbriuBlocoRecolhido = await js('selecionadaId === "painel01" && !recolhidos.has("gvendas") && ordemVisual.includes("painel01") && !localStorage.getItem(CHAVE_RECOLHIDOS).includes("gvendas")');
  wc.send('abrirPagina', 'estatisticas');
  await espera(300);
  await tecla('w', ['meta']);
  await espera(150);
  r.cmdWNaPaginaSoFechaAPagina = (await js('pagina === null')) && (await js('cartoes.length')) === (await js('ordemVisual.length'));
  const aindaVivos = await js('cartoes.length');
  r.cmdWNaoFechouSessao = aindaVivos === SESSOES.length;

  // ⌘T: sessão nova na hora, na pasta pessoal, como "Novo", sem lista.
  const antesT = recebido[r.depoisDeCmd1].length;
  const totalAntesT = await js('cartoes.length');
  await tecla('t', ['meta']);
  await espera(150);
  const nova = await js('selecionadaId');
  const cartaoDe = (id) => js(`(() => { const c = cartoes.find((x) => x.id === ${JSON.stringify(id)}); return c && { nome: c.nome, pasta: c.pasta, cor: c.cor }; })()`);
  r.cmdTCriouSessao = (await js('cartoes.length')) === totalAntesT + 1 && nova !== r.depoisDeCmd1;
  r.novaComeca = await cartaoDe(nova);
  r.novaNaPastaPessoal = r.novaComeca.pasta === HOME;
  r.semListaDeProjetos = await js('!document.getElementById("nova")');
  r.ptyNaoRecebeuCmdT = recebido[r.depoisDeCmd1].length === antesT;
  r.coresDasSessoes = await js('cartoes.map((c) => c.cor)');

  // O pty falso manda o título com o spinner (5 quadros): o cartão vira "Conferir Impostos".
  await espera(1500);
  r.novaDepoisDoTitulo = (await cartaoDe(nova)).nome;
  r.definirTituloChamadas = chamadasTitulo[nova] || 0;
  r.tituloDaJanela = janela.getTitle();
  r.cabecalho = await js('document.getElementById("cab-nome").textContent + " | " + document.getElementById("cab-pasta").textContent');
  r.painelEscondidoGanhouTitulo = (await cartaoDe('painel01')).nome;
  r.geralAntigaGanhouCor = await js('(() => { const c = cartoes.find((x) => x.id === "geral001"); return c.nome + " " + c.cor; })()');

  // Renomear pelo menu (o item "Renomear" manda este mesmo aviso à tela).
  const salvo = (id) => (JSON.parse(fs.readFileSync(arquivoLista, 'utf8')).find((s) => s.id === id) || {});
  const renomear = async () => { wc.send('renomear', nova); await espera(200); };
  await renomear();
  r.campoAbriuComNome = await js('document.activeElement.className === "cartao__editar" && document.activeElement.value');
  for (const ch of 'Minha sessão') await letra(ch);
  await tecla('Enter');
  await espera(300);
  r.renomeado = (await cartaoDe(nova)).nome;
  r.renomeadoNoArquivo = salvo(nova).nome;
  r.focoVoltouAoTerminal = await js('document.activeElement && document.activeElement.classList.contains("xterm-helper-textarea")');
  saidas[nova](titulo('⠂ Outro assunto'));
  saidas[nova](titulo('✳ Outro assunto'));
  await espera(600);
  r.manualVenceTitulo = (await cartaoDe(nova)).nome;
  r.tituloGuardado = salvo(nova).titulo;
  await renomear();
  for (const ch of 'xyz') await letra(ch);
  await tecla('Escape');
  await espera(300);
  r.escCancelou = (await cartaoDe(nova)).nome;
  await renomear();
  await tecla('Backspace');
  await tecla('Enter');
  await espera(300);
  r.vazioVoltouAoAutomatico = (await cartaoDe(nova)).nome;
  r.ptyNaoRecebeuONome = !recebido[nova].includes('Minha') && !recebido[nova].includes('xyz');

  // ⌘A no campo do nome seleciona o texto (menu Editar): digitar troca tudo.
  await renomear();
  await tecla('End'); // tira a seleção que o campo abre
  await letra('!');
  r.campoSemSelecaoAntes = await js('document.activeElement.value.endsWith("!")');
  await comandoEditar('selectAll');
  await letra('Q');
  r.cmdANoCampoSelecionouTudo = await js('document.activeElement.className === "cartao__editar" && document.activeElement.value');
  await tecla('Escape');
  await espera(200);

  // Atalhos do app não agem com o nome em edição.
  await renomear();
  const totalEditando = await js('cartoes.length');
  await tecla('w', ['meta']);
  await tecla('t', ['meta']);
  await tecla('2', ['meta']);
  await espera(300);
  r.atalhosIgnoradosAoRenomear = (await js('cartoes.length')) === totalEditando
    && (await js('selecionadaId')) === nova
    && (await js('document.activeElement.className === "cartao__editar"'));
  await tecla('Escape');
  await espera(200);

  // Spinner rápido (quadro a cada 100 ms, sem parar): o cartão muda enquanto os quadros chegam.
  const quadros = [];
  for (let i = 0; i < 40; i++) quadros.push(`${i % 2 ? '⠐' : '⠂'} ${i < 20 ? 'Spinner rápido' : 'Texto novo'}`);
  let q = 0;
  const giro = setInterval(() => { if (q < quadros.length) saidas[nova](titulo(quadros[q++])); }, 100);
  await espera(1000);
  r.spinnerRapidoNoQuadro = q;
  r.spinnerRapidoNomeNoMeio = (await cartaoDe(nova)).nome;
  await espera(2000);
  r.spinnerRapidoTextoNovoNoQuadro = q;
  r.spinnerRapidoTextoNovo = (await cartaoDe(nova)).nome;
  clearInterval(giro);

  // Mesmo botão depois de uma atualização do main (a cada 5 s): clique e foco não se perdem.
  await js('window.__cartaoAntes = document.querySelector("#cartoes .cartao")');
  await espera(5600);
  r.cartaoMesmoNoDepoisDe5s = await js('document.querySelector("#cartoes .cartao") === window.__cartaoAntes');

  // Retomar limpa o terminal antes da saída nova (a mensagem de encerrada some).
  const textoDe = (id) => js(`(() => { const b = terminais.get(${JSON.stringify(id)}).term.buffer.active; const l = []; for (let i = 0; i < b.length; i++) l.push(b.getLine(i).translateToString(true)); return l.join("\\n"); })()`);
  r.geralEncerradaAntes = (await textoDe('geral001')).includes('Sessão encerrada');
  await js('ponte.retomar("geral001")');
  await espera(150); // a tela falsa sai em 50 ms; a mensagem de encerrada só em 300 ms
  const depoisRetomar = await textoDe('geral001');
  r.retomarLimpouOTerminal = !depoisRetomar.includes('Sessão encerrada') && depoisRetomar.includes('Claude Code');

  // Erro no dispose de um terminal não trava a lista.
  await js('terminais.get("pedidos02").term.dispose = () => { throw new Error("teste") }; 0');
  gerente.fechar('pedidos02');
  await espera(300);
  r.listaSegueDepoisDeDisposeComErro = await js('!cartoes.some((c) => c.id === "pedidos02") && document.querySelectorAll("#cartoes .cartao").length === cartoes.length');

  // /salvar: "não salva" em Pedra na linha do estado; Salvar e fechar digita e espera.
  const evento = (id, ev) => {
    fs.appendFileSync(path.join(pastaEventos, id + '.jsonl'), JSON.stringify({ t: Date.now(), ...ev }) + '\n');
    gerente.aoMudarEventos(id);
  };
  const salvarDoCartao = (id) => js(`(() => { const s = botoes.get(${JSON.stringify(id)}).b.querySelector(".cartao__salvar"); return s ? s.textContent : ""; })()`);
  r.naoSalvaNoCartao = await salvarDoCartao('notas1');
  r.rotulosSemCorte = await js('[...document.querySelectorAll(".cartao__rotulo")].every((e) => e.scrollWidth <= e.clientWidth)');
  r.naoSalvaEmPedra = await js(`(() => { const s = botoes.get("notas1").b.querySelector(".cartao__salvar"); const p = document.createElement("span"); p.style.color = "var(--pedra)"; document.body.append(p); const ok = getComputedStyle(s).color === getComputedStyle(p).color; p.remove(); return ok; })()`);
  r.novaSemPedidoNaoPedeSalvar = (await salvarDoCartao(nova)) === '';
  // antesDoCmdW: teclas de verdade no terminal antes do ⌘W (o usuário escreve, apaga, ⌃C).
  const cmdWEm = async (id, botao, antesDoCmdW = async () => {}) => {
    wc.send('selecionar', id);
    await espera(200);
    await js('terminais.get(selecionadaId).term.focus()');
    await antesDoCmdW();
    if (botao) respostas.push(botao);
    await tecla('w', ['meta']);
    await espera(400); // o Enter vai 150 ms depois do texto
  };
  // No Painel o autoteste só mandou ⌥B e ⌥← (não mexem na caixa). Escreve "xyz": rascunho,
  // nada é digitado. Apagando os 3, a nova tentativa digita.
  await cmdWEm('painel01', 'Salvar e fechar', async () => { for (const ch of 'xyz') await letra(ch); });
  let antes = recebido.painel01.length;
  r.rascunhoNaoDigitou = !recebido.painel01.includes('/salvar');
  r.rascunhoNoCartao = await salvarDoCartao('painel01');
  r.rascunhoCartaoSegueAberto = await js('cartoes.some((c) => c.id === "painel01")');
  await cmdWEm('painel01', 'Salvar e fechar', async () => { for (let i = 0; i < 2; i++) await tecla('Backspace'); });
  r.aindaSobraUmBloqueia = !recebido.painel01.includes('/salvar');
  antes = recebido.painel01.length + 1; // o último Backspace
  const nDialogos = dialogos.length + 1;
  await cmdWEm('painel01', 'Salvar e fechar', () => tecla('Backspace'));
  r.dialogoFechar = dialogos[nDialogos] && `${dialogos[nDialogos].message} ${JSON.stringify(dialogos[nDialogos].buttons)}`;
  r.salvarEFecharDigitou = JSON.stringify(recebido.painel01.slice(antes));
  r.cartaoSalvandoEFechando = await salvarDoCartao('painel01');
  gerente.naoFechar('painel01'); // menu do cartão > Não fechar
  await espera(200);
  r.naoFecharVoltouANaoSalva = await salvarDoCartao('painel01');
  evento('painel01', { tipo: 'prompt', texto: '/salvar', session_id: 'demo-painel01' });
  evento('painel01', { tipo: 'stop', session_id: 'demo-painel01' });
  await espera(200);
  r.naoFecharDeixouAbertoESalvo = (await js('cartoes.some((c) => c.id === "painel01")')) && (await salvarDoCartao('painel01')) === '';
  // Salva: ⌘W fecha sem diálogo nenhum.
  const dialogosAntesSalva = dialogos.length;
  await cmdWEm('painel01');
  r.salvaFechouSemDialogo = !(await js('cartoes.some((c) => c.id === "painel01")')) && dialogos.length === dialogosAntesSalva;
  // Aprovação aberta: o Enter aprovaria, nada é digitado até a resposta.
  antes = recebido.impostos001.length;
  await cmdWEm('impostos001', 'Salvar e fechar');
  r.comAprovacaoNaoDigitou = recebido.impostos001.length === antes && (await salvarDoCartao('impostos001')) === 'salvando e fechando';
  gerente.naoFechar('impostos001');
  // Trabalhando: nada é digitado até o fim da vez. No fim, a caixa tem o texto que o
  // autoteste digitou lá no começo: rascunho. Apagado, a nova tentativa digita.
  antes = recebido.pedidos01.length;
  await cmdWEm('pedidos01', 'Salvar e fechar');
  r.trabalhandoNaoDigitou = recebido.pedidos01.length === antes;
  evento('pedidos01', { tipo: 'stop', session_id: 'demo-pedidos01' }); // fim do pedido de antes
  await espera(400);
  // (o texto colado lá no começo, depois do ⌃C, ficou na caixa)
  r.rascunhoNoFimDaVez = recebido.pedidos01.length === antes && (await salvarDoCartao('pedidos01'));
  antes = recebido.pedidos01.length + 1; // o ⌃C
  await cmdWEm('pedidos01', 'Salvar e fechar', () => tecla('c', ['control']));
  r.digitouDepoisDoCtrlC = JSON.stringify(recebido.pedidos01.slice(antes));
  r.stopDoPedidoAnteriorNaoFechou = await js('cartoes.some((c) => c.id === "pedidos01")');
  evento('pedidos01', { tipo: 'prompt', texto: '/salvar', session_id: 'demo-pedidos01' });
  evento('pedidos01', { tipo: 'stop', session_id: 'demo-pedidos01' });
  await espera(200);
  r.fechouDepoisDoSalvar = !(await js('cartoes.some((c) => c.id === "pedidos01")'));

  const verde = await js('ordemVisual.findIndex((id) => cartoes.find((c) => c.id === id).estado.cor === "verde")');
  const total = await js('cartoes.length');
  await tecla(String(verde + 1), ['meta']);
  // ⌘W repetido (tecla segurada) não faz nada; só o primeiro toque fecha.
  await tecla('w', ['meta', 'isAutoRepeat']);
  await espera(200);
  r.cmdWRepetidoIgnorado = (await js('cartoes.length')) === total;
  respostas.push('Fechar sem salvar');
  await tecla('w', ['meta']);
  await espera(300);
  r.cmdWNaoSalvaPerguntouEFechouSemSalvar = (await js('cartoes.length')) === total - 1 &&
    dialogos[dialogos.length - 1].escolha === 'Fechar sem salvar';
  r.selecionadaDepoisDeFechar = await js('selecionadaId');

  // Tamanho do texto: ⌘+ e ⌘0 do menu de verdade (o sendInputEvent não passa pelo menu do macOS,
  // então chama o click do item). Todo terminal muda e o pty recebe colunas e linhas novas.
  const menuItem = (acc) => {
    const achar = (itens) => { for (const i of itens) { if (i.accelerator === acc) return i; const f = i.submenu && achar(i.submenu.items); if (f) return f; } return null; };
    return achar(Menu.getApplicationMenu().items);
  };
  const tamanhoDe = () => js('terminais.get(selecionadaId).term.options.fontSize');
  const idFonte = await js('selecionadaId');
  const antesFonte = (redimensionados[idFonte] || []).length;
  r.fonteInicial = await tamanhoDe();
  menuItem('CmdOrCtrl+Plus').click();
  await espera(400);
  r.fonteDepoisDeCmdMais = await tamanhoDe();
  r.fonteDeTodosOsTerminais = await js('[...terminais.values()].every((t) => t.term.options.fontSize === 14)');
  r.ptyRecebeuResize = (redimensionados[idFonte] || []).length > antesFonte;
  r.fonteGravada = gerente.lerConfig().tamanhoFonte;
  menuItem('CmdOrCtrl+0').click();
  await espera(400);
  r.fonteDepoisDeCmd0 = await tamanhoDe();
  r.fonteGravadaDepoisDeCmd0 = gerente.lerConfig().tamanhoFonte;

  console.log('AUTOTESTE ' + JSON.stringify(r, null, 2));

  // Sair com não salvas: Salvar todas e sair digita em todas e só sai depois da última.
  const s = {};
  // A sessão do ⌘T ganha um pedido: são duas não salvas, uma delas com aprovação aberta.
  evento(nova, { tipo: 'prompt', texto: 'conferir o Impostos de hoje', session_id: 'demo-nova' });
  evento(nova, { tipo: 'stop', session_id: 'demo-nova' });
  await espera(200);
  const vivasNaoSalvas = () => gerente.listar().filter((c) => !c.salva && c.estado.cor !== 'preto').map((c) => c.id);
  const alvo = vivasNaoSalvas();
  s.naoSalvasAoSair = alvo;
  const antesSair = Object.fromEntries(alvo.map((id) => [id, recebido[id].length]));
  gerente.escrever(nova, 'meio pedido'); // rascunho na caixa da sessão do ⌘T
  respostas.push('Salvar todas e sair');
  janela.close(); // o mesmo caminho do ⌘Q e do SIGTERM
  await espera(400);
  s.rascunhoNaoDigitou = !recebido[nova].slice(antesSair[nova]).includes('/salvar') && (await salvarDoCartao(nova)) === 'rascunho na caixa, apague com ⌃U e tente de novo';
  s.dialogoSair = `${dialogos[dialogos.length - 1].message} ${JSON.stringify(dialogos[dialogos.length - 1].buttons)}`;
  s.janelaSegueAberta = !janela.isDestroyed();
  s.digitado = Object.fromEntries(alvo.map((id) => [id, recebido[id].slice(antesSair[id])]));
  s.cartoesSalvando = await js('[...document.querySelectorAll(".cartao__salvar")].filter((e) => e.textContent === "salvando").length');
  // Segundo ⌘Q durante a espera: o diálogo aparece de novo; Salvar todas e sair segue esperando.
  const nAntes = dialogos.length;
  respostas.push('Salvar todas e sair');
  janela.close();
  await espera(200);
  s.segundoCmdQMostrouDeNovo = dialogos.length === nAntes + 1 && !janela.isDestroyed();
  s.detalheDoRascunho = dialogos[dialogos.length - 1].detail;
  // A aprovação do Impostos é respondida e a vez termina: só então o /salvar é digitado nela.
  evento('impostos001', { tipo: 'post_tool', ferramenta: 'Bash' });
  await espera(300);
  s.impostosTrabalhandoNaoDigitou = recebido.impostos001.length === (antesSair.impostos001 || 0);
  evento('impostos001', { tipo: 'stop', session_id: 'demo-impostos001' });
  await espera(400);
  s.impostosDigitouDepoisDaResposta = recebido.impostos001.slice(antesSair.impostos001 || 0);
  // O Impostos termina o /salvar; o fim da espera volta ao diálogo por causa do rascunho.
  const nAntesVolta = dialogos.length;
  respostas.push('Cancelar');
  evento('impostos001', { tipo: 'prompt', texto: '/salvar', session_id: 'demo-impostos001' });
  evento('impostos001', { tipo: 'stop', session_id: 'demo-impostos001' });
  await espera(300);
  const volta = dialogos[nAntesVolta];
  s.dialogoVoltouComORascunho = volta ? `${volta.message} (${volta.detail})` : null;
  s.cancelarNaoSaiu = !janela.isDestroyed();
  // O usuário apaga com ⌃C e sai de novo: agora digita e sai quando o /salvar termina.
  gerente.escrever(nova, '\x03');
  const antesNova = recebido[nova].length;
  respostas.push('Salvar todas e sair');
  janela.close();
  await espera(400);
  s.digitouDepoisDeLimpar = recebido[nova].slice(antesNova).endsWith('/salvar\r');
  const ultima = nova;
  s.esperaAUltima = !janela.isDestroyed();
  app.once('will-quit', () => {
    s.saiuDepoisDaUltima = true;
    console.log('AUTOTESTE-SAIR ' + JSON.stringify(s, null, 2));
  });
  setTimeout(() => {
    console.log('AUTOTESTE-SAIR falhou, não saiu: ' + JSON.stringify(s, null, 2));
    app.exit(1);
  }, 5000);
  evento(ultima, { tipo: 'prompt', texto: '/salvar', session_id: 'demo-' + ultima });
  evento(ultima, { tipo: 'stop', session_id: 'demo-' + ultima });
  await new Promise(() => {}); // o app sai pelo Salvar todas e sair, não pelo fim do autoteste
}

module.exports = { preparar };
