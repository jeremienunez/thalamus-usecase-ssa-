# Thalamus + Sweep — dev Makefile
#
# Contract: every target is idempotent. `make demo` boots infra, migrates,
# seeds, and runs one research + sweep cycle end-to-end.

SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

##@ Infra
# ── Infra ────────────────────────────────────────────────────────────────────

.PHONY: up
up: ## Start Postgres (pgvector) + Redis in background, wait until healthy
	@bash -c '. ./scripts/ui.sh; \
	  section "Infra"; \
	  docker compose up -d >/dev/null 2>&1 || true; \
	  spinner_until "docker inspect -f {{.State.Health.Status}} thalamus-postgres 2>/dev/null | grep -q healthy" "postgres (pgvector)" 60; \
	  spinner_until "docker inspect -f {{.State.Health.Status}} thalamus-redis    2>/dev/null | grep -q healthy" "redis" 60'

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

##@ Schema
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

##@ Seed
# ── Seed ─────────────────────────────────────────────────────────────────────

.PHONY: seed
seed: ## Seed reference tables + ~500 satellites from CelesTrak TLE
	@bash -c '. ./scripts/ui.sh; \
	  section "Seeding catalog"; \
	  step "pnpm --filter @interview/db-schema seed"; \
	  pnpm --filter @interview/db-schema seed; \
	  sats=$$(docker exec thalamus-postgres psql -U thalamus -d thalamus -tAc "select count(*) from satellites" 2>/dev/null || echo "?"); \
	  regimes=$$(docker exec thalamus-postgres psql -U thalamus -d thalamus -tAc "select count(distinct regime_id) from satellites where regime_id is not null" 2>/dev/null || echo "?"); \
	  ok "$$sats satellites, $$regimes regimes in catalog"'

##@ Demo
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

.PHONY: ssa
ssa: ## Interactive SSA REPL (query → briefing loop)
	pnpm --filter @interview/thalamus ssa

##@ Local LLM
# ── Local LLM (Gemma 4 via llama.cpp Vulkan) ─────────────────────────────────
# llm-serve:       26B MoE Q3_K_M — best quality, ~16 tok/s (partial offload)
# llm-serve-fast:  E4B Q8         — fast fallback, ~43 tok/s (full GPU)
# ssa-local:       runs the REPL against http://127.0.0.1:8080 (provider=local)

LLM_MODELS_DIR ?= /media/jerem/ubuntu/models/gguf
LLM_TEMPLATE   := $(LLM_MODELS_DIR)/gemma-template.jinja
LLM_HOST       := 127.0.0.1
LLM_PORT       := 8080
LLM_URL        := http://$(LLM_HOST):$(LLM_PORT)

.PHONY: llm-serve
llm-serve: ## Start llama-server with Gemma 4 26B MoE Q3_K_M (primary demo model)
	@echo "▶ Gemma 4 26B MoE Q3_K_M on $(LLM_URL) (Ctrl+C to stop)"
	llama-server -m $(LLM_MODELS_DIR)/gemma-4-26B-A4B-it-Q3_K_M.gguf \
		--host $(LLM_HOST) --port $(LLM_PORT) \
		-ngl 18 -c 4096 -t 4 \
		--chat-template-file $(LLM_TEMPLATE)

.PHONY: llm-serve-fast
llm-serve-fast: ## Start llama-server with Gemma 4 E4B Q8 (fast fallback model)
	@echo "▶ Gemma 4 E4B Q8 on $(LLM_URL) (Ctrl+C to stop)"
	llama-server -m $(LLM_MODELS_DIR)/gemma-4-E4B-it-Q8_0.gguf \
		--host $(LLM_HOST) --port $(LLM_PORT) \
		-ngl 999 -c 8192 -t 4 \
		--chat-template-file $(LLM_TEMPLATE)

LLM_LOG ?= /tmp/llama-server-26b.log

.PHONY: llm-up
llm-up: ## Start llama-server in background (26B MoE, idempotent — logs to /tmp)
	@if curl -sf $(LLM_URL)/health >/dev/null 2>&1; then \
	  echo "✓ llama-server already running on $(LLM_URL)"; \
	else \
	  nohup llama-server -m $(LLM_MODELS_DIR)/gemma-4-26B-A4B-it-Q3_K_M.gguf \
	    --host $(LLM_HOST) --port $(LLM_PORT) \
	    -ngl 18 -c 4096 -t 4 \
	    --chat-template-file $(LLM_TEMPLATE) \
	    > $(LLM_LOG) 2>&1 & \
	  echo "▶ llama-server starting (PID $$!) — tail -f $(LLM_LOG)"; \
	fi

.PHONY: llm-down
llm-down: ## Stop background llama-server
	@pkill -f "llama-server.*--port $(LLM_PORT)" && echo "✓ llama-server stopped" || echo "no llama-server running"

.PHONY: llm-logs
llm-logs: ## Tail llama-server logs
	tail -f $(LLM_LOG)

.PHONY: ssa-local
ssa-local: ## Interactive SSA REPL routed to local Gemma (requires `make llm-serve` running)
	@curl -sf $(LLM_URL)/health >/dev/null 2>&1 || \
		(echo "✗ local LLM not responding at $(LLM_URL) — run 'make llm-serve' in another terminal"; exit 1)
	@echo "✓ local LLM up — launching REPL with provider=local"
	LOCAL_LLM_URL=$(LLM_URL) pnpm --filter @interview/thalamus ssa

##@ Sweep
.PHONY: sweep-run
sweep-run: ## Run one sweep audit pass against the seeded catalog
	pnpm --filter @interview/sweep demo-run

##@ Console
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

##@ Quality
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
help: ## Show this help — grouped targets and quick-start
	@bash -c '. ./scripts/ui.sh; \
	  satellite_logo; \
	  printf "\n  $${C_BOLD}Thalamus + Sweep$${C_RESET}  $${C_GRAY}·$${C_RESET} Space Situational Awareness dev environment\n\n"; \
	  printf "  $${C_BOLD}Quick start$${C_RESET}\n"; \
	  printf "    $${C_CYAN}make up$${C_RESET}        # Postgres + Redis (pgvector)\n"; \
	  printf "    $${C_CYAN}make demo$${C_RESET}      # migrate + seed ~500 satellites\n"; \
	  printf "    $${C_CYAN}make console$${C_RESET}   # UI on :5173, API on :4000\n\n"; \
	  printf "  $${C_BOLD}Targets$${C_RESET}\n"; \
	  awk '\''BEGIN {FS=":.*##"} \
	    /^##@/ { section=substr($$0,5); targets[section]=""; order[++n]=section; next } \
	    /^[a-zA-Z_-]+:.*##/ { \
	      split($$1, a, ":"); \
	      if (section != "" && a[1] != "help") targets[section] = targets[section] " " a[1]; \
	    } \
	    END { \
	      for (i=1; i<=n; i++) { \
	        s=order[i]; \
	        printf "    \033[36m▸\033[0m %-10s\033[90m%s\033[0m\n", s, targets[s]; \
	      } \
	    }'\'' $(MAKEFILE_LIST); \
	  printf "\n"'
