/* eslint-env node */
// Registry of Slack channels with human-friendly names and purposes.
// Extend this list to add new channels; keep IDs stable to avoid breakage.
const parseCsvIds = (value = '') => (value || '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean)

const envWarehouseIds = parseCsvIds(
  process.env.SLACK_WAREHOUSE_LOG_CHANNEL_IDS
  || process.env.SLACK_WAREHOUSE_LOG_CHANNEL_ID
  || process.env.WAREHOUSE_LOG_CHANNEL_ID,
)
const envChannels = envWarehouseIds.map((id, idx) => ({
  name: `${process.env.WAREHOUSE_LOG_CHANNEL_NAME || 'warehouse-log'}${envWarehouseIds.length > 1 ? `-${idx + 1}` : ''}`,
  id,
  purposes: ['warehouse'],
}))

const uniqueChannels = (channels = []) => {
  const seen = new Set()
  return channels.filter((channel) => {
    if (!channel.id || seen.has(channel.id)) return false
    seen.add(channel.id)
    return true
  })
}

export const warehouseLogChannels = uniqueChannels(envChannels)
export const warehouseLogChannelIds = warehouseLogChannels.map((c) => c.id)
export const defaultWarehouseLogChannelId = warehouseLogChannelIds[0] || null

export const isWarehouseLogChannel = (channelId) => {
  if (!warehouseLogChannelIds.length) return false
  return warehouseLogChannelIds.includes(channelId)
}

export const channelNameById = (channelId) => {
  const match = warehouseLogChannels.find((c) => c.id === channelId)
  return match ? match.name : channelId
}
