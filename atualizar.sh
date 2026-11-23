#!/bin/bash
# Atualiza o Atlas instalado: testa, gera o app, assina com "Atlas Local", troca o
# /Applications/Atlas.app (o antigo vai para o Lixo), refaz o atalho na Mesa e abre.
# Para no primeiro erro, menos o hook depois da troca (segue e acusa no fim, ver abaixo).
#
# Rodado de dentro do Atlas (pedido a uma sessão dele, que tem ATLAS_SESSAO_ID): gera,
# assina e confere como sempre, mas não fecha o Atlas (fechar mataria a própria sessão que
# roda este script). Deixa um finalizador solto, fora do Atlas, que espera o usuário fechar
# o Atlas com ⌘Q (até 2 h) e então troca o app, instala o hook, refaz o atalho e reabre.
# O hook vem sempre depois do app: o avisar.py novo se cala dentro do Atlas, então só pode
# entrar quando o Atlas novo (que avisa sozinho) já está no lugar. Se o hook falhar, o app
# novo com o hook velho só dá aviso em dobro, que é o lado seguro.
# O que ele faz fica em dist/atualizacao.log.
#
#   ./atualizar.sh            atualiza
#   ./atualizar.sh --plano    só diz qual caminho seria seguido (agora ou ao fechar)
#   ./atualizar.sh --concluir uso interno: o finalizador
set -uo pipefail
cd "$(dirname "$0")" || exit 1
AQUI=$(pwd)
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"

IDENTIDADE="Atlas Local"
# ATLAS_TESTE_*: só para testar o finalizador sem tocar no Atlas de verdade.
DESTINO="${ATLAS_TESTE_DESTINO:-/Applications/Atlas.app}"
NOVO="$(dirname "$DESTINO")/.Atlas.new.app"
GERADO="$AQUI/dist/mac-arm64/Atlas.app"
LOG_ASSINATURA="$AQUI/dist/assinatura.log"
LOG_ATUALIZACAO="$AQUI/dist/atualizacao.log"
MESA="${ATLAS_TESTE_MESA:-$HOME/Desktop}"
ATALHO="$MESA/Atlas"
ESPERA_MAX="${ATLAS_TESTE_ESPERA:-7200}"
FINALIZADOR="$AQUI/atualizar.sh --concluir"
# Hook falhou com o app novo já no lugar: segue (atalho e abrir) e acusa o erro no fim.
AVISO_HOOK="a instalação do hook falhou. O app novo está em $DESTINO; os avisos podem sair em dobro até rodar ./atualizar.sh de novo."

passo() { printf '\n==> %s\n' "$1"; }
falha() { printf '\nERRO: %s\n' "$1" >&2; exit 1; }
carimbo() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1"; }

# "ao-fechar" dentro de uma sessão do Atlas, "agora" fora dele.
modo() {
  if [ -n "${ATLAS_SESSAO_ID:-}" ]; then echo ao-fechar; else echo agora; fi
}

# Assina de dentro para fora: binários soltos, depois frameworks e apps auxiliares
# (os mais fundos primeiro) e por fim o app. Sem hardened runtime (uso pessoal).
# Erros do codesign vão para $LOG_ASSINATURA (o fim aparece se der errado).
assinar() {
  local app="$1" f
  local sign=(codesign --force --timestamp=none --sign "$IDENTIDADE")
  while IFS= read -r -d '' f; do
    if file -b "$f" | grep -q 'Mach-O'; then
      "${sign[@]}" "$f" 2>>"$LOG_ASSINATURA" || return 1
    fi
  done < <(find "$app/Contents" -type f -print0)
  while IFS= read -r f; do
    "${sign[@]}" "$f" 2>>"$LOG_ASSINATURA" || return 1
  done < <(find "$app/Contents/Frameworks" -depth -type d \( -name '*.framework' -o -name '*.app' \))
  "${sign[@]}" "$app" 2>>"$LOG_ASSINATURA"
}

atlas_aberto() { pgrep -f "^$DESTINO/Contents/MacOS/Atlas" >/dev/null 2>&1; }

instalar_hook() {
  if [ "${ATLAS_TESTE_SEM_HOOK:-}" = 1 ]; then echo "(teste: hook não instalado)"; return 0; fi
  python3 "$AQUI/hook/instalar.py"
}

