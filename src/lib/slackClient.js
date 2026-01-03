const nodeEnv = typeof process !== 'undefined' && process.env ? process.env : {}
const defaultSlackWebhook = nodeEnv.SLACK_WEBHOOK_URL || ''

export const sendSlackMessage = async (
  payload,
  { webhookUrl = defaultSlackWebhook, fetcher = globalThis.fetch } = {},
) => {
  if (!webhookUrl) {
    return { data: null, error: null, skipped: true }
  }

  if (!payload?.text) {
    return { data: null, error: new Error('Slack message text is required.') }
  }

  if (!fetcher) {
    return { data: null, error: new Error('Fetch implementation missing for Slack client.') }
  }

  try {
    const response = await fetcher(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      return { data: null, error: new Error(`Slack webhook returned ${response.status}`) }
    }

    const data = await response.json().catch(() => ({}))
    return { data, error: null }
  } catch (error) {
    return { data: null, error }
  }
}
