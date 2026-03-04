import { supabase } from './supabase'

const API_BASE = ''

async function request(path, options = {}) {
  const { headers: optHeaders, ...rest } = options
  const headers = { 'Content-Type': 'application/json', ...optHeaders }

  const { data: { session } } = await supabase.auth.getSession()
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers,
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

// Admin — allowed emails (requires admin password)
export const verifyAdminPassword = (password) =>
  request('/api/allowed-emails/verify', { method: 'POST', body: JSON.stringify({ password }) })

export const fetchAllowedEmails = (adminPassword) =>
  request('/api/allowed-emails', { headers: { 'x-admin-password': adminPassword } })

export const inviteUser = (email, adminPassword) =>
  request('/api/allowed-emails', {
    method: 'POST',
    body: JSON.stringify({ email }),
    headers: { 'x-admin-password': adminPassword },
  })

export const resendInvite = (email, adminPassword) =>
  request('/api/allowed-emails/resend', {
    method: 'POST',
    body: JSON.stringify({ email }),
    headers: { 'x-admin-password': adminPassword },
  })

export const deleteAllowedEmail = (id, adminPassword) =>
  request(`/api/allowed-emails/${id}`, {
    method: 'DELETE',
    headers: { 'x-admin-password': adminPassword },
  })
