const fs = require('node:fs');

// Chama aoMudar(id) quando ~/.claude/atlas/<id>.jsonl muda.
function observar(pasta, aoMudar) {
  fs.mkdirSync(pasta, { recursive: true });
  const w = fs.watch(pasta, (_tipo, nome) => {
    const m = /^([a-z0-9]+)\.jsonl$/.exec(String(nome || ''));
    if (m) aoMudar(m[1]);
  });
  // Pasta apagada ou watch falhou: o timer de 5 s segue relendo os arquivos.
  w.on('error', (err) => console.error('observador:', err.message));
  return w;
}

module.exports = { observar };
