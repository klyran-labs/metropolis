SHELL := /bin/bash

LOCAL_ENV_FILE ?= .env.local

.PHONY: all build test lint typecheck verify-production-integrity verify-ui-contract verify-theme-contract test-contracts test-contracts-forge test-web test-middleware test-gateway bench-gateway test-opensigner build-packages build-web build-gateway build-opensigner docker-up docker-down docker-logs docker-testnet-up docker-testnet-down docker-mainnet-up docker-mainnet-down docker-prod-up docker-prod-down clean help

all: lint build test

lint: verify-production-integrity verify-ui-contract verify-theme-contract typecheck
	@echo "All static analysis & typecheck quality gates passed!"

typecheck:
	@echo "=== Running TypeScript Typechecks across Workspaces ==="
	@npx tsc --noEmit --project packages/shared-types/tsconfig.json
	@npx tsc --noEmit --project packages/x402-middleware/tsconfig.json
	@npx tsc --noEmit --project apps/web/tsconfig.json

verify-production-integrity:
	@echo "=== Verifying zero-mock production integrity ==="
	@if grep -rn --exclude="*.test.*" --exclude="*.spec.*" -E 'Math\.random|0x70997970C51812dc3A010C7d01b50e0d17dc79C8' apps/web/src; then \
		echo "Prohibited mock or fallback data found in apps/web/src"; exit 1; \
	fi
	@test -s apps/web/src/configuration.ts
	@echo "Production integrity checks passed!"

verify-ui-contract:
	@echo "=== Verifying production UI interaction contract ==="
	@node scripts/verify-ui-contract.mjs

verify-theme-contract:
	@echo "=== Verifying config-driven design system & theme contract ==="
	@node scripts/verify-theme-contract.mjs

build: build-packages build-web build-gateway build-opensigner
	@echo "=== Build Completed Successfully ==="

build-packages:
	@echo "=== Building Core Packages ==="
	@npm run build --workspace=@agentguard/shared-types
	@npm run build --workspace=@agentguard/x402-middleware

build-web:
	@echo "=== Building React 19 Web Control Plane (Vite) ==="
	@cd apps/web && npm run build

test: test-contracts test-contracts-forge test-web test-middleware test-gateway test-opensigner
	@echo "=== All AgentGuard Test Suites Passed 100% ==="

test-contracts:
	@echo "=== Running AgentGuard Monad Contracts Test Suite ==="
	@node --test contracts/test/agentguard-contracts.test.mjs

test-contracts-forge:
	@echo "=== Running Foundry tests against compiled contract bytecode ==="
	@forge test --root contracts

test-web:
	@echo "=== Running React 19 Web Control Plane Tests ==="
	@node --test apps/web/test/frontend.test.mjs

test-middleware:
	@echo "=== Running x402 / AP2 Middleware Tests ==="
	@node --test packages/x402-middleware/test/middleware.test.mjs

test-opensigner:
	@echo "=== Running AgentGuard Self-Hosted OpenSigner Tests ==="
	@node --test services/opensigner/test/opensigner.test.mjs

build-gateway:
	@echo "=== Building AgentGuard High-Throughput Rust Gateway ==="
	@cargo build --release --manifest-path services/gateway/Cargo.toml

build-opensigner:
	@echo "=== Building sealed signing service ==="
	@npm run build --workspace=@agentguard/opensigner

test-gateway:
	@echo "=== Running AgentGuard High-Throughput Rust Gateway Tests ==="
	@cargo test --manifest-path services/gateway/Cargo.toml

bench-gateway:
	@echo "=== Running repeatable gateway latency profile ==="
	@cargo bench --manifest-path services/gateway/Cargo.toml --bench gateway_latency

run-web:
	@echo "=== Starting local control plane ==="
	@cd apps/web && npm run dev

docker-up:
	@echo "=== Starting AgentGuard Local Devnet Stack ==="
	@if [ ! -f "$(LOCAL_ENV_FILE)" ]; then \
		echo "Missing $(LOCAL_ENV_FILE). Create it with: cp docker/.env.local.example $(LOCAL_ENV_FILE)"; \
		exit 1; \
	fi
	@node scripts/ensure-local-env.mjs "$(LOCAL_ENV_FILE)"
	@docker compose --env-file "$(LOCAL_ENV_FILE)" -f docker/docker-compose.yml up --build -d

fund-wallets:
	@echo "=== Funding Local Devnet Wallets and Seeding Policies ==="
	@ENV_FILE="$(LOCAL_ENV_FILE)" node scripts/fund-wallets.mjs

docker-down:
	@echo "=== Stopping AgentGuard Local Devnet Stack ==="
	@docker compose --env-file "$(LOCAL_ENV_FILE)" -f docker/docker-compose.yml down

docker-logs:
	@docker compose --env-file "$(LOCAL_ENV_FILE)" -f docker/docker-compose.yml logs -f

docker-testnet-up:
	@echo "=== Starting AgentGuard Monad Testnet Stack ==="
	@docker compose -f docker/docker-compose.testnet.yml up --build -d

docker-testnet-down:
	@echo "=== Stopping AgentGuard Monad Testnet Stack ==="
	@docker compose -f docker/docker-compose.testnet.yml down

docker-mainnet-up:
	@echo "=== Starting mainnet profile ==="
	@docker compose -f docker/docker-compose.mainnet.yml --env-file docker/.env.mainnet.example up --build -d

docker-mainnet-down:
	@echo "=== Stopping mainnet profile ==="
	@docker compose -f docker/docker-compose.mainnet.yml down

docker-prod-up: docker-mainnet-up

docker-prod-down: docker-mainnet-down

clean:
	@rm -rf apps/web/dist packages/shared-types/dist packages/x402-middleware/dist
