// Nome do cartão (puro). Roda no main (require) e na tela (window.AtlasNome).
(function (raiz) {
  // Títulos que não dizem nada da conversa: o do próprio claude parado e os do shell.
  const GENERICOS = new Set(['claude code', 'claude', 'zsh', '-zsh', 'bash', '-bash']);

  // Título do terminal (OSC 0/2) sem o prefixo de status do claude ("✳ ", "⠂ ", "✻ ")
  // e sem espaços sobrando. Genérico ou vazio conta como sem título (null).
  function limparTitulo(bruto) {
    if (typeof bruto !== 'string') return null;
    const limpo = bruto
      .replace(/\p{Cc}/gu, ' ')
      .replace(/^[\s\p{So}\p{Sk}·•*]+/u, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!limpo || GENERICOS.has(limpo.toLowerCase())) return null;
    return limpo;
  }

  const semBarraNoFim = (p) => String(p).replace(/\/+$/, '');

  // Nome dado pelo usuário, senão o título da conversa, senão o nome da pasta (se não for a
  // pasta pessoal), senão "Novo".
  function nomeDoCartao(sessao, casa) {
    const manual = typeof sessao.nome === 'string' ? sessao.nome.trim() : '';
    if (manual) return manual;
    const titulo = limparTitulo(sessao.titulo);
    if (titulo) return titulo;
    if (typeof sessao.pasta === 'string' && sessao.pasta !== '') {
      const pasta = semBarraNoFim(sessao.pasta);
      const pessoal = typeof casa === 'string' && pasta === semBarraNoFim(casa);
      const nomePasta = pasta.slice(pasta.lastIndexOf('/') + 1);
      if (!pessoal && nomePasta) return nomePasta;
    }
    return 'Novo';
  }

  const api = { limparTitulo, nomeDoCartao };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.AtlasNome = api;
})(globalThis);
