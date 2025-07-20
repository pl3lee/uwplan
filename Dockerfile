# Build stage for Node.js (React app)
FROM node:20-alpine AS ui-builder

WORKDIR /app/ui
COPY ui/package*.json ./
RUN npm install

COPY ui/ ./
RUN npm run build

# Build stage for Go
FROM golang:1.24-alpine AS go-builder

# Install make
RUN apk add --no-cache make

WORKDIR /app

# Copy go mod files first (for better caching)
COPY go.mod go.sum ./
RUN go mod download

# Copy all Go source code
COPY . ./

# Copy built UI from previous stage (this will overwrite any existing ui/dist)
COPY --from=ui-builder /app/ui/dist ./ui/dist

# Build Go binary using make
RUN make go-build-docker

# Final runtime stage
FROM alpine:latest

# Install ca-certificates for HTTPS requests
RUN apk --no-cache add ca-certificates

WORKDIR /root/

# Copy the binary from builder stage
COPY --from=go-builder /app/uwplan .

# Run the binary
CMD ["./uwplan"]