# Copia ao lado primeiro; o Atlas antigo só sai quando o novo está inteiro e conferido.
trocar_app() {
  rm -rf "$NOVO"
  ditto "$GERADO" "$NOVO" || { rm -rf "$NOVO"; falha "não consegui copiar o app para $(dirname "$DESTINO") (o Atlas antigo continua lá)."; }
  codesign --verify --deep --strict "$NOVO" \
    || { rm -rf "$NOVO"; falha "a assinatura da cópia não confere (o Atlas antigo continua lá)."; }
  if [ -e "$DESTINO" ]; then
    trash "$DESTINO" || { rm -rf "$NOVO"; falha "não consegui mandar o Atlas antigo para o Lixo."; }
  fi
  mv "$NOVO" "$DESTINO" || falha "não consegui pôr o app novo em $DESTINO (ele ficou em $NOVO; o antigo está no Lixo)."
}

# O atalho antigo aponta para o app que foi para o Lixo: refaz. Se o Finder não deixar
# (o finalizador roda fora de qualquer app), fica um link simbólico, que abre igual.
refazer_atalho() {
  if [ -e "$ATALHO" ] || [ -L "$ATALHO" ]; then
    rm -f "$ATALHO" || { echo "AVISO: não consegui tirar o atalho antigo da Mesa."; return 1; }
  fi
  if osascript -e 'tell application "Finder" to make alias file to POSIX file "'"$DESTINO"'" at POSIX file "'"$MESA"'" with properties {name:"Atlas"}' >/dev/null \
    && [ -f "$ATALHO" ]; then
    echo "Atalho: $ATALHO"
  elif ln -s "$DESTINO" "$ATALHO"; then
    echo "AVISO: o Finder não criou o atalho; ficou um link simbólico em $ATALHO."
  else
    echo "AVISO: não consegui criar o atalho na Mesa."
    return 1
  fi
}

# Abre com ambiente limpo: nada da sessão que rodou este script (CLAUDECODE, CLAUDE_CODE_*,
# ATLAS_*) passa para o Atlas e dele para as sessões.
abrir_limpo() {
  if [ "${ATLAS_TESTE_SEM_ABRIR:-}" = 1 ]; then echo "(teste: não abri $DESTINO)"; return 0; fi
  env -i HOME="$HOME" USER="$USER" LOGNAME="${LOGNAME:-$USER}" PATH=/usr/bin:/bin:/usr/sbin:/sbin \
    open -a "$DESTINO"
}

# Finalizador: solto do Atlas, espera ele fechar, instala e reabre. Nunca fecha o Atlas.
concluir() {
  carimbo "Finalizador começou (pid $$). Esperando o Atlas fechar (até $ESPERA_MAX s)."
  local limite=$((SECONDS + ESPERA_MAX))
  while atlas_aberto; do
    if [ "$SECONDS" -ge "$limite" ]; then
      carimbo "O Atlas não fechou a tempo. Nada foi trocado; rode ./atualizar.sh de novo quando quiser."
      exit 1
    fi
    sleep 2
  done
  carimbo "Atlas fechado. Instalando."
  [ -d "$GERADO" ] || falha "o app gerado sumiu de $GERADO."
  codesign --verify --deep --strict "$GERADO" || falha "a assinatura do app gerado não confere."
  trocar_app
  carimbo "App trocado em $DESTINO."
  local hook_ok=1
  if instalar_hook; then carimbo "Hook instalado."; else hook_ok=0; carimbo "AVISO: $AVISO_HOOK"; fi
  refazer_atalho
  abrir_limpo || falha "não consegui abrir o Atlas."
  [ "$hook_ok" = 1 ] || falha "Atlas atualizado e aberto, mas $AVISO_HOOK"
  carimbo "Pronto. Atlas atualizado e aberto."
}

# Solta o finalizador do Atlas: dois forks e setsid (sem terminal, sem grupo do pty), entrada
# vazia e saída no log. Assim ⌘Q no Atlas não o leva junto.
soltar_finalizador() {
  python3 - "$LOG_ATUALIZACAO" "$AQUI/atualizar.sh" <<'PY'
import os, sys
log, script = sys.argv[1], sys.argv[2]
if os.fork():
    sys.exit(0)
os.setsid()
if os.fork():
    os._exit(0)
os.chdir('/')
nulo = os.open('/dev/null', os.O_RDONLY)
os.dup2(nulo, 0)
saida = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
os.dup2(saida, 1)
os.dup2(saida, 2)
os.execv('/bin/bash', ['/bin/bash', script, '--concluir'])
PY
}

