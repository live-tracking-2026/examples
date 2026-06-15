// ── State ────────────────────────────────────────────────────────────────────
var capToken = null
var baseURL  = ''
var siteKey  = ''

// ── Log helpers ───────────────────────────────────────────────────────────────
var logEl      = document.getElementById('login-log')
var firstEntry = true

function logEntry(type, label, msg) {
  if (firstEntry) { logEl.innerHTML = ''; firstEntry = false }
  var t   = new Date().toTimeString().slice(0, 8)
  var div = document.createElement('div')
  div.className = 'log-entry ' + type
  div.innerHTML =
    '<span class="log-time">' + t + '</span>' +
    '<span class="log-label">[' + escHtml(label) + ']</span>' +
    escHtml(msg)
  logEl.prepend(div)
}

function clearLoginLog() { logEl.innerHTML = ''; firstEntry = true }

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// ── Status banner ─────────────────────────────────────────────────────────────
function showStatus(type, msg) {
  var el = document.getElementById('status-banner')
  el.className = 'status-banner ' + (type || '')
  el.textContent = msg
  if (!type) el.style.display = 'none'
}

// ── Cap widget event wiring ───────────────────────────────────────────────────
function attachWidgetListeners(widget) {
  widget.addEventListener('solve', function (e) {
    capToken = e.detail.token
    document.getElementById('submit-btn').disabled = false
    document.getElementById('nav-status').className = 'badge'
    document.getElementById('nav-status').textContent = '✅ Verified'
    showStatus('success', '✅ Challenge solved — you may now sign in.')
    logEntry('success', 'solve', 'token: ' + capToken)
  })
  widget.addEventListener('capStart', function () { logEntry('info', 'start', 'fetching challenge…') })
  widget.addEventListener('capDone',  function () { logEntry('success', 'done', 'PoW solved, token ready') })
  widget.addEventListener('capError', function (e) {
    logEntry('error', 'error', e.detail?.message || 'unknown error')
    document.getElementById('nav-status').className = 'badge blocked'
    document.getElementById('nav-status').textContent = '🚫 Error'
    showStatus('error', '❌ Cap error: ' + (e.detail?.message || 'unknown'))
  })
}

// ── Widget reset ──────────────────────────────────────────────────────────────
function resetWidget() {
  capToken = null
  document.getElementById('submit-btn').disabled = true
  document.getElementById('nav-status').className = 'badge pending'
  document.getElementById('nav-status').textContent = '⏳ Awaiting verification'
  showStatus('', '')

  var old   = document.getElementById('cap')
  var fresh = document.createElement('cap-widget')
  fresh.id  = 'cap'
  fresh.setAttribute('data-cap-api-endpoint', old.getAttribute('data-cap-api-endpoint'))
  old.replaceWith(fresh)
  attachWidgetListeners(fresh)

  logEntry('warn', 'reset', 'widget reset — new challenge will be fetched')
}

// ── Apply config ──────────────────────────────────────────────────────────────
function applyConfig() {
  baseURL = document.getElementById('cfg-base-url').value.trim().replace(/\/$/, '')
  siteKey = document.getElementById('cfg-site-key').value.trim()

  if (!baseURL) {
    showStatus('error', 'Enter your Cap API URL first.')
    return
  }
  if (!siteKey) {
    showStatus('error', 'Enter a site key from the Cap admin dashboard first.')
    return
  }

  var endpoint = baseURL + '/' + siteKey + '/'
  showStatus('info', 'Config applied. Widget endpoint: ' + endpoint)
  logEntry('info', 'config', 'endpoint → ' + endpoint)

  var old = document.getElementById('cap')
  old.setAttribute('data-cap-api-endpoint', endpoint)
  resetWidget()
}

// ── Form submission ───────────────────────────────────────────────────────────
function handleSubmit(e) {
  e.preventDefault()

  if (!capToken) {
    showStatus('error', 'Complete the human verification widget first.')
    return
  }

  var email    = document.getElementById('email').value
  var password = document.getElementById('password').value

  logEntry('info', 'submit', 'email=' + email + '  cap_token=' + capToken)
  callLoginAPI(email, password, capToken)
}

// POST /api/login → Go backend → Cap /siteverify (with secret) → auth logic
function callLoginAPI(email, password, token) {
  var payload = { email: email, password: password, cap_token: token }

  logEntry('info', 'POST', '/api/login')
  logEntry('info', 'login→', 'email=' + email + '  cap_token=' + token.slice(0, 20) + '…')

  fetch('/api/login', {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    JSON.stringify(payload)
  })
  .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body } }) })
  .then(function (res) {
    logEntry(res.ok ? 'success' : 'error', 'login←', JSON.stringify(res.body))

    if (res.body.success) {
      showStatus('success', '🎉 ' + (res.body.message || 'Login accepted!'))
      document.getElementById('nav-status').className = 'badge'
      document.getElementById('nav-status').textContent = '🎉 Signed in as ' + email
    } else {
      showStatus('error', '❌ ' + (res.body.error || 'Login rejected'))
      document.getElementById('nav-status').className = 'badge blocked'
      document.getElementById('nav-status').textContent = '🚫 Rejected'
    }

    // Token is single-use — disable submit until a new challenge is solved
    capToken = null
    document.getElementById('submit-btn').disabled = true
  })
  .catch(function (err) {
    logEntry('error', 'login←', 'network error: ' + err.message)
    showStatus('error', '❌ Could not reach login server: ' + err.message)
  })
}

// ── Intercept fetch to mirror challenge/redeem calls in the log ───────────────
var _origFetch = window.fetch
window.fetch = function (url, opts) {
  var u = typeof url === 'string' ? url : (url.url || String(url))
  if ((u.includes('/challenge') || u.includes('/redeem')) && !u.includes('/siteverify')) {
    var method = (opts && opts.method) || 'GET'
    logEntry('info', method, u.replace(baseURL, ''))
    return _origFetch.apply(this, arguments).then(function (resp) {
      resp.clone().json().then(function (body) {
        var tag     = u.includes('/challenge') ? 'challenge←' : 'redeem←'
        var preview = JSON.stringify(body)
        if (preview.length > 120) preview = preview.slice(0, 117) + '…'
        logEntry(resp.ok ? 'success' : 'error', tag, preview)
      }).catch(function () {})
      return resp
    })
  }
  return _origFetch.apply(this, arguments)
}

// ── Init (widget lives on /login tab in index.html) ───────────────────────────
function initLoginDemo() {
  var widget = document.getElementById('cap')
  if (!widget || widget.dataset.loginReady) return
  widget.dataset.loginReady = '1'
  attachWidgetListeners(widget)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLoginDemo)
} else {
  initLoginDemo()
}
