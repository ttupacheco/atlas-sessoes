#!/usr/bin/env python3
"""Instala o hook do Atlas em ~/.claude (idempotente)."""
import datetime
import json
import os
import shutil

EVENTOS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
           'PermissionRequest', 'Notification', 'Stop', 'StopFailure', 'SessionStart']
# Só sessões do Atlas têm ATLAS_SESSAO_ID: no Terminal comum o hook nem chama o python.
COMANDO = '[ -n "$ATLAS_SESSAO_ID" ] && python3 ~/.claude/hooks/atlas-estado.py 2>/dev/null || true'
# Versões antigas do comando, trocadas no lugar pela atual.
ANTIGOS = ('python3 ~/.claude/hooks/atlas-estado.py 2>/dev/null || true',)

# Linha que a status line ganha: grava o uso do plano para o Atlas. Roda em segundo plano,
# com entrada, saída e erros desligados (nunca muda o que a status line mostra nem o código
# de saída) e só grava quando o JSON traz rate_limits. Escrita atômica: temporário + mv.
MARCA_USO = '# atlas-uso'
LINHA_USO = (
    '{ d="$HOME/.claude/atlas"; mkdir -p "$d" && printf \'%s\' "$input"'
    ' | jq -ce \'select(.rate_limits != null) | {five_hour: .rate_limits.five_hour,'
    ' seven_day: .rate_limits.seven_day, t: (now * 1000 | floor)}\' > "$d/.uso.$$.tmp"'
    ' && mv -f "$d/.uso.$$.tmp" "$d/uso.json"; rm -f "$d/.uso.$$.tmp"; }'
    ' </dev/null >/dev/null 2>&1 &  ' + MARCA_USO + ': grava o uso do plano para o Atlas'
)
ANCORA_USO = 'input=$(cat)'


def instalar(base=None):
    base = base or os.path.expanduser('~/.claude')
    aqui = os.path.dirname(os.path.abspath(__file__))
    os.makedirs(os.path.join(base, 'hooks'), exist_ok=True)
    shutil.copyfile(os.path.join(aqui, 'atlas-estado.py'),
                    os.path.join(base, 'hooks', 'atlas-estado.py'))

    caminho = os.path.join(base, 'settings.json')
    with open(caminho, encoding='utf-8') as f:
        cfg = json.load(f)

    backup = caminho + '.bak-atlas-' + datetime.date.today().isoformat()
    if not os.path.exists(backup):
        shutil.copyfile(caminho, backup)

    hooks = cfg.setdefault('hooks', {})
    mudou = False
    for ev in EVENTOS:
        grupos = hooks.setdefault(ev, [])
        for g in grupos:
            for h in g.get('hooks', []):
                if h.get('command') in ANTIGOS:
                    h['command'] = COMANDO
                    mudou = True
        ja = any(h.get('command') == COMANDO for g in grupos for h in g.get('hooks', []))
        if not ja:
            grupos.append({'matcher': '', 'hooks': [
                {'type': 'command', 'command': COMANDO, 'timeout': 5}]})
            mudou = True
    if mudou:
        temp = caminho + '.atlas-tmp'
        with open(temp, 'w', encoding='utf-8') as f:
            json.dump(cfg, f, indent=2, ensure_ascii=False)
            f.write('\n')
        shutil.copymode(caminho, temp)
        os.replace(temp, caminho)
    return mudou


def instalar_uso(base=None):
    """Põe LINHA_USO logo depois de input=$(cat) na status line. Idempotente, com backup."""
    base = base or os.path.expanduser('~/.claude')
    caminho = os.path.join(base, 'statusline-uso.sh')
    if not os.path.exists(caminho):
        return False
    with open(caminho, encoding='utf-8') as f:
        texto = f.read()
    if MARCA_USO in texto:
        return False
    linhas = texto.split('\n')
    if ANCORA_USO not in linhas:
        return False
    backup = caminho + '.bak-atlas-' + datetime.date.today().isoformat()
    if not os.path.exists(backup):
        shutil.copy2(caminho, backup)
    i = linhas.index(ANCORA_USO)
    linhas.insert(i + 1, LINHA_USO)
    temp = caminho + '.atlas-tmp'
    with open(temp, 'w', encoding='utf-8') as f:
        f.write('\n'.join(linhas))
    shutil.copymode(caminho, temp)
    os.replace(temp, caminho)
    return True


def instalar_avisar(base=None):
    """Põe em ~/.claude/hooks/avisar.py a cópia do repo (que se cala dentro do Atlas).
    Só cria quando não existe ou atualiza uma cópia anterior do Atlas (que cita ATLAS_SESSAO_ID):
    um avisar.py próprio da pessoa nunca é trocado. Idempotente: igual não mexe. Backup do
    anterior uma vez por dia, gravação atômica."""
    base = base or os.path.expanduser('~/.claude')
    aqui = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(aqui, 'avisar.py'), encoding='utf-8') as f:
        novo = f.read()
    pasta = os.path.join(base, 'hooks')
    os.makedirs(pasta, exist_ok=True)
    caminho = os.path.join(pasta, 'avisar.py')
    existe = os.path.exists(caminho)
    if existe:
        with open(caminho, encoding='utf-8') as f:
            atual = f.read()
        if atual == novo or 'ATLAS_SESSAO_ID' not in atual:
            return False
        backup = caminho + '.bak-atlas-' + datetime.date.today().isoformat()
        if not os.path.exists(backup):
            shutil.copy2(caminho, backup)
    temp = caminho + '.atlas-tmp'
    try:
        with open(temp, 'w', encoding='utf-8') as f:
            f.write(novo)
        if existe:
            shutil.copymode(caminho, temp)
        else:
            os.chmod(temp, 0o755)
        os.replace(temp, caminho)
    finally:
        if os.path.exists(temp):
            os.remove(temp)
    return True

def instalar_salvar(base=None):
    """Põe o /salvar genérico (comandos/salvar.md) em ~/.claude/commands, só se a pessoa ainda
    não tem um /salvar (comando ou skill). Nunca troca nem atualiza um que já exista."""
    base = base or os.path.expanduser('~/.claude')
    comando = os.path.join(base, 'commands', 'salvar.md')
    if os.path.exists(comando) or os.path.exists(os.path.join(base, 'skills', 'salvar')):
        return False
    aqui = os.path.dirname(os.path.abspath(__file__))
    os.makedirs(os.path.dirname(comando), exist_ok=True)
    shutil.copyfile(os.path.join(aqui, '..', 'comandos', 'salvar.md'), comando)
    return True


if __name__ == '__main__':
    print('settings atualizado' if instalar() else 'ja estava instalado')
    print('status line atualizada' if instalar_uso() else 'status line sem mudanca')
    print('avisar.py atualizado' if instalar_avisar() else 'avisar.py sem mudanca')
    print('/salvar instalado' if instalar_salvar() else '/salvar ja existia, sem mudanca')
