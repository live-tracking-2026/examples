package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path"
	"strings"
	"time"
)

// ── config ────────────────────────────────────────────────────────────────────

var (
	capURL    = env("CAP_URL", "http://localhost:3002")
	capSecret = env("CAP_SECRET", "") // required — set via env or edit this default
	port      = env("PORT", "4173")
)

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// ── request / response types ──────────────────────────────────────────────────

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	CapToken string `json:"cap_token"`
}

type loginResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
	Error   string `json:"error,omitempty"`
}

type capSiteVerifyRequest struct {
	Secret   string `json:"secret"`
	Response string `json:"response"`
}

type capSiteVerifyResponse struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

// ── handlers ──────────────────────────────────────────────────────────────────

func loginHandler(log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		log.Debug("step 1/5 — decoding request body")
		var req loginRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Error("step 1/5 FAIL — bad JSON", "err", err)
			writeJSON(w, http.StatusBadRequest, loginResponse{Error: "invalid request body"})
			return
		}
		log.Debug("step 1/5 OK — body decoded", "email", req.Email, "cap_token_prefix", tokenPrefix(req.CapToken))

		log.Debug("step 2/5 — validating required fields")
		if req.Email == "" || req.CapToken == "" {
			log.Warn("step 2/5 FAIL — missing fields", "email_empty", req.Email == "", "token_empty", req.CapToken == "")
			writeJSON(w, http.StatusBadRequest, loginResponse{Error: "email and cap_token are required"})
			return
		}
		log.Debug("step 2/5 OK — fields present")

		log.Debug("step 3/5 — checking CAP_SECRET is configured")
		if capSecret == "" {
			log.Error("step 3/5 FAIL — CAP_SECRET not set")
			writeJSON(w, http.StatusInternalServerError, loginResponse{Error: "server misconfigured: CAP_SECRET not set"})
			return
		}
		log.Debug("step 3/5 OK — secret configured", "secret_prefix", tokenPrefix(capSecret))

		log.Debug("step 4/5 — calling Cap siteverify", "token_prefix", tokenPrefix(req.CapToken))
		verified, capErr := verifyCap(log, req.CapToken)
		if capErr != nil {
			log.Error("step 4/5 FAIL — siteverify error", "err", capErr)
			writeJSON(w, http.StatusBadGateway, loginResponse{Error: "cap verification unavailable"})
			return
		}
		if !verified {
			log.Warn("step 4/5 FAIL — token rejected by Cap", "email", req.Email)
			writeJSON(w, http.StatusForbidden, loginResponse{Error: "bot verification failed"})
			return
		}
		log.Debug("step 4/5 OK — Cap accepted token")

		// ── your real auth logic goes here ───────────────────────────────────
		// e.g. look up req.Email + req.Password in a database.
		// For this demo we accept any credentials that pass the cap check.
		log.Debug("step 5/5 — authenticating user (demo: accept all)", "email", req.Email)
		log.Info("step 5/5 OK — login accepted", "email", req.Email)
		writeJSON(w, http.StatusOK, loginResponse{
			Success: true,
			Message: fmt.Sprintf("Welcome, %s!", req.Email),
		})
	}
}

func verifyCap(log *slog.Logger, token string) (bool, error) {
	payload, _ := json.Marshal(capSiteVerifyRequest{
		Secret:   capSecret,
		Response: token,
	})

	url := strings.TrimRight(capURL, "/") + "/siteverify"
	log.Debug("siteverify → sending request", "url", url, "token_prefix", tokenPrefix(token))

	resp, err := http.Post(url, "application/json", bytes.NewReader(payload)) //nolint:gosec
	if err != nil {
		return false, fmt.Errorf("siteverify request: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	log.Debug("siteverify ← raw response", "status", resp.StatusCode, "body", string(body))

	var sv capSiteVerifyResponse
	if err := json.Unmarshal(body, &sv); err != nil {
		return false, fmt.Errorf("siteverify parse: %w", err)
	}

	log.Debug("siteverify ← parsed", "success", sv.Success, "cap_error", sv.Error)
	return sv.Success, nil
}

// ── helpers ───────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// responseWriter captures the status code so the middleware can log it.
type responseWriter struct {
	http.ResponseWriter
	status int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.status = code
	rw.ResponseWriter.WriteHeader(code)
}

// loggingMiddleware logs method, path, status and latency for every request.
func loggingMiddleware(log *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := &responseWriter{ResponseWriter: w, status: http.StatusOK}
		log.Debug("→ incoming", "method", r.Method, "path", r.URL.Path, "remote", r.RemoteAddr)
		next.ServeHTTP(rw, r)
		log.Info("← done", "method", r.Method, "path", r.URL.Path, "status", rw.status, "ms", time.Since(start).Milliseconds())
	})
}

// tokenPrefix returns the first 12 chars of a token for safe log output.
func tokenPrefix(s string) string {
	if len(s) <= 12 {
		return s
	}
	return s[:12] + "…"
}

// spaFileServer serves real files when present; otherwise index.html for client-side routes.
// Do not route SPA fallbacks through http.FileServer — it 301s /index.html → / and loops.
func spaFileServer(root http.Dir) http.Handler {
	fileServer := http.FileServer(root)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
			return
		}

		clean := path.Clean(r.URL.Path)
		if clean == "/" {
			serveSPAIndex(w, r, root)
			return
		}

		name := strings.TrimPrefix(clean, "/")
		if f, err := root.Open(name); err == nil {
			defer f.Close()
			if info, err := f.Stat(); err == nil && !info.IsDir() {
				fileServer.ServeHTTP(w, r)
				return
			}
		}

		serveSPAIndex(w, r, root)
	})
}

func serveSPAIndex(w http.ResponseWriter, r *http.Request, root http.Dir) {
	f, err := root.Open("index.html")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()

	stat, err := f.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}

	rs, ok := f.(io.ReadSeeker)
	if !ok {
		http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
		return
	}
	http.ServeContent(w, r, "index.html", stat.ModTime(), rs)
}

// ── main ──────────────────────────────────────────────────────────────────────

func main() {
	log := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug}))

	if capSecret == "" {
		log.Warn("CAP_SECRET is not set — /api/login will return 500 until it is configured")
	}

	mux := http.NewServeMux()

	// Static files + SPA fallback (index.html for /about, /blog, …)
	mux.Handle("/", spaFileServer(http.Dir(".")))

	// Login endpoint — verifies Cap token server-side then authenticates user
	mux.HandleFunc("POST /api/login", loginHandler(log))

	addr := ":" + strings.TrimPrefix(port, ":")
	log.Info("server starting", "addr", "http://localhost"+addr)
	log.Info("cap backend", "url", capURL)

	if err := http.ListenAndServe(addr, loggingMiddleware(log, mux)); err != nil {
		log.Error("server exited", "err", err)
		os.Exit(1)
	}
}
