// Classificação automática de grupo: uma chamada curta ao Haiku (`claude -p`) depois do
// primeiro pedido da sessão. Nunca derruba nada: qualquer erro ou resposta fora da lista
// vira null ("Sem grupo"), e o gerente decide quando tentar de novo.
const { spawn } = require('node:child_process');
const { limpar } = require('./pty.js');

const TEMPO_LIMITE = 60_000;
const LIMITE_SAIDA = 2048;
const PEDIDO_MAX = 2000;

// grupos: nomes (texto) ou { nome, descricao }; com descrição a linha vira "Nome: descrição".
function montarPergunta(grupos, nomeCartao, pedido) {
  const lista = grupos.map((g) => {
    if (typeof g === 'string') return `- ${g}`;
    return g.descricao ? `- ${g.nome}: ${g.descricao}` : `- ${g.nome}`;
  }).join('\n');
  return [
    'Você classifica sessões de trabalho em grupos.',
    'Grupos disponíveis:',
    lista,
    '',
    `Nome da sessão: ${nomeCartao || '(sem nome)'}`,
    'Primeiro pedido da sessão:',
    String(pedido || '').slice(0, PEDIDO_MAX),
    '',
    'Responda com exatamente um nome da lista acima, copiado igual (só o nome, sem a descrição).',
    'Se não estiver claro a qual grupo pertence, ou se o pedido não tem assunto (por exemplo "sim" ou "continua"), responda: nenhum',
    'Sua resposta inteira deve ser só esse nome, em uma única linha: nada antes, nada depois, sem explicação, sem aspas e sem pontuação.',
  ].join('\n');
}

// Tira espaços, aspas/crases nas pontas e pontuação final, e ignora a caixa. Vale para a
// resposta e para os nomes dos grupos, que são comparados do mesmo jeito.
function normalizar(texto) {
  return String(texto == null ? '' : texto)
    .trim()
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '')
    .replace(/[.!?,;:]+$/g, '')
    .trim()
    .toLowerCase();
}

// "nenhum" sempre dá null, mesmo que exista um grupo com esse nome.
function interpretarResposta(texto, grupos) {
  const t = normalizar(texto);
  if (!t || t === 'nenhum') return null;
  const g = (grupos || []).find((x) => normalizar(x.nome) === t);
  return g ? g.id : null;
}

// Fila de uma vaga: as chamadas esperam a anterior terminar.
function criarClassificador({ executar, grupos }) {
  let fila = Promise.resolve();
  return (sessao, pedido) => {
    const vez = fila.then(async () => {
      try {
        const lista = grupos();
        if (!lista || lista.length === 0) return null;
        const pergunta = montarPergunta(lista, sessao && sessao.nomeCartao, pedido);
        return interpretarResposta(await executar(pergunta), lista);
      } catch {
        return null;
      }
    });
    fila = vez;
    return vez;
  };
}

// Sem as variáveis do Claude e do Atlas: o hook do Atlas ignora a chamada (sem
// ATLAS_SESSAO_ID) e o cartão da sessão nunca é tocado.
function ambienteDoClassificador(base) {
  const env = limpar(base);
  delete env.ATLAS_SESSAO_ID;
  return env;
}

// Sem ferramentas, sem MCPs, sem skills e sem as configurações do usuário (hooks de voz,
// notificação e do Atlas não disparam): o texto do pedido é não confiável e a chamada só
// precisa devolver um nome. A autenticação não depende dos arquivos de configuração.
const ARGUMENTOS = [
  '-p', '--model', 'haiku', '--no-session-persistence',
  '--tools', '', '--strict-mcp-config', '--disable-slash-commands', '--setting-sources', '',
];

// Spawn direto do claude com o PATH já resolvido (resolverAmbiente): um processo só, o kill
// por timeout atinge o próprio claude, e não paga a leitura do zsh de login a cada chamada.
// ambiente = { env, cwd, tempoLimite? }. Rejeita em erro, saída vazia, excesso (em bytes) ou timeout.
function executarClaude(pergunta, ambiente) {
  const { env, cwd, tempoLimite = TEMPO_LIMITE } = ambiente;
  return new Promise((resolve, reject) => {
    let filho;
    try {
      filho = spawn('claude', ARGUMENTOS, {
        cwd, env: ambienteDoClassificador(env), stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch (err) { reject(err); return; }
    const pedacos = [];
    let bytes = 0;
    let fim = false;
    const matar = () => { try { filho.kill('SIGKILL'); } catch { /* já saiu */ } };
    const terminar = (fn, v) => { if (fim) return; fim = true; clearTimeout(timer); fn(v); };
    const timer = setTimeout(() => { matar(); terminar(reject, new Error('tempo esgotado')); }, tempoLimite);
    filho.on('error', (e) => terminar(reject, e));
    filho.stdin.on('error', () => {});
    filho.stdout.on('data', (d) => {
      bytes += d.length;
      pedacos.push(d);
      if (bytes > LIMITE_SAIDA) { matar(); terminar(reject, new Error('saída grande demais')); }
    });
    filho.on('close', (codigo) => {
      const saida = Buffer.concat(pedacos).toString('utf8');
      if (codigo === 0 && saida.trim()) terminar(resolve, saida);
      else terminar(reject, new Error('claude saiu com código ' + codigo));
    });
    filho.stdin.end(pergunta);
  });
}

module.exports = { ARGUMENTOS, normalizar, montarPergunta, interpretarResposta, criarClassificador, ambienteDoClassificador, executarClaude };
