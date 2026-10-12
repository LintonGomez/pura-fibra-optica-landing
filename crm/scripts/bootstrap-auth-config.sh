#!/usr/bin/env bash
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
AUTH_FILE="$(printenv PFO_CRM_AUTH_ENV_FILE || true)"
[ -n "$AUTH_FILE" ] || AUTH_FILE="/etc/pfo-crm/pfo-crm-auth.env"
AUTH_DIR="$(dirname -- "$AUTH_FILE")"

if ! command -v node >/dev/null 2>&1 || ! command -v openssl >/dev/null 2>&1; then
  echo "Se requieren Node.js y openssl." >&2
  exit 1
fi

read -r -p "Usuario administrador del CRM: " username
if ! printf '%s' "$username" | grep -Eq '^[A-Za-z0-9._-]{3,64}$'; then
  echo "El usuario debe tener 3-64 caracteres: letras, números, punto, guion o guion bajo." >&2
  exit 1
fi

read -r -s -p "Contraseña nueva (mínimo 12 caracteres): " password
printf '\n'
read -r -s -p "Confirma la contraseña: " confirmation
printf '\n'
if [ "$password" != "$confirmation" ]; then
  unset password confirmation
  echo "Las contraseñas no coinciden." >&2
  exit 1
fi

password_hash="$(printf '%s' "$password" | node "$SCRIPT_DIR/hash-password.js")"
session_secret="$(openssl rand -hex 32)"
unset password confirmation
install -d -m 700 "$AUTH_DIR"
temporary_file="$AUTH_FILE.tmp.$$"
printf "PFO_CRM_USERNAME=%s\nPFO_CRM_PASSWORD_HASH='%s'\nPFO_CRM_SESSION_SECRET=%s\n" "$username" "$password_hash" "$session_secret" > "$temporary_file"
chmod 600 "$temporary_file"
mv -f "$temporary_file" "$AUTH_FILE"
unset password_hash session_secret

echo "Configuración de acceso creada en $AUTH_FILE (permisos 600). No se imprimieron contraseña, hash ni clave de sesión."
