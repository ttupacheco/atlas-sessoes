// Modo Jarvis: o Mac lê em voz alta o começo de cada resposta do Claude.
// Ligado = existe o arquivo `ligado` na pasta (~/.claude/jarvis); a skill /jarvis usa a mesma regra.
const fs = require('node:fs');
const path = require('node:path');

const arquivo = (pasta, nome) => path.join(pasta, nome);

function estaLigado(pasta) {
  try { return fs.statSync(arquivo(pasta, 'ligado')).isFile(); } catch { return false; }
}

function ligar(pasta) {
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(arquivo(pasta, 'ligado'), '');
}

// Apaga o arquivo e pede para parar qualquer fala em andamento. Erro do matarSay é ignorado.
function desligar(pasta, matarSay) {
  fs.rmSync(arquivo(pasta, 'ligado'), { force: true });
  try { if (typeof matarSay === 'function') matarSay(); } catch { /* sem fala em andamento */ }
}

// Nome da voz em `voz`, ou null se o arquivo não existe ou está vazio.
function vozAtual(pasta) {
  try {
    const nome = fs.readFileSync(arquivo(pasta, 'voz'), 'utf8').trim().split('\n')[0].trim();
    return nome || null;
  } catch { return null; }
}

module.exports = { estaLigado, ligar, desligar, vozAtual };
