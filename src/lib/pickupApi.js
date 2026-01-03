import { ensurePermission, PERMISSIONS } from './permissions.js'
import { sendApprovalEmail } from './emailClient.js'
import { sendSlackMessage } from './slackClient.js'

const API_BASE = ''

const parseResponse = async (resp) => {
  let json = {}
  try {
    json = await resp.json()
  } catch (_) {
    json = {}
  }

  if (!resp.ok) {
    const message = json.error || resp.statusText || 'Request failed'
    return { data: null, error: new Error(message) }
  }

  const data = typeof json.data !== 'undefined' ? json.data : json
  return { data, error: null }
}

const apiGet = async (path) => {
  try {
    const resp = await fetch(`${API_BASE}${path}`)
    return parseResponse(resp)
  } catch (err) {
    return { data: null, error: err }
  }
}

const apiPost = async (path, body) => {
  try {
    const resp = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    })
    return parseResponse(resp)
  } catch (err) {
    return { data: null, error: err }
  }
}

const unwrapSupabaseResult = async (resultPromise) => {
  const result = await resultPromise
  if (result && typeof result.select === 'function') {
    return result.select()
  }
  return result
}

export const fetchApprovedEvents = async () => apiGet('/api/events')

export const submitPickupSignup = async (signup, { supabaseClient } = {}) => {
  const client = supabaseClient || null
  if (client) {
    const payload = { ...signup, status: signup?.status || 'pending' }
    const response = await unwrapSupabaseResult(
      client.from('pickup_signups').insert(payload),
    )
    const dataRow = Array.isArray(response?.data) ? response.data[0] : response?.data || null
    return { data: dataRow, error: response?.error || null, autoApproved: payload.status === 'approved' }
  }

  const response = await apiPost('/api/signup', signup)
  return { ...response, autoApproved: false }
}

export const createEvent = async (event, { supabaseClient, actor, slackClient } = {}) => {
  if (actor) {
    const permission = ensurePermission(actor, PERMISSIONS.CREATE_EVENTS)
    if (!permission.ok) return { data: null, error: permission.error }
  }

  const client = supabaseClient || null
  const payload = { status: 'pending_review', ...event }
  let response

  if (client) {
    response = await unwrapSupabaseResult(client.from('pickup_events').insert(payload))
  } else {
    response = await apiPost('/api/events', payload)
  }

  const dataRow = Array.isArray(response?.data) ? response.data[0] : response?.data || null
  const error = response?.error || null

  if (!error && (slackClient || sendSlackMessage)) {
    const slack = slackClient || sendSlackMessage
    await slack({
      text: `New pickup event created: ${dataRow?.name || payload.name || 'Pickup event'}`,
    })
  }

  return { data: dataRow, error }
}

export const triggerSlackAlert = async () => apiPost('/api/slack/test', {})

export const fetchPendingSignups = async () => apiGet('/api/signups?status=pending')

export const updateSignupStatus = async (id, status, { supabaseClient, emailClient, actor } = {}) => {
  if (actor) {
    const permission = ensurePermission(actor, PERMISSIONS.REVIEW_SIGNUPS)
    if (!permission.ok) return { data: null, error: permission.error }
  }

  const client = supabaseClient || null
  if (!client) {
    return apiPost(`/api/signups/${id}/status`, { status })
  }

  const updatePayload = { status, reviewed_at: new Date().toISOString() }
  const response = await unwrapSupabaseResult(
    client.from('pickup_signups').update(updatePayload).eq('id', id),
  )

  const dataRow = Array.isArray(response?.data) ? response.data[0] : response?.data || null
  const error = response?.error || null

  if (!error && status === 'approved') {
    const emailer = emailClient || sendApprovalEmail
    await emailer({
      to: dataRow?.volunteer_email,
      eventName: dataRow?.store || dataRow?.name,
      eventDay: dataRow?.day,
      eventTime: dataRow?.time,
      notes: dataRow?.notes,
    })
  }

  return { data: dataRow, error }
}

export const updateAccountRole = async (id, role, { supabaseClient, actor, tableName = 'pickup_accounts' } = {}) => {
  if (actor) {
    const permission = ensurePermission(actor, PERMISSIONS.MANAGE_PERMISSIONS)
    if (!permission.ok) return { data: null, error: permission.error }
  }

  const client = supabaseClient || null
  if (!client) {
    return apiPost(`/api/accounts/${id}/role`, { role })
  }

  const response = await unwrapSupabaseResult(
    client.from(tableName).update({ role }).eq('id', id),
  )

  const dataRow = Array.isArray(response?.data) ? response.data[0] : response?.data || null
  return { data: dataRow, error: response?.error || null }
}

// Backwards-compatible helper that delegates to the signup endpoint
export const signupForEvent = async ({
  event = {},
  signup = {},
  account = {},
  supabaseClient,
  emailClient,
} = {}) => {
  const client = supabaseClient || null
  const isGreenlit = account?.status === 'greenlit'
  const eventTags = event?.tags || []
  const accountTags = account?.tags || []
  const tagMatch = eventTags.length === 0 || eventTags.every((tag) => accountTags.includes(tag))
  const autoApproved = isGreenlit && tagMatch

  const payload = {
    ...signup,
    status: autoApproved ? 'approved' : 'pending',
    reviewed_at: autoApproved ? new Date().toISOString() : null,
  }

  let response
  if (client) {
    response = await unwrapSupabaseResult(client.from('pickup_signups').insert(payload))
  } else {
    response = await apiPost('/api/signup', payload)
  }

  const dataRow = Array.isArray(response?.data) ? response.data[0] : response?.data || null
  const error = response?.error || null

  if (autoApproved && !error) {
    const emailer = emailClient || sendApprovalEmail
    await emailer({
      to: dataRow?.volunteer_email || signup?.volunteer_email,
      eventName: event?.name || signup?.store,
      eventDay: event?.day || signup?.day,
      eventTime: event?.time || signup?.time,
      notes: signup?.notes,
    })
  }

  return { data: dataRow, error, autoApproved }
}
