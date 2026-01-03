const nodeEnv = typeof process !== 'undefined' && process.env ? process.env : {}
const defaultEmailServiceUrl = nodeEnv.EMAIL_WEBHOOK_URL

export const sendApprovalEmail = async (
  { to, eventName, eventDay, eventTime, notes, subject } = {},
  { emailServiceUrl = defaultEmailServiceUrl, fetcher = globalThis.fetch } = {},
) => {
  if (!emailServiceUrl) {
    return { data: null, error: null, skipped: true }
  }

  if (!to) {
    return { data: null, error: new Error('Recipient email is required for approval message.') }
  }

  if (!fetcher) {
    return { data: null, error: new Error('Fetch implementation missing for email client.') }
  }

  const body = {
    to,
    subject: subject || `Your pickup is approved: ${eventName || 'Food rescue event'}`,
    template: 'approval',
    eventName,
    eventDay,
    eventTime,
    notes,
  }

  try {
    const response = await fetcher(emailServiceUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      return {
        data: null,
        error: new Error(`Email service returned ${response.status}`),
      }
    }

    const data = await response.json().catch(() => ({}))
    return { data, error: null }
  } catch (error) {
    return { data: null, error }
  }
}
