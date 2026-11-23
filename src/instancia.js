// Uma cópia só do Atlas: duas abririam `claude --resume` da mesma conversa e uma apagaria
// as sessões da outra ao regravar o sessoes.json. A segunda cópia sai na hora com app.exit
// (sem before-quit nem will-quit, que salvariam a lista vazia dela por cima da verdadeira)
// e a primeira traz a janela para a frente. No modo demo não vale: ele roda ao lado.
function instanciaUnica(app, { demo = false, aoSegunda }) {
  if (demo) return true;
  if (!app.requestSingleInstanceLock()) {
    app.exit(0);
    return false;
  }
  app.on('second-instance', () => aoSegunda());
  return true;
}

module.exports = { instanciaUnica };
