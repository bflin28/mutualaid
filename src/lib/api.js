const API_BASE = ''
const API_KEY = import.meta.env.VITE_API_KEY || ''

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (API_KEY) headers['x-api-key'] = API_KEY

  const res = await fetch(`${API_BASE}${path}`, {
    headers,
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Request failed: ${res.status}`)
  }
  return res.json()
}

// Locations
export const fetchLocations = (type) =>
  request(`/api/locations${type ? `?type=${type}` : ''}`)

// Food Logs
export const createFoodLog = (data) =>
  request('/api/food-logs', { method: 'POST', body: JSON.stringify(data) })

export const fetchFoodLogs = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return request(`/api/food-logs${qs ? `?${qs}` : ''}`)
}

export const parseFoodText = (text) =>
  request('/api/food-logs/parse', { method: 'POST', body: JSON.stringify({ text }) })

// Events
export const fetchEvents = () =>
  request('/api/events')

export const createEvent = (data) =>
  request('/api/events', { method: 'POST', body: JSON.stringify(data) })

// Signups
export const createSignup = (data) =>
  request('/api/signups', { method: 'POST', body: JSON.stringify(data) })

export const fetchSignups = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return request(`/api/signups${qs ? `?${qs}` : ''}`)
}
