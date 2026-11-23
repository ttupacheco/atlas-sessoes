const { idValido } = require('./sessoes.js');
const { lerJson, guardarCorrompido, gravarJson } = require('./arquivo.js');

const MAXIMO = 10;

const entradaBemFormada = (s) =>
  s !== null && typeof s === 'object' &&
  typeof s.id === 'string' && /^[a-z0-9]+$/.test(s.id) &&
  typeof s.pasta === 'string' && s.pasta !== '' &&
  idValido(s.claudeSessionId);

function carregarFechadas(caminho) {
  const dados = lerJson(caminho);
  if (dados === undefined) return [];
  if (!Array.isArray(dados)) {
    guardarCorrompido(caminho);
    return [];
  }
  return dados.filter(entradaBemFormada).slice(0, MAXIMO);
}

function salvarFechadas(caminho, lista) {
  gravarJson(caminho, lista);
}

// Só conversa com UUID dá para retomar. Mais nova primeiro, no máximo 10, sem repetir a conversa.
function registrarFechada(lista, sessao, agora) {
  if (!sessao || !idValido(sessao.claudeSessionId)) return lista;
  const resto = lista.filter((f) => f.claudeSessionId !== sessao.claudeSessionId);
  return [{ ...sessao, fechadaEm: agora }, ...resto].slice(0, MAXIMO);
}

function retirarFechada(lista, id) {
  const achada = lista.find((f) => f.id === id);
  if (!achada) return { lista, sessao: null };
  const { fechadaEm, ...sessao } = achada; // eslint-disable-line no-unused-vars
  return { lista: lista.filter((f) => f.id !== id), sessao };
}

// Grupo apagado enquanto a sessão estava na lista: ao reabrir ela fica sem grupo.
function limparGrupoInexistente(sessao, grupos) {
  const existe = sessao.grupoId != null && grupos.some((g) => g.id === sessao.grupoId);
  return existe ? sessao : { ...sessao, grupoId: null };
}

module.exports = { carregarFechadas, salvarFechadas, registrarFechada, retirarFechada, limparGrupoInexistente };
