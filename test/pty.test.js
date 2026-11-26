const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { aspas, linhaDeComando, ambiente } = require('../src/pty.js');

test('aspas simples seguras: o zsh devolve cada argumento intacto', () => {
  const args = ["/a b/Café", "it's", "x'y'z", '$HOME `ls` "q"', ''];
  const saida = execFileSync('/bin/zsh', ['-f', '-c', 'printf "%s\\n" ' + args.map(aspas).join(' ')], { encoding: 'utf8' });
  assert.deepEqual(saida.split('\n').slice(0, -1), args);
});

test('linha de comando usa exec', () => {
  assert.equal(linhaDeComando(['claude', '--resume', 'u-1']), "exec 'claude' '--resume' 'u-1'");
});

test('ambiente tem ATLAS_SESSAO_ID, locale e terminal', () => {
  const env = ambiente({ id: 'abc12345' }, { PATH: '/bin', LANG: 'C' });
  assert.equal(env.ATLAS_SESSAO_ID, 'abc12345');
  assert.equal(env.LANG, 'pt_BR.UTF-8');
  assert.equal(env.TERM, 'xterm-256color');
  assert.equal(env.COLORTERM, 'truecolor');
  assert.equal(env.PATH, '/bin');
});

const { limpar, lerSaidaDoShell, resolverAmbiente, MARCA } = require('../src/pty.js');
const os = require('node:os');

const DO_CLAUDE = {
  CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CODE_SESSION_ID: 's', CLAUDE_CODE_MESSAGING_SOCKET: '/x',
  CLAUDE_CODE_MESSAGING_TOKEN: 't', CLAUDE_PID: '9', ATLAS_SESSAO_ID: 'velha', ATLAS_PASTA: '/y',
};

test('ambiente não passa as variáveis do Claude Code nem ATLAS_* herdadas', () => {
  const env = ambiente({ id: 'nova1234' }, { PATH: '/bin', HOME: '/h', CLAUDE_CONFIG_DIR: '/c', ...DO_CLAUDE });
  for (const k of Object.keys(DO_CLAUDE)) if (k !== 'ATLAS_SESSAO_ID') assert.equal(env[k], undefined, k);
  assert.equal(env.ATLAS_SESSAO_ID, 'nova1234');
  assert.equal(env.HOME, '/h');
  assert.equal(env.CLAUDE_CONFIG_DIR, '/c', 'só as do Claude Code saem, não as de configuração');
});

test('limpar tira também PWD, OLDPWD, SHLVL e _ do zsh que respondeu', () => {
  assert.deepEqual(limpar({ PATH: '/bin', PWD: '/a', OLDPWD: '/b', SHLVL: '2', _: '/usr/bin/env', X: 'y' }), { PATH: '/bin', X: 'y' });
});

test('lerSaidaDoShell ignora o que vem antes da marca e lê pares separados por NUL', () => {
  const saida = 'aviso do zshrc\n' + MARCA + 'PATH=/a:/b\0CLOUDSDK_PYTHON=/py\0MULTI=linha1\nlinha2\0';
  assert.deepEqual(lerSaidaDoShell(saida), { PATH: '/a:/b', CLOUDSDK_PYTHON: '/py', MULTI: 'linha1\nlinha2' });
  assert.equal(lerSaidaDoShell('sem marca'), null);
  assert.equal(lerSaidaDoShell(MARCA + 'X=1\0'), null, 'sem PATH não serve');
});

test('resolverAmbiente usa a resposta do zsh -ilc, sem stdin, com limite de tempo', async () => {
  let chamada;
  const executar = (shell, args, opts, cb) => {
    chamada = { shell, args, opts };
    setImmediate(() => cb(null, 'oi\n' + MARCA + 'PATH=/Users/m/.local/bin:/usr/bin\0CLOUDSDK_PYTHON=/py\0CLAUDECODE=1\0HOME=/Users/m\0'));
    return { stdin: { end() { chamada.stdinFechado = true; } } };
  };
  const r = await resolverAmbiente({ base: { PATH: '/usr/bin:/bin', HOME: '/Users/m', CLAUDECODE: '1' }, executar });
  assert.equal(chamada.shell, '/bin/zsh');
  assert.equal(chamada.args[0], '-ilc');
  assert.ok(chamada.opts.timeout > 0 && chamada.opts.timeout <= 5000);
  assert.equal(chamada.opts.env.CLAUDECODE, undefined, 'o zsh também não recebe as do Claude Code');
  assert.equal(chamada.stdinFechado, true);
  assert.equal(r.origem, 'shell');
  assert.equal(r.env.CLOUDSDK_PYTHON, '/py');
  assert.equal(r.env.CLAUDECODE, undefined);
  assert.equal(r.env.PATH.split(':')[0], '/Users/m/.local/bin');
});

test('resolverAmbiente sem resposta volta o ambiente base com as pastas comuns no PATH', async () => {
  const falha = (s, a, o, cb) => { setImmediate(() => cb(new Error('timeout'), 'lixo')); return {}; };
  const r = await resolverAmbiente({ base: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: '/Users/m', CLAUDE_CODE_X: '1' }, executar: falha });
  assert.equal(r.origem, 'reserva');
  assert.equal(r.env.CLAUDE_CODE_X, undefined);
  const p = r.env.PATH.split(':');
  for (const d of ['/usr/bin', '/Users/m/.local/bin', '/opt/homebrew/bin', '/usr/local/bin']) assert.ok(p.includes(d), d);
  const explode = () => { throw new Error('spawn'); };
  assert.equal((await resolverAmbiente({ base: { PATH: '/bin', HOME: '/h' }, executar: explode })).origem, 'reserva');
});

test('resolverAmbiente de verdade com o ambiente mínimo do Dock acha o claude', { skip: !require('node:fs').existsSync(os.homedir() + '/.local/bin/claude') }, async () => {
  const base = { HOME: os.homedir(), USER: os.userInfo().username, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' };
  const r = await resolverAmbiente({ base });
  assert.equal(r.origem === 'shell' || r.origem === 'shell com aviso', true, r.origem);
  const achado = execFileSync('/bin/zsh', ['-l', '-c', 'command -v claude'], { env: ambiente({ id: 'teste123' }, r.env), encoding: 'utf8' }).trim();
  assert.match(achado, /\/claude$/);
});
