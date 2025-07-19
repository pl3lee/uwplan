# Build stage for Node.js (React app)
FROM node:20-alpine AS ui-builder

WORKDIR /app/ui
COPY ui/package*.json ./
RUN npm install

COPY ui/ ./
RUN npm run build

# Build stage for Go
FROM golang:1.24-alpine AS go-builder

WORKDIR /app

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY main.go ./

# Copy built UI from previous stage
COPY --from=ui-builder /app/ui/dist ./ui/dist

# Build Go binary
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o uwplan main.go

# Final runtime stage
FROM alpine:latest

# Install ca-certificates for HTTPS requests
RUN apk --no-cache add ca-certificates

WORKDIR /root/

# Copy the binary from builder stage
COPY --from=go-builder /app/uwplan .

# Run the binary
CMD ["./uwplan"]
