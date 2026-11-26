// Funções puras da tela. Rodam no navegador (window.AtlasUtil) e nos testes (require).
(function (raiz) {
  const MIN = 60000;
  const HORA = 60 * MIN;
  const DIA = 24 * HORA;

  function tempoRelativo(desde, agora) {
    const d = Number.isFinite(desde) ? Math.max(0, agora - desde) : 0;
    if (d < MIN) return 'agora';
    if (d < HORA) return `há ${Math.floor(d / MIN)} min`;
    if (d < DIA) return `há ${Math.floor(d / HORA)} h`;
    const dias = Math.floor(d / DIA);
    return dias === 1 ? 'há 1 dia' : `há ${dias} dias`;
  }

  // Aspas simples seguras para o shell: ' vira '\''. Termina com espaço, como o Terminal.
  function caminhosArrastados(caminhos) {
    const validos = caminhos.filter((c) => typeof c === 'string' && c !== '');
    if (!validos.length) return '';
    return validos.map((c) => "'" + c.replace(/'/g, "'\\''") + "'").join(' ') + ' ';
  }

  // Só ⌘1 a ⌘9, ⌘T e ⌘W são do app; qualquer outra tecla vai para o terminal.
  function atalho(ev) {
    if (!ev.metaKey || ev.ctrlKey || ev.altKey || ev.shiftKey) return null;
    const key = String(ev.key || '').toLowerCase();
    const code = String(ev.code || '');
    const digito = /^[1-9]$/.test(key) ? key : (/^Digit[1-9]$/.exec(code) || [])[0];
    if (digito) return { acao: 'selecionar', indice: Number(digito.slice(-1)) - 1 };
    if (key === 't' || code === 'KeyT') return { acao: 'nova' };
    if (key === 'w' || code === 'KeyW') return { acao: 'fechar' };
    return null;
  }

  function pastaCurta(pasta) {
    return String(pasta).replace(/^\/Users\/[^/]+(?=\/|$)/, '~');
  }

  // Mesma ordem do gerente (estado.js): vermelhos primeiro, o mais antigo em cima; o resto
  // pela ordem de criação.
  function ordenar(cartoes) {
    const vermelhos = cartoes.filter((c) => c.estado.cor === 'vermelho').sort((a, b) => a.estado.desde - b.estado.desde);
    const resto = cartoes.filter((c) => c.estado.cor !== 'vermelho').sort((a, b) => a.criadoEm - b.criadoEm);
    return [...vermelhos, ...resto];
  }

  // Blocos da coluna, um por grupo com cartão (vazio não aparece). Bloco com vermelho sobe;
  // depois vale a ordem dos grupos, com "Sem grupo" (id null) no fim. Grupo que não existe
  // mais conta como "Sem grupo". `recolhidos` guarda os ids dos blocos fechados.
  function agruparCartoes(cartoes, grupos, recolhidos) {
    const ordem = new Map(grupos.map((g, i) => [g.id, i]));
    const porGrupo = new Map();
    for (const c of cartoes) {
      const gid = c.grupoId != null && ordem.has(c.grupoId) ? c.grupoId : null;
      if (!porGrupo.has(gid)) porGrupo.set(gid, []);
      porGrupo.get(gid).push(c);
    }
    const blocos = [...porGrupo].map(([grupoId, lista]) => ({
      grupoId,
      nome: grupoId === null ? 'Sem grupo' : grupos[ordem.get(grupoId)].nome,
      cartoes: ordenar(lista),
      vermelhos: lista.filter((c) => c.estado.cor === 'vermelho').length,
      recolhido: Boolean(recolhidos && recolhidos.has(grupoId)),
    }));
    const posicao = (b) => (b.grupoId === null ? grupos.length : ordem.get(b.grupoId));
    return blocos.sort((a, b) => (b.vermelhos > 0) - (a.vermelhos > 0) || posicao(a) - posicao(b));
  }

  // "6h 40", "1h", "35 min", "0 min". Arredonda para baixo: nunca mostra mais do que houve.
  function formatarDuracao(ms) {
    const min = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / MIN) : 0;
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const resto = min % 60;
    return resto ? `${h}h ${String(resto).padStart(2, '0')}` : `${h}h`;
  }

  // Sinal do /salvar no cartão: o Salvar e fechar (ou Salvar todas e sair) esperando, ou
  // "não salva". Salva (ou sem pedido): nada.
  function textoSalvar(c) {
    if (c.salvando === 'fechar') return 'salvando e fechando';
    if (c.salvando === 'sair') return 'salvando';
    if (c.rascunho) return 'rascunho na caixa, apague com ⌃U e tente de novo';
    if (c.falhaSalvar) return 'o /salvar não terminou, tente de novo';
    return c.salva === false ? 'não salva' : '';
  }

  // Miniaturas das imagens coladas. A caixa do claude (no /tui fullscreen) fica entre as duas
  // últimas linhas feitas de ─ na tela, com o "❯" na primeira linha; dentro dela cada imagem
  // aparece como "[Image #N]". linhas: o texto da tela, de cima para baixo. Devolve
  // { topo, base, texto } ou null quando não há caixa à vista (pergunta, menu "❯ 1. Sim", ou
  // modo classic com a caixa fora da tela).
  const REGUA = /^─{20,}$/;
  function caixaDoClaude(linhas) {
    const reguas = [];
    for (let i = linhas.length - 1; i >= 0 && reguas.length < 2; i--) {
      if (REGUA.test(String(linhas[i] || '').trim())) reguas.unshift(i);
    }
    if (reguas.length < 2) return null;
    const [topo, base] = reguas;
    const primeira = String(linhas[topo + 1] || '').trimStart();
    if (base - topo < 2 || !primeira.startsWith('❯')) return null;
    // Menu de opções ("❯ 1. Sim" e mais uma opção numerada embaixo) não é a caixa; um pedido
    // que começa com "1. faz isso" é.
    const opcao = /^\s*\d+\.\s/;
    if (opcao.test(primeira.slice(1)) && linhas.slice(topo + 2, base).some((l) => opcao.test(String(l)))) return null;
    // Linhas juntas com espaço: o claude quebra o texto longo nos espaços ("[Image" / "#1]").
    return { topo, base, texto: linhas.slice(topo + 1, base).join(' ') };
  }

  function numerosDeImagem(texto) {
    const out = new Set();
    for (const m of String(texto).matchAll(/\[Image\s+#(\d+)\]/g)) out.add(Number(m[1]));
    return out;
  }

  // Liga cada "[Image #N]" que surge na caixa à imagem colada há menos de VALIDADE_COLADA, na
  // ordem em que foram coladas. Número que já estava na caixa sem miniatura (pedido antigo do
  // ↑, colada vencida) nunca pega colada nova. Número que some da caixa (enviado, apagado, ⌃C,
  // ⌃U) só sai depois de AUSENCIA sem voltar: um quadro desenhado pela metade não apaga nada.
  // estado = { porNumero: Map(n -> colada), coladas: [colada], vistos: Set(n), ausentes:
  // Map(n -> desde) }, alterado no lugar; colada = { imagem, t }, com imagem null enquanto a
  // miniatura é feita. Devolve { lista: [[n, colada], ...] em ordem de número, esperando: há
  // número em ausência (conferir de novo depois de AUSENCIA) }.
  const VALIDADE_COLADA = 8000; // print grande no ⌃V: o claude demora a desenhar o número
  const AUSENCIA = 400;
  function ligarMiniaturas(estado, numeros, agora) {
    estado.coladas = estado.coladas.filter((c) => agora - c.t <= VALIDADE_COLADA);
    for (const n of [...estado.vistos]) {
      if (numeros.has(n)) { estado.ausentes.delete(n); continue; }
      if (!estado.ausentes.has(n)) estado.ausentes.set(n, agora);
      else if (agora - estado.ausentes.get(n) >= AUSENCIA) {
        estado.vistos.delete(n);
        estado.porNumero.delete(n);
        estado.ausentes.delete(n);
      }
    }
    for (const n of [...numeros].sort((a, b) => a - b)) {
      if (estado.vistos.has(n)) continue;
      estado.vistos.add(n);
      if (estado.coladas.length) estado.porNumero.set(n, estado.coladas.shift());
    }
    const lista = [...estado.porNumero.entries()].sort((a, b) => a[0] - b[0]);
    return { lista, esperando: estado.ausentes.size > 0 };
  }

  // Arquivo arrastado que o claude transforma em "[Image #N]" (testado no 2.1.332: HEIC, BMP
  // e TIFF ficam como caminho; e com um deles no meio, nenhum do grupo vira imagem).
  const ehImagem = (caminho) => /\.(png|jpe?g|gif|webp)$/i.test(String(caminho));

  const api = { tempoRelativo, caminhosArrastados, atalho, pastaCurta, agruparCartoes, formatarDuracao, textoSalvar,
    caixaDoClaude, numerosDeImagem, ligarMiniaturas, ehImagem, VALIDADE_COLADA, AUSENCIA };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.AtlasUtil = api;
})(globalThis);
