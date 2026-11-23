import json, os, shutil, subprocess, tempfile, time, unittest

import importlib.util

AQUI = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('instalar', os.path.join(AQUI, 'instalar.py'))
instalar = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(instalar)

EXEMPLO = os.path.join(AQUI, 'statusline-exemplo.sh')
AGORA = int(time.time())
ENTRADA = {
    'model': {'display_name': 'Opus'},
    'workspace': {'current_dir': '/Users/m/Projetos/atlas'},
    'rate_limits': {
        'five_hour': {'used_percentage': 42, 'resets_at': AGORA + 2 * 3600 + 300},
        'seven_day': {'used_percentage': 87.5, 'resets_at': (AGORA + 3 * 86400) * 1000},
    },
}


class InstalarUsoTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = self.tmp.name
        self.base = os.path.join(self.home, '.claude')
        os.makedirs(self.base)
        self.script = os.path.join(self.base, 'statusline-uso.sh')
        shutil.copyfile(EXEMPLO, self.script)
        os.chmod(self.script, 0o755)

    def tearDown(self):
        self.tmp.cleanup()

    def rodar(self, script, entrada):
        env = dict(os.environ, HOME=self.home)
        return subprocess.run(['bash', script], input=json.dumps(entrada), text=True,
                              capture_output=True, env=env, timeout=10)

    def backups(self):
        return [n for n in os.listdir(self.base) if n.startswith('statusline-uso.sh.bak-atlas-')]

    def uso(self, espera=3.0):
        caminho = os.path.join(self.home, '.claude', 'atlas', 'uso.json')
        fim = time.time() + espera
        while time.time() < fim:
            if os.path.exists(caminho):
                with open(caminho, encoding='utf-8') as f:
                    return json.load(f)
            time.sleep(0.05)
        return None

    def test_duas_vezes_nao_duplica_e_backup_uma_vez(self):
        self.assertTrue(instalar.instalar_uso(self.base))
        self.assertFalse(instalar.instalar_uso(self.base))
        with open(self.script, encoding='utf-8') as f:
            texto = f.read()
        self.assertEqual(texto.count(instalar.MARCA_USO), 1)
        self.assertEqual(len(self.backups()), 1)
        with open(os.path.join(self.base, self.backups()[0]), encoding='utf-8') as f:
            self.assertNotIn(instalar.MARCA_USO, f.read())
        # Executável continua executável.
        self.assertTrue(os.stat(self.script).st_mode & 0o100)

    def test_linha_logo_depois_do_input(self):
        instalar.instalar_uso(self.base)
        with open(self.script, encoding='utf-8') as f:
            linhas = f.read().split('\n')
        i = linhas.index('input=$(cat)')
        self.assertIn(instalar.MARCA_USO, linhas[i + 1])

    def test_saida_identica_ao_backup_e_grava_uso(self):
        instalar.instalar_uso(self.base)
        backup = os.path.join(self.base, self.backups()[0])
        antes = self.rodar(backup, ENTRADA)
        depois = self.rodar(self.script, ENTRADA)
        self.assertEqual(depois.returncode, antes.returncode)
        self.assertEqual(depois.stdout, antes.stdout)
        self.assertEqual(depois.stderr, '')
        self.assertIn('5h', depois.stdout)
        u = self.uso()
        self.assertEqual(u['five_hour'], ENTRADA['rate_limits']['five_hour'])
        self.assertEqual(u['seven_day'], ENTRADA['rate_limits']['seven_day'])
        self.assertAlmostEqual(u['t'] / 1000, time.time(), delta=10)
        sobras = os.listdir(os.path.join(self.home, '.claude', 'atlas'))
        self.assertEqual(sobras, ['uso.json'])

    def test_sem_rate_limits_nao_grava(self):
        instalar.instalar_uso(self.base)
        entrada = {k: v for k, v in ENTRADA.items() if k != 'rate_limits'}
        r = self.rodar(self.script, entrada)
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout, self.rodar(os.path.join(self.base, self.backups()[0]), entrada).stdout)
        self.assertIsNone(self.uso(espera=0.8))
        pasta = os.path.join(self.home, '.claude', 'atlas')
        self.assertEqual(os.listdir(pasta) if os.path.isdir(pasta) else [], [])

    def test_pasta_impossivel_nao_quebra_a_status_line(self):
        instalar.instalar_uso(self.base)
        # ~/.claude/atlas é um arquivo: mkdir falha, a status line segue igual.
        with open(os.path.join(self.base, 'atlas'), 'w') as f:
            f.write('x')
        backup = os.path.join(self.base, self.backups()[0])
        depois = self.rodar(self.script, ENTRADA)
        self.assertEqual(depois.returncode, 0)
        self.assertEqual(depois.stdout, self.rodar(backup, ENTRADA).stdout)
        self.assertEqual(depois.stderr, '')

    def test_entrada_invalida_nao_quebra(self):
        instalar.instalar_uso(self.base)
        env = dict(os.environ, HOME=self.home)
        r = subprocess.run(['bash', self.script], input='{quebrado', text=True,
                           capture_output=True, env=env, timeout=10)
        b = subprocess.run(['bash', os.path.join(self.base, self.backups()[0])], input='{quebrado',
                           text=True, capture_output=True, env=env, timeout=10)
        self.assertEqual((r.returncode, r.stdout), (b.returncode, b.stdout))
        self.assertIsNone(self.uso(espera=0.8))

    def test_sem_script_nao_faz_nada(self):
        os.remove(self.script)
        self.assertFalse(instalar.instalar_uso(self.base))
        self.assertEqual(os.listdir(self.base), [])

    def test_sem_linha_do_input_nao_mexe(self):
        with open(self.script, 'w', encoding='utf-8') as f:
            f.write('#!/usr/bin/env bash\necho oi\n')
        self.assertFalse(instalar.instalar_uso(self.base))
        with open(self.script, encoding='utf-8') as f:
            self.assertEqual(f.read(), '#!/usr/bin/env bash\necho oi\n')
        self.assertEqual(self.backups(), [])



