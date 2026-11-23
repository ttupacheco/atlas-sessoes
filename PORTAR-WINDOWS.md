# Guia para adaptar o Atlas ao Windows

Este guia é para quem (pessoa ou assistente de código, como o Claude Code) for adaptar o Atlas ao Windows. Ele lista cada ponto preso ao macOS, com arquivo e linha, o equivalente sugerido no Windows e a ordem de trabalho. Os números de linha valem para o commit em que este guia entrou; se mudarem, procure pelo trecho citado.

O código é comentado em português e explica o porquê de cada decisão. Leia o comentário antes de trocar um trecho: vários detalhes existem para corrigir um problema real que já aconteceu.

## Antes de começar

- **O que já funciona sem mudar:** a tela (`src/tela/`), os cartões, os grupos, o histórico, as estatísticas e o terminal embutido (`node-pty` e `xterm` rodam no Windows). É a maior parte do código.
- **Rede de segurança:** `npm test` (app) e `python3 -m unittest discover -s hook` (hooks) devem continuar passando a cada passo. Alguns testes usam caminhos no formato do Mac (`/Users/m/...`, `/x/...`) e vão precisar de versão para o Windows.
- **Modo demonstração:** `ATLAS_DEMO=1 npm start` (no PowerShell: `$env:ATLAS_DEMO=1; npm start`) abre o app com sessões falsas, sem o Claude Code. É o jeito mais seguro de conferir a tela. Com `ATLAS_DEMO_TESTE=1` ele também manda teclas de verdade e imprime o resultado (ver o começo de `src/demo.js`).
- **Cuidado com o `~/.claude` de quem testa:** o instalador de hooks mexe nas configurações do Claude Code da pessoa. Teste primeiro com um diretório temporário (as funções de `hook/instalar.py` aceitam `base=`) e só depois rode na pasta real. O instalador guarda backup (`.bak-atlas-AAAA-MM-DD`) antes de alterar algo.
- Use `process.platform === 'win32'` para separar os caminhos, mantendo o comportamento do Mac intacto.

## Ordem sugerida

1. Abrir sessões (shell e ambiente)
2. Pastas de dados
3. Hooks
4. Atalhos de teclado
5. Janela, avisos e Dock
6. Instalação e empacotamento
7. Opcionais (Jarvis, barras de uso)

## 1. Abrir sessões: shell e ambiente (o ponto mais delicado)

- `src/pty.js:127`: cada sessão é aberta com `pty.spawn('/bin/zsh', ['-l', '-c', 'exec claude ...'])`. No Windows, abrir o `claude` direto pelo `node-pty` (ou via `powershell.exe -NoLogo -Command claude ...`). O `exec` e as aspas de `linhaDeComando` (`src/pty.js:20`) são de shell POSIX e não servem lá.
- `src/pty.js:66` a `110`: o app pergunta o ambiente (PATH etc.) uma vez a um zsh interativo de login, porque apps abertos pelo Dock não herdam o `~/.zshrc`. No Windows os apps herdam o PATH do usuário, então isso provavelmente vira só `process.env` (com a limpeza de variáveis de `proibida`, `src/pty.js:27`, mantida).
- `src/classificar.js:94`: `spawn('claude', ...)` sem shell. No Windows o `claude` costuma ser `claude.cmd` ou `claude.exe`; resolver o caminho ou usar `shell: true` com cuidado com as aspas.
- `src/nome.js:4`: lista nomes genéricos de terminal (`zsh`, `bash`) para não virarem nome de cartão; acrescentar `powershell`, `pwsh`, `cmd`.

## 2. Pastas de dados

- `src/sessoes.js:8` e `src/config.js:5` montam `~/Library/Application Support/Atlas/...` à mão. Trocar por `app.getPath('userData')` do Electron, que no Windows dá `%APPDATA%\Atlas`. Atenção: esses módulos são testados fora do Electron, então o caminho deve continuar podendo ser passado por parâmetro.
- `src/main.js:34` a `38`: `~/.claude/atlas` e `~/.claude/jarvis` via `os.homedir()` já funcionam no Windows (`C:\Users\<nome>\.claude`).

## 3. Hooks

- `hook/instalar.py:11`: o comando registrado no `settings.json` é de shell POSIX (`[ -n "$ATLAS_SESSAO_ID" ] && python3 ...`). Confirme na documentação do Claude Code qual shell executa hooks no Windows antes de reescrever.
- Os hooks dependem de `python3`, que no Windows muitas vezes não existe (ou é `py`). Alternativa robusta: reescrever `hook/atlas-estado.py` em Node, que já vem com o app, mantendo o mesmo formato de evento gravado em `~/.claude/atlas/<id>.jsonl` (é o que `src/observador.js` e `src/estado.js` leem). Os testes em `hook/test_atlas_estado.py` descrevem o comportamento esperado.
- `hook/avisar.py:34` usa `osascript` para o aviso do sistema. No Windows, o próprio Atlas já avisa por `Notification` do Electron (`src/main.js:76`); o `avisar.py` serve só para sessões fora do Atlas e pode ficar de fora numa primeira versão.

