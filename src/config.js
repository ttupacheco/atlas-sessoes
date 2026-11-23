const path = require('node:path');
const os = require('node:os');
const { lerJson, guardarCorrompido, gravarJson } = require('./arquivo.js');

const CONFIG_PADRAO = path.join(os.homedir(), 'Library', 'Application Support', 'Atlas', 'config.json');

// Tamanho do texto do terminal: inteiro de 10 a 24, padrão 13.
const FONTE_MIN = 10;
const FONTE_MAX = 24;
const FONTE_PADRAO = 13;
const tamanhoFonteValido = (v) => Number.isInteger(v) && v >= FONTE_MIN && v <= FONTE_MAX;

const padrao = () => ({ classificar: true, tamanhoFonte: FONTE_PADRAO });

function carregarConfig(caminho = CONFIG_PADRAO) {
  const dados = lerJson(caminho);
  if (dados === undefined) return padrao();
  if (dados === null || typeof dados !== 'object' || Array.isArray(dados)) {
    guardarCorrompido(caminho);
    return padrao();
  }
  return {
    classificar: typeof dados.classificar === 'boolean' ? dados.classificar : true,
    tamanhoFonte: tamanhoFonteValido(dados.tamanhoFonte) ? dados.tamanhoFonte : FONTE_PADRAO,
  };
}

function salvarConfig(caminho, cfg) {
  gravarJson(caminho, {
    classificar: cfg.classificar !== false,
    tamanhoFonte: tamanhoFonteValido(cfg.tamanhoFonte) ? cfg.tamanhoFonte : FONTE_PADRAO,
  });
}

module.exports = { CONFIG_PADRAO, FONTE_MIN, FONTE_MAX, FONTE_PADRAO, tamanhoFonteValido, carregarConfig, salvarConfig };
