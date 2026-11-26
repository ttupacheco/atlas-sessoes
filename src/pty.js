// Um pty por sessão, rodando `claude` pelo zsh de login, com o ambiente do usuário.
//
// Aberto pelo Dock, pela Mesa ou depois de reiniciar, o app só recebe o ambiente mínimo do
// launchd (PATH=/usr/bin:/bin:/usr/sbin:/sbin), e o PATH do claude (~/.local/bin) e o do
// gcloud estão no ~/.zshrc, que um zsh de login não interativo não lê. Por isso, como o
// VS Code, o app pergunta o ambiente uma vez a um zsh interativo de login (`zsh -ilc`) e
// usa a resposta em todas as sessões.
const { execFile } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const MARCA = '__ATLAS_AMBIENTE__';
const TEMPO_LIMITE = 5000;

// Aspas simples seguras para o shell: ' vira '\''.
function aspas(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

function linhaDeComando(argv) {
  return 'exec ' + argv.map(aspas).join(' ');
}

// Variáveis que não podem passar para a sessão: as do próprio Claude Code (quando o Atlas
// foi aberto de dentro de uma sessão dele) e as do Atlas herdadas de fora; e as que só valem
// para o zsh que respondeu o ambiente.
function proibida(nome) {
  return nome === 'CLAUDECODE' || nome.startsWith('CLAUDE_CODE_') || nome === 'CLAUDE_PID' ||
    nome.startsWith('ATLAS_') ||
    ['PWD', 'OLDPWD', 'SHLVL', '_'].includes(nome);
}

function limpar(env) {
  const out = {};
  for (const [k, v] of Object.entries(env || {})) {
    if (typeof v === 'string' && !proibida(k)) out[k] = v;
  }
  return out;
}

// Pastas onde costumam estar o claude e as ferramentas do Homebrew: entram no fim do PATH
// se faltarem, para o claude ser achado mesmo se o zsh não responder.
function pastasComuns(casa) {
  return [path.join(casa, '.local', 'bin'), '/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin'];
}

function completarPath(env, casa) {
  const atuais = String(env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin').split(':').filter(Boolean);
  for (const p of pastasComuns(casa)) if (!atuais.includes(p)) atuais.push(p);
  return { ...env, PATH: atuais.join(':') };
}

// Saída de `printf MARCA; env -0`: o que vier antes da marca (avisos do .zshrc) é ignorado.
function lerSaidaDoShell(saida) {
  const texto = String(saida);
  const i = texto.lastIndexOf(MARCA);
  if (i < 0) return null;
  const env = {};
  for (const par of texto.slice(i + MARCA.length).split('\0')) {
    const igual = par.indexOf('=');
    if (igual > 0) env[par.slice(0, igual)] = par.slice(igual + 1);
  }
  return env.PATH ? env : null;
}

// Pergunta o ambiente ao zsh interativo de login. Nunca rejeita: sem resposta (erro, mais de
// 5 s ou saída estranha) volta o ambiente do processo com as pastas comuns no PATH.
// opcoes: { base, casa, shell, executar } (executar e base são para os testes).
function resolverAmbiente(opcoes = {}) {
  const base = limpar(opcoes.base || process.env);
  const casa = opcoes.casa || base.HOME || os.homedir();
  const shell = opcoes.shell || '/bin/zsh';
  const executar = opcoes.executar || execFile;
  const reserva = () => ({ origem: 'reserva', env: completarPath(base, casa) });
  return new Promise((resolve) => {
    try {
      const filho = executar(shell, ['-ilc', `printf '%s' ${MARCA}; command env -0`], {
        env: { ...base, HOME: casa }, cwd: casa, timeout: TEMPO_LIMITE, encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024, killSignal: 'SIGKILL',
      }, (err, stdout) => {
        const lido = lerSaidaDoShell(stdout || '');
        if (!lido) return resolve(reserva());
        // Sem erro grave: o .zshrc pode terminar com código diferente de 0 e mesmo assim responder.
        resolve({ origem: err ? 'shell com aviso' : 'shell', env: completarPath(limpar(lido), casa) });
      });
      // Sem entrada: o .zshrc nunca fica esperando alguém digitar.
      if (filho && filho.stdin) filho.stdin.end();
    } catch {
      resolve(reserva());
    }
  });
}

let resolvido = null;
let promessa = null;

// Chamado uma vez ao abrir o app; as sessões abertas antes da resposta usam a reserva.
function prepararAmbiente(opcoes) {
  if (!promessa) {
    promessa = resolverAmbiente(opcoes).then((r) => { resolvido = r; return r; });
  }
  return promessa;
}

function ambienteDoUsuario() {
  if (resolvido) return resolvido.env;
  return completarPath(limpar(process.env), os.homedir());
}

function ambiente(sessao, base = ambienteDoUsuario()) {
  return {
    ...limpar(base),
    // Apps abertos pelo Dock não herdam locale; o hook decodifica o stdin por ele.
    LANG: 'pt_BR.UTF-8',
    ATLAS_SESSAO_ID: sessao.id,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    // Caixa de digitar fixa no rodapé (o /tui fullscreen do claude) em todas as sessões do Atlas.
    // Para voltar ao modo antigo numa sessão: /tui classic.
    CLAUDE_CODE_NO_FLICKER: '1',
  };
}

// cfg = { argv, cols, rows }
// O spawn segue com `zsh -l -c 'exec claude ...'` (sem -i): o ambiente já vem completo do
// zsh interativo, e um -i aqui leria o .zshrc a cada sessão (mais lento e com o risco de o
// .zshrc escrever no terminal antes do claude).
function abrir(sessao, cfg, aoDados, aoSair) {
  const pty = require('node-pty'); // carregado só aqui: os testes rodam sem o módulo nativo
  const p = pty.spawn('/bin/zsh', ['-l', '-c', linhaDeComando(cfg.argv)], {
    name: 'xterm-256color',
    cols: cfg.cols || 100,
    rows: cfg.rows || 30,
    cwd: sessao.pasta,
    env: ambiente(sessao),
  });
  p.onData((d) => aoDados(d));
  p.onExit(({ exitCode }) => aoSair(exitCode));
  return {
    escrever: (s) => p.write(s),
    redimensionar: (cols, rows) => p.resize(cols, rows),
    matar: () => { try { p.kill(); } catch { /* já saiu */ } },
  };
}

module.exports = {
  aspas, linhaDeComando, ambiente, abrir, limpar, lerSaidaDoShell, resolverAmbiente,
  prepararAmbiente, ambienteDoUsuario, completarPath, MARCA,
};
