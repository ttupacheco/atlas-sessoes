const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('atlas', {
  listar: () => ipcRenderer.invoke('listar'),
  nova: () => ipcRenderer.invoke('nova'),
  selecionar: (id) => ipcRenderer.invoke('selecionar', id),
  retomar: (id) => ipcRenderer.invoke('retomar', id),
  recomecar: (id) => ipcRenderer.invoke('recomecar', id),
  escrever: (id, dados) => ipcRenderer.invoke('escrever', id, dados),
  microfone: () => ipcRenderer.invoke('microfone'),
  // Miniatura (data URL ou null) da imagem na área de transferência ou de um arquivo de imagem.
  miniaturaDaArea: () => ipcRenderer.invoke('miniaturaDaArea'),
  miniaturaDoArquivo: (caminho) => ipcRenderer.invoke('miniaturaDoArquivo', caminho),
  redimensionar: (id, cols, rows) => ipcRenderer.invoke('redimensionar', id, cols, rows),
  renomear: (id, nome) => ipcRenderer.invoke('renomear', id, nome),
  definirTitulo: (id, titulo) => ipcRenderer.invoke('definirTitulo', id, titulo),
  trocarCor: (id, cor) => ipcRenderer.invoke('trocarCor', id, cor),
  pedirFechar: (id) => ipcRenderer.invoke('pedirFechar', id),
  menuCartao: (id) => ipcRenderer.invoke('menuCartao', id),
  uso: () => ipcRenderer.invoke('uso'),
  listarGrupos: () => ipcRenderer.invoke('listarGrupos'),
  criarGrupo: (nome) => ipcRenderer.invoke('criarGrupo', nome),
  renomearGrupo: (id, nome) => ipcRenderer.invoke('renomearGrupo', id, nome),
  descreverGrupo: (id, descricao) => ipcRenderer.invoke('descreverGrupo', id, descricao),
  apagarGrupo: (id) => ipcRenderer.invoke('apagarGrupo', id),
  moverParaGrupo: (sessaoId, grupoId) => ipcRenderer.invoke('moverParaGrupo', sessaoId, grupoId),
  listarFechadas: () => ipcRenderer.invoke('listarFechadas'),
  reabrirFechada: (id) => ipcRenderer.invoke('reabrirFechada', id),
  estatisticas: (dias) => ipcRenderer.invoke('estatisticas', dias),
  contarVermelhos: () => ipcRenderer.invoke('contarVermelhos'),
  marcarPagina: (aberta) => ipcRenderer.invoke('marcarPagina', aberta),
  lerConfig: () => ipcRenderer.invoke('lerConfig'),
  definirConfig: (cfg) => ipcRenderer.invoke('definirConfig', cfg),
  lerJarvis: () => ipcRenderer.invoke('lerJarvis'),
  definirJarvis: (ligado) => ipcRenderer.invoke('definirJarvis', ligado),
  // Caminho no disco de um arquivo arrastado ('' se não for arquivo do disco).
  caminhoDoArquivo: (arquivo) => {
    try { return webUtils.getPathForFile(arquivo); } catch { return ''; }
  },
  aoCartoes: (cb) => ipcRenderer.on('cartoes', (_e, cartoes) => cb(cartoes)),
  aoUso: (cb) => ipcRenderer.on('uso', (_e, linhas) => cb(linhas)),
  aoPedirRenomear: (cb) => ipcRenderer.on('renomear', (_e, id) => cb(id)),
  aoDados: (cb) => ipcRenderer.on('dados', (_e, id, dados) => cb(id, dados)),
  aoRetomar: (cb) => ipcRenderer.on('retomar', (_e, id) => cb(id)),
  // Clique num aviso do Mac: a tela mostra aquela sessão.
  aoSelecionar: (cb) => ipcRenderer.on('selecionar', (_e, id) => cb(id)),
  // Tamanho do texto do terminal mudou (menu ⌘+ ⌘− ⌘0 ou Configurações).
  aoTamanhoFonte: (cb) => ipcRenderer.on('tamanhoFonte', (_e, n) => cb(n)),
  // Menu ⌘, e ⌘⇧E: 'configuracoes' ou 'estatisticas'.
  aoAbrirPagina: (cb) => ipcRenderer.on('abrirPagina', (_e, pagina) => cb(pagina)),
  // ⌘D do menu: a tela confere as travas e manda o toque do microfone.
  aoMicrofone: (cb) => ipcRenderer.on('microfone', () => cb()),
});
