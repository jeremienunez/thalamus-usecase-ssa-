# k6 load tests

Scenarios live in `scripts/`, runner is a compose overlay on top of the base
`docker-compose.yml` (pg + redis). The overlay also builds and runs
`console-api`, so k6 hits the real stack end-to-end.

## Scenarios

| Script          | Purpose                              |
| --------------- | ------------------------------------ |
| `smoke.js`      | 1 VU sanity pass on every read route |
| `load.js`       | Ramp 0→50 VUs, steady read mix       |
| `stress.js`     | Arrival-rate ramp to find breakpoint |
| `sweep-chat.js` | Low-concurrency write/streaming path |

## Run

From the repo root:

```bash
# bring up pg + redis + console-api
docker compose -f docker-compose.yml -f infra/k6/docker-compose.k6.yml \
  up -d --build console-api

# smoke test (default)
docker compose -f docker-compose.yml -f infra/k6/docker-compose.k6.yml \
  run --rm k6

# pick another scenario
K6_SCRIPT=load.js docker compose \
  -f docker-compose.yml -f infra/k6/docker-compose.k6.yml \
  run --rm k6

# live dashboard (http://localhost:5665) while load.js runs
K6_SCRIPT=load.js docker compose \
  -f docker-compose.yml -f infra/k6/docker-compose.k6.yml \
  --profile dashboard run --rm --service-ports k6-dashboard
```

JSON summaries are written to `infra/k6/results/`.

## Against a remote endpoint

Point k6 at any reachable URL without booting the api:

```bash
BASE_URL=https://api.example.com \
  docker run --rm -i -v "$PWD/infra/k6/scripts:/scripts:ro" \
  grafana/k6:0.54.0 run /scripts/smoke.js
```
