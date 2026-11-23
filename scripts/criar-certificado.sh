#!/bin/bash
# Cria no Keychain de login a identidade de assinatura "Atlas Local" (autoassinada, 10 anos).
# Roda uma vez; se ela já existe, não faz nada. Assinar sempre com a mesma identidade faz o
# macOS reconhecer o Atlas como o mesmo app a cada atualização (as permissões continuam).
set -euo pipefail

NOME="Atlas Local"
CHAVEIRO="$HOME/Library/Keychains/login.keychain-db"

falha() { echo "ERRO: $*" >&2; exit 1; }

if security find-certificate -c "$NOME" "$CHAVEIRO" >/dev/null 2>&1; then
  echo "A identidade \"$NOME\" já existe no Keychain. Nada a fazer."
  exit 0
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
SENHA=$(openssl rand -hex 16)

cat > "$TMP/cert.cnf" <<CNF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NOME
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
subjectKeyIdentifier = hash
CNF

openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -sha256 \
  -config "$TMP/cert.cnf" -keyout "$TMP/chave.pem" -out "$TMP/cert.pem" 2>/dev/null \
  || falha "não consegui gerar o certificado com o openssl."

openssl pkcs12 -export -inkey "$TMP/chave.pem" -in "$TMP/cert.pem" -name "$NOME" \
  -out "$TMP/atlas.p12" -passout "pass:$SENHA" \
  || falha "não consegui montar o arquivo .p12."

security import "$TMP/atlas.p12" -k "$CHAVEIRO" -P "$SENHA" -T /usr/bin/codesign \
  || falha "não consegui importar no Keychain de login."

echo "Identidade \"$NOME\" criada no Keychain de login (válida por 10 anos)."
security find-identity -p codesigning "$CHAVEIRO" | grep "$NOME" || true
