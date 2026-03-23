.PHONY: dev build test lint clean setup

# ── Quick Start ─────────────────────────────────────────────────────────────
setup: ## First-time setup: generate .env, configure credentials
	@./setup.sh

dev: ## Start all services (Docker Compose)
	docker compose up --build

dev-profile: ## Start with dev profile (includes media-worker)
	docker compose --profile dev up --build

# ── Testing ─────────────────────────────────────────────────────────────────
test: test-cp test-ui ## Run all tests

test-cp: ## Run control-plane tests (node:test)
	cd services/control-plane && npx tsc && node --test

test-ui: ## Run web-ui tests (vitest)
	cd services/web-ui && npx vitest run

# ── Build ───────────────────────────────────────────────────────────────────
build: ## Build all services
	cd services/control-plane && npx tsc
	cd services/web-ui && npx vite build

build-docker: ## Build all Docker images
	docker compose build

# ── Code Quality ────────────────────────────────────────────────────────────
lint: ## Type-check all TypeScript
	cd services/control-plane && npx tsc --noEmit
	cd services/web-ui && npx tsc --noEmit

# ── Cleanup ─────────────────────────────────────────────────────────────────
clean: ## Remove build artifacts
	rm -rf services/control-plane/dist services/web-ui/dist
	rm -rf services/control-plane/coverage services/web-ui/coverage

# ── Utilities ───────────────────────────────────────────────────────────────
swagger: ## Open Swagger UI in browser
	open http://localhost:8080/api

logs: ## Tail docker compose logs
	docker compose logs -f

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
