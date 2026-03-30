const API_URL = process.env.NEXT_PUBLIC_API_URL

// ── Storage helpers ──────────────────────────────────────────────────────────

export function getStoredAuth() {
  return {
    accessToken: localStorage.getItem('access_token'),
    refreshToken: localStorage.getItem('refresh_token'),
    // Supabase returns expires_at as a Unix timestamp in seconds
    expiresAt: Number(localStorage.getItem('expires_at')),
    businessId: localStorage.getItem('business_id'),
  }
}

export function storeSession(session, businessId) {
  localStorage.setItem('access_token', session.access_token)
  localStorage.setItem('refresh_token', session.refresh_token)
  localStorage.setItem('expires_at', session.expires_at)
  if (businessId) localStorage.setItem('business_id', businessId)
}

export function clearAuth() {
  localStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
  localStorage.removeItem('expires_at')
  localStorage.removeItem('business_id')
}

// ── Token refresh ─────────────────────────────────────────────────────────────

// Returns true if a refresh was attempted (success or fail)
async function maybeRefresh() {
  const { accessToken, refreshToken, expiresAt } = getStoredAuth()
  if (!accessToken || !expiresAt) return

  const secondsUntilExpiry = expiresAt - Date.now() / 1000
  if (secondsUntilExpiry > 300) return // more than 5 min left, no action needed

  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })

    if (res.ok) {
      const data = await res.json()
      storeSession(data.session)
    } else {
      // Refresh token is expired/invalid — clear auth so the app redirects to login
      clearAuth()
    }
  } catch {
    // Network error during refresh — leave existing tokens alone and let the
    // main request fail naturally
  }
}

// ── Core fetch wrapper ────────────────────────────────────────────────────────

export async function apiFetch(path, options = {}) {
  await maybeRefresh()

  const { accessToken } = getStoredAuth()

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'ngrok-skip-browser-warning': 'true',
      ...options.headers,
    },
  })

  return res
}
