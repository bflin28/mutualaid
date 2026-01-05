const API_BASE = import.meta.env.VITE_SLACK_BROWSER_API || 'http://localhost:5055'

export const auditSlackRecord = async (record) => {
  try {
    const resp = await fetch(`${API_BASE}/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    return { data, error: null }
  } catch (err) {
    return { data: null, error: err }
  }
}

export const saveRescueLog = async (payload) => {
  try {
    const resp = await fetch(`${API_BASE}/rescue-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    return { data, error: null }
  } catch (err) {
    return { data: null, error: err }
  }
}
