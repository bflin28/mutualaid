const API_BASE = import.meta.env.VITE_SLACK_BROWSER_API || 'http://localhost:5055'

export const fetchAuditedMessages = async () => {
  try {
    const params = new URLSearchParams({ audited: 'true', start: '0', limit: '5000' })
    const resp = await fetch(`${API_BASE}/messages?${params.toString()}`)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    return { data, error: null }
  } catch (err) {
    return { data: null, error: err }
  }
}
