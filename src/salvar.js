// Sessão salva com o /salvar: o último pedido da conversa é /salvar e o Claude terminou esse
// turno. Sem nenhum pedido não há o que salvar. Sem Electron aqui: o main e o gerente usam.
const { encerraVez } = require('./estado.js');

// /salvar com ou sem argumentos (o texto do evento é o começo do pedido).
const ehSalvar = (texto) => typeof texto === 'string' && /^\/salvar(\s|$)/.test(texto.trimStart());

// Fases: 'nada' (sem pedido), 'pedido' (o último pedido não é /salvar), 'salvando' (o /salvar
// está rodando) e 'salva' (o turno do /salvar terminou). Incremental: o gerente guarda só a
// fase, então o resultado não depende de quantos eventos ficaram na memória.
// Só o stop da conversa principal salva. A vez do /salvar que acaba de outro jeito não
// terminou o registro: o idle_prompt sem stop (Esc no meio, aprovação recusada) e a falha_stop
// (erro da API, como o limite do plano) voltam a 'pedido'. Fim de um subagente (com agente)
// não encerra o turno da conversa principal.
function passoSalvar(fase, ev) {
  if (!ev || typeof ev !== 'object') return fase;
  if (ev.tipo === 'prompt') return ehSalvar(ev.texto) ? 'salvando' : 'pedido';
  if (fase === 'salvando' && encerraVez(ev) && ev.agente == null) return ev.tipo === 'stop' ? 'salva' : 'pedido';
  return fase;
}

const faseSalvar = (eventos, inicial = 'nada') => eventos.reduce(passoSalvar, inicial);
const faseSalva = (fase) => fase === 'nada' || fase === 'salva';
const estaSalva = (eventos) => faseSalva(faseSalvar(eventos));

// Estimativa do que está na caixa de texto do claude, tecla a tecla do que o usuário manda
// ao pty: número de caracteres, ou null quando não dá para saber (o lado seguro: bloqueia).
// Zeram: Enter, ⌃C e ⌃U. Texto soma (colado também, sem os marcadores). Backspace tira 1.
// Sequências com Esc (setas, ⌥←/→, ⇧Tab, foco, posição do cursor, Esc) não mexem, menos ↑ e ↓
// com a caixa vazia (histórico).
// Desconhecida até zerar: ⌥⌫ e ⌃W (apagam uma palavra), Tab (completa), ⌃K e ⌃Y (cortam e
// colam), ⌃G (editor), ⌃R (histórico) e ⌃V (cola imagem).
const COLAR_INICIO = '\x1b[200~';
const COLAR_FIM = '\x1b[201~';
// ↑ e ↓ na caixa vazia trazem um pedido antigo do histórico: a conta fica desconhecida. Com
// texto (ou já desconhecida), só movem o cursor.
const HISTORICO = new Set(['A', 'B']);
const DESCONHECIDA = new Set(['\x17', '\t', '\x0b', '\x19', '\x07', '\x12', '\x16']);

function passoCaixa(n, texto) {
  const s = String(texto);
  let i = 0;
  const somar = (k) => { if (n !== null) n += k; };
  while (i < s.length) {
    if (s.startsWith(COLAR_INICIO, i)) {
      const fim = s.indexOf(COLAR_FIM, i + COLAR_INICIO.length);
      const colado = s.slice(i + COLAR_INICIO.length, fim < 0 ? s.length : fim);
      somar([...colado].length);
      i = fim < 0 ? s.length : fim + COLAR_FIM.length;
      continue;
    }
    const c = s[i];
    if (c === '\x1b') {
      const d = s[i + 1];
      if (d === '\x7f') { n = null; i += 2; continue; } // ⌥⌫
      if (d === '[') { // CSI: parâmetros e um byte final
        let j = i + 2;
        while (j < s.length && !/[@-~]/.test(s[j])) j++;
        if (j === i + 2 && HISTORICO.has(s[j]) && n === 0) n = null;
        i = j + 1;
      } else if (d === 'O') {
        if (HISTORICO.has(s[i + 2]) && n === 0) n = null;
        i += 3; // SS3 (setas em modo aplicação)
      } else if (d === ']') { // OSC até BEL ou ST
        let j = i + 2;
        while (j < s.length && s[j] !== '\x07' && !(s[j] === '\x1b' && s[j + 1] === '\\')) j++;
        i = j + (s[j] === '\x07' ? 1 : 2);
      } else {
        i += d === undefined ? 1 : 2; // Esc sozinho ou ⌥ + tecla
      }
      continue;
    }
    if (c === '\r' || c === '\x03' || c === '\x15') n = 0;
    else if (c === '\x7f' || c === '\x08') { if (n !== null) n = Math.max(0, n - 1); }
    else if (DESCONHECIDA.has(c)) n = null;
    else if (c === '\n' || c >= ' ') somar(1);
    // outros controles (⌃A, ⌃E, ⌃L...) só movem ou redesenham
    // Par substituto (emoji) é um caractere só: pula a segunda metade.
    i += c >= '\ud800' && c <= '\udbff' ? 2 : 1;
  }
  return n;
}

const temTextoNaCaixa = (n) => n === null || n > 0;

const textoRascunhos = (n) => `Há texto pela metade na caixa de ${n} ${n === 1 ? 'sessão' : 'sessões'}. Apague com ⌃U e tente de novo.`;

// Diálogos nativos (message, buttons, defaultId, cancelId) e a ação de cada botão.
function dialogoFechar(cartao) {
  const encerrada = Boolean(cartao && cartao.estado && cartao.estado.cor === 'preto');
  if (encerrada) {
    return {
      message: 'Esta sessão não foi salva e o Claude já saiu.',
      buttons: ['Fechar sem salvar', 'Cancelar'],
      acoes: ['fechar', 'cancelar'],
      defaultId: 1,
      cancelId: 1,
    };
  }
  return {
    message: 'Esta sessão não foi salva.',
    buttons: ['Salvar e fechar', 'Fechar sem salvar', 'Cancelar'],
    acoes: ['salvar', 'fechar', 'cancelar'],
    defaultId: 0,
    cancelId: 2,
  };
}

const textoNaoSalvas = (n) => (n === 1 ? '1 sessão não foi salva.' : `${n} sessões não foram salvas.`);

const textoFalhas = (n) => `O /salvar não terminou em ${n} ${n === 1 ? 'sessão' : 'sessões'}. Salvar todas e sair tenta de novo.`;

function dialogoSair(n, rascunhos = 0, falhas = 0) {
  const detalhes = [rascunhos > 0 ? textoRascunhos(rascunhos) : '', falhas > 0 ? textoFalhas(falhas) : ''].filter(Boolean);
  return {
    message: textoNaoSalvas(n),
    detail: detalhes.length ? detalhes.join(' ') : undefined,
    buttons: ['Salvar todas e sair', 'Sair sem salvar', 'Cancelar'],
    acoes: ['salvar', 'sair', 'cancelar'],
    defaultId: 0,
    cancelId: 2,
  };
}

module.exports = { passoCaixa, temTextoNaCaixa, textoRascunhos, ehSalvar, passoSalvar, faseSalvar, faseSalva, estaSalva, dialogoFechar, dialogoSair, textoNaoSalvas };
