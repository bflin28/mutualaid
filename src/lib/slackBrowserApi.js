const API_BASE = import.meta.env.VITE_SLACK_BROWSER_API || 'http://localhost:5055'

export const fetchSlackMessage = async ({
  start = 0,
  limit = 1,
  startDate,
  endDate,
  audited = false,
  auditFilter,
  includeRecurring = false,
} = {}) => {
  try {
    const params = new URLSearchParams({ start: String(start), limit: String(limit) })
    if (startDate) params.set('start_date', startDate)
    if (endDate) params.set('end_date', endDate)

    const filter = auditFilter || (audited ? 'audited' : 'all')
    if (filter === 'audited') {
      params.set('audited', 'true')
    } else if (filter === 'unaudited') {
      params.set('hide_audited', 'true')
    }

    if (includeRecurring) {
      params.set('include_recurring', 'true')
    }

    const resp = await fetch(`${API_BASE}/messages?${params.toString()}`)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    return { data, error: null }
  } catch (err) {
    return { data: null, error: err }
  }
}

export const searchSlackMessages = async (query, limit = 50) => {
  try {
    const params = new URLSearchParams({
      query: query.trim(),
      limit: String(limit)
    })
    const resp = await fetch(`${API_BASE}/search?${params.toString()}`)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    return { data, error: null }
  } catch (err) {
    return { data: null, error: err }
  }
}

export const fetchSlackMessageById = async ({
  messageId,
  startDate,
  endDate,
  audited = false,
  auditFilter,
} = {}) => {
  try {
    const params = new URLSearchParams()
    if (startDate) params.set('start_date', startDate)
    if (endDate) params.set('end_date', endDate)

    const filter = auditFilter || (audited ? 'audited' : 'all')
    if (filter === 'audited') {
      params.set('audited', 'true')
    } else if (filter === 'unaudited') {
      params.set('hide_audited', 'true')
    }

    const url = `${API_BASE}/messages/${messageId}${params.toString() ? '?' + params.toString() : ''}`
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    return { data, error: null }
  } catch (err) {
    return { data: null, error: err }
  }
}
