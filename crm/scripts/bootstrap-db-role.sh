#!/usr/bin/env bash
set -euo pipefail
umask 077

DB_CONTAINER="$(printenv PFO_CRM_DB_CONTAINER || true)"
[ -n "$DB_CONTAINER" ] || DB_CONTAINER="pura-fibra-postgres"
DB_NAME="$(printenv PFO_CRM_DB_NAME || true)"
[ -n "$DB_NAME" ] || DB_NAME="pura_fibra"
DB_ADMIN_USER="$(printenv PFO_CRM_DB_ADMIN_USER || true)"
[ -n "$DB_ADMIN_USER" ] || DB_ADMIN_USER="pura_fibra_app"
BACKUP_DIR="$(printenv PFO_CRM_BACKUP_DIR || true)"
[ -n "$BACKUP_DIR" ] || BACKUP_DIR="/root/n8n-docker/ops-backups"
ENV_DIR="$(printenv PFO_CRM_ENV_DIR || true)"
[ -n "$ENV_DIR" ] || ENV_DIR="/etc/pfo-crm"
DB_ENV="$ENV_DIR/pfo-crm-db.env"
case "$DB_NAME" in
  *[!A-Za-z0-9_]*|'') echo "Nombre de base de datos no válido." >&2; exit 1 ;;
esac

if ! command -v docker >/dev/null 2>&1 || ! command -v openssl >/dev/null 2>&1; then
  echo "Se requieren docker y openssl." >&2
  exit 1
fi
LATEST_BACKUP="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.dump' -mmin -1440 -printf '%T@ %f\n' 2>/dev/null | sort -nr | head -n 1 | cut -d' ' -f2-)"
if [ -z "$LATEST_BACKUP" ] || ! docker run --rm -v "$BACKUP_DIR:/backups:ro" postgres:16-alpine pg_restore --list "/backups/$LATEST_BACKUP" >/dev/null 2>&1; then
  echo "No se encontró un backup PostgreSQL reciente y validable (24 h). Ejecuta primero backup_all y valida el dump." >&2
  exit 1
fi
if ! docker inspect "$DB_CONTAINER" >/dev/null 2>&1; then
  echo "No se encuentra el contenedor PostgreSQL esperado." >&2
  exit 1
fi

install -d -m 700 "$ENV_DIR"
DB_PASSWORD="$(openssl rand -hex 32)"
printf 'PGUSER=pfo_crm_app\nPGPASSWORD=%s\n' "$DB_PASSWORD" > "$DB_ENV"
chmod 600 "$DB_ENV"

{
  printf "%s\n" "SELECT format('CREATE ROLE pfo_crm_app LOGIN') WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='pfo_crm_app');"
  printf '%s\n' '\gexec'
  printf "ALTER ROLE pfo_crm_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '%s';\n" "$DB_PASSWORD"
  printf "%s\n" "SELECT format('REVOKE %I FROM pfo_crm_app', r.rolname) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE m.member='pfo_crm_app'::regrole;"
  printf '%s\n' '\gexec'
  printf 'GRANT CONNECT ON DATABASE %s TO pfo_crm_app;\n' "$DB_NAME"
  cat <<'SQL'
REVOKE ALL PRIVILEGES ON SCHEMA pfo FROM pfo_crm_app;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA pfo FROM pfo_crm_app;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA pfo FROM pfo_crm_app;
GRANT USAGE ON SCHEMA pfo TO pfo_crm_app;
GRANT SELECT, INSERT, UPDATE ON TABLE pfo.contacts, pfo.leads TO pfo_crm_app;
GRANT SELECT, INSERT ON TABLE pfo.lead_events TO pfo_crm_app;
GRANT INSERT ON TABLE pfo.audit_events TO pfo_crm_app;
GRANT USAGE, SELECT ON SEQUENCE pfo.contacts_id_seq, pfo.leads_id_seq, pfo.lead_events_id_seq, pfo.audit_events_id_seq TO pfo_crm_app;
SQL
} | docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_ADMIN_USER" -d "$DB_NAME" >/dev/null

unset DB_PASSWORD
echo "Rol pfo_crm_app preparado con permisos mínimos. Credenciales guardadas en $DB_ENV (600); no se imprimieron."
