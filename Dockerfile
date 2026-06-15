# Lite production image for the Cap login demo (server.go).
#
#   docker build -t login-demo examples/
#   docker run --rm -p 4173:4173 \
#     -e CAP_SECRET=<secret> \
#     -e CAP_URL=http://cap:3002 \
#     login-demo
#
# Required at runtime: CAP_SECRET
# Optional: CAP_URL (default http://localhost:3002), PORT (default 4173)

FROM golang:1.22-alpine AS build
WORKDIR /src

COPY go.mod ./
RUN go mod download

COPY server.go index.html cap-programmatic.html login.html login.js login-programmatic.js login.css ./
RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags="-s -w" \
    -trimpath \
    -o /out/server \
    .

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app

COPY --from=build --chown=nonroot:nonroot /out/server /app/server
COPY --from=build --chown=nonroot:nonroot \
    /src/index.html \
    /src/cap-programmatic.html \
    /src/login.html \
    /src/login.js \
    /src/login-programmatic.js \
    /src/login.css \
    /app/

ENV PORT=4173
EXPOSE 4173

ENTRYPOINT ["/app/server"]
