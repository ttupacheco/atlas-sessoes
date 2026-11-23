---
description: Encerra a conversa salvando um resumo dela em Markdown (versão genérica que vem com o Atlas)
---

A conversa está sendo encerrada (o Atlas digita /salvar antes de fechar a sessão). Salve um resumo dela, sem fazer perguntas: o Atlas espera esta resposta terminar para fechar.

1. **Data:** rode `date +"%Y-%m-%d"` (não invente a data).
2. **Pasta:** se o CLAUDE.md do projeto ou do usuário indicar uma pasta de notas de sessão, use essa. Senão, use `~/Documents/Atlas/Sessões/`, criando a pasta se não existir.
3. **Nota:** escreva `<pasta>/AAAA-MM-DD-<assunto-curto>.md` com:
   - `# ` título com a data e o assunto principal;
   - `## O que foi feito / decidido`: tópicos curtos com resultados, números, arquivos e decisões;
   - `## Pendências`: próximos passos em aberto, se houver.
   É um resumo para consultar depois, não a transcrição. Conversa curta pode ter nota curta. Se já existir um arquivo com o mesmo nome, acrescente `-2`, `-3`...
4. **Resposta:** diga em uma linha o caminho da nota criada.
