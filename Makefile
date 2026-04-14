# Thalamus + Sweep — dev Makefile
#
# Contract: every target is idempotent. `make demo` boots infra, migrates,
# seeds, and runs one research + sweep cycle end-to-end.

SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

# ── Infra ────────────────────────────────────────────────────────────────────

.PHONY: up
up: ## Start Postgres (pgvector) + Redis in background, wait until healthy
	docker compose up -d
	@echo "⏳ waiting for services to be healthy..."
	@until [ "$$(docker inspect -f '{{.State.Health.Status}}' thalamus-postgres 2>/dev/null)" = "healthy" ]; do sleep 1; done
	@until [ "$$(docker inspect -f '{{.State.Health.Status}}' thalamus-redis    2>/dev/null)" = "healthy" ]; do sleep 1; done
	@echo "✓ postgres + redis healthy"

.PHONY: down
down: ## Stop services (keeps volumes)
	docker compose down

.PHONY: nuke
nuke: ## Stop services AND delete volumes (destructive)
	docker compose down -v

.PHONY: logs
logs: ## Tail service logs
	docker compose logs -f --tail=100

.PHONY: psql
psql: ## Open psql shell on the dev DB
	docker exec -it thalamus-postgres psql -U thalamus -d thalamus

.PHONY: redis-cli
redis-cli: ## Open redis-cli shell
	docker exec -it thalamus-redis redis-cli

# ── Schema ───────────────────────────────────────────────────────────────────

.PHONY: migrate
migrate: ## Apply Drizzle migrations (generates if none exist yet)
	pnpm --filter @interview/db-schema drizzle-kit push

.PHONY: migrate-generate
migrate-generate: ## Generate a new migration from the current schema
	pnpm --filter @interview/db-schema drizzle-kit generate

.PHONY: migrate-drop
migrate-drop: ## Drop the latest migration (requires interactive confirm in drizzle-kit)
	pnpm --filter @interview/db-schema drizzle-kit drop

.PHONY: studio
studio: ## Open Drizzle Studio (web UI on :4983)
	pnpm --filter @interview/db-schema drizzle-kit studio

# ── Seed ─────────────────────────────────────────────────────────────────────

.PHONY: seed
seed: ## Seed reference tables + ~500 satellites from CelesTrak TLE
	pnpm --filter @interview/db-schema seed

# ── Demo ─────────────────────────────────────────────────────────────────────

.PHONY: demo
demo: up migrate seed ## Full bring-up: infra → migrations → seeds → stop-ready
	@echo ""
	@echo "✓ stack is up and seeded. Next:"
	@echo "  make thalamus-cycle   — run one research cycle against seeded catalog"
	@echo "  make sweep-run        — run one nano-swarm audit pass"

.PHONY: thalamus-cycle
thalamus-cycle: ## Run one research cycle end-to-end (SSA catalog query)
	pnpm --filter @interview/thalamus demo-cycle

.PHONY: sweep-run
sweep-run: ## Run one sweep audit pass against the seeded catalog
	pnpm --filter @interview/sweep demo-run

# ── Console (operator UI) ────────────────────────────────────────────────────

.PHONY: console
console: ## Run console-api + console dev server in parallel (Palantir UI on :5173)
	@echo "▶ console-api :4000 · console :5173"
	@(trap 'kill 0' INT TERM; \
	 pnpm --filter @interview/console-api dev & \
	 pnpm --filter @interview/console dev & \
	 wait)

.PHONY: console-api
console-api: ## Run the read-only Fastify API backing the console
	pnpm --filter @interview/console-api dev

.PHONY: console-ui
console-ui: ## Run the Vite dev server for the console only
	pnpm --filter @interview/console dev

# ── Quality ──────────────────────────────────────────────────────────────────

.PHONY: typecheck
typecheck: ## TypeScript on every package
	pnpm -r typecheck

.PHONY: test
test: ## Run vitest workspace
	pnpm test

.PHONY: spec-check
spec-check: ## Verify every APPROVED/IMPLEMENTED spec AC has a test
	pnpm spec:check

.PHONY: hooks-install
hooks-install: ## Point git at .githooks/ (pre-commit gate)
	pnpm hooks:install

# ── Help ─────────────────────────────────────────────────────────────────────

.PHONY: help
help:
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage: make \033[36m<target>\033[0m\n\nTargets:\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) }' $(MAKEFILE_LIST)
