/**
 * API client for PEFT model inference endpoints
 */

const API_BASE = import.meta.env.VITE_SLACK_BROWSER_API || 'http://localhost:5055'

/**
 * Run model inference on a message
 * @param {string} messageText - Raw Slack message text
 * @param {string} version - Model version to use (default: 'active')
 * @returns {Promise<{data: Object|null, error: Error|null}>}
 */
export const runInference = async (messageText, version = 'active') => {
  try {
    const resp = await fetch(`${API_BASE}/infer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_text: messageText, version }),
    })

    if (!resp.ok) {
      const errorText = await resp.text()
      throw new Error(`HTTP ${resp.status}: ${errorText}`)
    }

    const data = await resp.json()
    return { data, error: null }
  } catch (err) {
    console.error('Model inference failed:', err)
    return { data: null, error: err }
  }
}

/**
 * Compare regex extraction vs model inference for a record
 * @param {number} recordId - Record ID to compare
 * @returns {Promise<{data: Object|null, error: Error|null}>}
 */
export const compareExtractions = async (recordId) => {
  try {
    const resp = await fetch(`${API_BASE}/compare/${recordId}`)

    if (!resp.ok) {
      const errorText = await resp.text()
      throw new Error(`HTTP ${resp.status}: ${errorText}`)
    }

    const data = await resp.json()
    return { data, error: null }
  } catch (err) {
    console.error('Comparison failed:', err)
    return { data: null, error: err }
  }
}

/**
 * Get training statistics and model versions
 * @returns {Promise<{data: Object|null, error: Error|null}>}
 */
export const getTrainingStats = async () => {
  try {
    const resp = await fetch(`${API_BASE}/training/stats`)

    if (!resp.ok) {
      const errorText = await resp.text()
      throw new Error(`HTTP ${resp.status}: ${errorText}`)
    }

    const data = await resp.json()
    return { data, error: null }
  } catch (err) {
    console.error('Failed to get training stats:', err)
    return { data: null, error: err }
  }
}
