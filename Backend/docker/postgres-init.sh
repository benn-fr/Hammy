#!/bin/sh
set -eu

: "${APP_DB_PASSWORD:?APP_DB_PASSWORD must be set}"

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=app_db_password="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE hammy_app
  LOGIN
  PASSWORD :'app_db_password'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOREPLICATION;

GRANT CONNECT, CREATE ON DATABASE hammy TO hammy_app;
GRANT USAGE, CREATE ON SCHEMA public TO hammy_app;
SQL
