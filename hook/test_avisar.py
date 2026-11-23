import io, json, os, runpy, unittest
from unittest import mock

AVISAR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'avisar.py')


def rodar(entrada, sessao=None):
    """Roda o avisar.py com subprocess.run trocado por um falso. Devolve as chamadas."""
    env = {k: v for k, v in os.environ.items() if k != 'ATLAS_SESSAO_ID'}
    if sessao:
        env['ATLAS_SESSAO_ID'] = sessao
    with mock.patch.dict(os.environ, env, clear=True), \
            mock.patch('subprocess.run') as run, \
            mock.patch('sys.stdin', io.StringIO(json.dumps(entrada))):
        try:
            runpy.run_path(AVISAR, run_name='__main__')
        except SystemExit as e:
            if e.code not in (None, 0):
                raise
        return run.call_args_list


class AvisarTest(unittest.TestCase):
    def test_dentro_do_atlas_fica_calado(self):
        for evento in ('Stop', 'Notification'):
            chamadas = rodar({'hook_event_name': evento, 'cwd': '/Users/m/Projetos/atlas'}, sessao='abc12345')
            self.assertEqual(chamadas, [], evento)

    def test_fora_do_atlas_avisa_como_antes(self):
        chamadas = rodar({'hook_event_name': 'Stop', 'cwd': '/Users/m/Projetos/atlas'})
        self.assertEqual(len(chamadas), 1)
        argv = chamadas[0].args[0]
        self.assertEqual(argv[0], 'osascript')
        self.assertIn('atlas · terminou', argv[2])
        self.assertIn('sound name "Pop"', argv[2])
        chamadas = rodar({'hook_event_name': 'Notification', 'cwd': '/x/Pedidos', 'message': 'Aprovar?'})
        self.assertIn('Pedidos · precisa de você', chamadas[0].args[0][2])
        self.assertIn('sound name "Glass"', chamadas[0].args[0][2])

    def test_variavel_vazia_conta_como_fora(self):
        chamadas = rodar({'hook_event_name': 'Stop', 'cwd': '/x/a'}, sessao='')
        self.assertEqual(len(chamadas), 1)


if __name__ == '__main__':
    unittest.main()
