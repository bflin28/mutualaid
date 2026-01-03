const formatNumber = (num) => {
  if (!Number.isFinite(num)) return '0'
  const rounded = Math.round(num * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, '')
}

const pluralizeUnit = (unit, qty) => {
  if (!unit) return ''
  return Math.abs(qty) === 1 ? unit : `${unit}s`
}

export const emptyTotals = () => ({
  weightLb: 0,
  volumeGallons: 0,
  containers: {},
  countEach: 0,
})

export const mergeTotals = (base = emptyTotals(), incoming = emptyTotals()) => {
  const merged = {
    weightLb: (base.weightLb || 0) + (incoming.weightLb || 0),
    volumeGallons: (base.volumeGallons || 0) + (incoming.volumeGallons || 0),
    countEach: (base.countEach || 0) + (incoming.countEach || 0),
    containers: { ...(base.containers || {}) },
  }

  Object.entries(incoming.containers || {}).forEach(([unit, qty]) => {
    merged.containers[unit] = (merged.containers[unit] || 0) + (qty || 0)
  })

  return merged
}

export const formatNormalizedSummary = ({ items = [], totals = emptyTotals() } = {}) => {
  if (!items.length) return ''

  const itemLines = items.map((item) => {
    const qty = formatNumber(item.quantity)
    const unitLabel = item.unit || item.canonicalUnit || ''
    const itemName = item.item || ''

    let canonicalLabel = ''
    if (item.unitKind === 'weight') {
      canonicalLabel = `${formatNumber(item.canonicalQuantity)} ${pluralizeUnit('lb', item.canonicalQuantity)}`
    } else if (item.unitKind === 'volume') {
      canonicalLabel = `${formatNumber(item.canonicalQuantity)} ${pluralizeUnit('gallon', item.canonicalQuantity)}`
    } else if (item.unitKind === 'container') {
      canonicalLabel = `${formatNumber(item.canonicalQuantity)} ${pluralizeUnit(item.canonicalUnit, item.canonicalQuantity)}`
    } else {
      canonicalLabel = `${formatNumber(item.canonicalQuantity)} ${pluralizeUnit('each', item.canonicalQuantity)}`
    }

    return `• ${qty} ${unitLabel} ${itemName}`.trim() + ` → ${canonicalLabel}`
  })

  const totalParts = []
  if (totals.weightLb) totalParts.push(`${formatNumber(totals.weightLb)} lb`)
  if (totals.volumeGallons) totalParts.push(`${formatNumber(totals.volumeGallons)} gal`)
  Object.entries(totals.containers || {}).forEach(([unit, qty]) => {
    if (qty) totalParts.push(`${formatNumber(qty)} ${pluralizeUnit(unit, qty)}`)
  })
  if (totals.countEach) totalParts.push(`${formatNumber(totals.countEach)} each`)

  const totalsLine = totalParts.length ? `Totals: ${totalParts.join(' · ')}` : ''

  return ['Parsed food log:', ...itemLines, totalsLine].filter(Boolean).join('\n')
}

export const postSlackMessage = async ({ slackBotToken, channel, text, threadTs }) => {
  if (!slackBotToken) return { ok: false, error: new Error('Slack bot token missing') }
  if (!channel || !text) return { ok: false, error: new Error('channel and text are required for Slack message') }

  try {
    const payload = {
      channel,
      text,
    }
    if (threadTs) payload.thread_ts = threadTs

    const resp = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${slackBotToken}`,
      },
      body: JSON.stringify(payload),
    })
    const json = await resp.json().catch(() => ({}))
    if (!resp.ok || !json.ok) {
      return { ok: false, error: new Error(json.error || `Slack API returned ${resp.status}`) }
    }
    return { ok: true, data: json }
  } catch (err) {
    return { ok: false, error: err }
  }
}