## 4. Atalhos de teclado

- `src/menus.js` já usa `CmdOrCtrl` nos aceleradores, que vira Ctrl no Windows. Atenção ao conflito: **Ctrl+C, Ctrl+D e Ctrl+W têm significado dentro do terminal** (interromper, fim de entrada, apagar palavra). O ⌘D do microfone (`src/menus.js:117`) e o ⌘W de fechar sessão (`src/tela/util.js:23` a `25`) precisam de outro atalho no Windows (por exemplo Ctrl+Shift+D e Ctrl+Shift+W, como fazem os terminais do Windows).
- `src/tela/util.js:23` a `25` e `src/tela/tela.js:556`: os atalhos do app dentro do terminal (⌘1 a ⌘9, ⌘T, ⌘W) conferem `ev.metaKey`, que no Windows é a tecla Windows. Usar `ev.ctrlKey` com Shift (ou Alt+1 a 9 para as posições, mais comum lá), sem roubar teclas que o terminal usa.
- `src/tela/tela.js:25`: abrir link com ⌘ clique (`ev.metaKey`); no Windows, Ctrl clique.
- `src/tela/tela.js:677` a `698`: a lista de atalhos mostrada nas Configurações escreve ⌘ fixo; montar o texto conforme o sistema.

## 5. Janela, avisos e Dock

- `src/main.js:292` a `298`: `titleBarStyle: 'hiddenInset'`, `trafficLightPosition` e `vibrancy` são do macOS. No Windows, usar `titleBarStyle: 'hidden'` com `titleBarOverlay` (botões de minimizar e fechar) ou a barra padrão; `backgroundMaterial: 'mica'` é o mais próximo do vidro fosco no Windows 11.
- `src/main.js:54` a `56`: número de cards vermelhos no Dock (`app.dock.setBadge`). No Windows, `BrowserWindow.setOverlayIcon` (um selo sobre o ícone da barra de tarefas) ou `flashFrame`.
- `src/main.js:77`: os sons `Glass` e `Pop` dos avisos são do macOS; no Windows, omitir `sound` (usa o som padrão).
- `src/main.js:434`: o `SIGTERM` é como o `atualizar.sh` pede para fechar o Atlas no Mac. No Windows não há esse sinal; o instalador novo deve fechar o app de outro jeito (ver item 6).

## 6. Instalação e empacotamento

- `atualizar.sh` e `scripts/criar-certificado.sh` são inteiros do macOS (bash, `codesign`, `security`, `osascript`, `/Applications`, Finder). Não traduzir linha a linha: no Windows, gerar um instalador comum com o próprio `electron-builder` (alvo `nsis`), que já cuida de atalho no Menu Iniciar e na Área de Trabalho e de desinstalação.
- `package.json`: hoje só há a seção `mac` (`arm64`, `build/icon.icns`). Acrescentar uma seção `win` com alvo `nsis`, arquitetura `x64` e um ícone `.ico` (dá para gerar a partir de `identidade/logos/png/atlas-icone-app-escuro-quadrado-1024px.png`).
- `package.json:37`: os `prebuilds` do `node-pty` para `win32-x64` e `win32-arm64` estão **excluídos** do pacote. No build de Windows, eles precisam entrar.
- A instalação dos hooks (hoje `python3 hook/instalar.py` dentro do `atualizar.sh`) precisa de outro gatilho: um passo do instalador, um script `npm`, ou o próprio app na primeira abertura.
- Assinatura: no Mac a identidade fixa evita que o sistema peça permissões de novo. No Windows, sem certificado, o SmartScreen avisa na primeira execução; para uso pessoal dá para seguir sem assinar.

## 7. Opcionais

- **Modo Jarvis** (`src/jarvis.js`, `src/main.js:38` e `39`): liga e desliga a leitura em voz alta criando o arquivo `~/.claude/jarvis/ligado`; `killall say` (`src/main.js:39`) para a fala no Mac. No Windows, se quiser manter, a voz seria pela fala do sistema (SAPI, via PowerShell) e o "parar" mataria esse processo. Pode ficar desligado numa primeira versão.
- **Barras de uso** (`src/uso.js`, `hook/instalar.py:68`): dependem de uma status line em bash com `jq` (`hook/statusline-exemplo.sh`). No Windows, reescrever a status line em PowerShell ou Node, gravando o mesmo `~/.claude/atlas/uso.json`. Sem ela, as barras só não aparecem.

## Como saber que terminou

- `npm test` e os testes dos hooks passando no Windows.
- O modo demonstração abre, mostra os cartões e responde aos atalhos.
- Uma sessão real abre o `claude`, o cartão muda de estado (trabalhando, pede aprovação, pronta) e fechar a sessão com "Salvar e fechar" digita `/salvar` e espera terminar.
- Instalar, desinstalar e instalar de novo sem perder as configurações do Claude Code de quem testa.
