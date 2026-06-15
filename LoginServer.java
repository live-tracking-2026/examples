import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.logging.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Login demo backend — Java edition.
 *
 * Mirrors server.go exactly:
 *   POST /api/login  → verifies Cap token via /siteverify, returns JSON
 *   GET  /*          → serves static files from the current directory
 *
 * Run:
 *   CAP_SECRET=<your-secret> java LoginServer.java
 *
 * Requires Java 17+ (single-file execution, java.net.http, switch expressions).
 */
public class LoginServer {

    // ── config ────────────────────────────────────────────────────────────────

    static final String CAP_URL    = env("CAP_URL",    "http://localhost:3002");
    static final String CAP_SECRET = env("CAP_SECRET", "");
    static final int    PORT       = Integer.parseInt(env("PORT", "4173"));

    // ── logger ────────────────────────────────────────────────────────────────

    static final Logger LOG = Logger.getLogger("LoginServer");

    // ── http client (reused across requests) ─────────────────────────────────

    static final HttpClient HTTP = HttpClient.newHttpClient();

    // ── main ──────────────────────────────────────────────────────────────────

    public static void main(String[] args) throws IOException {
        setupLogging();

        LOG.info("cap backend : " + CAP_URL);
        if (CAP_SECRET.isEmpty()) {
            LOG.warning("CAP_SECRET not set — /api/login will return 500");
        } else {
            LOG.info("CAP_SECRET  : " + prefix(CAP_SECRET) + " (truncated)");
        }

        HttpServer server = HttpServer.create(new InetSocketAddress(PORT), 0);

        // more-specific path wins, so /api/login is matched before /
        server.createContext("/api/login", LoginServer::handleLogin);
        server.createContext("/",          LoginServer::handleStatic);

        server.start();
        LOG.info("server started → http://localhost:" + PORT);
    }

    // ── POST /api/login ───────────────────────────────────────────────────────

