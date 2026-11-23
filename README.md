# Atlas

App do Mac que abre várias sessões do Claude Code lado a lado, cada uma com um cartão colorido que mostra o estado: trabalhando, pede aprovação, pronta, sem sinal, encerrada.

## Abrir

`/Applications/Atlas.app`, pelo Dock, pelo Spotlight ou pelo atalho **Atlas** na Mesa.

## Atualizar

Peça ao Claude: **"atualiza o Atlas"**. Ele roda `./atualizar.sh` nesta pasta, que:

1. instala as dependências e roda os testes (app e hook);
2. gera o app e assina com a identidade **Atlas Local** (sempre a mesma, para o macOS não pedir de novo as permissões);
3. reinstala o hook no Claude (`hook/instalar.py`);
4. manda o app antigo para o Lixo, instala o novo em `/Applications`, refaz o atalho na Mesa e abre o Atlas (com ambiente limpo, sem nada da sessão que pediu a atualização).

**Pedido de dentro do Atlas** (o caso normal): o script gera, assina e confere, e responde "Pronto para instalar. Feche o Atlas com ⌘Q quando quiser: ele será atualizado e reabrirá sozinho." Nada é fechado: quando você fechar o Atlas (até 2 h depois), a troca acontece sozinha e o Atlas reabre. O andamento fica em `dist/atualizacao.log`. Pedir de novo antes de fechar cancela a espera anterior e prepara a nova.

**Pedido de fora do Atlas** (Terminal comum): se o Atlas estiver aberto, pergunta antes de fechar; com sessão trabalhando, o próprio Atlas confirma na janela dele.

Se algo falhar, ele para e diz o que foi. A identidade Atlas Local é criada uma vez só, com `scripts/criar-certificado.sh` (fica no Keychain de login, vale 10 anos).

## Onde ficam as coisas

- Sessões abertas, com o nome, o título da conversa e a cor de cada uma: `~/Library/Application Support/Atlas/sessoes.json`
- Eventos de estado das sessões: `~/.claude/atlas/` (um arquivo por sessão, gravado pelo hook `~/.claude/hooks/atlas-estado.py`). Sessões abertas no Terminal comum não gravam nada aqui (o comando do hook só chama o python quando a sessão é do Atlas). O arquivo de uma sessão é apagado quando ela é fechada.
- Uso do plano (5 h e semana): `~/.claude/atlas/uso.json`, gravado pela status line do Claude (`~/.claude/statusline-uso.sh`, linha marcada com `# atlas-uso`).

## Desligar os hooks

O instalador guarda uma cópia com a data (`.bak-atlas-AAAA-MM-DD`). Use a **mais antiga**, que é a de antes do Atlas (a primeira é de 2026-11-21):

- Hooks: `cp ~/.claude/settings.json.bak-atlas-AAAA-MM-DD ~/.claude/settings.json` (ou apague no `settings.json` os itens com `atlas-estado.py`; a cópia `.bak-atlas-antes-guarda-*` é a de logo antes da troca do comando pelo que só roda dentro do Atlas).
- Status line: `cp ~/.claude/statusline-uso.sh.bak-atlas-AAAA-MM-DD ~/.claude/statusline-uso.sh` (ou apague a linha com `# atlas-uso`).

Atenção: o `./atualizar.sh` reinstala os dois. Depois de desligar, não rode a atualização.
