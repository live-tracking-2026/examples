// Cap programmatic mode — new Cap({ apiEndpoint }).solve() (no visible widget)
// https://trycap.dev/guide/programmatic

var progCap = null
var progToken = null
var progSolving = false
var progBaseURL = ''
var progSiteKey = ''

var progLogEl = document.getElementById('prog-log')
var progLogFirst = true

function progLog(type, label, msg) {
  if (!progLogEl) return
  if (progLogFirst) { progLogEl.innerHTML = ''; progLogFirst = false }
  var t = new Date().toTimeString().slice(0, 8)
  var div = document.createElement('div')
  div.className = 'log-entry ' + type
  div.innerHTML =
    '<span class="log-time">' + t + '</span>' +
    '<span class="log-label">[' + progEsc(label) + ']</span>' +
    progEsc(msg)
  progLogEl.prepend(div)
}

function clearProgLog() {
  if (!progLogEl) return
  progLogEl.innerHTML = ''
  progLogFirst = true
}

function progEsc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function showProgStatus(type, msg) {
  var el = document.getElementById('prog-status-banner')
  if (!el) return
  el.className = 'status-banner ' + (type || '')
  el.textContent = msg
  if (!type) el.style.display = 'none'
}

function progEndpoint() {
  return progBaseURL.replace(/\/$/, '') + '/' + progSiteKey + '/'
}

function setProgProgress(pct) {
  var bar = document.getElementById('prog-progress-bar')
  var label = document.getElementById('prog-progress-label')
  if (bar) bar.style.width = Math.min(100, Math.max(0, pct)) + '%'
  if (label) {
    label.textContent = pct > 0 ? Math.round(pct) + '%' : (progSolving ? 'Starting…' : 'Idle')
  }
}

function updateProgNavBadge(state, text) {
  var el = document.getElementById('nav-status')
  if (!el) return
  if (state === 'pending') el.className = 'badge pending'
  else if (state === 'blocked') el.className = 'badge blocked'
  else el.className = 'badge'
  el.textContent = text
}

function showProgLoginSuccess(body, email) {
  var message = body.message || 'Login accepted!'
  var panel = document.getElementById('prog-login-success')
  var workspace = document.getElementById('prog-login-workspace')
  var msgEl = document.getElementById('prog-login-success-message')
  var emailEl = document.getElementById('prog-login-success-email')
  var jsonEl = document.getElementById('prog-login-success-json')
  var titleEl = document.getElementById('prog-header-title')
  var descEl = document.getElementById('prog-header-desc')
  var logoEl = document.getElementById('prog-header-logo')

  if (msgEl) msgEl.textContent = message
  if (emailEl) emailEl.textContent = 'Signed in as ' + email
  if (jsonEl) jsonEl.textContent = JSON.stringify(body, null, 2)
  if (panel) panel.hidden = false
  if (workspace) workspace.hidden = true
  if (titleEl) titleEl.textContent = 'Signed in'
  if (descEl) descEl.textContent = message
  if (logoEl) logoEl.textContent = '✓'

  showProgStatus('success', message)
  updateProgNavBadge('', message)
  document.title = message
}

function clearProgLoginSuccess(andResolve) {
  var panel = document.getElementById('prog-login-success')
  var workspace = document.getElementById('prog-login-workspace')
  var titleEl = document.getElementById('prog-header-title')
  var descEl = document.getElementById('prog-header-desc')
  var logoEl = document.getElementById('prog-header-logo')

  if (panel) panel.hidden = true
  if (workspace) workspace.hidden = false
  if (titleEl) titleEl.textContent = 'Programmatic Cap'
  if (descEl) descEl.textContent = 'cap.solve() runs automatically on page load'
  if (logoEl) logoEl.textContent = '⚙️'
  document.title = 'Cap programmatic demo'

  if (andResolve !== false) {
    updateProgNavBadge('pending', '⏳ Re-solving…')
    runProgrammaticSolve()
  }
}

function destroyProgCap() {
  if (progCap && progCap.widget && progCap.widget.parentNode) {
    progCap.widget.parentNode.removeChild(progCap.widget)
  }
  progCap = null
}

function createProgCap() {
  if (typeof Cap === 'undefined') {
    showProgStatus('error', 'Cap class not loaded — is @cap.js/widget on the page?')
    return null
  }
  destroyProgCap()
  var endpoint = progEndpoint()
  progCap = new Cap({ apiEndpoint: endpoint, workers: navigator.hardwareConcurrency || 8 })
  if (progCap.widget) progCap.widget.style.display = 'none'

  progCap.addEventListener('progress', function (e) {
    var pct = e.detail && e.detail.progress != null ? e.detail.progress : 0
    setProgProgress(pct)
    updateProgNavBadge('pending', '⏳ Solving… ' + Math.round(pct) + '%')
    progLog('info', 'progress', Math.round(pct) + '%')
  })
  progCap.addEventListener('error', function (e) {
    var msg = (e.detail && (e.detail.message || e.detail.error)) || 'unknown error'
    progLog('error', 'error', msg)
    showProgStatus('error', '❌ ' + msg)
    updateProgNavBadge('blocked', '🚫 Error')
    setProgProgress(0)
    progSolving = false
  })

  progLog('info', 'Cap()', 'apiEndpoint → ' + endpoint)
  return progCap
}

