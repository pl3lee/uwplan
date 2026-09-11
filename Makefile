.PHONY: generate check test build e2e
generate:
	pnpm generate
check:
	pnpm check
test:
	pnpm test
build:
	pnpm build
e2e:
	pnpm test:e2e