case "${1:-}" in
  --plano)
    echo "$(modo)"
    exit 0
    ;;
  --concluir)
    concluir
    exit 0
    ;;
  "") ;;
  *) falha "opção desconhecida: $1" ;;
esac

# Um finalizador de uma atualização anterior ainda esperando: este o substitui (o dist/ vai
# ser refeito).
if pgrep -f "^/bin/bash $FINALIZADOR" >/dev/null 2>&1; then
  passo "Cancelando a atualização anterior que esperava o Atlas fechar"
  pkill -TERM -f "^/bin/bash $FINALIZADOR"
fi

security find-certificate -c "$IDENTIDADE" >/dev/null 2>&1 \
  || falha "a identidade \"$IDENTIDADE\" não está no Keychain. Rode antes: scripts/criar-certificado.sh"

passo "Instalando dependências (npm ci)"
npm ci || falha "npm ci falhou."

passo "Testes do app (npm test)"
npm test || falha "os testes do app falharam."

passo "Testes do hook"
python3 -m unittest discover -s hook || falha "os testes do hook falharam."

passo "Gerando o app"
rm -rf dist
# O aviso "skipped macOS application code signing" é esperado: o electron-builder só aceita
# identidade confiável pelo sistema; a assinatura com "Atlas Local" é feita logo abaixo.
npx electron-builder --mac --arm64 || falha "o electron-builder falhou."
[ -d "$GERADO" ] || falha "o app gerado não apareceu em $GERADO."

passo "Assinando com \"$IDENTIDADE\""
: > "$LOG_ASSINATURA"
if ! assinar "$GERADO"; then
  tail -n 20 "$LOG_ASSINATURA" >&2
  falha "a assinatura falhou (codesign). Detalhes em $LOG_ASSINATURA."
fi
codesign --verify --deep --strict "$GERADO" || falha "a assinatura não confere."
info=$(codesign -dvv "$GERADO" 2>&1)
grep -qx "Authority=$IDENTIDADE" <<<"$info" \
  || falha "o app não ficou assinado por \"$IDENTIDADE\"."
echo "Assinado e conferido."

if [ "$(modo)" = ao-fechar ]; then
  passo "Preparando a instalação para quando o Atlas fechar"
  soltar_finalizador || falha "não consegui deixar a instalação esperando o Atlas fechar."
  sleep 1
  pgrep -f "^/bin/bash $FINALIZADOR" >/dev/null 2>&1 \
    || falha "o finalizador não ficou rodando. Detalhes em $LOG_ATUALIZACAO."
  echo "Pronto para instalar. Feche o Atlas com ⌘Q quando quiser: ele será atualizado e reabrirá sozinho."
  echo "(o andamento fica em $LOG_ATUALIZACAO)"
  exit 0
fi

if atlas_aberto; then
  passo "Fechando o Atlas"
  if [ ! -t 0 ]; then
    falha "o Atlas está aberto e não dá para perguntar aqui. Feche o Atlas e rode de novo."
  fi
  read -r -p "O Atlas está aberto. Fechar para atualizar? (s/n) " resp
  case "$resp" in
    s|S|sim|Sim) ;;
    *) falha "atualização cancelada: o Atlas continua aberto." ;;
  esac
  pkill -TERM -f "^$DESTINO/Contents/MacOS/Atlas"
  # Com sessão trabalhando ou não salva, o Atlas pergunta na janela dele antes de fechar. Com
  # "Salvar todas e sair" ele só fecha quando o último /salvar termina: espera até 15 min.
  echo "Se o Atlas perguntar na janela dele, responda lá."
  echo "Esperando o Atlas terminar de salvar as sessões…"
  for _ in $(seq 1 900); do atlas_aberto || break; sleep 1; done
  atlas_aberto && falha "o Atlas não fechou em 15 min (Cancelar na janela, ou sem resposta). Nada foi trocado; rode de novo quando quiser."
fi

passo "Instalando em $DESTINO"
trocar_app

# Depois do app, nunca antes: ver o comentário do topo.
passo "Instalando o hook no Claude"
hook_ok=1
instalar_hook || { hook_ok=0; echo "AVISO: $AVISO_HOOK"; }

passo "Atalho na Mesa"
refazer_atalho || falha "não consegui criar o atalho na Mesa."

passo "Abrindo o Atlas"
abrir_limpo || falha "não consegui abrir o Atlas."
[ "$hook_ok" = 1 ] || falha "Atlas atualizado e aberto, mas $AVISO_HOOK"
echo "Pronto. Atlas atualizado."
