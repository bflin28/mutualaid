const parseResponse = async (resp) => {
  let json = {}
  try {
    json = await resp.json()
  } catch (err) {
    json = {}
  }

  if (!resp.ok) {
    const message = json.error || resp.statusText || 'Request failed'
    return { data: null, error: new Error(message) }
  }

  const data = typeof json.data !== 'undefined' ? json.data : json
  return { data, error: null }
}

const getJson = async (path) => {
  try {
    const resp = await fetch(path)
    return parseResponse(resp)
  } catch (err) {
    return { data: null, error: err }
  }
}

const postJson = async (path, body) => {
  try {
    const resp = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    })
    return parseResponse(resp)
  } catch (err) {
    return { data: null, error: err }
  }
}

const putJson = async (path, body) => {
  try {
    const resp = await fetch(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    })
    return parseResponse(resp)
  } catch (err) {
    return { data: null, error: err }
  }
}

export const fetchWarehouseLogs = async ({ limit = 500 } = {}) => {
  const params = new URLSearchParams({ limit: String(limit) })
  const { data, error } = await getJson(`/api/warehouse/logs?${params.toString()}`)
  return { data: data || [], error }
}

export const previewWarehouseLog = async ({ text, images = [] } = {}) => postJson('/api/warehouse/logs/preview', { text, images })

export const saveWarehouseLog = async (payload) => postJson('/api/warehouse/logs', payload)

export const updateWarehouseLogItems = async (logId, items, rescuedAt) => putJson(`/api/warehouse/logs/${logId}/items`, {
  items,
  rescued_at: rescuedAt || null,
})
