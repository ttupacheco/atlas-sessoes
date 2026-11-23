const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { lerUso, textoReset, paraTela } = require('../src/uso.js');

const MIN = 60000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
const AGORA = Date.UTC(2026, 10, 21, 12, 0, 0); // 21/11/2026 12:00 UTC

function arquivo(conteudo) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-uso-'));
  const c = path.join(d, 'uso.json');
  if (conteudo != null) fs.writeFileSync(c, typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo));
  return c;
}

const VAZIO = { cincoHoras: null, semana: null, atualizadoEm: null, velho: true };

test('arquivo ausente: tudo nulo e velho', () => {
  assert.deepEqual(lerUso(arquivo(null), AGORA), VAZIO);
});

test('JSON inválido ou fora do formato: tudo nulo', () => {
  assert.deepEqual(lerUso(arquivo('{nao é json'), AGORA), VAZIO);
  assert.deepEqual(lerUso(arquivo('null'), AGORA), VAZIO);
  assert.deepEqual(lerUso(arquivo('[1,2]'), AGORA), VAZIO);
});

test('resets_at em segundos, em milissegundos e ISO viram milissegundos', () => {
  const reset = AGORA + 2 * HORA;
  const u = lerUso(arquivo({
    five_hour: { used_percentage: 42, resets_at: reset / 1000 },
    seven_day: { used_percentage: 87.6, resets_at: reset },
    t: AGORA - MIN,
  }), AGORA);
  assert.deepEqual(u.cincoHoras, { pct: 42, resetaEm: reset });
  assert.deepEqual(u.semana, { pct: 87.6, resetaEm: reset });
  assert.equal(u.atualizadoEm, AGORA - MIN);
  assert.equal(u.velho, false);

  const iso = lerUso(arquivo({
    five_hour: { used_percentage: 10, resets_at: '2026-11-21T14:00:00.000Z' },
    seven_day: { used_percentage: 20, resets_at: '2026-11-21T14:00:00+00:00' },
    t: AGORA,
  }), AGORA);
  assert.equal(iso.cincoHoras.resetaEm, reset);
  assert.equal(iso.semana.resetaEm, reset);
  // Texto em string com só dígitos também é epoch.
  const txt = lerUso(arquivo({ five_hour: { used_percentage: 1, resets_at: String(reset / 1000) }, t: AGORA }), AGORA);
  assert.equal(txt.cincoHoras.resetaEm, reset);
});

test('janela sem porcentagem ou ausente fica nula; resets_at inválido vira null', () => {
  const u = lerUso(arquivo({ five_hour: { resets_at: 1 }, seven_day: { used_percentage: 5, resets_at: 'ontem' }, t: AGORA }), AGORA);
  assert.equal(u.cincoHoras, null);
  assert.deepEqual(u.semana, { pct: 5, resetaEm: null });
});

test('dado com mais de 6 h (ou sem hora) é velho', () => {
  const base = { five_hour: { used_percentage: 1, resets_at: AGORA / 1000 } };
  assert.equal(lerUso(arquivo({ ...base, t: AGORA - 6 * HORA }), AGORA).velho, false);
  assert.equal(lerUso(arquivo({ ...base, t: AGORA - 6 * HORA - 1 }), AGORA).velho, true);
  assert.equal(lerUso(arquivo(base), AGORA).velho, true);
});

test('textoReset no formato da status line', () => {
  assert.equal(textoReset(AGORA + 2 * HORA + 5 * MIN, AGORA), 'reseta em 2h05m');
  assert.equal(textoReset(AGORA + 45 * MIN + 30000, AGORA), 'reseta em 45m');
  assert.equal(textoReset(AGORA + 3 * DIA + 4 * HORA + 20 * MIN, AGORA), 'reseta em 3d4h');
  assert.equal(textoReset(AGORA, AGORA), '');
  assert.equal(textoReset(AGORA - MIN, AGORA), '');
  assert.equal(textoReset(null, AGORA), '');
  // Aceita também o valor cru (segundos ou ISO).
  assert.equal(textoReset((AGORA + 45 * MIN) / 1000, AGORA), 'reseta em 45m');
  assert.equal(textoReset('2026-11-21T14:05:00Z', AGORA), 'reseta em 2h05m');
});

