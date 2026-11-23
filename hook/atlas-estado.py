#!/usr/bin/env python3
"""Hook do Atlas: grava cada evento da sessao em ~/.claude/atlas/<ATLAS_SESSAO_ID>.jsonl."""
import json
import os
import subprocess
import sys
import time

# O Atlas mostra só o começo do pedido; o resto só faria o arquivo crescer.
LIMITE_TEXTO = 300

TIPOS = {
    'UserPromptSubmit': 'prompt',
    'PreToolUse': 'pre_tool',
    'PostToolUse': 'post_tool',
    # Ferramenta que falhou não manda PostToolUse: sem isto o pedido de aprovação dela
    # ficaria pendente no Atlas.
    'PostToolUseFailure': 'post_tool',
    'PermissionRequest': 'permissao',
    'Notification': 'notificacao',
    'Stop': 'stop',
    # Vem no lugar do Stop quando um erro da API (limite do plano, falha de login, sobrecarga)
    # acabou a vez: o Atlas sai do amarelo na hora e não conta um /salvar assim como salvo.
    'StopFailure': 'falha_stop',
    'SessionStart': 'inicio',
}


CASCAS = {'sh', 'bash', 'zsh', 'dash', 'ksh'}


def pid_do_claude():
    """Pid do claude que chamou o hook. Ele roda o comando por sh -c, então o pai do python
    costuma ser o sh e o claude é o avô. O Atlas usa isto para ignorar os eventos de um
    claude rodado de dentro da sessão (ele herda o ATLAS_SESSAO_ID)."""
    pai = os.getppid()
    try:
        saida = subprocess.run(['ps', '-o', 'ppid=,comm=', '-p', str(pai)], capture_output=True,
                               text=True, timeout=2).stdout.split(None, 1)
    except Exception:
        return None
    if len(saida) != 2:
        return None
    nome = os.path.basename(saida[1].strip()).lstrip('-')
    return int(saida[0]) if nome in CASCAS else pai


def montar(dados):
    nome = dados.get('hook_event_name')
    tipo = TIPOS.get(nome)
    if not tipo:
        return None
    ev = {'t': int(time.time() * 1000), 'tipo': tipo}
    if tipo == 'prompt':
        ev['texto'] = (dados.get('prompt') or '')[:LIMITE_TEXTO]
    if tipo in ('pre_tool', 'post_tool', 'permissao') and dados.get('tool_name'):
        ev['ferramenta'] = dados['tool_name']
    # tool_use_id liga o pre_tool ao post_tool da mesma chamada; agente separa os
    # subagentes da conversa principal (que não tem agent_id).
    if tipo in ('pre_tool', 'post_tool') and dados.get('tool_use_id'):
        ev['tool_use_id'] = dados['tool_use_id']
    if dados.get('agent_id'):
        ev['agente'] = dados['agent_id']
    if nome == 'PostToolUseFailure':
        ev['falhou'] = True
    if tipo == 'falha_stop' and dados.get('error'):
        ev['erro'] = str(dados['error'])[:LIMITE_TEXTO]
    if tipo == 'notificacao':
        n = dados.get('notification_type')
        if not n:
            msg = str(dados.get('message') or '').lower()
            n = 'permission_prompt' if 'permission' in msg else 'outra'
        ev['notificacao'] = n
    if dados.get('session_id'):
        ev['session_id'] = dados['session_id']
    pid = pid_do_claude()
    if pid:
        ev['pid'] = pid
    return ev


def main():
    sessao = os.environ.get('ATLAS_SESSAO_ID')
    if not sessao or '/' in sessao or sessao.startswith('.'):
        return
    dados = json.loads(sys.stdin.read())
    ev = montar(dados)
    if not ev:
        return
    pasta = os.environ.get('ATLAS_PASTA') or os.path.expanduser('~/.claude/atlas')
    os.makedirs(pasta, exist_ok=True)
    with open(os.path.join(pasta, sessao + '.jsonl'), 'a', encoding='utf-8') as f:
        f.write(json.dumps(ev, ensure_ascii=False) + '\n')


if __name__ == '__main__':
    try:
        main()
    except BaseException:
        pass
    sys.exit(0)
