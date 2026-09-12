SHELL := /bin/bash

.PHONY: all build test lint verify-production-integrity verify-marketplace-scale test-contracts test-engine test-oracle test-sdk test-sdk-ts test-sdk-py test-web test-mobile run-engine run-oracle run-web run-mobile bench docker-up docker-down docker-logs docker-migrate-prod clean help

all: lint build test

lint: verify-production-integrity verify-ui-contract
	@echo "=== Running Strict Rust Clippy Lints (-D warnings) ==="
	@cargo clippy --workspace --all-targets -- -D warnings
	@echo "=== Running TypeScript Typechecks across Workspaces ==="
	@npx tsc --noEmit --project packages/shared-types/tsconfig.json
	@npx tsc --noEmit --project packages/sdk-ts/tsconfig.json
	@npx tsc --noEmit --project services/api-gateway/tsconfig.json
	@npx tsc --noEmit --project services/identity-policy/tsconfig.json
	@npx tsc --noEmit --project services/provisioning-controller/tsconfig.json
	@npx tsc --noEmit --project services/reconciliation/tsconfig.json
	@npx tsc --noEmit --project services/settlement-keeper/tsconfig.json
	@npx tsc --noEmit --project apps/web/tsconfig.json
	@npx tsc --noEmit --project apps/mobile/tsconfig.json
	@echo "All static analysis & typecheck quality gates passed!"

verify-production-integrity:
	@echo "=== Verifying zero-mock production integrity ==="
	@if rg -n --glob '!**/*.test.*' --glob '!**/*.spec.*' 'Math\.random|0x70997970C51812dc3A010C7d01b50e0d17dc79C8' apps/web/src; then \
		echo "Prohibited mock or fallback data found in apps/web/src"; exit 1; \
	fi
	@test -s apps/web/src/config/env.ts
	@test -s services/api-gateway/src/production-main.ts
	@test -s docker/docker-compose.prod.yml
	@if rg -n '^VITE_(CHAIN_ID|RPC_URL|WS_URL|CLOB_SETTLEMENT_ADDRESS|COMPUTE_TOKEN_ADDRESS|SLA_VAULT_ADDRESS|USDC_TOKEN_ADDRESS|PRIVY_APP_ID)=\S' apps/web/.env.production; then \
		echo "Deployment values must be injected at release time, not committed in apps/web/.env.production"; exit 1; \
	fi
	@echo "Production integrity checks passed!"

verify-ui-contract:
	@echo "=== Verifying production UI interaction contract ==="
	@npm run verify:ui-contract

verify-marketplace-scale:
	@echo "=== Running read-only marketplace scale acceptance check ==="
	@npm run verify:marketplace-scale

bench:
	@echo "=== Running ComputeX Engine Throughput & Latency Benchmark (Release) ==="
	@cargo run --release --bin benchmark

build: build-contracts build-rust build-sdk build-web

build-contracts:
	@echo "=== Compiling Solidity Smart Contracts (solc 0.8.36 with Cancun via-IR) ==="
	@/opt/homebrew/bin/solc --base-path . --include-path node_modules --via-ir --optimize \
		contracts/src/core/ComputeToken.sol \
		contracts/src/core/ComputeCLOBSettlement.sol \
		contracts/src/core/ParametricSLAVault.sol --bin >/dev/null
	@echo "Contracts compiled successfully!"

build-rust:
	@echo "=== Compiling ComputeX Rust Workspace (Engine, Oracle, Core) ==="
	@cargo build --workspace

build-sdk:
	@echo "=== Building @computex/sdk TypeScript SDK ==="
	@cd packages/sdk-ts && npm run build

build-web:
	@echo "=== Building React 19 Trading Terminal (Vite) ==="
	@echo "=== Using the checked-in development profile for the local gate; release builds must inject explicit deployment configuration ==="
	@cd apps/web && npm run build -- --mode development

test: test-contracts test-engine test-oracle test-sdk test-web test-mobile test-services
	@echo "=== All Test Suites Passed 100% ==="

test-services:
	@echo "=== Running ComputeX Services Test Suite ==="
	@node --test services/*/test/*.test.mjs

test-web:
	@echo "=== Running React 19 Frontend Test Suite ==="
	@node --test apps/web/test/frontend.test.mjs

test-mobile:
	@echo "=== Running ComputeX Mobile App Test Suite ==="
	@node --test apps/mobile/test/mobile-tests.mjs


test-contracts:
	@echo "=== Running Smart Contracts Verification Suite ==="
	@node --test contracts/test/computex-contracts.test.mjs

test-engine:
	@echo "=== Running Rust Matching Engine & WAL Test Suite ==="
	@cargo test -p computex-engine

test-oracle:
	@echo "=== Running Telemetry Oracle, DuckDB & Threshold Consensus Test Suite ==="
	@cargo test -p computex-oracle

test-sdk: test-sdk-ts test-sdk-py

test-sdk-ts:
	@echo "=== Running @computex/sdk TypeScript SDK Test Suite ==="
	@cd packages/sdk-ts && npm test

test-sdk-py:
	@echo "=== Running computex-sdk Python SDK Test Suite ==="
	@cd packages/sdk-py && PYTHONPATH=. python3 -m unittest discover tests

run-engine:
	@echo "=== Starting ComputeX Matching Engine (Port 9101) ==="
	@COMPUTEX_WAL_PATH=/tmp/computex_engine.wal cargo run --bin computex-engine

run-oracle:
	@echo "=== Starting ComputeX 400ms Telemetry Oracle Daemon & DuckDB ==="
	@DUCKDB_PATH=/tmp/computex_telemetry.duckdb cargo run --bin computex-oracle

run-web:
	@echo "=== Starting React 19 Web Trading Terminal (Port 3110) ==="
	@cd apps/web && npm run dev

run-mobile:
	@echo "=== Starting ComputeX Mobile Terminal (Port 8081 / Expo) ==="
	@cd apps/mobile && npx expo start

docker-up:
	@echo "=== Starting ComputeX Full Multi-Service Docker Stack ==="
	@docker compose -f docker/docker-compose.yml up --build -d

docker-down:
	@echo "=== Stopping ComputeX Docker Stack ==="
	@docker compose -f docker/docker-compose.yml down

docker-logs:
	@docker compose -f docker/docker-compose.yml logs -f

docker-migrate-prod:
	@docker compose -f docker/docker-compose.prod.yml run --rm computex-api-gateway node dist/migrate.js

clean:
	@cargo clean
	@rm -rf apps/web/dist packages/sdk-ts/dist /tmp/computex_engine.wal /tmp/computex_telemetry.duckdb
