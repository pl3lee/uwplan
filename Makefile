.PHONY: build dev clean ui-build ui-dev go-build run

# Default target
all: build

# Build everything
build: ui-build go-build

# Build React app
ui-build:
	cd ui && npm run build

# Development server for React app
ui-dev:
	cd ui && npm run dev

# Build Go binary (requires ui-build to be run first)
go-build:
	go build -o uwplan main.go

# Run the Go server (requires build to be run first)
run:
	./uwplan

# Install dependencies
install:
	cd ui && npm install
	go mod tidy

# Clean build artifacts
clean:
	rm -rf ui/dist
	rm -f uwplan

# Development workflow: build and run
dev-server: build run

# Check if ui/dist exists before building Go
check-ui-dist:
	@if [ ! -d "ui/dist" ]; then \
		echo "ui/dist directory not found. Running ui-build first..."; \
		$(MAKE) ui-build; \
	fi

# Safe Go build that ensures UI is built first
go-build-safe: check-ui-dist go-build
