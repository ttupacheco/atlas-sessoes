#!/usr/bin/env python3
"""Aviso no Mac quando uma sessão do Claude termina ou pede aprovação.
Mostra o nome da pasta (projeto) para saber qual terminal olhar."""
import json, os, subprocess, sys

# Dentro do Atlas quem avisa é o próprio Atlas (com o nome do cartão e o clique que leva
# à sessão): aqui fica calado para não sair aviso em dobro. Fora dele nada muda.
if os.environ.get("ATLAS_SESSAO_ID"):
    sys.exit(0)

try:
    d = json.load(sys.stdin)
except Exception:
    d = {}

projeto = os.path.basename((d.get("cwd") or os.getcwd()).rstrip("/")) or "Claude"
if projeto == os.path.basename(os.path.expanduser("~").rstrip("/")):
    projeto = "Geral"
evento = d.get("hook_event_name", "")

if evento == "Notification":
    titulo = f"⏳ {projeto} · precisa de você"
    texto = d.get("message") or "O Claude está esperando uma resposta."
    som = "Glass"
else:
    titulo = f"✅ {projeto} · terminou"
    texto = "A resposta está pronta."
    som = "Pop"

def q(s):
    return s.replace("\\", "\\\\").replace('"', '\\"')

subprocess.run(
    ["osascript", "-e",
     f'display notification "{q(texto)}" with title "{q(titulo)}" sound name "{som}"'],
    timeout=5,
)