ANTIGO = 'python3 ~/.claude/hooks/atlas-estado.py 2>/dev/null || true'
JARVIS = 'python3 ~/.claude/hooks/jarvis.py'
AVISAR = 'python3 ~/.claude/hooks/avisar.py'


class InstalarHooksTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = os.path.join(self.tmp.name, '.claude')
        os.makedirs(self.base)
        self.settings = os.path.join(self.base, 'settings.json')

    def tearDown(self):
        self.tmp.cleanup()

    def escrever(self, cfg):
        with open(self.settings, 'w', encoding='utf-8') as f:
            json.dump(cfg, f)

    def ler(self):
        with open(self.settings, encoding='utf-8') as f:
            return json.load(f)

    def comandos(self, cfg, ev):
        return [h['command'] for g in cfg['hooks'].get(ev, []) for h in g.get('hooks', [])]

    def test_comando_so_roda_python_dentro_do_atlas(self):
        self.assertTrue(instalar.COMANDO.startswith('[ -n "$ATLAS_SESSAO_ID" ] && python3 '))
        hook = os.path.join(self.base, 'hooks', 'atlas-estado.py')
        cmd = instalar.COMANDO.replace('~/.claude/hooks/atlas-estado.py', hook)
        pasta = os.path.join(self.tmp.name, 'eventos')
        entrada = json.dumps({'hook_event_name': 'Stop'})
        os.makedirs(os.path.dirname(hook))
        shutil.copyfile(os.path.join(AQUI, 'atlas-estado.py'), hook)
        fora = {k: v for k, v in os.environ.items() if k != 'ATLAS_SESSAO_ID'}
        fora['ATLAS_PASTA'] = pasta
        r = subprocess.run(['sh', '-c', cmd], input=entrada, text=True, capture_output=True, env=fora)
        self.assertEqual((r.returncode, r.stdout, r.stderr), (0, '', ''))
        self.assertFalse(os.path.exists(pasta))
        dentro = dict(fora, ATLAS_SESSAO_ID='abc12345')
        r = subprocess.run(['sh', '-c', cmd], input=entrada, text=True, capture_output=True, env=dentro)
        self.assertEqual(r.returncode, 0)
        self.assertEqual(os.listdir(pasta), ['abc12345.jsonl'])

    def test_troca_o_comando_antigo_sem_mexer_nos_outros(self):
        cfg = {'model': 'opus', 'hooks': {
            'Stop': [{'matcher': '', 'hooks': [{'type': 'command', 'command': JARVIS}]},
                     {'matcher': '', 'hooks': [{'type': 'command', 'command': ANTIGO, 'timeout': 5}]}],
            'Notification': [{'matcher': '', 'hooks': [{'type': 'command', 'command': AVISAR},
                                                      {'type': 'command', 'command': ANTIGO, 'timeout': 5}]}],
        }}
        self.escrever(cfg)
        self.assertTrue(instalar.instalar(self.base))
        novo = self.ler()
        self.assertEqual(novo['model'], 'opus')
        self.assertEqual(self.comandos(novo, 'Stop'), [JARVIS, instalar.COMANDO])
        self.assertEqual(self.comandos(novo, 'Notification'), [AVISAR, instalar.COMANDO])
        for ev in instalar.EVENTOS:
            self.assertEqual(self.comandos(novo, ev).count(instalar.COMANDO), 1, ev)
            self.assertNotIn(ANTIGO, self.comandos(novo, ev), ev)
        backups = [n for n in os.listdir(self.base) if n.startswith('settings.json.bak-atlas-')]
        self.assertEqual(len(backups), 1)
        with open(os.path.join(self.base, backups[0]), encoding='utf-8') as f:
            self.assertEqual(json.load(f), cfg)
        # Segunda vez: nada muda.
        antes = self.ler()
        self.assertFalse(instalar.instalar(self.base))
        self.assertEqual(self.ler(), antes)

    def test_eventos_cobrem_todos_os_tipos_do_hook(self):
        # Todo evento que o hook entende tem de estar instalado (ex.: PostToolUseFailure).
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            'atlas_estado', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'atlas-estado.py'))
        hook = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(hook)
        self.assertEqual(sorted(instalar.EVENTOS), sorted(hook.TIPOS))
        self.assertIn('PostToolUseFailure', instalar.EVENTOS)
        self.assertIn('StopFailure', instalar.EVENTOS)

    def test_instalacao_antiga_ganha_o_stop_failure_uma_vez(self):
        # Instalado antes do StopFailure: só ele entra, os outros ficam como estavam.
        antigos = [ev for ev in instalar.EVENTOS if ev != 'StopFailure']
        cfg = {'hooks': {ev: [{'matcher': '', 'hooks': [
            {'type': 'command', 'command': instalar.COMANDO, 'timeout': 5}]}] for ev in antigos}}
        cfg['hooks']['Stop'].insert(0, {'matcher': '', 'hooks': [{'type': 'command', 'command': JARVIS}]})
        self.escrever(cfg)
        self.assertTrue(instalar.instalar(self.base))
        novo = self.ler()
        self.assertEqual(self.comandos(novo, 'StopFailure'), [instalar.COMANDO])
        self.assertEqual(self.comandos(novo, 'Stop'), [JARVIS, instalar.COMANDO])
        for ev in antigos:
            self.assertEqual(novo['hooks'][ev], cfg['hooks'][ev], ev)
        antes = self.ler()
        self.assertFalse(instalar.instalar(self.base))
        self.assertEqual(self.ler(), antes)

    def test_sem_hooks_instala_em_todos_os_eventos(self):
        self.escrever({})
        self.assertTrue(instalar.instalar(self.base))
        for ev in instalar.EVENTOS:
            self.assertEqual(self.comandos(self.ler(), ev), [instalar.COMANDO])


class InstalarAvisarTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = os.path.join(self.tmp.name, '.claude')
        self.hooks = os.path.join(self.base, 'hooks')
        os.makedirs(self.hooks)
        self.vivo = os.path.join(self.hooks, 'avisar.py')
        with open(os.path.join(AQUI, 'avisar.py'), encoding='utf-8') as f:
            self.repo = f.read()

    def tearDown(self):
        self.tmp.cleanup()

    def backups(self):
        return [n for n in os.listdir(self.hooks) if n.startswith('avisar.py.bak-atlas-')]

    def ler(self):
        with open(self.vivo, encoding='utf-8') as f:
            return f.read()

    def test_repo_cala_dentro_do_atlas_logo_no_comeco(self):
        self.assertIn('ATLAS_SESSAO_ID', self.repo)
        antes_do_stdin = self.repo.split('json.load(sys.stdin)')[0]
        self.assertIn('os.environ.get("ATLAS_SESSAO_ID")', antes_do_stdin)

    def test_atualiza_com_backup_uma_vez_e_idempotente(self):
        antigo = '#!/usr/bin/env python3\nimport os\nos.environ.get("ATLAS_SESSAO_ID")\nprint("antigo")\n'
        with open(self.vivo, 'w', encoding='utf-8') as f:
            f.write(antigo)
        os.chmod(self.vivo, 0o755)
        self.assertTrue(instalar.instalar_avisar(self.base))
        self.assertEqual(self.ler(), self.repo)
        self.assertTrue(os.stat(self.vivo).st_mode & 0o100, 'continua executável')
        self.assertEqual(len(self.backups()), 1)
        with open(os.path.join(self.hooks, self.backups()[0]), encoding='utf-8') as f:
            self.assertEqual(f.read(), antigo)
        self.assertFalse(instalar.instalar_avisar(self.base))
        self.assertEqual(len(self.backups()), 1)
        self.assertEqual(sorted(os.listdir(self.hooks)), sorted(['avisar.py'] + self.backups()), 'sem temporário sobrando')

    def test_avisar_proprio_da_pessoa_nunca_e_trocado(self):
        proprio = '#!/usr/bin/env python3\nprint("meu aviso")\n'
        with open(self.vivo, 'w', encoding='utf-8') as f:
            f.write(proprio)
        self.assertFalse(instalar.instalar_avisar(self.base))
        self.assertEqual(self.ler(), proprio)
        self.assertEqual(self.backups(), [])

    def test_sem_arquivo_instala_sem_backup(self):
        os.remove(self.vivo) if os.path.exists(self.vivo) else None
        self.assertTrue(instalar.instalar_avisar(self.base))
        self.assertEqual(self.ler(), self.repo)
        self.assertEqual(self.backups(), [])


class InstalarSalvarTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = os.path.join(self.tmp.name, '.claude')
        self.comando = os.path.join(self.base, 'commands', 'salvar.md')
        with open(os.path.join(AQUI, '..', 'comandos', 'salvar.md'), encoding='utf-8') as f:
            self.repo = f.read()

    def tearDown(self):
        self.tmp.cleanup()

    def test_sem_salvar_instala_o_generico_uma_vez(self):
        self.assertTrue(instalar.instalar_salvar(self.base))
        with open(self.comando, encoding='utf-8') as f:
            self.assertEqual(f.read(), self.repo)
        self.assertFalse(instalar.instalar_salvar(self.base))

    def test_comando_proprio_nunca_e_trocado(self):
        os.makedirs(os.path.dirname(self.comando))
        with open(self.comando, 'w', encoding='utf-8') as f:
            f.write('meu salvar')
        self.assertFalse(instalar.instalar_salvar(self.base))
        with open(self.comando, encoding='utf-8') as f:
            self.assertEqual(f.read(), 'meu salvar')

    def test_skill_propria_impede_a_instalacao(self):
        os.makedirs(os.path.join(self.base, 'skills', 'salvar'))
        self.assertFalse(instalar.instalar_salvar(self.base))
        self.assertFalse(os.path.exists(self.comando))


if __name__ == '__main__':
    unittest.main()