function applyProgConfig() {
  progBaseURL = document.getElementById('prog-cfg-base-url').value.trim().replace(/\/$/, '')
  progSiteKey = document.getElementById('prog-cfg-site-key').value.trim()
  if (!progBaseURL) {
    showProgStatus('error', 'Enter your Cap API URL first.')
    return
  }
  if (!progSiteKey) {
    showProgStatus('error', 'Enter a site key first.')
    return
  }
  showProgStatus('info', 'Config applied — re-solving…')
  resetProgrammatic(true)
  runProgrammaticSolve()
}

async function runProgrammaticSolve() {
  if (progSolving) return
  if (!progBaseURL) {
    showProgStatus('error', 'Enter your Cap API URL and site key, then click Apply & re-solve.')
    return
  }
  if (!progSiteKey) {
    showProgStatus('error', 'Enter a site key first.')
    return
  }

  progSolving = true
  progToken = null
  var submitBtn = document.getElementById('prog-submit-btn')
  if (submitBtn) submitBtn.disabled = true
  setProgProgress(0)
  showProgStatus('info', 'Requesting challenge and solving in the background…')
  updateProgNavBadge('pending', '⏳ Solving…')

  try {
    var cap = createProgCap()
    if (!cap) return

    progLog('info', 'solve()', 'await cap.solve()…')
    var t0 = performance.now()
    var result = await cap.solve()
    var ms = Math.round(performance.now() - t0)

    progToken = (result && result.token) || cap.token
    if (!progToken) {
      showProgStatus('error', 'Solve finished but no token was returned.')
      progLog('error', 'solve←', 'no token')
      updateProgNavBadge('blocked', '🚫 No token')
      return
    }

    setProgProgress(100)
    if (submitBtn) submitBtn.disabled = false
    var preview = document.getElementById('prog-token-preview')
    if (preview) preview.textContent = progToken.slice(0, 24) + '…'
    showProgStatus('success', '✅ Solved in ' + ms + 'ms — token ready for POST /api/login')
    updateProgNavBadge('', '✅ Token ready')
    progLog('success', 'solve←', 'token in ' + ms + 'ms: ' + progToken.slice(0, 32) + '…')
  } catch (err) {
    showProgStatus('error', '❌ ' + (err.message || String(err)))
    progLog('error', 'solve←', err.message || String(err))
    updateProgNavBadge('blocked', '🚫 Failed')
    setProgProgress(0)
  } finally {
    progSolving = false
  }
}

function resetProgrammatic(skipSolve) {
  clearProgLoginSuccess(false)
  progToken = null
  if (progCap) progCap.reset()
  destroyProgCap()
  setProgProgress(0)
  var submitBtn = document.getElementById('prog-submit-btn')
  if (submitBtn) submitBtn.disabled = true
  var preview = document.getElementById('prog-token-preview')
  if (preview) preview.textContent = '—'
  if (!skipSolve) {
    showProgStatus('info', 'Reset — solving again…')
    updateProgNavBadge('pending', '⏳ Re-solving…')
    progLog('warn', 'reset', 're-running cap.solve()')
    runProgrammaticSolve()
  }
}

function handleProgSubmit(e) {
  e.preventDefault()
  if (!progToken) {
    showProgStatus('error', 'Wait for cap.solve() to finish.')
    return
  }
  var email = document.getElementById('prog-email').value
  var password = document.getElementById('prog-password').value
  progLog('info', 'POST', '/api/login')
  callProgLoginAPI(email, password, progToken)
}

function callProgLoginAPI(email, password, token) {
  fetch('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: email, password: password, cap_token: token })
  })
    .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body } }) })
    .then(function (res) {
      progLog(res.ok ? 'success' : 'error', 'login←', JSON.stringify(res.body))
      if (res.body.success) {
        showProgLoginSuccess(res.body, email)
        progToken = null
        if (progCap) progCap.reset()
        return
      }
      clearProgLoginSuccess()
      showProgStatus('error', '❌ ' + (res.body.error || 'Login rejected'))
      updateProgNavBadge('blocked', '🚫 Rejected')
      progToken = null
      var submitBtn = document.getElementById('prog-submit-btn')
      if (submitBtn) submitBtn.disabled = true
      if (progCap) progCap.reset()
      var preview = document.getElementById('prog-token-preview')
      if (preview) preview.textContent = '—'
      runProgrammaticSolve()
    })
    .catch(function (err) {
      progLog('error', 'login←', 'network: ' + err.message)
      showProgStatus('error', '❌ ' + err.message)
    })
}

function initProgrammaticDemo() {
  if (document.body.dataset.progReady) return
  document.body.dataset.progReady = '1'

  var baseEl = document.getElementById('prog-cfg-base-url')
  var keyEl = document.getElementById('prog-cfg-site-key')
  if (baseEl) progBaseURL = baseEl.value.trim().replace(/\/$/, '') || progBaseURL
  if (keyEl) progSiteKey = keyEl.value.trim() || progSiteKey

  progLog('info', 'init', 'auto cap.solve() on load')
  runProgrammaticSolve()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initProgrammaticDemo)
} else {
  initProgrammaticDemo()
}
