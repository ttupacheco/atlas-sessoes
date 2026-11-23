const { gerarId } = require('./sessoes.js');
const { lerJson, guardarCorrompido, gravarJson } = require('./arquivo.js');

const GRUPOS_INICIAIS = ['Pedidos', 'Vendas', 'Financeiro', 'Marketing', 'Impostos', 'Relatórios', 'Freelas', 'Geral'];
const DESCRICOES_INICIAIS = {
  Pedidos: 'Expedição: pedidos, etiquetas, notas fiscais, estoque, devoluções',
  Vendas: 'Painel de vendas e mídia: números do site, anúncios, criativos',
  Financeiro: 'DRE, fluxo de caixa, conciliação bancária, impostos, contabilidade',
  Marketing: 'Anúncios no Meta e no Google, campanhas, ofertas, cupons, e-mail, site e tema da loja',
  Impostos: 'Guias de impostos, notas fiscais, obrigações do mês',
  'Relatórios': 'Relatórios gerenciais da empresa',
  'Freelas': "Trabalhos por fora: sites, propostas, clientes",
  Geral: 'Assuntos pessoais e tarefas que não são de um projeto',
};
const NOME_MAX = 40;
const DESCRICAO_MAX = 200;

const iniciais = () => GRUPOS_INICIAIS.map((nome) => ({ id: gerarId(), nome, descricao: DESCRICOES_INICIAIS[nome] || '' }));

// Descrição limpa ou erro: precisa ser texto de até 200 caracteres (vazio vale).
function descricaoValida(descricao) {
  if (descricao === undefined || descricao === null) return '';
  const limpa = typeof descricao === 'string' ? descricao.trim() : null;
  if (limpa === null || limpa.length > DESCRICAO_MAX) throw new Error('descrição inválida');
  return limpa;
}

const grupoBemFormado = (g) =>
  g !== null && typeof g === 'object' &&
  typeof g.id === 'string' && /^[a-z0-9]+$/.test(g.id) &&
  typeof g.nome === 'string' && g.nome.trim() !== '';

function carregarGrupos(caminho) {
  const dados = lerJson(caminho);
  if (dados === undefined) {
    // Ausente ou JSON estragado (já guardado por lerJson): começa pelos padrões.
    const lista = iniciais();
    try { gravarJson(caminho, lista); } catch { /* sem disco, segue em memória */ }
    return lista;
  }
  // Lista vazia salva é escolha do usuário (apagou todos os grupos), não arquivo estragado.
  if (Array.isArray(dados) && dados.length === 0) return [];
  const lista = Array.isArray(dados) ? dados.filter(grupoBemFormado).map((g) => ({ id: g.id, nome: g.nome, descricao: typeof g.descricao === 'string' ? g.descricao.slice(0, DESCRICAO_MAX) : '' })) : [];
  if (lista.length === 0) {
    if (!Array.isArray(dados)) guardarCorrompido(caminho);
    const padroes = iniciais();
    try { gravarJson(caminho, padroes); } catch { /* segue em memória */ }
    return padroes;
  }
  return lista;
}

function salvarGrupos(caminho, lista) {
  gravarJson(caminho, lista);
}

// Nome limpo ou erro: vazio, acima de 40 caracteres ou igual (sem diferenciar caixa) a outro grupo.
function nomeValido(lista, nome, ignorarId = null) {
  const limpo = typeof nome === 'string' ? nome.trim() : '';
  // "nenhum" é a resposta do classificador para "sem grupo": não pode ser nome de grupo.
  if (limpo === '' || limpo.length > NOME_MAX || limpo.toLowerCase() === 'nenhum') throw new Error('nome inválido');
  const minusculo = limpo.toLowerCase();
  if (lista.some((g) => g.id !== ignorarId && g.nome.toLowerCase() === minusculo)) throw new Error('nome inválido');
  return limpo;
}

function criarGrupo(lista, nome, descricao) {
  const limpo = nomeValido(lista, nome);
  const desc = descricaoValida(descricao);
  const ids = new Set(lista.map((g) => g.id));
  let id = gerarId();
  while (ids.has(id)) id = gerarId();
  const grupo = { id, nome: limpo, descricao: desc };
  return { lista: [...lista, grupo], grupo };
}

function renomearGrupo(lista, id, nome) {
  const limpo = nomeValido(lista, nome, id);
  return lista.map((g) => (g.id === id ? { ...g, nome: limpo } : g));
}

function descreverGrupo(lista, id, descricao) {
  const desc = descricaoValida(descricao);
  return lista.map((g) => (g.id === id ? { ...g, descricao: desc } : g));
}

function apagarGrupo(lista, id) {
  return lista.filter((g) => g.id !== id);
}

module.exports = { GRUPOS_INICIAIS, DESCRICOES_INICIAIS, carregarGrupos, salvarGrupos, criarGrupo, renomearGrupo, descreverGrupo, apagarGrupo, DESCRICAO_MAX };