    static void handleLogin(HttpExchange ex) throws IOException {
        long   start  = System.currentTimeMillis();
        int[]  status = {200};   // captured for the finally block
        LOG.fine("→ " + ex.getRequestMethod() + " " + ex.getRequestURI() + "  remote=" + ex.getRemoteAddress());

        try {
            if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
                status[0] = 405;
                respond(ex, 405, "{\"error\":\"method not allowed\"}");
                return;
            }

            // step 1 — read + decode body
            LOG.fine("step 1/5 — reading request body");
            String rawBody;
            try {
                rawBody = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            } catch (IOException e) {
                LOG.severe("step 1/5 FAIL — could not read body: " + e.getMessage());
                status[0] = 400;
                respond(ex, 400, "{\"error\":\"could not read request body\"}");
                return;
            }
            String email    = jsonStr(rawBody, "email");
            String password = jsonStr(rawBody, "password");
            String capToken = jsonStr(rawBody, "cap_token");
            LOG.fine("step 1/5 OK — email=" + email + "  cap_token=" + prefix(capToken));

            // step 2 — validate required fields
            LOG.fine("step 2/5 — validating required fields");
            if (email.isEmpty() || capToken.isEmpty()) {
                LOG.warning("step 2/5 FAIL — missing fields  email_empty=" + email.isEmpty() + "  token_empty=" + capToken.isEmpty());
                status[0] = 400;
                respond(ex, 400, "{\"error\":\"email and cap_token are required\"}");
                return;
            }
            LOG.fine("step 2/5 OK — fields present");

            // step 3 — check server secret is configured
            LOG.fine("step 3/5 — checking CAP_SECRET is configured");
            if (CAP_SECRET.isEmpty()) {
                LOG.severe("step 3/5 FAIL — CAP_SECRET not set");
                status[0] = 500;
                respond(ex, 500, "{\"error\":\"server misconfigured: CAP_SECRET not set\"}");
                return;
            }
            LOG.fine("step 3/5 OK — secret_prefix=" + prefix(CAP_SECRET));

            // step 4 — call Cap siteverify
            LOG.fine("step 4/5 — calling Cap siteverify  token_prefix=" + prefix(capToken));
            boolean verified;
            try {
                verified = verifyCap(capToken);
            } catch (Exception e) {
                LOG.severe("step 4/5 FAIL — siteverify error: " + e.getMessage());
                status[0] = 502;
                respond(ex, 502, "{\"error\":\"cap verification unavailable\"}");
                return;
            }
            if (!verified) {
                LOG.warning("step 4/5 FAIL — token rejected by Cap  email=" + email);
                status[0] = 403;
                respond(ex, 403, "{\"error\":\"bot verification failed\"}");
                return;
            }
            LOG.fine("step 4/5 OK — Cap accepted token");

            // step 5 — authenticate user
            // Replace this block with a real DB lookup + password check.
            // For this demo we accept any credentials that passed the cap check.
            LOG.fine("step 5/5 — authenticating user (demo: accept all)  email=" + email);
            LOG.info("step 5/5 OK — login accepted  email=" + email);
            respond(ex, 200, "{\"success\":true,\"message\":\"Welcome, " + escJson(email) + "!\"}");

        } finally {
            LOG.info("← done  method=" + ex.getRequestMethod()
                   + "  path=" + ex.getRequestURI().getPath()
                   + "  status=" + status[0]
                   + "  ms=" + (System.currentTimeMillis() - start));
        }
    }

    // ── Cap siteverify call ───────────────────────────────────────────────────

    static boolean verifyCap(String token) throws IOException, InterruptedException {
        String url     = CAP_URL.replaceAll("/+$", "") + "/siteverify";
        String payload = "{\"secret\":\"" + escJson(CAP_SECRET) + "\",\"response\":\"" + escJson(token) + "\"}";

        LOG.fine("siteverify → url=" + url + "  token_prefix=" + prefix(token));

        HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("content-type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(payload))
                .build();

        HttpResponse<String> resp = HTTP.send(req, HttpResponse.BodyHandlers.ofString());

        LOG.fine("siteverify ← status=" + resp.statusCode() + "  body=" + resp.body());

        boolean success = "true".equals(jsonBool(resp.body(), "success"));
        String  capErr  = jsonStr(resp.body(), "error");
        LOG.fine("siteverify ← parsed  success=" + success + "  cap_error=" + capErr);

        return success;
    }

    // ── static file handler ───────────────────────────────────────────────────

    static final Map<String, String> MIME = Map.of(
        "html", "text/html; charset=utf-8",
        "css",  "text/css",
        "js",   "application/javascript",
        "json", "application/json",
        "ico",  "image/x-icon",
        "png",  "image/png",
        "webp", "image/webp"
    );

    // Resolved once at startup so all file lookups are absolute.
    static final Path STATIC_ROOT = Path.of(".").toAbsolutePath().normalize();

    static void handleStatic(HttpExchange ex) throws IOException {
        String raw = ex.getRequestURI().getPath();
        String rel = raw.equals("/") ? "login.html" : raw.replaceAll("^\\/+", "");

        // block path traversal before touching the filesystem
        if (rel.contains("..") || rel.contains("\0")) {
            respond(ex, 403, "{\"error\":\"forbidden\"}");
            return;
        }

        // resolve against the absolute root so startsWith works correctly
        Path file = STATIC_ROOT.resolve(rel).normalize();
        if (!file.startsWith(STATIC_ROOT) || !Files.isRegularFile(file)) {
            LOG.fine("static 404  rel=" + rel + "  resolved=" + file);
            respond(ex, 404, "{\"error\":\"not found\"}");
            return;
        }

        String ext  = rel.contains(".") ? rel.substring(rel.lastIndexOf('.') + 1) : "";
        String mime = MIME.getOrDefault(ext, "application/octet-stream");
        byte[] body = Files.readAllBytes(file);

        ex.getResponseHeaders().set("Content-Type", mime);
        ex.sendResponseHeaders(200, body.length);
        try (OutputStream os = ex.getResponseBody()) { os.write(body); }
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /** Extract a string value from a flat JSON object by key. */
    static String jsonStr(String json, String key) {
        Matcher m = Pattern.compile("\"" + Pattern.quote(key) + "\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"")
                           .matcher(json);
        return m.find() ? m.group(1).replace("\\\"", "\"").replace("\\\\", "\\") : "";
    }

    /** Extract a boolean value (returns "true" or "false") from flat JSON. */
    static String jsonBool(String json, String key) {
        Matcher m = Pattern.compile("\"" + Pattern.quote(key) + "\"\\s*:\\s*(true|false)")
                           .matcher(json);
        return m.find() ? m.group(1) : "false";
    }

    /** Escape a string for safe embedding inside a JSON string value. */
    static String escJson(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    /** First 12 chars of a token — safe to log. */
    static String prefix(String s) {
        return s.length() <= 12 ? s : s.substring(0, 12) + "…";
    }

    static String env(String key, String fallback) {
        String v = System.getenv(key);
        return (v != null && !v.isEmpty()) ? v : fallback;
    }

    static void respond(HttpExchange ex, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "application/json");
        ex.sendResponseHeaders(status, bytes.length);
        try (OutputStream os = ex.getResponseBody()) { os.write(bytes); }
    }

    // ── logging setup ─────────────────────────────────────────────────────────

    static void setupLogging() {
        // Silence noisy JDK-internal HTTP server logs (sun.net.httpserver.*).
        // They use unformatted MessageFormat placeholders like "{0}" at FINE level.
        Logger.getLogger("sun.net.httpserver").setLevel(Level.WARNING);
        Logger.getLogger("com.sun.net.httpserver").setLevel(Level.WARNING);

        Logger root = Logger.getLogger("");
        root.setLevel(Level.FINE);
        for (Handler h : root.getHandlers()) {
            h.setLevel(Level.FINE);
            h.setFormatter(new SimpleFormatter() {
                @Override
                public synchronized String format(LogRecord r) {
                    String lvl = switch (r.getLevel().getName()) {
                        case "FINE"    -> "DEBUG";
                        case "INFO"    -> " INFO";
                        case "WARNING" -> " WARN";
                        case "SEVERE"  -> "ERROR";
                        default        -> r.getLevel().getName();
                    };
                    return lvl + " [" + r.getLoggerName() + "] " + r.getMessage() + "\n";
                }
            });
        }
    }
}
