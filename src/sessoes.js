const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PALETA } = require('./projetos.js');
const { gravarJson } = require('./arquivo.js');

const SESSOES_PADRAO = path.join(os.homedir(), 'Library', 'Application Support', 'Atlas', 'sessoes.json');

const ALFABETO = 'abcdefghijklmnopqrstuvwxyz0123456789';

// Só [a-z0-9], 8 caracteres: seguro como nome de arquivo e como variável de ambiente.
function gerarId() {
  const bytes = crypto.randomBytes(8);
  let id = '';
  for (const b of bytes) id += ALFABETO[b % ALFABETO.length];
  return id;
}

// A cor menos usada entre as sessões abertas; empate fica com a que vem antes na paleta.
function corMenosUsada(lista, paleta) {
  const usos = new Map(paleta.map((c) => [c, 0]));
  for (const s of lista) if (usos.has(s.cor)) usos.set(s.cor, usos.get(s.cor) + 1);
  return paleta.reduce((melhor, c) => (usos.get(c) < usos.get(melhor) ? c : melhor), paleta[0]);
}

function novaSessao(lista, pasta, agora, paleta = PALETA) {
  return {
    id: gerarId(), pasta, criadoEm: agora, claudeSessionId: null,
    nome: null, titulo: null, cor: corMenosUsada(lista, paleta),
    grupoId: null, grupoManual: false, classificada: 0,
  };
}

// Id de conversa do claude: só UUID vai para o --resume (qualquer outra coisa abre uma nova).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idValido = (v) => typeof v === 'string' && UUID.test(v);

function comandoClaude(s) {
  return idValido(s.claudeSessionId) ? ['claude', '--resume', s.claudeSessionId] : ['claude'];
}

function bemFormada(s) {
  return (
    s !== null && typeof s === 'object' &&
    typeof s.id === 'string' && /^[a-z0-9]+$/.test(s.id) &&
    typeof s.pasta === 'string' && s.pasta !== ''
  );
}

const textoOuNull = (v) => (typeof v === 'string' && v.trim() !== '' ? v : null);

// Sessões de antes desta versão (sem nome, título e cor) ganham os campos novos;
// a cor sai da paleta, a menos usada entre as que já têm cor.
function carregarLista(caminho = SESSOES_PADRAO, paleta = PALETA) {
  let bruto;
  try {
    bruto = fs.readFileSync(caminho, 'utf8');
  } catch {
    return [];
  }
  let dados;
  try {
    dados = JSON.parse(bruto);
  } catch {
    dados = null;
  }
  if (!Array.isArray(dados)) {
    // Arquivo estragado: guarda ao lado antes que a próxima gravação o apague.
    try { fs.renameSync(caminho, `${caminho}.corrompido-${Date.now()}`); } catch { /* segue vazio */ }
    return [];
  }
  const lista = dados.filter(bemFormada).map((s) => ({
    id: s.id,
    pasta: s.pasta,
    criadoEm: typeof s.criadoEm === 'number' ? s.criadoEm : 0,
    claudeSessionId: typeof s.claudeSessionId === 'string' ? s.claudeSessionId : null,
    nome: textoOuNull(s.nome),
    titulo: textoOuNull(s.titulo),
    cor: paleta.includes(s.cor) ? s.cor : null,
    grupoId: textoOuNull(s.grupoId),
    grupoManual: s.grupoManual === true,
    classificada: s.classificada === 1 || s.classificada === 2 ? s.classificada : 0,
    // Reaberta com ⌘⇧T sem estar salva (gerente.js): a fase parte de "pedido".
    ...(s.naoSalva === true ? { naoSalva: true } : {}),
  }));
  for (const s of lista) if (!s.cor) s.cor = corMenosUsada(lista, paleta);
  return lista;
}

function salvarLista(caminho, lista) {
  gravarJson(caminho, lista);
}

module.exports = { SESSOES_PADRAO, gerarId, novaSessao, comandoClaude, idValido, salvarLista, carregarLista };
