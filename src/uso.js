// Uso do plano (janela de 5 h e semanal), gravado pela status line em ~/.claude/atlas/uso.json
// no formato {"five_hour": {...}, "seven_day": {...}, "t": <ms>}. Só leitura, sem efeitos.
const fs = require('node:fs');

const HORA = 3600 * 1000;
const SEIS_HORAS = 6 * HORA;
const CINCO_HORAS = 5 * HORA;
const FOLGA_RELOGIO = 60 * 1000; // hora do dado no futuro além disso: relógio errado, conta como velho

// resets_at: epoch em s ou ms (número ou texto só com dígitos) ou ISO-8601 (UTC se sem fuso).
function paraMs(v) {
  if (typeof v === 'string' && /^\d+$/.test(v)) v = Number(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v <= 0) return null;
    return v >= 1e12 ? Math.floor(v) : Math.floor(v * 1000);
  }
  if (typeof v !== 'string' || !v) return null;
  const temFuso = /(Z|[+-]\d{2}:?\d{2})$/i.test(v);
  const ms = Date.parse(temFuso ? v : v + 'Z');
  return Number.isFinite(ms) ? ms : null;
}

function janela(j) {
  if (!j || typeof j !== 'object') return null;
  const pct = typeof j.used_percentage === 'number' ? j.used_percentage : Number.NaN;
  if (!Number.isFinite(pct)) return null;
  return { pct, resetaEm: paraMs(j.resets_at) };
}

function lerUso(caminho, agora) {
  let d;
  try { d = JSON.parse(fs.readFileSync(caminho, 'utf8')); } catch { d = null; }
  if (!d || typeof d !== 'object' || Array.isArray(d)) {
    return { cincoHoras: null, semana: null, atualizadoEm: null, velho: true };
  }
  const t = typeof d.t === 'number' && Number.isFinite(d.t) ? d.t : null;
  return {
    cincoHoras: janela(d.five_hour),
    semana: janela(d.seven_day),
    atualizadoEm: t,
    velho: t == null || agora - t > SEIS_HORAS || t - agora > FOLGA_RELOGIO,
  };
}

// Mesmo texto da status line: "reseta em 2h05m", "reseta em 45m", "reseta em 3d4h"; vazio se passou.
function textoReset(resetsAt, agora) {
  const ms = paraMs(resetsAt);
  if (ms == null) return '';
  const resta = Math.floor(ms / 1000) - Math.floor(agora / 1000);
  if (resta <= 0) return '';
  const h = Math.floor(resta / 3600);
  const m = Math.floor((resta % 3600) / 60);
  if (h >= 24) return `reseta em ${Math.floor(h / 24)}d${h % 24}h`;
  if (h > 0) return `reseta em ${h}h${String(m).padStart(2, '0')}m`;
  return `reseta em ${m}m`;
}

// Faixas da status line: até 59% normal, 60 a 84% atenção (amarelo), 85% ou mais alerta (vermelho).
// Sem dado: dado velho (6 h), janela que já resetou (a porcentagem gravada não vale mais) ou,
// sem resets_at, dado mais velho que a própria janela (5 h; a semana fica com as 6 h).
function paraTela(uso, agora) {
  const linha = (rotulo, j, validade) => {
    const vencida = j && (j.resetaEm != null
      ? j.resetaEm <= agora
      : uso.atualizadoEm == null || agora - uso.atualizadoEm > validade);
    if (uso.velho || !j || vencida) return { rotulo, semDado: true };
    const pct = Math.min(100, Math.max(0, Math.floor(j.pct)));
    const faixa = pct >= 85 ? 'alerta' : pct >= 60 ? 'atencao' : 'normal';
    return { rotulo, pct, faixa, reset: textoReset(j.resetaEm, agora) };
  };
  return [linha('5 h', uso.cincoHoras, CINCO_HORAS), linha('Semana', uso.semana, SEIS_HORAS)];
}

module.exports = { lerUso, textoReset, paraTela };
