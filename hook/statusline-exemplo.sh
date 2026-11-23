#!/usr/bin/env bash
# Status line do Claude Code: modelo, pasta e barras de uso (janela de 5h e semanal).
# Recebe o JSON de contexto no stdin.

input=$(cat)

model=$(printf '%s' "$input" | jq -r '.model.display_name // "Claude"')
dir=$(printf '%s' "$input"  | jq -r '.workspace.current_dir // ""')
dir=${dir/#$HOME/\~}
dir=${dir##*/}

# Converte resets_at (epoch em s/ms ou ISO-8601 UTC) em "falta Xh Ym"
reset_em() {
  local v="$1" epoch agora resta h m
  [ -z "$v" ] || [ "$v" = "null" ] && return
  if [[ "$v" =~ ^[0-9]+$ ]]; then
    epoch=$v
    [ ${#v} -ge 13 ] && epoch=$((v / 1000))
  else
    v=${v%Z}; v=${v%%.*}; v=${v%%+*}
    epoch=$(TZ=UTC date -j -f "%Y-%m-%dT%H:%M:%S" "$v" +%s 2>/dev/null) || return
  fi
  agora=$(date +%s)
  resta=$((epoch - agora))
  [ "$resta" -le 0 ] && return
  h=$((resta / 3600)); m=$(((resta % 3600) / 60))
  if [ "$h" -ge 24 ]; then printf 'reseta em %dd%dh' $((h / 24)) $((h % 24))
  elif [ "$h" -gt 0 ]; then printf 'reseta em %dh%02dm' "$h" "$m"
  else printf 'reseta em %dm' "$m"; fi
}

# Barra de 10 blocos, colorida por faixa de uso
barra() {
  local pct=$1 cheios vazios cor
  pct=${pct%.*}
  [ -z "$pct" ] && pct=0
  [ "$pct" -gt 100 ] && pct=100
  cheios=$(((pct + 9) / 10)); vazios=$((10 - cheios))
  if   [ "$pct" -ge 85 ]; then cor=$'\033[31m'   # vermelho
  elif [ "$pct" -ge 60 ]; then cor=$'\033[33m'   # amarelo
  else                         cor=$'\033[32m'   # verde
  fi
  printf '%s' "$cor"
  [ "$cheios" -gt 0 ] && printf '█%.0s' $(seq "$cheios")
  printf $'\033[90m'
  [ "$vazios" -gt 0 ] && printf '░%.0s' $(seq "$vazios")
  printf $'\033[0m %d%%' "$pct"
}

saida=$'\033[36m'"$model"$'\033[0m'
[ -n "$dir" ] && saida+=$'\033[90m · \033[0m'"$dir"

for janela in five_hour:5h seven_day:sem; do
  chave=${janela%%:*}; rotulo=${janela##*:}
  pct=$(printf '%s' "$input" | jq -r ".rate_limits.$chave.used_percentage // empty")
  [ -z "$pct" ] && continue
  reset=$(reset_em "$(printf '%s' "$input" | jq -r ".rate_limits.$chave.resets_at // empty")")
  saida+=$'\033[90m · \033[0m'"$rotulo "$(barra "$pct")
  [ -n "$reset" ] && saida+=$'\033[90m ('"$reset"$')\033[0m'
done

printf '%s' "$saida"