test('paraTela: faixas da status line, texto do reset e linha sem dado', () => {
  const u = {
    cincoHoras: { pct: 42.7, resetaEm: AGORA + 2 * HORA + 5 * MIN },
    semana: { pct: 87, resetaEm: AGORA + 3 * DIA + 4 * HORA },
    atualizadoEm: AGORA, velho: false,
  };
  assert.deepEqual(paraTela(u, AGORA), [
    { rotulo: '5 h', pct: 42, faixa: 'normal', reset: 'reseta em 2h05m' },
    { rotulo: 'Semana', pct: 87, faixa: 'alerta', reset: 'reseta em 3d4h' },
  ]);
  const faixa = (pct) => paraTela({ ...u, cincoHoras: { pct, resetaEm: null } }, AGORA)[0].faixa;
  assert.equal(faixa(59.9), 'normal');
  assert.equal(faixa(60), 'atencao');
  assert.equal(faixa(84), 'atencao');
  assert.equal(faixa(85), 'alerta');
  assert.equal(paraTela({ ...u, cincoHoras: { pct: 130, resetaEm: null } }, AGORA)[0].pct, 100);

  const semDado = [{ rotulo: '5 h', semDado: true }, { rotulo: 'Semana', semDado: true }];
  assert.deepEqual(paraTela({ ...u, velho: true }, AGORA), semDado);
  assert.deepEqual(paraTela(lerUso(arquivo(null), AGORA), AGORA), semDado);
  assert.deepEqual(paraTela({ ...u, semana: null }, AGORA)[1], { rotulo: 'Semana', semDado: true });
});

test('revisão: janela que já resetou vira sem dado', () => {
  const u = {
    cincoHoras: { pct: 90, resetaEm: AGORA - HORA },
    semana: { pct: 50, resetaEm: AGORA },
    atualizadoEm: AGORA - 2 * HORA, velho: false,
  };
  assert.deepEqual(paraTela(u, AGORA), [{ rotulo: '5 h', semDado: true }, { rotulo: 'Semana', semDado: true }]);
  // Pelo caminho todo: resets_at em segundos já no passado.
  const f = arquivo({ five_hour: { used_percentage: 90, resets_at: (AGORA - HORA) / 1000 }, t: AGORA - 2 * HORA });
  assert.deepEqual(paraTela(lerUso(f, AGORA), AGORA)[0], { rotulo: '5 h', semDado: true });
});

test('revisão: sem resets_at, 5 h vale por 5 h e semana por 6 h', () => {
  const u = (idade) => ({
    cincoHoras: { pct: 30, resetaEm: null }, semana: { pct: 40, resetaEm: null },
    atualizadoEm: AGORA - idade, velho: false,
  });
  const [cinco, semana] = paraTela(u(5 * HORA), AGORA);
  assert.equal(cinco.pct, 30);
  assert.equal(semana.pct, 40);
  const [cinco2, semana2] = paraTela(u(5 * HORA + 1), AGORA);
  assert.deepEqual(cinco2, { rotulo: '5 h', semDado: true });
  assert.equal(semana2.pct, 40);
});

test('revisão: hora do dado mais de 1 min no futuro é velha', () => {
  const base = { five_hour: { used_percentage: 1, resets_at: AGORA / 1000 + 3600 } };
  assert.equal(lerUso(arquivo({ ...base, t: AGORA + MIN }), AGORA).velho, false);
  assert.equal(lerUso(arquivo({ ...base, t: AGORA + MIN + 1 }), AGORA).velho, true);
});
