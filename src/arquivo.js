const fs = require('node:fs');
const path = require('node:path');

// Lê um JSON; ausente devolve undefined, estragado é guardado ao lado como .corrompido-<ms>
// (antes que a próxima gravação o apague) e também devolve undefined.
function lerJson(caminho) {
  let bruto;
  try {
    bruto = fs.readFileSync(caminho, 'utf8');
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(bruto);
  } catch {
    guardarCorrompido(caminho);
    return undefined;
  }
}

function guardarCorrompido(caminho) {
  try { fs.renameSync(caminho, `${caminho}.corrompido-${Date.now()}`); } catch { /* segue com os padrões */ }
}

// Temporário + rename: um corte no meio (app fechado, Mac desligado) nunca deixa meio arquivo.
function gravarJson(caminho, dados) {
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  const temp = `${caminho}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(dados, null, 2) + '\n');
    fs.renameSync(temp, caminho);
  } catch (err) {
    try { fs.rmSync(temp, { force: true }); } catch { /* nada */ }
    throw err;
  }
}

module.exports = { lerJson, guardarCorrompido, gravarJson };
