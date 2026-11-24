#!/bin/sh
# Runs INSIDE the MySQL container (called by repair-db-credentials.sh).
# Uses the MYSQL_* environment variables docker-compose.yml passes to the
# container. Passwords are only passed via environment/stdin – never on a
# command line (visible in the process list) and never printed.
#
#   check-app            exit 0 if the application user can log in with MYSQL_PASSWORD
#   online               log in as root with MYSQL_ROOT_PASSWORD, set the app user's password
#   offline <dump-file>  (MySQL must be stopped) start mysqld without grant tables, dump the
#                        database to <dump-file>, set root and app user passwords, shut down
set -eu

mode="${1:?mode}"
db="${MYSQL_DATABASE:?MYSQL_DATABASE missing}"
user="${MYSQL_USER:?MYSQL_USER missing}"

# SQL string literal / identifier quoting (default sql_mode: backslash escapes active).
sql_str() { printf "'%s'" "$(printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e "s/'/''/g")"; }
sql_ident() { printf '`%s`' "$(printf '%s' "$1" | sed -e 's/`/``/g')"; }

# Statements that (re)create the application user with the .env password and its grants.
app_user_sql() {
  u=$(sql_str "$user")
  p=$(sql_str "${MYSQL_PASSWORD:?MYSQL_PASSWORD missing}")
  printf 'CREATE USER IF NOT EXISTS %s@%s IDENTIFIED BY %s;\n' "$u" "'%'" "$p"
  printf 'ALTER USER %s@%s IDENTIFIED BY %s;\n' "$u" "'%'" "$p"
  printf 'GRANT ALL PRIVILEGES ON %s.* TO %s@%s;\n' "$(sql_ident "$db")" "$u" "'%'"
}

db_exists_sql() { printf 'SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = %s;\n' "$(sql_str "$db")"; }

case "$mode" in
  check-app)
    MYSQL_PWD="${MYSQL_PASSWORD:-}" mysql --protocol=tcp -h 127.0.0.1 -u "$user" -N -e 'SELECT 1' "$db" >/dev/null 2>&1
    ;;

  online)
    export MYSQL_PWD="${MYSQL_ROOT_PASSWORD:-}"
    if ! mysql --protocol=tcp -h 127.0.0.1 -u root -N -e 'SELECT 1' >/dev/null 2>&1; then
      echo "[mysql] The root password from .env is not accepted either." >&2
      exit 3
    fi
    if [ "$(db_exists_sql | mysql --protocol=tcp -h 127.0.0.1 -u root -N)" != "1" ]; then
      echo "[mysql] Database '$db' (MYSQL_DATABASE) does not exist in this volume – refusing to continue." >&2
      echo "[mysql] Check MYSQL_DATABASE in .env; nothing was changed." >&2
      exit 4
    fi
    { app_user_sql; echo 'FLUSH PRIVILEGES;'; } | mysql --protocol=tcp -h 127.0.0.1 -u root
    echo "[mysql] Password of user '$user' updated to the value in .env (logged in as root)."
    ;;

  offline)
    dump="${2:?dump file}"
    : "${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD missing}"
    echo "[mysql] Starting MySQL in maintenance mode (no authentication, no network)…"
    mysqld --user=mysql --skip-grant-tables --skip-networking >/tmp/maintenance.log 2>&1 &
    pid=$!
    for _ in $(seq 1 90); do
      mysqladmin --protocol=socket ping >/dev/null 2>&1 && break
      kill -0 "$pid" 2>/dev/null || { echo "[mysql] mysqld exited:" >&2; tail -n 30 /tmp/maintenance.log >&2; exit 5; }
      sleep 1
    done
    mysqladmin --protocol=socket ping >/dev/null 2>&1 || { echo "[mysql] mysqld did not start" >&2; exit 5; }

    if [ "$(db_exists_sql | mysql --protocol=socket -N)" != "1" ]; then
      echo "[mysql] Database '$db' (MYSQL_DATABASE) does not exist in this volume – refusing to continue." >&2
      mysqladmin --protocol=socket shutdown || kill "$pid"
      exit 4
    fi

    echo "[mysql] Backing up database '$db' to $(basename "$dump") before changing anything…"
    umask 077
    mysqldump --protocol=socket --single-transaction --routines --triggers --no-tablespaces --set-gtid-purged=OFF "$db" | gzip -9 > "$dump.partial"
    if ! gzip -dc "$dump.partial" | tail -n 1 | grep -q 'Dump completed'; then
      rm -f "$dump.partial"
      echo "[mysql] Backup is incomplete – nothing was changed." >&2
      mysqladmin --protocol=socket shutdown || kill "$pid"
      exit 6
    fi
    mv "$dump.partial" "$dump"

    echo "[mysql] Setting the root and '$user' passwords to the values in .env…"
    root_pw=$(sql_str "$MYSQL_ROOT_PASSWORD")
    {
      echo 'FLUSH PRIVILEGES;' # loads the grant tables so account statements work
      printf "ALTER USER IF EXISTS 'root'@'localhost' IDENTIFIED BY %s;\n" "$root_pw"
      printf "ALTER USER IF EXISTS 'root'@'%%' IDENTIFIED BY %s;\n" "$root_pw"
      app_user_sql
      echo 'FLUSH PRIVILEGES;'
    } | mysql --protocol=socket

    MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqladmin --protocol=socket -u root shutdown
    for _ in $(seq 1 60); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    echo "[mysql] Done; MySQL stopped cleanly."
    ;;

  *)
    echo "Unknown mode $mode" >&2
    exit 2
    ;;
esac
