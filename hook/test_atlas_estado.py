import json, os, subprocess, sys, tempfile, unittest

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'atlas-estado.py')


def rodar(entrada, pasta, sessao='s1'):
    env = dict(os.environ, ATLAS_PASTA=pasta)
    env.pop('ATLAS_SESSAO_ID', None)
    if sessao:
        env['ATLAS_SESSAO_ID'] = sessao
    if not isinstance(entrada, str):
        entrada = json.dumps(entrada)
    return subprocess.run([sys.executable, HOOK], input=entrada, text=True,
                          capture_output=True, env=env)


def linhas(pasta, sessao='s1'):
    caminho = os.path.join(pasta, sessao + '.jsonl')
    if not os.path.exists(caminho):
        return []
    with open(caminho, encoding='utf-8') as f:
        return [json.loads(l) for l in f if l.strip()]


def rodar_pelo_sh(entrada, pasta, sessao='s1'):
    """Como o Claude Code chama: pelo sh, com o comando do instalar.py."""
    env = dict(os.environ, ATLAS_PASTA=pasta, ATLAS_SESSAO_ID=sessao)
    comando = '[ -n "$ATLAS_SESSAO_ID" ] && "%s" "%s" 2>/dev/null || true' % (sys.executable, HOOK)
    return subprocess.run(['/bin/sh', '-c', comando], input=json.dumps(entrada), text=True,
                          capture_output=True, env=env)


class HookTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.pasta = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def test_sem_sessao_nao_grava(self):
        r = rodar({'hook_event_name': 'Stop'}, self.pasta, sessao=None)
        self.assertEqual(r.returncode, 0)
        self.assertEqual(os.listdir(self.pasta), [])

    def test_prompt(self):
        r = rodar({'hook_event_name': 'UserPromptSubmit', 'prompt': 'conferir Impostos',
                   'session_id': 'abc'}, self.pasta)
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout, '')
        ev = linhas(self.pasta)
        self.assertEqual(len(ev), 1)
        self.assertEqual(ev[0]['tipo'], 'prompt')
        self.assertEqual(ev[0]['texto'], 'conferir Impostos')
        self.assertEqual(ev[0]['session_id'], 'abc')
        self.assertIsInstance(ev[0]['t'], int)

    def test_stop_failure_vira_falha_stop(self):
        rodar({'hook_event_name': 'StopFailure', 'error': 'rate_limit', 'session_id': 'abc'},
              self.pasta)
        ev = linhas(self.pasta)
        self.assertEqual(len(ev), 1)
        self.assertEqual(ev[0]['tipo'], 'falha_stop')
        self.assertEqual(ev[0]['erro'], 'rate_limit')
        self.assertEqual(ev[0]['session_id'], 'abc')

    def test_stop_grava_segundo_plano_sem_monitor(self):
        rodar({'hook_event_name': 'Stop', 'background_tasks': [
            {'id': 'b1', 'type': 'shell', 'status': 'running', 'description': 'x', 'command': 'sleep 99'},
            {'id': 'a1', 'type': 'subagent', 'status': 'running', 'description': 'y'},
            {'id': 'm1', 'type': 'monitor', 'status': 'running', 'description': 'z'},
            {'id': 'd1', 'type': 'dream', 'status': 'running', 'description': 'w'}]}, self.pasta)
        rodar({'hook_event_name': 'Stop', 'background_tasks': []}, self.pasta)
        rodar({'hook_event_name': 'Stop'}, self.pasta)
        ev = linhas(self.pasta)
        self.assertEqual(ev[0]['fundo'], ['shell', 'subagent'])
        self.assertEqual(ev[1]['fundo'], [])
        self.assertNotIn('fundo', ev[2])

    def test_notificacao_tipo(self):
        rodar({'hook_event_name': 'Notification', 'notification_type': 'permission_prompt',
               'session_id': 'abc'}, self.pasta)
        self.assertEqual(linhas(self.pasta)[0]['notificacao'], 'permission_prompt')

    def test_notificacao_fallback(self):
        rodar({'hook_event_name': 'Notification', 'message': 'Claude needs your permission'}, self.pasta)
        rodar({'hook_event_name': 'Notification', 'message': 'waiting'}, self.pasta)
        ev = linhas(self.pasta)
        self.assertEqual(ev[0]['notificacao'], 'permission_prompt')
        self.assertEqual(ev[1]['notificacao'], 'outra')

    def test_ferramenta_e_demais_tipos(self):
        for nome, tipo in [('PreToolUse', 'pre_tool'), ('PostToolUse', 'post_tool'),
                           ('PermissionRequest', 'permissao')]:
            rodar({'hook_event_name': nome, 'tool_name': 'Bash'}, self.pasta)
        rodar({'hook_event_name': 'Stop'}, self.pasta)
        rodar({'hook_event_name': 'SessionStart'}, self.pasta)
        ev = linhas(self.pasta)
        self.assertEqual([e['tipo'] for e in ev],
                         ['pre_tool', 'post_tool', 'permissao', 'stop', 'inicio'])
        self.assertEqual(ev[0]['ferramenta'], 'Bash')

    def test_texto_do_prompt_cortado_em_300(self):
        rodar({'hook_event_name': 'UserPromptSubmit', 'prompt': 'ç' * 1000}, self.pasta)
        self.assertEqual(linhas(self.pasta)[0]['texto'], 'ç' * 300)

    def test_stdin_invalido(self):
        r = rodar('isso nao e json', self.pasta)
        self.assertEqual(r.returncode, 0)
        self.assertEqual(linhas(self.pasta), [])

    def test_dois_eventos(self):
        rodar({'hook_event_name': 'UserPromptSubmit', 'prompt': 'a'}, self.pasta)
        rodar({'hook_event_name': 'Stop'}, self.pasta)
        self.assertEqual(len(linhas(self.pasta)), 2)

    def test_pid_do_claude_que_chamou(self):
        # O pid é o do processo que chamou o hook (aqui, este teste), pulando o sh do meio.
        rodar({'hook_event_name': 'Stop'}, self.pasta)
        rodar_pelo_sh({'hook_event_name': 'Stop'}, self.pasta)
        ev = linhas(self.pasta)
        self.assertEqual(ev[0]['pid'], os.getpid())
        self.assertEqual(ev[1]['pid'], os.getpid())

    def test_agente_e_tool_use_id(self):
        # Subagente: o Claude Code manda agent_id; a ferramenta tem tool_use_id no Pre e no Post.
        rodar({'hook_event_name': 'PreToolUse', 'tool_name': 'Read', 'tool_use_id': 'toolu_1',
               'agent_id': 'ag1'}, self.pasta)
        rodar({'hook_event_name': 'PermissionRequest', 'tool_name': 'Bash'}, self.pasta)
        ev = linhas(self.pasta)
        self.assertEqual(ev[0]['tool_use_id'], 'toolu_1')
        self.assertEqual(ev[0]['agente'], 'ag1')
        self.assertNotIn('agente', ev[1], 'conversa principal: sem agente')
        self.assertNotIn('tool_use_id', ev[1])

    def test_falha_da_ferramenta_conta_como_post_tool(self):
        rodar({'hook_event_name': 'PostToolUseFailure', 'tool_name': 'Bash', 'tool_use_id': 'toolu_2'},
              self.pasta)
        ev = linhas(self.pasta)[0]
        self.assertEqual(ev['tipo'], 'post_tool')
        self.assertEqual(ev['ferramenta'], 'Bash')
        self.assertEqual(ev['tool_use_id'], 'toolu_2')
        self.assertTrue(ev['falhou'])


if __name__ == '__main__':
    unittest.main()
