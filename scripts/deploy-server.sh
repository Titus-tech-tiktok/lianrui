#!/usr/bin/env bash
set -euo pipefail

if [[ ! -d .git || ! -f Dockerfile || ! -f docker-compose.yml ]]; then
  echo "Refusing to deploy outside the 多嘻噜卡科技 repository root." >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "Missing server .env. Copy .env.example to .env and configure production secrets first." >&2
  exit 1
fi

required_env=(CAISHEN_SESSION_SECRET CAISHEN_FILE_TOKEN_SECRET)
for name in "${required_env[@]}"; do
  value="$(grep -E "^${name}=" .env | tail -n 1 | cut -d= -f2- || true)"
  if [[ ${#value} -lt 32 ]]; then
    echo "${name} must be configured with at least 32 characters in the server .env." >&2
    exit 1
  fi
done

export APP_COMMIT_SHA="$(git rev-parse HEAD)"
docker compose config --quiet
docker compose up -d --build --remove-orphans
docker compose ps

for attempt in $(seq 1 45); do
  health="$(curl -fsS http://127.0.0.1:8788/api/health 2>/dev/null || true)"
  if printf '%s' "$health" | grep -Fq "\"commit\":\"${APP_COMMIT_SHA}\""; then
    printf 'Deployment verified at %s\n' "$APP_COMMIT_SHA"
    exit 0
  fi
  sleep 2
done

echo "Deployment health check did not report commit ${APP_COMMIT_SHA}." >&2
docker compose logs --tail=120 caishen-web >&2 || true
exit 1
