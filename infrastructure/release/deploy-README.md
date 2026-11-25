# Nexora {{VERSION}} – Docker deployment

> **Simpler:** `docker-compose.yml` is self-contained. You can also paste it into Portainer or Arcane, or save it on its own, without this package: see the [installation guide](https://github.com/epicclowds/Nexora/blob/main/docs/installation/README.md).

This folder contains everything needed to run Nexora with Docker Compose, plus helper scripts. The
backend and dashboard are pulled as prebuilt images from GitHub Container
Registry; nothing is compiled on your server.

## Install

Requirements: a Linux server with Docker Engine 24+ and the Docker Compose plugin
(`docker compose version` must work), and `openssl`.

```sh
sh infrastructure/scripts/generate-secrets.sh   # creates .env with random passwords
docker compose pull                             # downloads the Nexora, MySQL and Redis images
docker compose up -d                            # starts everything in the background
docker compose logs backend | grep "Setup code" # the one-time code for the setup wizard
```

Open `http://<your-server>:3000`, enter the setup code and follow the wizard.

## Files

| File | Purpose |
| --- | --- |
| `docker-compose.yml` | The stack: MySQL, Redis, backend, dashboard (+ optional HTTPS via Caddy, `docker compose --profile https up -d`) |
| `.env.example` | All settings; `generate-secrets.sh` copies it to `.env` with secrets filled in |
| `infrastructure/scripts/backup.sh`, `restore.sh` | Database backup and restore |
| `infrastructure/scripts/repair-db-credentials.sh` | Fixes "P1000 Authentication failed" without data loss (passwords in `.env` differ from the existing database volume) |

**Updating or moving an existing installation?** Copy your existing `.env` into this folder instead of running `generate-secrets.sh` – the database volume only accepts the passwords it was created with.

Full documentation: https://github.com/epicclowds/Nexora/tree/v{{VERSION}}/docs/installation
