import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { submitPickupSignup, createEvent as createEventApi, fetchApprovedEvents, triggerSlackAlert } from './lib/pickupApi'
import { fetchWarehouseLogs, previewWarehouseLog, saveWarehouseLog, updateWarehouseLogItems } from './lib/warehouseLogApi'
import { fetchSlackMessage, searchSlackMessages, fetchSlackMessageById } from './lib/slackBrowserApi'
import { auditSlackRecord } from './lib/slackAuditApi'
import { runInference, compareExtractions, getTrainingStats } from './lib/modelInferenceApi'
import locationAliases from '../training/peft/data/location_aliases.json'

const LOCATION_OPTIONS = Object.keys(locationAliases || {}).sort((a, b) => a.localeCompare(b))
const WAREHOUSE_SUBCATEGORY_OPTIONS = ['produce', 'grain', 'meat', 'drinks', 'snacks', 'dry goods', 'dairy']
const formatSubcategoryLabel = (value) => value.split(' ').map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' ')
const normalizeSubcategory = (value = '') => {
  const lower = String(value || '').trim().toLowerCase()
  if (!lower) return ''
  if (lower === 'fruit' || lower === 'vegetable') return 'produce'
  return WAREHOUSE_SUBCATEGORY_OPTIONS.includes(lower) ? lower : ''
}
const parseSubcategoryFromNotes = (notes = '') => normalizeSubcategory(String(notes || '').split('·')[0].trim())
const todayDateString = () => new Date().toISOString().slice(0, 10)
const toDateInputValue = (value) => {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}
const formatDisplayDate = (value) => {
  if (!value) return 'unknown date'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'unknown date'
  return date.toLocaleDateString()
}
const getItemWeight = (item = {}) => {
  const val = Number(item.pounds ?? item.estimated_lbs)
  return Number.isFinite(val) ? val : 0
}
const totalRescuedWeight = (items = []) => (Array.isArray(items) ? items : []).reduce((sum, item) => sum + getItemWeight(item), 0)

const normalizeLocationKey = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9 ]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const titleCaseWords = (value) => {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return ''
  return words.map((word) => {
    const clean = word.replace(/[^a-z0-9'-]/gi, '')
    if (!clean) return word
    if (clean.length <= 2) return clean.toUpperCase()
    return `${clean[0].toUpperCase()}${clean.slice(1).toLowerCase()}`
  }).join(' ')
}

const buildLocationAliasLookup = (aliases = {}) => {
  const map = new Map()
  Object.entries(aliases || {}).forEach(([canonical, aliasList]) => {
    const canonKey = normalizeLocationKey(canonical)
    if (canonKey) map.set(canonKey, canonical)
    ;(aliasList || []).forEach((alias) => {
      const key = normalizeLocationKey(alias)
      if (key) map.set(key, canonical)
    })
  })
  return map
}

const LOCATION_ALIAS_LOOKUP = buildLocationAliasLookup(locationAliases)

const stripLocationLeadIns = (value = '') => {
  const cleaned = String(value || '').trim()
  if (!cleaned) return ''
  const patterns = [
    /^[A-Za-z0-9 /&'’.-]+\s+picked\s+up\s+(?:this\s+morning|earlier\s+today|today)?\s+at\s+(.+)$/i,
    /^[A-Za-z0-9 /&'’.-]+\s+picked\s+up\s+at\s+(.+)$/i,
    /^[A-Za-z0-9 /&'’.-]+\s+picked\s+up\s+from\s+(.+)$/i,
    /^[A-Za-z0-9 /&'’.-]+\s+took\s+(?:directly\s+)?from\s+(.+)$/i,
  ]
  for (const pat of patterns) {
    const match = cleaned.match(pat)
    if (match) return match[1].trim().replace(/^[-:]/, '').trim()
  }
  return cleaned
}

const canonicalizeLocation = (value) => {
  const cleaned = stripLocationLeadIns(value)
  const trimmed = cleaned
    .replace(/^\s*from\s+/i, '')
    .split('\n')[0]
    .split('(')[0]
    .replace(/\s*[:;,-]+\s*$/, '')
    .replace(/\btook\b\s*$/i, '')
    .trim()
  const key = normalizeLocationKey(trimmed)
  if (!key) return ''
  const alias = LOCATION_ALIAS_LOOKUP.get(key)
  if (alias) return alias
  for (const [aliasKey, canonical] of LOCATION_ALIAS_LOOKUP.entries()) {
    if (aliasKey && key.includes(aliasKey)) return canonical
  }
  return ''
}

const collectRescueLocations = (record) => {
  if (!record) return []
  const set = new Set()
  const add = (val) => {
    const resolved = canonicalizeLocation(val)
    if (resolved) set.add(resolved)
  }
  add(record.rescue_location_canonical)
  add(record.rescue_location)
  if (Array.isArray(record.sections)) {
    record.sections.forEach((sec) => {
      add(sec?.location_canonical)
      add(sec?.location)
    })
  }
  return Array.from(set)
}

const collectSectionLocations = (sections = []) => {
  if (!Array.isArray(sections)) return []
  const locations = sections
    .map((section) => canonicalizeLocation(section?.location_canonical || section?.location))
    .filter(Boolean)
  return Array.from(new Set(locations))
}

const resolveLocationLabel = (value) => {
  const canonical = canonicalizeLocation(value)
  if (canonical) return canonical
  const trimmed = String(value || '').trim()
  return trimmed
}

const getRecordTimestamp = (record) => {
  if (!record) return null
  const candidate = record.start_ts || record.slack_sent_at || record.created_at || record.audited_at
  if (!candidate) return null
  if (candidate instanceof Date) {
    return Number.isNaN(candidate.getTime()) ? null : candidate.getTime()
  }
  const numeric = Number(candidate)
  if (Number.isFinite(numeric)) {
    const ms = numeric < 1000000000000 ? numeric * 1000 : numeric
    return Number.isNaN(ms) ? null : ms
  }
  const parsed = new Date(candidate)
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime()
}

const formatRecordDate = (record) => {
  const timestamp = getRecordTimestamp(record)
  if (!timestamp) return 'unknown date'
  return new Date(timestamp).toLocaleDateString()
}

const getRecordPrimaryLocation = (record) => resolveLocationLabel(
  record?.drop_off_location_canonical || record?.drop_off_location || record?.rescue_location_canonical || record?.rescue_location,
)

const buildAuditedCards = (record) => {
  if (!record) return []
  const sections = Array.isArray(record.sections) ? record.sections : []
  if (sections.length) {
    return sections.map((section, idx) => {
      const locationValue = section?.location_canonical || section?.location
      const location = resolveLocationLabel(locationValue) || getRecordPrimaryLocation(record)
      return {
        key: `section-${idx}`,
        location,
        items: Array.isArray(section?.items) ? section.items : [],
      }
    })
  }
  return [{
    key: 'items',
    location: getRecordPrimaryLocation(record),
    items: Array.isArray(record.items) ? record.items : [],
  }]
}

const auditedRecordRowId = (record, fallback) => (
  record?.id
  || record?.message_key
  || record?.slack_ts
  || record?.start_ts
  || record?.audited_at
  || `audited-${fallback}`
)

const getRecordRawText = (record) => {
  if (!record) return 'No message text captured.'
  if (Array.isArray(record.raw_messages) && record.raw_messages.length) {
    return record.raw_messages.join(' | ')
  }
  if (record.raw_text) return record.raw_text
  if (record.raw_message) return record.raw_message
  return 'No message text captured.'
}

function App() {
  const [currentView, setCurrentView] = useState('deliveries')
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [selectedPickup, setSelectedPickup] = useState(null)
  const [events, setEvents] = useState([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [eventsError, setEventsError] = useState('')
  const [deliveries, setDeliveries] = useState([])
  const [deliveriesLoading, setDeliveriesLoading] = useState(false)
  const [deliveriesError, setDeliveriesError] = useState('')
  const [warehouseInput, setWarehouseInput] = useState('')
  const [warehouseDraft, setWarehouseDraft] = useState(null)
  const [warehouseItems, setWarehouseItems] = useState([])
  const [warehouseDraftMeta, setWarehouseDraftMeta] = useState({
    location: '',
    summary: '',
    notes: '',
    rescuedDate: todayDateString(),
  })
  const [warehouseImages, setWarehouseImages] = useState([])
  const [warehousePreviewStatus, setWarehousePreviewStatus] = useState('idle')
  const [warehousePreviewError, setWarehousePreviewError] = useState('')
  const [warehouseSaveStatus, setWarehouseSaveStatus] = useState({ state: 'idle', message: '' })
  const [expandedDeliveryId, setExpandedDeliveryId] = useState(null)
  const [expandedAuditedId, setExpandedAuditedId] = useState(null)
  const [editingDeliveryItems, setEditingDeliveryItems] = useState({})
  const [editingDeliveryDates, setEditingDeliveryDates] = useState({})
  const [deliveryItemSaveState, setDeliveryItemSaveState] = useState({})
  const [daysToShow, setDaysToShow] = useState(7)
  const [signupForm, setSignupForm] = useState({
    name: '',
    email: '',
    phone: '',
    notes: '',
    firstTime: false,
  })
  const [newEvent, setNewEvent] = useState({
    title: '',
    description: '',
    address: '',
    day: '',
    startHour: '',
    startMinute: '',
    startMeridiem: '',
    endHour: '',
    endMinute: '',
    endMeridiem: '',
    capacity: 1,
    recurrenceType: 'weekly',
    recurrenceNth: '3',
    recurrenceWeekday: 'Thursday',
    singleDate: '',
  })
  const [signupStatus, setSignupStatus] = useState({ state: 'idle', message: '' })
  const [slackStatus, setSlackStatus] = useState({ state: 'idle', message: '' })
  const [slackRecord, setSlackRecord] = useState(null)
  const [slackTotal, setSlackTotal] = useState(0)
  const [slackIndex, setSlackIndex] = useState(0)
  const [slackBrowserStatus, setSlackBrowserStatus] = useState({ state: 'idle', message: '' })
  const [slackStartDate, setSlackStartDate] = useState('2025-01-01')
  const [slackEndDate, setSlackEndDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [slackAuditStatus, setSlackAuditStatus] = useState({ state: 'idle', message: '' })
  const [auditFilter, setAuditFilter] = useState('unaudited')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchTotal, setSearchTotal] = useState(0)
  const [searchStatus, setSearchStatus] = useState({ state: 'idle', message: '' })
  const [showSearchResults, setShowSearchResults] = useState(false)
  const slackItems = useMemo(() => {
    if (!slackRecord) return []
    if (Array.isArray(slackRecord.sections) && slackRecord.sections.length) {
      return slackRecord.sections.flatMap((sec) => Array.isArray(sec.items) ? sec.items : [])
    }
    return Array.isArray(slackRecord.items) ? slackRecord.items : []
  }, [slackRecord])
  const sectionLocations = useMemo(() => collectSectionLocations(slackRecord?.sections), [slackRecord])
  const rescueLocations = useMemo(() => {
    if (!slackRecord) return []
    const direction = String(slackRecord.direction || '').toLowerCase()
    if (direction === 'outbound') return []
    const locations = collectRescueLocations(slackRecord)
    if (direction !== 'both') return locations
    const dropFromRecord = canonicalizeLocation(slackRecord.drop_off_location_canonical || slackRecord.drop_off_location)
    const drop = dropFromRecord || sectionLocations[sectionLocations.length - 1] || ''
    return drop ? locations.filter((loc) => loc !== drop) : locations
  }, [slackRecord, sectionLocations])
  const dropOffLocations = useMemo(() => {
    if (!slackRecord) return []
    const direction = String(slackRecord.direction || '').toLowerCase()
    const dropFromRecord = canonicalizeLocation(slackRecord.drop_off_location_canonical || slackRecord.drop_off_location)
    if (direction === 'outbound') {
      return sectionLocations.length ? sectionLocations : (dropFromRecord ? [dropFromRecord] : [])
    }
    if (dropFromRecord) return [dropFromRecord]
    if (!sectionLocations.length) return []
    if (direction === 'both') return [sectionLocations[sectionLocations.length - 1]]
    return []
  }, [slackRecord, sectionLocations])
  const [auditedStats, setAuditedStats] = useState({
    total: 0,
    items: [],
    byLocation: [],
    bySubcategory: [],
    totalLbs: 0,
    records: [],
  })
  const [auditedLoading, setAuditedLoading] = useState(false)
  const [auditedError, setAuditedError] = useState('')
  const [selectedAuditedLocation, setSelectedAuditedLocation] = useState(null)
  const [unauditedMessages, setUnauditedMessages] = useState([])
  const [unauditedLoading, setUnauditedLoading] = useState(false)
  const [editingAuditedCards, setEditingAuditedCards] = useState({})
  const [auditedCardSaveState, setAuditedCardSaveState] = useState({})
  const [recurringEvents, setRecurringEvents] = useState([])
  const [recurringLoading, setRecurringLoading] = useState(false)
  const [recurringError, setRecurringError] = useState('')
  const [showRecurringForm, setShowRecurringForm] = useState(false)
  const [recurringFormData, setRecurringFormData] = useState({
    id: null,
    rescue_location_canonical: '',
    day_of_week: 1,
    items: [{
      name: '',
      quantity: '',
      unit: '',
      subcategory: '',
      estimated_lbs: '',
    }],
  })
  const [recurringFormStatus, setRecurringFormStatus] = useState({ state: 'idle', message: '' })
  const sortedAuditedRecords = useMemo(() => {
    const records = Array.isArray(auditedStats.records) ? [...auditedStats.records] : []
    records.sort((a, b) => {
      const aTime = getRecordTimestamp(a)
      const bTime = getRecordTimestamp(b)
      if (aTime === null && bTime === null) return 0
      if (aTime === null) return 1
      if (bTime === null) return -1
      return aTime - bTime
    })
    return records
  }, [auditedStats.records])

  const availableAuditedLocations = useMemo(() => {
    // Union of locations from location_aliases AND locations from audited messages
    // This ensures we show all known locations (for creating recurring events)
    // plus any locations that appear in messages but aren't in aliases yet
    const locationSet = new Set(LOCATION_OPTIONS)
    const records = Array.isArray(auditedStats.records) ? auditedStats.records : []

    records.forEach((rec) => {
      const locations = collectRescueLocations(rec)
      locations.forEach(loc => locationSet.add(loc))
    })

    return Array.from(locationSet).filter(Boolean).sort((a, b) => a.localeCompare(b))
  }, [auditedStats.records])

  const filteredAuditedRecords = useMemo(() => {
    const records = Array.isArray(auditedStats.records) ? auditedStats.records : []

    if (!selectedAuditedLocation) {
      return records
    }

    const filtered = records.filter((rec) => {
      const locations = collectRescueLocations(rec)
      return locations.includes(selectedAuditedLocation)
    })

    // Sort chronologically
    filtered.sort((a, b) => {
      const aTime = getRecordTimestamp(a)
      const bTime = getRecordTimestamp(b)
      if (aTime === null && bTime === null) return 0
      if (aTime === null) return 1
      if (bTime === null) return -1
      return aTime - bTime
    })

    return filtered
  }, [auditedStats.records, selectedAuditedLocation])

  const locationSpecificStats = useMemo(() => {
    if (!selectedAuditedLocation) return null

    const records = filteredAuditedRecords
    let totalLbs = 0
    const items = []

    records.forEach((rec) => {
      const cards = buildAuditedCards(rec)
      cards.forEach((card) => {
        // Only count cards that match the selected location
        if (card.location === selectedAuditedLocation) {
          const cardItems = Array.isArray(card.items) ? card.items : []
          cardItems.forEach((it) => {
            items.push(it)
            totalLbs += getItemWeight(it)
          })
        }
      })
    })

    const eventCount = records.length
    const avgLbsPerEvent = eventCount > 0 ? totalLbs / eventCount : 0

    return {
      totalLbs,
      eventCount,
      avgLbsPerEvent,
      items,
    }
  }, [selectedAuditedLocation, filteredAuditedRecords])

  const locationUnauditedMessages = useMemo(() => {
    if (!selectedAuditedLocation || !unauditedMessages.length) return []

    return unauditedMessages.filter((msg) => {
      const rawText = getRecordRawText(msg).toLowerCase()
      const locationLower = selectedAuditedLocation.toLowerCase()
      return rawText.includes(locationLower)
    })
  }, [selectedAuditedLocation, unauditedMessages])

  // Model inference state
  const [extractionMethod, setExtractionMethod] = useState('regex') // 'regex' | 'model' | 'compare'
  const [modelInference, setModelInference] = useState(null)
  const [modelInferenceLoading, setModelInferenceLoading] = useState(false)
  const [comparisonData, setComparisonData] = useState(null)
  const [trainingStats, setTrainingStats] = useState({
    audited_count: 0,
    ready_for_training: false,
    models: [],
    active_version: null,
    has_active_model: false,
  })

  const dayOrder = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const loadMoreRef = useRef(null)
  const openInitRef = useRef(false)

  const loadDeliveries = useCallback(async () => {
    setDeliveriesLoading(true)
    setDeliveriesError('')
    const { data, error } = await fetchWarehouseLogs()
    if (error) {
      setDeliveriesError(error.message || 'Could not load deliveries.')
      setDeliveries([])
    } else {
      setDeliveries(data || [])
    }
    setDeliveriesLoading(false)
    setExpandedDeliveryId(null)
    setEditingDeliveryItems({})
    setEditingDeliveryDates({})
    setDeliveryItemSaveState({})
  }, [])

  const fetchUnauditedForLocation = useCallback(async (location) => {
    if (!location) {
      setUnauditedMessages([])
      return
    }

    setUnauditedLoading(true)
    const { data, error } = await fetchSlackMessage({
      auditFilter: 'unaudited',
      start: 0,
      limit: 1000,
    })

    if (error || !data) {
      console.error('Failed to fetch unaudited messages:', error)
      setUnauditedMessages([])
    } else {
      const records = Array.isArray(data.records) ? data.records : []
      setUnauditedMessages(records)
    }

    setUnauditedLoading(false)
  }, [])

  const loadRecurringEvents = useCallback(async (location) => {
    if (!location) {
      setRecurringEvents([])
      return
    }

    setRecurringLoading(true)
    setRecurringError('')

    const { data, error } = await fetchSlackMessage({
      auditFilter: 'audited',
      start: 0,
      limit: 5000,
      includeRecurring: true,
    })

    if (error || !data) {
      setRecurringError(error?.message || 'Could not load recurring events.')
      setRecurringEvents([])
    } else {
      const records = Array.isArray(data.records) ? data.records : []
      // Filter for recurring events at this location
      // For recurring events, directly compare rescue_location_canonical
      const recurring = records.filter(r => {
        if (!r.recurring) return false
        return r.rescue_location_canonical === location
      })
      setRecurringEvents(recurring)
    }

    setRecurringLoading(false)
  }, [])

  const generateVirtualRecordsFromRecurring = useCallback((recurringEvent, startDate, endDate) => {
    if (!recurringEvent?.recurring) return []

    const virtualRecords = []
    const start = new Date(startDate)
    const end = new Date(endDate)
    const dayOfWeek = recurringEvent.day_of_week

    // Find first occurrence of this day of week within range
    let current = new Date(start)
    while (current.getDay() !== dayOfWeek && current <= end) {
      current.setDate(current.getDate() + 1)
    }

    // Generate records for each occurrence
    while (current <= end) {
      const virtualId = `${recurringEvent.id}-${current.toISOString().slice(0, 10)}`
      virtualRecords.push({
        ...recurringEvent,
        id: virtualId,
        virtual_from_recurring: true,
        recurring_parent_id: recurringEvent.id,
        start_ts: current.toISOString(),
        end_ts: current.toISOString(),
      })
      current.setDate(current.getDate() + 7) // Next week
    }

    return virtualRecords
  }, [])

  const resetWarehouseDraftState = () => {
    setWarehouseDraft(null)
    setWarehouseItems([])
    setWarehouseDraftMeta({
      location: '',
      summary: '',
      notes: '',
      rescuedDate: todayDateString(),
    })
    setWarehouseImages([])
    setWarehousePreviewStatus('idle')
    setWarehousePreviewError('')
  }

  const handleWarehouseInputChange = (value) => {
    setWarehouseInput(value)
    setWarehousePreviewError('')
    setWarehouseSaveStatus({ state: 'idle', message: '' })
    if (warehouseDraft && value !== (warehouseDraft.raw_text || '')) {
      resetWarehouseDraftState()
    }
  }

  const readImageFilesAsDataUrls = async (fileList) => {
    const files = Array.from(fileList || []).filter((file) => (file.type || '').startsWith('image/')).slice(0, 3)
    if (!files.length) return []
    const readers = files.map(
      (file) => new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(file)
      }),
    )
    return Promise.all(readers)
  }

  const handleWarehouseImagesChange = async (fileList) => {
    try {
      const urls = await readImageFilesAsDataUrls(fileList)
      setWarehouseImages((prev) => [...prev, ...urls].slice(0, 3))
      setWarehousePreviewError('')
    } catch (err) {
      setWarehousePreviewError('Could not read images. Please try smaller files.')
    }
  }

  const handleWarehousePaste = async (event) => {
    const clipboardFiles = event.clipboardData?.files || []
    if (!clipboardFiles.length) return
    const images = Array.from(clipboardFiles).filter((file) => (file.type || '').startsWith('image/'))
    if (!images.length) return
    try {
      const urls = await readImageFilesAsDataUrls(images)
      if (urls.length) {
        setWarehouseImages((prev) => [...prev, ...urls].slice(0, 3))
        setWarehousePreviewError('')
      }
    } catch (err) {
      setWarehousePreviewError('Could not read pasted images.')
    }
  }

  const removeWarehouseImage = (index) => {
    setWarehouseImages((prev) => prev.filter((_, idx) => idx !== index))
  }

  const handleWarehousePreview = async () => {
    if (!warehouseInput.trim()) {
      setWarehousePreviewError('Paste a Slack message to parse.')
      return
    }
    setWarehousePreviewStatus('loading')
    setWarehousePreviewError('')
    setWarehouseSaveStatus({ state: 'idle', message: '' })
    // Images are stored on save but intentionally not sent to the LLM parser.
    const { data, error } = await previewWarehouseLog({ text: warehouseInput })
    if (error) {
      setWarehousePreviewStatus('idle')
      setWarehousePreviewError(error.message || 'Could not parse message.')
      return
    }
    const meta = {
      location: data.location || '',
      summary: data.summary || '',
      notes: data.notes || '',
      rescuedDate: warehouseDraftMeta.rescuedDate || toDateInputValue(new Date()),
    }
    setWarehouseDraft(data)
    setWarehouseItems((data.items || []).map((item) => ({
      name: item.name || item.item_name || '',
      quantity: item.quantity ?? '',
      unit: item.unit || item.container || '',
      subcategory: item.subcategory || '',
      estimated_lbs: item.estimated_lbs ?? '',
      notes: item.notes || '',
    })))
    setWarehouseDraftMeta(meta)
    setWarehousePreviewStatus('ready')
  }

  const deliveryRowId = (delivery) => delivery.id || delivery.message_key || delivery.slack_ts

  const deriveSubcategory = (item = {}) => {
    if (item.subcategory) return normalizeSubcategory(item.subcategory)
    return parseSubcategoryFromNotes(item.notes)
  }

  const deriveRescueDate = (delivery = {}) => {
    const created = delivery.created_at || delivery.slack_sent_at
    return toDateInputValue(created || new Date())
  }

  const startEditingDelivery = (delivery) => {
    const rowId = deliveryRowId(delivery)
    setExpandedDeliveryId((prev) => (prev === rowId ? null : rowId))
    setEditingDeliveryItems((prev) => ({
      ...prev,
      [rowId]: (delivery.items || []).map((item) => ({
        id: item.id,
        name: item.item_name || item.name || '',
        quantity: item.quantity ?? '',
        unit: item.unit || item.container || '',
        pounds: item.pounds ?? item.estimated_lbs ?? '',
        subcategory: deriveSubcategory(item),
      })),
    }))
    setEditingDeliveryDates((prev) => ({
      ...prev,
      [rowId]: deriveRescueDate(delivery),
    }))
    setDeliveryItemSaveState({})
  }

  const updateDeliveryItem = (rowId, index, field, value) => {
    setEditingDeliveryItems((prev) => {
      const list = prev[rowId] || []
      if (field === 'remove') {
        return { ...prev, [rowId]: list.filter((_, idx) => idx !== index) }
      }
      return {
        ...prev,
        [rowId]: list.map((item, idx) => (idx === index ? { ...item, [field]: value } : item)),
      }
    })
  }

  const handleSaveDeliveryItems = async (delivery) => {
    const rowId = deliveryRowId(delivery)
    const items = editingDeliveryItems[rowId] || []
    const rescuedAt = editingDeliveryDates[rowId] || ''
    if (!items.length) return
    if (!delivery.id) {
      setDeliveryItemSaveState({ [rowId]: 'error', message: 'Missing log id for update.' })
      return
    }
    setDeliveryItemSaveState({ [rowId]: 'saving' })
    const payload = items
      .filter((item) => (item.name || '').trim())
      .map((item) => ({
        ...item,
        quantity: item.quantity === '' ? null : item.quantity,
        pounds: item.pounds === '' ? null : item.pounds,
      }))

    const { error, data } = await updateWarehouseLogItems(delivery.id, payload, rescuedAt)
    if (error) {
      setDeliveryItemSaveState({ [rowId]: 'error', message: error.message || 'Failed to save items' })
      return
    }
    const newItems = data?.items || items
    const newCreatedAt = data?.rescued_at || delivery.created_at
    setDeliveries((prev) => prev.map((d) => (deliveryRowId(d) === rowId
      ? { ...d, items: newItems, created_at: newCreatedAt, slack_sent_at: d.slack_sent_at || newCreatedAt }
      : d)))
    setDeliveryItemSaveState({ [rowId]: 'saved' })
    setExpandedDeliveryId((prev) => (prev === rowId ? null : prev))
  }

  const handleCancelDeliveryItems = (delivery) => {
    const rowId = deliveryRowId(delivery)
    setExpandedDeliveryId(null)
    setEditingDeliveryItems((prev) => ({ ...prev, [rowId]: (delivery.items || []).map((item) => ({
      id: item.id,
      name: item.item_name || item.name || '',
      quantity: item.quantity ?? '',
      unit: item.unit || item.container || '',
      pounds: item.pounds ?? item.estimated_lbs ?? '',
      subcategory: deriveSubcategory(item),
    })) }))
    setEditingDeliveryDates((prev) => ({ ...prev, [rowId]: deriveRescueDate(delivery) }))
    setDeliveryItemSaveState({})
  }

  const startEditingAuditedCard = (record, cardIndex) => {
    const rowId = auditedRecordRowId(record)
    const cardKey = `${rowId}-${cardIndex}`
    const cards = buildAuditedCards(record)
    const card = cards[cardIndex]
    if (!card) return

    setEditingAuditedCards((prev) => ({
      ...prev,
      [cardKey]: {
        record,
        cardIndex,
        items: (card.items || []).map((item) => ({
          name: item.name || item.item_name || '',
          quantity: item.quantity ?? item.qty ?? '',
          unit: item.unit || item.container || '',
          subcategory: item.subcategory || '',
          estimated_lbs: item.estimated_lbs ?? item.pounds ?? '',
        })),
      },
    }))
    setAuditedCardSaveState({})
  }

  const updateAuditedCardItem = (cardKey, index, field, value) => {
    setEditingAuditedCards((prev) => {
      const cardData = prev[cardKey]
      if (!cardData) return prev

      const items = cardData.items || []
      if (field === 'remove') {
        return {
          ...prev,
          [cardKey]: {
            ...cardData,
            items: items.filter((_, idx) => idx !== index),
          },
        }
      }

      return {
        ...prev,
        [cardKey]: {
          ...cardData,
          items: items.map((item, idx) => (idx === index ? { ...item, [field]: value } : item)),
        },
      }
    })
  }

  const addAuditedCardItem = (cardKey) => {
    setEditingAuditedCards((prev) => {
      const cardData = prev[cardKey]
      if (!cardData) return prev

      return {
        ...prev,
        [cardKey]: {
          ...cardData,
          items: [
            ...(cardData.items || []),
            {
              name: '',
              quantity: '',
              unit: '',
              subcategory: '',
              estimated_lbs: '',
            },
          ],
        },
      }
    })
  }

  const handleSaveAuditedCard = async (cardKey) => {
    const cardData = editingAuditedCards[cardKey]
    if (!cardData) return

    const { record, cardIndex, items } = cardData
    if (!items.length) return

    setAuditedCardSaveState({ [cardKey]: 'saving' })

    // Rebuild the record with updated items for this card
    const cards = buildAuditedCards(record)
    const updatedCards = cards.map((card, idx) => {
      if (idx === cardIndex) {
        return {
          ...card,
          items: items
            .filter((item) => (item.name || '').trim())
            .map((item) => ({
              name: item.name,
              quantity: item.quantity === '' ? null : item.quantity,
              unit: item.unit || null,
              subcategory: item.subcategory || null,
              estimated_lbs: item.estimated_lbs === '' ? null : Number(item.estimated_lbs),
            })),
        }
      }
      return card
    })

    // Reconstruct the record's sections array
    const updatedSections = updatedCards.map((card) => ({
      location: card.location,
      location_canonical: card.location,
      items: card.items,
    }))

    // Calculate new total estimated lbs
    const total_estimated_lbs = updatedCards.reduce((sum, card) => {
      return sum + (card.items || []).reduce((cardSum, item) => {
        const lbs = Number(item.estimated_lbs)
        return cardSum + (Number.isFinite(lbs) ? lbs : 0)
      }, 0)
    }, 0)

    const payload = {
      ...record,
      sections: updatedSections,
      total_estimated_lbs,
      audited: true,
      audited_at: new Date().toISOString(),
    }

    const { error } = await auditSlackRecord(payload)
    if (error) {
      setAuditedCardSaveState({ [cardKey]: 'error', message: error.message || 'Failed to save card' })
      return
    }

    // Update the local state
    setAuditedStats((prev) => ({
      ...prev,
      records: prev.records.map((rec) =>
        auditedRecordRowId(rec) === auditedRecordRowId(record)
          ? { ...rec, sections: updatedSections, total_estimated_lbs }
          : rec
      ),
    }))

    setAuditedCardSaveState({ [cardKey]: 'saved' })
    setEditingAuditedCards((prev) => {
      const updated = { ...prev }
      delete updated[cardKey]
      return updated
    })

    // Refresh the audited stats to recalculate totals
    setTimeout(() => {
      const btn = document.getElementById('audited-refresh-btn')
      if (btn && !btn.disabled) btn.click()
    }, 500)
  }

  const handleCancelAuditedCard = (cardKey) => {
    setEditingAuditedCards((prev) => {
      const updated = { ...prev }
      delete updated[cardKey]
      return updated
    })
    setAuditedCardSaveState({})
  }

  const updateRecurringFormItem = (index, field, value) => {
    setRecurringFormData(prev => ({
      ...prev,
      items: prev.items.map((item, idx) =>
        idx === index ? { ...item, [field]: value } : item
      )
    }))
  }

  const addRecurringFormItem = () => {
    setRecurringFormData(prev => ({
      ...prev,
      items: [...prev.items, {
        name: '',
        quantity: '',
        unit: '',
        subcategory: '',
        estimated_lbs: '',
      }]
    }))
  }

  const removeRecurringFormItem = (index) => {
    setRecurringFormData(prev => ({
      ...prev,
      items: prev.items.filter((_, idx) => idx !== index)
    }))
  }

  const handleSaveRecurringEvent = async () => {
    setRecurringFormStatus({ state: 'saving', message: '' })

    const items = recurringFormData.items
      .filter(item => item.name.trim())
      .map(item => ({
        name: item.name,
        quantity: item.quantity === '' ? null : Number(item.quantity),
        unit: item.unit || null,
        subcategory: item.subcategory || null,
        estimated_lbs: item.estimated_lbs === '' ? null : Number(item.estimated_lbs),
      }))

    if (items.length === 0) {
      setRecurringFormStatus({ state: 'error', message: 'Please add at least one item.' })
      return
    }

    const total_estimated_lbs = items.reduce((sum, item) => {
      const lbs = Number(item.estimated_lbs)
      return sum + (Number.isFinite(lbs) ? lbs : 0)
    }, 0)

    const now = new Date().toISOString()
    const locationKey = normalizeLocationKey(recurringFormData.rescue_location_canonical)
    const id = recurringFormData.id || `recurring-${locationKey}-${recurringFormData.day_of_week}-${Date.now()}`

    const payload = {
      id,
      recurring: true,
      rescue_location_canonical: recurringFormData.rescue_location_canonical,
      rescue_location: recurringFormData.rescue_location_canonical,
      day_of_week: recurringFormData.day_of_week,
      sections: [{
        location: recurringFormData.rescue_location_canonical,
        location_canonical: recurringFormData.rescue_location_canonical,
        items,
      }],
      items: [],
      total_estimated_lbs,
      audited: true,
      created_at: recurringFormData.id ? undefined : now,
      updated_at: now,
      user: '',
      start_ts: '',
      end_ts: '',
      direction: 'inbound',
      drop_off_location: '',
      drop_off_location_canonical: '',
      raw_messages: [`Recurring event: Every ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][recurringFormData.day_of_week]}`],
    }

    const { error } = await auditSlackRecord(payload)

    if (error) {
      setRecurringFormStatus({ state: 'error', message: error.message || 'Failed to save recurring event.' })
      return
    }

    setRecurringFormStatus({ state: 'saved', message: '' })
    setTimeout(() => {
      setShowRecurringForm(false)
      setRecurringFormStatus({ state: 'idle', message: '' })
      loadRecurringEvents(selectedAuditedLocation)
      // Trigger stats refresh
      const btn = document.getElementById('audited-refresh-btn')
      if (btn && !btn.disabled) btn.click()
    }, 1000)
  }

  const handleEditRecurringEvent = (event) => {
    const items = event.sections?.[0]?.items || []
    setRecurringFormData({
      id: event.id,
      rescue_location_canonical: event.rescue_location_canonical,
      day_of_week: event.day_of_week,
      items: items.map(item => ({
        name: item.name || '',
        quantity: item.quantity ?? '',
        unit: item.unit || '',
        subcategory: item.subcategory || '',
        estimated_lbs: item.estimated_lbs ?? '',
      })),
    })
    setShowRecurringForm(true)
    setRecurringFormStatus({ state: 'idle', message: '' })
  }

  const handleDeleteRecurringEvent = async (event) => {
    if (!confirm(`Delete recurring event for ${event.rescue_location_canonical} on ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][event.day_of_week]}?`)) {
      return
    }

    const payload = {
      ...event,
      audited: false,
    }

    const { error } = await auditSlackRecord(payload)

    if (error) {
      alert('Failed to delete recurring event: ' + (error.message || 'Unknown error'))
      return
    }

    loadRecurringEvents(selectedAuditedLocation)
    // Trigger stats refresh
    const btn = document.getElementById('audited-refresh-btn')
    if (btn && !btn.disabled) btn.click()
  }

  const updateWarehouseItem = (index, field, value) => {
    setWarehouseItems((prev) => prev.map((item, idx) => (idx === index ? { ...item, [field]: value } : item)))
  }

  const removeWarehouseItem = (index) => {
    setWarehouseItems((prev) => prev.filter((_, idx) => idx !== index))
  }

  const addWarehouseItem = () => {
    setWarehouseItems((prev) => [...prev, {
      name: '',
      quantity: '',
      unit: '',
      subcategory: '',
      estimated_lbs: '',
      notes: '',
    }])
  }

  const handleWarehouseSave = async () => {
    if (!warehouseDraft) {
      setWarehousePreviewError('Run the parser first.')
      return
    }
    setWarehouseSaveStatus({ state: 'saving', message: '' })
    const payload = {
      text: warehouseInput,
      location: warehouseDraftMeta.location,
      rescued_at: warehouseDraftMeta.rescuedDate || null,
      items: warehouseItems.map((item) => ({
        name: item.name || '',
        quantity: item.quantity === '' ? null : item.quantity,
        unit: item.unit || '',
        pounds: item.estimated_lbs === '' ? null : item.estimated_lbs,
        subcategory: item.subcategory || '',
        estimated_lbs: item.estimated_lbs === '' ? null : item.estimated_lbs,
        notes: item.notes || '',
      })),
      draftId: warehouseDraft.draftId,
      images: warehouseImages,
    }
    const { error } = await saveWarehouseLog(payload)
    if (error) {
      setWarehouseSaveStatus({ state: 'error', message: error.message || 'Could not save log.' })
      return
    }
    setWarehouseSaveStatus({ state: 'success', message: 'Saved to warehouse log.' })
    resetWarehouseDraftState()
    setWarehouseInput('')
    await loadDeliveries()
  }

  const formatTime = (value) => {
    if (!value) return ''
    const [h, m] = value.split(':').map((v) => parseInt(v, 10))
    if (Number.isNaN(h) || Number.isNaN(m)) return value
    const hours12 = ((h + 11) % 12) + 1
    const ampm = h >= 12 ? 'PM' : 'AM'
    const paddedMinutes = m.toString().padStart(2, '0')
    return `${hours12}:${paddedMinutes} ${ampm}`
  }

  const timeValueToMinutes = (value) => {
    if (!value) return Number.POSITIVE_INFINITY
    const [h, m] = value.split(':').map((v) => parseInt(v, 10))
    if (Number.isNaN(h) || Number.isNaN(m)) return Number.POSITIVE_INFINITY
    return h * 60 + m
  }

  const parseTimeTo24h = (value = '') => {
    if (!value) return ''
    const main = value.split('-')[0].trim()
    const match = main.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i)
    if (!match) return ''
    let hours = parseInt(match[1], 10)
    const minutes = match[2] ? parseInt(match[2], 10) : 0
    const meridiem = (match[3] || '').toUpperCase()
    if (meridiem === 'PM' && hours !== 12) hours += 12
    if (meridiem === 'AM' && hours === 12) hours = 0
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return ''
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
  }

  const getSlotStartDate = (dayDateKey, slot) => {
    const timeStr = slot.timeStart || parseTimeTo24h(slot.time)
    const startTime = timeStr || '00:00'
    const start = new Date(`${dayDateKey}T${startTime}`)
    if (Number.isNaN(start.getTime())) return null
    return start
  }

  const to24h = (hour12, minute, meridiem) => {
    if (!hour12 || !minute || !meridiem) return ''
    let h = parseInt(hour12, 10)
    const m = minute.padStart(2, '0')
    if (meridiem === 'AM') {
      if (h === 12) h = 0
    } else if (meridiem === 'PM') {
      if (h !== 12) h += 12
    }
    return `${h.toString().padStart(2, '0')}:${m}`
  }

  const rollingDays = useMemo(() => {
    const today = new Date()
    return Array.from({ length: daysToShow }).map((_, idx) => {
      const date = new Date(today)
      date.setDate(today.getDate() + idx)
      const label = date.toLocaleDateString(undefined, { weekday: 'long' })
      const display = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
      return {
        label,
        dateKey: date.toISOString().slice(0, 10),
        displayDate: display,
      }
    })
  }, [daysToShow])

  const [openDays, setOpenDays] = useState([])

  useEffect(() => {
    loadDeliveries()
  }, [loadDeliveries])

  useEffect(() => {
    if (!openInitRef.current) {
      setOpenDays(rollingDays.slice(0, 7).map((d) => d.dateKey))
      openInitRef.current = true
    } else {
      setOpenDays((prev) => prev.filter((key) => rollingDays.some((d) => d.dateKey === key)))
    }
  }, [rollingDays])

  useEffect(() => {
    fetchUnauditedForLocation(selectedAuditedLocation)
  }, [selectedAuditedLocation, fetchUnauditedForLocation])

  useEffect(() => {
    if (selectedAuditedLocation) {
      loadRecurringEvents(selectedAuditedLocation)
    }
  }, [selectedAuditedLocation, loadRecurringEvents])

  useEffect(() => {
    const loadEvents = async () => {
      setEventsLoading(true)
      setEventsError('')
      const { data, error } = await fetchApprovedEvents()
      if (error) {
        setEventsError(error.message || 'Could not load events.')
        setEvents([])
      } else {
        const mapped = (data || []).map((row) => {
          const dayIdx = typeof row.day_of_week === 'number' ? row.day_of_week : dayOrder.findIndex((d) => d.toLowerCase() === (row.day || '').toLowerCase())
          const day = dayIdx >= 0 ? dayOrder[dayIdx] : row.day || ''
          const start = (row.start_time || '').slice(0, 5)
          const end = (row.end_time || '').slice(0, 5)
          const capacity = Number(row.capacity) || 1
          const filledCount = Number(row.filled_count) || 0
          const assigned = row.assigned || filledCount >= capacity
          const filledCountsByDate = row.filled_counts_by_date || {}
          return {
            id: row.id || row.slot_key || row.name,
            store: row.name || row.store || row.title,
            name: row.name || row.store || row.title,
            description: row.notes || row.description || '',
            address: row.address || '',
            day,
            timeStart: start,
            timeEnd: end || null,
            time: row.time || '',
            capacity,
            filledCount,
            filledCountsByDate,
            occurrenceDate: row.occurrence_date || null,
            urgent: row.urgent || false,
            assigned,
            assignee: row.assignee || '',
          }
        })
        setEvents(mapped)
      }
      setEventsLoading(false)
    }

    loadEvents()
  }, [])

  const showDeliveries = () => {
    setCurrentView('deliveries')
    setSelectedPickup(null)
    setSignupStatus({ state: 'idle', message: '' })
  }

  const showPickupHub = () => {
    setCurrentView('food-pickup')
    setSelectedPickup(null)
    setSignupStatus({ state: 'idle', message: '' })
    setSignupForm({
      name: '',
      email: '',
      phone: '',
      notes: '',
      firstTime: false,
    })
  }

  const loadSlackRecord = async (startIndex = 0, filter = auditFilter, options = {}) => {
    const { resetAuditStatus = true } = options
    const targetIndex = Math.max(0, startIndex)
    setSlackBrowserStatus({ state: 'loading', message: '' })
    if (resetAuditStatus) setSlackAuditStatus({ state: 'idle', message: '' })
    const runFetch = async (index) => fetchSlackMessage({
      start: Math.max(0, index),
      limit: 1,
      startDate: slackStartDate,
      endDate: slackEndDate,
      auditFilter: filter,
    })
    let { data, error } = await runFetch(targetIndex)
    if (error || !data) {
      setSlackBrowserStatus({ state: 'error', message: error?.message || 'Could not load Slack messages. Is the Python server running on port 5055?' })
      return
    }

    let record = (data.records || [])[0] || null
    let effectiveIndex = targetIndex

    // If we asked for an index past the end (e.g., after removing the last item), retry from the last available.
    if (!record && (data.total || 0) > 0 && targetIndex >= data.total) {
      const fallbackIndex = Math.max(0, (data.total || 1) - 1)
      const retry = await runFetch(fallbackIndex)
      if (!retry.error && retry.data) {
        data = retry.data
        record = (retry.data.records || [])[0] || null
        effectiveIndex = fallbackIndex
      }
    }

    const clampedIndex = Math.max(0, Math.min(effectiveIndex, Math.max((data.total || 1) - 1, 0)))
    setSlackRecord(normalizeSlackRecord(record))
    setSlackTotal(data.total || 0)
    setSlackIndex(clampedIndex)
    setSlackBrowserStatus({ state: 'idle', message: '' })
  }

  const handleSearch = async (query) => {
    const trimmed = query.trim()

    if (!trimmed) {
      setSearchResults([])
      setSearchTotal(0)
      setShowSearchResults(false)
      setSearchStatus({ state: 'idle', message: '' })
      return
    }

    setSearchStatus({ state: 'loading', message: '' })
    setShowSearchResults(true)

    const { data, error } = await searchSlackMessages(trimmed, 50)

    if (error || !data) {
      setSearchStatus({
        state: 'error',
        message: error?.message || 'Search failed. Is the server running?'
      })
      setSearchResults([])
      setSearchTotal(0)
      return
    }

    setSearchResults(data.results || [])
    setSearchTotal(data.total || 0)
    setSearchStatus({ state: 'idle', message: '' })
  }

  const loadSearchResult = async (result) => {
    setShowSearchResults(false)
    setSearchQuery('')
    setSlackBrowserStatus({ state: 'loading', message: '' })
    setSlackAuditStatus({ state: 'idle', message: '' })

    // Load without filters to ensure the message is found regardless of current filter settings
    const { data, error } = await fetchSlackMessageById({
      messageId: result.id,
      startDate: slackStartDate,
      endDate: slackEndDate,
      auditFilter: 'all',  // Always use 'all' to find the message
    })

    if (error || !data) {
      setSlackBrowserStatus({
        state: 'error',
        message: error?.message || 'Could not load message. Is the Python server running on port 5055?'
      })
      return
    }

    const record = (data.records || [])[0] || null
    const messageIndex = data.start || 0

    if (!record) {
      setSlackBrowserStatus({
        state: 'error',
        message: 'Message not found. It may be outside the current date range.'
      })
      return
    }

    setSlackRecord(normalizeSlackRecord(record))
    setSlackTotal(data.total || 0)
    setSlackIndex(messageIndex)
    setSlackBrowserStatus({ state: 'idle', message: '' })
  }

  const handleAudit = async () => {
    if (!slackRecord) {
      setSlackAuditStatus({ state: 'error', message: 'Load a Slack record before auditing.' })
      return
    }
    if (slackAuditStatus.state === 'saving') return
    setSlackAuditStatus({ state: 'saving', message: '' })
    const payload = { ...slackRecord, audited: !slackRecord.audited, audited_at: new Date().toISOString() }
    const { error } = await auditSlackRecord(payload)
    if (error) {
      setSlackAuditStatus({ state: 'error', message: error.message || 'Could not mark audited.' })
      return
    }

    const toggledToAudited = !!payload.audited
    const needsRefresh = (auditFilter === 'unaudited' && toggledToAudited) || (auditFilter === 'audited' && !toggledToAudited)

    if (needsRefresh) {
      const nextIndex = Math.max(0, Math.min(slackIndex, Math.max((slackTotal || 1) - 2, 0)))
      await loadSlackRecord(nextIndex, auditFilter, { resetAuditStatus: false })
      setSlackAuditStatus({
        state: 'saved',
        message: toggledToAudited ? 'Audited and moved to next pending record.' : 'Unmarked and showing next audited record.',
      })
    } else {
      setSlackRecord((prev) => ({ ...(prev || {}), audited: payload.audited }))
      setSlackAuditStatus({ state: 'saved', message: payload.audited ? 'Audited' : 'Unmarked' })
    }
  }

  const handleRunModelInference = async () => {
    if (!slackRecord || !slackRecord.raw_messages) {
      setModelInference({ error: 'No message loaded' })
      return
    }
    setModelInferenceLoading(true)
    setModelInference(null)
    const messageText = Array.isArray(slackRecord.raw_messages)
      ? slackRecord.raw_messages.join('\n\n')
      : String(slackRecord.raw_messages || '')
    const { data, error } = await runInference(messageText)
    setModelInferenceLoading(false)
    if (error) {
      setModelInference({ error: error.message || 'Inference failed' })
    } else {
      setModelInference(data?.inference || null)
    }
  }

  const handleCompareExtractions = async () => {
    if (!slackRecord || !slackRecord.id) {
      setComparisonData({ error: 'No record loaded' })
      return
    }
    setModelInferenceLoading(true)
    setComparisonData(null)
    const { data, error } = await compareExtractions(slackRecord.id)
    setModelInferenceLoading(false)
    if (error) {
      setComparisonData({ error: error.message || 'Comparison failed' })
    } else {
      setComparisonData(data || null)
    }
  }

  const loadTrainingStats = useCallback(async () => {
    const { data, error } = await getTrainingStats()
    if (!error && data) {
      setTrainingStats(data)
    }
  }, [])

  useEffect(() => {
    if (extractionMethod === 'model' && slackRecord) {
      handleRunModelInference()
    } else if (extractionMethod === 'compare' && slackRecord) {
      handleCompareExtractions()
    }
  }, [extractionMethod, slackRecord?.id])

  useEffect(() => {
    if (currentView === 'audited-stats' || currentView === 'slack-browser') {
      loadTrainingStats()
    }
  }, [currentView, loadTrainingStats])

  const normalizeSlackRecord = (record) => {
    if (!record) return record

    // Ensure sections and items arrays exist
    const sections = Array.isArray(record.sections) ? record.sections : []
    const items = Array.isArray(record.items) ? record.items : []

    // If sections is empty, create a default section with the items
    const normalizedSections = sections.length > 0
      ? sections
      : [{ location: '', items: items }]

    return {
      ...record,
      sections: normalizedSections,
      items: items,
      direction: record.direction || 'unknown',
      rescue_location: record.rescue_location || '',
      drop_off_location: record.drop_off_location || '',
      rescue_location_canonical: record.rescue_location_canonical || '',
      drop_off_location_canonical: record.drop_off_location_canonical || ''
    }
  }

  const syncSlackRecordLocationsFromSections = (record, sections = []) => {
    if (!record) return record
    const direction = String(record.direction || '').toLowerCase()
    if (!direction) return record
    const locations = collectSectionLocations(sections)
    if (!locations.length) return record
    const next = { ...record }
    const dropFromRecord = canonicalizeLocation(record.drop_off_location_canonical || record.drop_off_location)
    const rescueFromRecord = canonicalizeLocation(record.rescue_location_canonical || record.rescue_location)

    if (direction === 'outbound') {
      const drop = dropFromRecord && locations.includes(dropFromRecord)
        ? dropFromRecord
        : locations[locations.length - 1]
      next.drop_off_location = drop
      next.drop_off_location_canonical = drop
    } else if (direction === 'inbound') {
      const rescue = rescueFromRecord && locations.includes(rescueFromRecord)
        ? rescueFromRecord
        : locations[0]
      next.rescue_location = rescue
      next.rescue_location_canonical = rescue
    } else if (direction === 'both') {
      const drop = dropFromRecord && locations.includes(dropFromRecord)
        ? dropFromRecord
        : locations[locations.length - 1]
      const rescue = rescueFromRecord && locations.includes(rescueFromRecord)
        ? rescueFromRecord
        : locations.find((loc) => loc !== drop) || locations[0]
      if (rescue) {
        next.rescue_location = rescue
        next.rescue_location_canonical = rescue
      }
      if (drop) {
        next.drop_off_location = drop
        next.drop_off_location_canonical = drop
      }
    }
    return next
  }

  const updateSlackRecordItems = (sectionIdx, updater) => {
    setSlackRecord((prev) => {
      if (!prev) return prev
      const next = { ...prev }
      const hasSections = Array.isArray(prev.sections) && prev.sections.length
      const mutateItems = (items) => updater(Array.isArray(items) ? [...items] : [])

      if (hasSections && sectionIdx !== null && sectionIdx !== undefined) {
        const sections = [...prev.sections]
        const section = { ...(sections[sectionIdx] || {}) }
        section.items = mutateItems(section.items)
        sections[sectionIdx] = section
        next.sections = sections
      } else {
        next.items = mutateItems(prev.items)
      }
      return next
    })
  }

  const updateSlackItem = (sectionIdx, itemIdx, field, value) => {
    updateSlackRecordItems(sectionIdx, (items) => items.map((item, idx) => (
      idx === itemIdx ? { ...item, [field]: value } : item
    )))
  }

  const addSlackItem = (sectionIdx = null) => {
    updateSlackRecordItems(sectionIdx, (items) => [
      ...items,
      { name: '', quantity: '', unit: '', subcategory: '', estimated_lbs: '' },
    ])
  }

  const removeSlackItem = (sectionIdx, itemIdx) => {
    updateSlackRecordItems(sectionIdx, (items) => items.filter((_, idx) => idx !== itemIdx))
  }

  const updateSlackSectionLocation = (sectionIdx, nextLocation) => {
    setSlackRecord((prev) => {
      if (!prev) return prev
      const sections = Array.isArray(prev.sections) ? [...prev.sections] : []
      const section = { ...(sections[sectionIdx] || {}) }
      section.location = nextLocation
      section.location_canonical = nextLocation
      sections[sectionIdx] = section
      return syncSlackRecordLocationsFromSections({ ...prev, sections }, sections)
    })
  }

  const addSlackSection = () => {
    setSlackRecord((prev) => {
      if (!prev) return prev
      const sections = Array.isArray(prev.sections) ? [...prev.sections] : []
      if (!sections.length) {
        const baseItems = Array.isArray(prev.items) ? prev.items : []
        sections.push({ location: '', items: baseItems })
      } else {
        sections.push({ location: '', items: [] })
      }
      return syncSlackRecordLocationsFromSections({ ...prev, sections }, sections)
    })
  }

  const removeSlackSection = (sectionIdx) => {
    setSlackRecord((prev) => {
      if (!prev) return prev
      const sections = Array.isArray(prev.sections) ? prev.sections.filter((_, idx) => idx !== sectionIdx) : []
      return syncSlackRecordLocationsFromSections({ ...prev, sections }, sections)
    })
  }

  const showSlackBrowser = () => {
    setCurrentView('slack-browser')
    setSelectedPickup(null)
    if (!slackRecord) {
      loadSlackRecord(0)
    }
  }
  const showAuditedTab = () => {
    setCurrentView('audited-stats')
    setSelectedPickup(null)
  }

  const handlePickupSelect = (pickupId, occurrenceDate = null) => {
    const pickup = events.find((evt) => evt.id === pickupId)
    if (!pickup) return
    setSelectedPickup({
      key: pickupId,
      occurrenceDate: occurrenceDate || pickup.occurrenceDate || null,
      ...pickup,
    })
    setCurrentView('pickup-signup')
    setSignupStatus({ state: 'idle', message: '' })
  }

  const handleLogin = () => {
    setIsLoggedIn(true)
  }

  const isFormValid = useMemo(
    () => signupForm.name.trim().length > 1 && signupForm.email.trim().length > 3,
    [signupForm.email, signupForm.name]
  )

  const handleSignupForPickup = async () => {
    if (!selectedPickup) return
    if (selectedPickup.assigned) {
      setSignupStatus({ state: 'error', message: 'This slot is already assigned. Contact the coordinator to request changes.' })
      return
    }
    if (!isFormValid) {
      setSignupStatus({ state: 'error', message: 'Name and email are required.' })
      return
    }

    setSignupStatus({ state: 'submitting', message: '' })

    const { error } = await submitPickupSignup({
      slot_key: selectedPickup.key,
      store: selectedPickup.store,
      day: selectedPickup.day,
      time: selectedPickup.time,
      address: selectedPickup.address,
      occurrence_date: selectedPickup.occurrenceDate,
      volunteer_name: signupForm.name,
      volunteer_email: signupForm.email,
      volunteer_phone: signupForm.phone,
      notes: signupForm.notes,
      first_time: signupForm.firstTime,
    })

    if (error) {
      setSignupStatus({
        state: 'error',
        message: error.message || 'Unable to submit signup right now.',
      })
      return
    }

    setSignupStatus({
      state: 'success',
      message: 'Signup received and pending coordinator review.',
    })
  }

  const handleSendSlackAlert = async () => {
    setSlackStatus({ state: 'submitting', message: 'Sending Slack alert…' })
    const { error, data } = await triggerSlackAlert()
    if (error) {
      setSlackStatus({ state: 'error', message: error.message || 'Failed to send Slack alert.' })
      return
    }
    const count = data?.sent ?? 0
    const defaultMsg = data?.message || `Slack alert sent with ${count} unfilled spot${count === 1 ? '' : 's'}.`
    setSlackStatus({ state: 'success', message: defaultMsg })
  }

  const weeklySchedule = useMemo(() => {
    return rollingDays.map((day) => ({
      ...day,
      slots: events
        .filter((evt) => {
          if (evt.occurrenceDate) {
            return evt.occurrenceDate === day.dateKey
          }
          return (evt.day || '').toLowerCase() === day.label.toLowerCase()
        })
        .sort((a, b) => timeValueToMinutes(a.timeStart || a.time || '') - timeValueToMinutes(b.timeStart || b.time || '')),
    }))
  }, [events, rollingDays])

  const unfilledSoon = useMemo(() => {
    const now = new Date()
    const soon = new Date(now.getTime() + 24 * 60 * 60 * 1000)

    return weeklySchedule
      .flatMap((day) => day.slots
        .filter((slot) => !slot.assigned)
        .map((slot) => {
          const startDate = getSlotStartDate(day.dateKey, slot)
          return startDate ? { slot, day, startDate } : null
        })
        .filter(Boolean))
      .filter(({ startDate }) => startDate >= now && startDate <= soon)
      .sort((a, b) => a.startDate - b.startDate)
  }, [weeklySchedule])

  useEffect(() => {
    const sentinel = loadMoreRef.current
    if (!sentinel) return undefined

    let isIntersecting = false
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0]
      if (entry.isIntersecting && !isIntersecting) {
        isIntersecting = true
        setDaysToShow((prev) => prev + 7)
      } else if (!entry.isIntersecting) {
        isIntersecting = false
      }
    }, { rootMargin: '200px' })

    observer.observe(sentinel)

    return () => observer.disconnect()
  }, [])

  const toggleDay = (label) => {
    setOpenDays((prev) => (
      prev.includes(label)
        ? prev.filter((d) => d !== label)
        : [...prev, label]
    ))
  }

  const resetNewEventForm = () => {
    setNewEvent({
      title: '',
      description: '',
      address: '',
      day: '',
      startHour: '',
      startMinute: '',
      startMeridiem: '',
      endHour: '',
      endMinute: '',
      endMeridiem: '',
      capacity: 1,
      recurrenceType: 'weekly',
      recurrenceNth: '3',
      recurrenceWeekday: 'Thursday',
      singleDate: '',
    })
  }

  const handleCreateEvent = async () => {
    setEventsError('')
    const startVal = to24h(newEvent.startHour, newEvent.startMinute, newEvent.startMeridiem)
    const endVal = to24h(newEvent.endHour, newEvent.endMinute, newEvent.endMeridiem)

    if (!newEvent.title || !newEvent.description || !newEvent.address || !startVal) {
      setEventsError('Title, description, address, and time are required.')
      return
    }

    const getDayFromDate = (dateStr) => {
      const date = new Date(dateStr)
      if (Number.isNaN(date.getTime())) return ''
      return dayOrder[date.getDay()]
    }

    let eventDay = newEvent.day
    let occurrenceDate = null

    if (newEvent.recurrenceType === 'one-off') {
      eventDay = getDayFromDate(newEvent.singleDate)
      occurrenceDate = newEvent.singleDate || null
    } else if (newEvent.recurrenceType === 'monthly') {
      eventDay = newEvent.recurrenceWeekday
    }

    if (!eventDay) {
      setEventsError('Day of week is required.')
      return
    }

    const timeRange = endVal
      ? `${formatTime(startVal)} - ${formatTime(endVal)}`
      : formatTime(startVal)

    const payload = {
      name: newEvent.title,
      day_of_week: dayOrder.indexOf(eventDay),
      start_time: startVal,
      // end_time intentionally omitted for schema compatibility
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      address: newEvent.address,
      capacity: Number(newEvent.capacity) || 1,
      status: 'approved',
      notes: newEvent.description,
      time: timeRange,
    }

    const { data, error } = await createEventApi(payload, {})

    if (error) {
      setEventsError(error.message || 'Unable to create event.')
      return
    }

    const createdRow = Array.isArray(data) ? data?.[0] : data
    const created = {
      id: createdRow?.id || crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      store: newEvent.title,
      name: newEvent.title,
      description: newEvent.description,
      day: eventDay,
      time: timeRange,
      timeStart: startVal,
      timeEnd: endVal || null,
      address: newEvent.address,
      capacity: Number(newEvent.capacity) || 1,
      assigned: false,
      assignee: '',
      recurrenceType: newEvent.recurrenceType,
      recurrenceNth: newEvent.recurrenceNth,
      recurrenceWeekday: newEvent.recurrenceWeekday,
      occurrenceDate,
    }

    setEvents((prev) => [...prev, created])
    resetNewEventForm()
    setCurrentView('food-pickup')
  }

  return (
    <div className="app">
      <header className="header pickup-hero">
        <div className="header-top">
          <div className="title-block">
            <p className="eyebrow">Mutual Aid · Food Rescue</p>
            <h1>Food Pickup Hub</h1>
            <p className="subtitle">
              Cover a pickup, see what&apos;s urgent, and get the instructions you need for drop-off.
            </p>
          </div>
        </div>
        <div className="view-tabs">
          <button
            className={`view-tab ${currentView === 'deliveries' ? 'active' : ''}`}
            type="button"
            onClick={showDeliveries}
          >
            Deliveries
          </button>
          <button
            className={`view-tab ${currentView === 'food-pickup' ? 'active' : ''}`}
            type="button"
            onClick={showPickupHub}
          >
            Pickup schedule
          </button>
          <button
            className={`view-tab ${currentView === 'slack-browser' ? 'active' : ''}`}
            type="button"
            onClick={showSlackBrowser}
          >
            Slack browser
          </button>
          <button
            className={`view-tab ${currentView === 'audited-stats' ? 'active' : ''}`}
            type="button"
            onClick={showAuditedTab}
          >
            Audited stats
          </button>
        </div>
      </header>

      <main className="main-content">
        {currentView === 'deliveries' && (
          <div className="deliveries">
            <div className="deliveries-header">
              <div>
                <h2>Warehouse Deliveries</h2>
                <p>Paste Slack messages, let the LLM structure them, edit anything, and approve to append to the log below.</p>
              </div>
              <div className="deliveries-actions">
                <button
                  className="schedule-action secondary"
                  type="button"
                  onClick={loadDeliveries}
                  disabled={deliveriesLoading}
                >
                  {deliveriesLoading ? 'Refreshing…' : 'Reload'}
                </button>
                <button
                  className="schedule-action"
                  type="button"
                  onClick={showPickupHub}
                >
                  Go to pickups
                </button>
              </div>
            </div>

            <div className="warehouse-intake card">
              <div className="intake-top">
                <div>
                  <p className="eyebrow">Manual intake</p>
                  <h3>Paste a Slack message</h3>
                  <p>Send it to the LLM, review the parsed fields, tweak items, and approve.</p>
                </div>
                <div className="intake-status">
                  {warehousePreviewStatus === 'loading' && <span className="status-pill outline">Parsing…</span>}
                  {warehousePreviewStatus === 'ready' && warehouseDraft && <span className="status-pill filled">Draft ready</span>}
                </div>
                <div className="item-actions">
                  <button
                    className="schedule-action"
                    type="button"
                    onClick={handleAudit}
                    disabled={slackAuditStatus.state === 'saving' || !slackRecord}
                  >
                    {slackAuditStatus.state === 'saving' ? 'Saving…' : 'Mark audited'}
                  </button>
                  {slackAuditStatus.state === 'saved' && <span className="status-pill filled">Audited</span>}
                  {slackAuditStatus.state === 'error' && <span className="status-pill danger">Audit error</span>}
                </div>
              </div>

              <label className="intake-label" htmlFor="warehouse-message">Slack message text</label>
              <textarea
                id="warehouse-message"
                className="intake-textarea"
                placeholder="Paste the Slack message text (checklist bullets are great)…"
                value={warehouseInput}
                onChange={(e) => handleWarehouseInputChange(e.target.value)}
                onPaste={handleWarehousePaste}
              />
              <div className="intake-upload">
                <label className="intake-label" htmlFor="warehouse-images">Optional photos (improves weight guesses)</label>
                <input
                  id="warehouse-images"
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => handleWarehouseImagesChange(e.target.files)}
                />
                <p className="intake-hint">Tip: you can also paste images directly into the message box.</p>
                {warehouseImages.length > 0 && (
                  <div className="image-previews">
                    {warehouseImages.map((url, idx) => (
                      <div className="image-preview" key={`${url}-${idx}`}>
                        <img src={url} alt={`Upload ${idx + 1}`} />
                        <button
                          type="button"
                          className="image-remove"
                          onClick={() => removeWarehouseImage(idx)}
                          aria-label="Remove image"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="intake-actions">
                <button
                  className="schedule-action"
                  type="button"
                  onClick={handleWarehousePreview}
                  disabled={warehousePreviewStatus === 'loading'}
                >
                  {warehousePreviewStatus === 'loading' ? 'Sending to LLM…' : 'Send to LLM'}
                </button>
                <button
                  className="schedule-action secondary"
                  type="button"
                  onClick={() => {
                    resetWarehouseDraftState()
                    setWarehouseInput('')
                    setWarehouseImages([])
                    setWarehouseSaveStatus({ state: 'idle', message: '' })
                  }}
                >
                  Clear
                </button>
              </div>

              {warehousePreviewError && <div className="alert error">{warehousePreviewError}</div>}
              {warehouseSaveStatus.state === 'error' && <div className="alert error">{warehouseSaveStatus.message}</div>}
              {warehouseSaveStatus.state === 'success' && <div className="alert success">{warehouseSaveStatus.message}</div>}

              {warehouseDraft && (
                <div className="warehouse-review">
                  <div className="form-row">
                    <label className="field-large">
                      <span>Rescued from</span>
                      <input
                        type="text"
                        value={warehouseDraftMeta.location}
                        onChange={(e) => setWarehouseDraftMeta((prev) => ({ ...prev, location: e.target.value }))}
                        placeholder="e.g. Aldi on Kostner"
                      />
                    </label>
                  </div>
                  <div className="form-row">
                    <label className="field-medium">
                      <span>Rescue date</span>
                      <input
                        type="date"
                        value={warehouseDraftMeta.rescuedDate}
                        onChange={(e) => setWarehouseDraftMeta((prev) => ({ ...prev, rescuedDate: e.target.value }))}
                      />
                    </label>
                  </div>
                  {(warehouseDraftMeta.summary || warehouseDraftMeta.notes) && (
                    <p className="llm-hint">
                      LLM summary: {warehouseDraftMeta.summary || warehouseDraftMeta.notes}
                    </p>
                  )}

                <div className="items-editor">
                  <div className="items-head">
                    <div>Item</div>
                    <div className="qty-col">Qty</div>
                    <div className="unit-col">Unit</div>
                    <div className="category-col">Subcategory</div>
                    <div className="lbs-col">lbs (est.)</div>
                    <div className="remove-col" />
                  </div>

                  {warehouseItems.length === 0 && (
                    <div className="items-empty">No items parsed yet. Add one below.</div>
                    )}

                    {warehouseItems.map((item, idx) => (
                      <div className="items-row" key={`item-${idx}`}>
                        <input
                          type="text"
                          value={item.name}
                          onChange={(e) => updateWarehouseItem(idx, 'name', e.target.value)}
                          placeholder="Item name"
                        />
                        <input
                          type="text"
                          className="qty-col"
                          value={item.quantity ?? ''}
                          onChange={(e) => updateWarehouseItem(idx, 'quantity', e.target.value)}
                          placeholder="#"
                        />
                        <input
                          type="text"
                          className="unit-col"
                          value={item.unit}
                        onChange={(e) => updateWarehouseItem(idx, 'unit', e.target.value)}
                        placeholder="cases / lbs / boxes"
                      />
                      <select
                        className="category-col"
                        value={item.subcategory}
                        onChange={(e) => updateWarehouseItem(idx, 'subcategory', e.target.value)}
                      >
                        <option value="">Select</option>
                        {WAREHOUSE_SUBCATEGORY_OPTIONS.map((option) => (
                          <option key={option} value={option}>{formatSubcategoryLabel(option)}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        className="lbs-col"
                        value={item.estimated_lbs ?? item.pounds ?? ''}
                        onChange={(e) => {
                          updateWarehouseItem(idx, 'estimated_lbs', e.target.value)
                          updateWarehouseItem(idx, 'pounds', e.target.value)
                        }}
                        placeholder="~lbs"
                      />
                        <button type="button" className="link-remove" onClick={() => removeWarehouseItem(idx)}>Remove</button>
                      </div>
                    ))}

                    <div className="items-actions">
                      <button type="button" className="schedule-action secondary" onClick={addWarehouseItem}>
                        Add item
                      </button>
                    </div>
                  </div>

                  {warehouseDraft?.llm_error && (
                    <p className="llm-hint">
                      LLM error: {warehouseDraft.llm_error}. Using fallback parser output.
                    </p>
                  )}

                  <div className="intake-actions">
                    <button
                      className="schedule-action"
                      type="button"
                      onClick={handleWarehouseSave}
                      disabled={warehouseSaveStatus.state === 'saving'}
                    >
                      {warehouseSaveStatus.state === 'saving' ? 'Saving…' : 'Approve & save'}
                    </button>
                    <button
                      className="schedule-action secondary"
                      type="button"
                      onClick={() => {
                        resetWarehouseDraftState()
                        setWarehouseInput('')
                        setWarehouseImages([])
                        setWarehouseSaveStatus({ state: 'idle', message: '' })
                      }}
                    >
                      Start over
                    </button>
                  </div>
                </div>
              )}
            </div>

            {deliveriesError && <div className="alert error">{deliveriesError}</div>}
            {deliveriesLoading && <div className="loading">Loading deliveries…</div>}

            {!deliveriesLoading && deliveries.length === 0 && (
              <div className="empty-state">
                <p>No deliveries found yet. Paste a Slack message above to add one.</p>
              </div>
            )}

              <div className="delivery-table">
                <div className="delivery-head">
                  <div className="col date">Rescue date</div>
                  <div className="col from">Rescued from</div>
                  <div className="col weight">Rescued weight</div>
                  <div className="col items">Items</div>
                </div>
                {deliveries.map((delivery) => {
                  const rowId = deliveryRowId(delivery)
                  const isExpanded = expandedDeliveryId === rowId
                  const rescuedFrom = delivery.location || delivery.slack_channel_name || 'Unknown location'
                  const sentAt = delivery.created_at || delivery.slack_sent_at
                  const createdAt = formatDisplayDate(sentAt)
                  const items = Array.isArray(delivery.items)
                    ? delivery.items
                    : (delivery.llm_json?.items || [])
                  const hasItems = items.length > 0
                  const weightTotal = totalRescuedWeight(items)
                  return (
                    <div key={rowId || createdAt}>
                      <div
                        className={`delivery-row ${isExpanded ? 'expanded' : ''}`}
                        onClick={() => startEditingDelivery(delivery)}
                      >
                        <div className="col date">{createdAt}</div>
                        <div className="col from">
                          <span className="delivery-pill">{rescuedFrom}</span>
                        </div>
                        <div className="col weight">{weightTotal ? `${Math.round(weightTotal)} lbs` : '—'}</div>
                        <div className="col items">
                          <span className="delivery-items-inline">Items ({items.length || 0})</span>
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="delivery-items-editor" onClick={(e) => e.stopPropagation()}>
                          <div className="delivery-message">
                            <p>{delivery.raw_text || 'No message text captured.'}</p>
                            {delivery.photo_urls?.length > 0 && (
                              <div className="delivery-photos inline">
                                {delivery.photo_urls.map((url, idx) => (
                                  <a key={url} href={url} target="_blank" rel="noreferrer">
                                    <img src={url} alt={`Delivery photo ${idx + 1}`} />
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                          {editingDeliveryItems[rowId]?.length ? (
                            <>
                              <div className="form-row">
                                <label className="field-small">
                                  <span>Rescue date</span>
                                  <input
                                    type="date"
                                    value={editingDeliveryDates[rowId] || ''}
                                    onChange={(e) => setEditingDeliveryDates((prev) => ({
                                      ...prev,
                                      [rowId]: e.target.value,
                                    }))}
                                  />
                                </label>
                              </div>
                              <div className="items-head">
                                <div>Item</div>
                                <div className="qty-col">Qty</div>
                                <div className="unit-col">Unit</div>
                                <div className="category-col">Subcategory</div>
                                <div className="lbs-col">lbs</div>
                                <div className="remove-col" />
                              </div>
                              {editingDeliveryItems[rowId].map((item, idx) => (
                                <div className="items-row" key={`${rowId}-edit-${idx}`}>
                                  <input
                                    type="text"
                                    value={item.name}
                                    onChange={(e) => updateDeliveryItem(rowId, idx, 'name', e.target.value)}
                                    placeholder="Item name"
                                  />
                                  <input
                                    type="text"
                                    className="qty-col"
                                    value={item.quantity ?? ''}
                                    onChange={(e) => updateDeliveryItem(rowId, idx, 'quantity', e.target.value)}
                                    placeholder="#"
                                  />
                                  <input
                                    type="text"
                                    className="unit-col"
                                    value={item.unit || ''}
                                    onChange={(e) => updateDeliveryItem(rowId, idx, 'unit', e.target.value)}
                                    placeholder="cases / lbs / boxes"
                                  />
                                  <select
                                    className="category-col"
                                    value={item.subcategory || ''}
                                    onChange={(e) => updateDeliveryItem(rowId, idx, 'subcategory', e.target.value)}
                                  >
                                    <option value="">Select</option>
                                    {WAREHOUSE_SUBCATEGORY_OPTIONS.map((option) => (
                                      <option key={option} value={option}>{formatSubcategoryLabel(option)}</option>
                                    ))}
                                  </select>
                                  <input
                                    type="text"
                                    className="lbs-col"
                                    value={item.pounds ?? ''}
                                    onChange={(e) => updateDeliveryItem(rowId, idx, 'pounds', e.target.value)}
                                    placeholder="lbs"
                                  />
                                  <button type="button" className="link-remove" onClick={() => updateDeliveryItem(rowId, idx, 'remove', true)}>
                                    Remove
                                  </button>
                                </div>
                              ))}
                              <div className="delivery-items-editor items-actions">
                                <button
                                  type="button"
                                  className="schedule-action secondary"
                                  onClick={() => handleCancelDeliveryItems(delivery)}
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  className="schedule-action"
                                  disabled={deliveryItemSaveState[rowId] === 'saving'}
                                  onClick={() => handleSaveDeliveryItems(delivery)}
                                >
                                  {deliveryItemSaveState[rowId] === 'saving' ? 'Saving…' : 'Save items'}
                                </button>
                              </div>
                              {deliveryItemSaveState[rowId] === 'saved' && <p className="save-status">Items saved.</p>}
                              {deliveryItemSaveState[rowId] === 'error' && (
                                <p className="save-status error">{deliveryItemSaveState.message || 'Unable to save items.'}</p>
                              )}
                            </>
                          ) : (
                            <p className="items-empty">No items to edit.</p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
          </div>
        )}

        {currentView === 'audited-stats' && (
          <div className="deliveries">
            <div className="deliveries-header">
              <div>
                <h2>Audited stats</h2>
                <p>Summaries based on audited/confirmed extractions.</p>
              </div>
              <div className="deliveries-actions">
                <button
                  id="audited-refresh-btn"
                  className="schedule-action secondary"
                  type="button"
                  onClick={async () => {
                    setAuditedLoading(true)
                    setAuditedError('')
                    setExpandedAuditedId(null)
                    const { data, error } = await fetchSlackMessage({
                      auditFilter: 'audited',
                      start: 0,
                      limit: 5000,
                      includeRecurring: true,
                    })
                    if (error || !data) {
                      setAuditedError(error?.message || 'Could not load audited messages.')
                      setAuditedStats({
                        total: 0,
                        items: [],
                        byLocation: [],
                        bySubcategory: [],
                        totalLbs: 0,
                        records: [],
                      })
                    } else {
                      const allRecords = Array.isArray(data.records) ? data.records : []

                      // Separate regular and recurring events
                      const regularRecords = allRecords.filter(r => !r.recurring)
                      const recurringEventsAll = allRecords.filter(r => r.recurring)

                      // Generate virtual records from recurring events
                      // Use last 90 days as default date range
                      const defaultStartDate = new Date()
                      defaultStartDate.setDate(defaultStartDate.getDate() - 90)
                      const virtualRecords = recurringEventsAll.flatMap(event =>
                        generateVirtualRecordsFromRecurring(
                          event,
                          defaultStartDate.toISOString().slice(0, 10),
                          new Date().toISOString().slice(0, 10)
                        )
                      )

                      // Combine regular and virtual records for stats calculation
                      const records = [...regularRecords, ...virtualRecords]

                      const items = []
                      const byLocationMap = new Map()
                      const bySubcategoryMap = new Map()
                      let totalLbs = 0
                      records.forEach((rec) => {
                        const cards = buildAuditedCards(rec)
                        cards.forEach((card) => {
                          const locKey = card.location || 'unknown'
                          const cardItems = Array.isArray(card.items) ? card.items : []
                          cardItems.forEach((it) => {
                            items.push(it)
                            const lbs = getItemWeight(it)
                            totalLbs += lbs
                            byLocationMap.set(locKey, (byLocationMap.get(locKey) || 0) + lbs)
                            const sub = (it.subcategory || '').trim() || 'Uncategorized'
                            bySubcategoryMap.set(sub, (bySubcategoryMap.get(sub) || 0) + lbs)
                          })
                        })
                      })
                      const byLocation = Array.from(byLocationMap.entries()).map(([name, lbs]) => ({ name, lbs }))
                        .sort((a, b) => b.lbs - a.lbs)
                      const bySubcategory = Array.from(bySubcategoryMap.entries()).map(([name, lbs]) => ({ name, lbs }))
                        .sort((a, b) => b.lbs - a.lbs)

                      // Store only regular records to avoid UI clutter
                      setAuditedStats({ total: records.length, items, byLocation, bySubcategory, totalLbs, records: regularRecords })
                    }
                    setAuditedLoading(false)
                  }}
                  disabled={auditedLoading}
                >
                  {auditedLoading ? 'Loading…' : 'Refresh'}
                </button>
              </div>
            </div>

            {auditedError && <div className="error-text">{auditedError}</div>}

            <div className="card stats-card">
              <div className="filter-row">
                <div style={{ flex: 1 }}>
                  <label className="intake-label" htmlFor="audited-location-filter">
                    Location Filter
                  </label>
                  <select
                    id="audited-location-filter"
                    value={selectedAuditedLocation || ''}
                    onChange={(e) => {
                      setSelectedAuditedLocation(e.target.value || null)
                      setExpandedAuditedId(null)
                    }}
                    style={{ width: '100%' }}
                  >
                    <option value="">All Locations</option>
                    {availableAuditedLocations.map((loc) => (
                      <option key={loc} value={loc}>{loc}</option>
                    ))}
                  </select>
                </div>
              </div>

              {!selectedAuditedLocation && (
                <>
                  <div className="summary-blocks">
                    <div className="summary-block">
                      <p className="summary-label">Total locations</p>
                      <p className="summary-value">{auditedStats.byLocation.length}</p>
                    </div>
                    <div className="summary-block">
                      <p className="summary-label">Total rescue events</p>
                      <p className="summary-value">{auditedStats.total}</p>
                    </div>
                    <div className="summary-block">
                      <p className="summary-label">Total lbs</p>
                      <p className="summary-value">{(auditedStats.totalLbs || 0).toFixed(1)}</p>
                    </div>
                  </div>

                  <div className="intake-label" style={{ marginTop: '1rem' }}>Locations Summary</div>
                  <div className="items-editor">
                    <div className="items-head">
                      <div>Location</div>
                      <div>Total lbs</div>
                      <div>Avg lbs/event</div>
                      <div># Events</div>
                      <div />
                      <div />
                    </div>
                    {auditedStats.byLocation.map((row) => {
                      const locationRecords = auditedStats.records.filter((rec) => {
                        const locations = collectRescueLocations(rec)
                        return locations.includes(row.name)
                      })
                      const eventCount = locationRecords.length
                      const avgLbs = eventCount > 0 ? row.lbs / eventCount : 0

                      return (
                        <div
                          className="items-row"
                          key={row.name}
                          style={{ cursor: 'pointer' }}
                          onClick={() => setSelectedAuditedLocation(row.name)}
                          title="Click to view details"
                        >
                          <div>{row.name}</div>
                          <div className="qty-col">{row.lbs.toFixed(1)}</div>
                          <div className="qty-col">{avgLbs.toFixed(1)}</div>
                          <div className="qty-col">{eventCount}</div>
                          <div />
                          <div />
                        </div>
                      )
                    })}
                    {!auditedStats.byLocation.length && (
                      <div className="items-row">
                        <div style={{ gridColumn: '1 / span 6' }}>No audited data yet.</div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {selectedAuditedLocation && locationSpecificStats && (
                <>
                  <div style={{ marginBottom: '1rem' }}>
                    <button
                      className="schedule-action secondary"
                      type="button"
                      onClick={() => setSelectedAuditedLocation(null)}
                    >
                      ← Back to All Locations
                    </button>
                  </div>

                  <div className="summary-blocks">
                    <div className="summary-block">
                      <p className="summary-label">Location</p>
                      <p className="summary-value" style={{ fontSize: '1.2rem' }}>
                        {selectedAuditedLocation}
                      </p>
                    </div>
                    <div className="summary-block">
                      <p className="summary-label">Total rescue events</p>
                      <p className="summary-value">{locationSpecificStats.eventCount}</p>
                    </div>
                    <div className="summary-block">
                      <p className="summary-label">Total lbs</p>
                      <p className="summary-value">
                        {locationSpecificStats.totalLbs.toFixed(1)}
                      </p>
                    </div>
                    <div className="summary-block">
                      <p className="summary-label">Avg lbs per event</p>
                      <p className="summary-value">
                        {locationSpecificStats.avgLbsPerEvent.toFixed(1)}
                      </p>
                    </div>
                  </div>

                  <div className="intake-label" style={{ marginTop: '1.25rem' }}>
                    Recurring Events
                  </div>
                  {recurringLoading && <p>Loading recurring events...</p>}
                  {recurringError && <p className="save-status error">{recurringError}</p>}
                  {!recurringLoading && !recurringError && (
                    <>
                      <div className="items-editor">
                        <div className="items-head">
                          <div>Day of Week</div>
                          <div>Total Weight</div>
                          <div>Items</div>
                          <div>Actions</div>
                          <div />
                          <div />
                        </div>
                        {recurringEvents.length > 0 ? (
                          recurringEvents.map((event) => {
                            const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
                            const dayName = dayNames[event.day_of_week] || 'Unknown'
                            const totalWeight = event.total_estimated_lbs || 0
                            const itemsCount = (event.sections || []).flatMap(s => s.items || []).length

                            return (
                              <div className="items-row" key={event.id}>
                                <div>{dayName}</div>
                                <div className="qty-col">{totalWeight.toFixed(1)} lbs</div>
                                <div className="qty-col">{itemsCount}</div>
                                <div>
                                  <button
                                    type="button"
                                    className="schedule-action secondary"
                                    style={{ marginRight: '0.5rem', padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}
                                    onClick={() => handleEditRecurringEvent(event)}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    className="schedule-action secondary"
                                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem' }}
                                    onClick={() => handleDeleteRecurringEvent(event)}
                                  >
                                    Delete
                                  </button>
                                </div>
                                <div />
                                <div />
                              </div>
                            )
                          })
                        ) : (
                          <div className="items-row">
                            <div style={{ gridColumn: '1 / span 6' }}>No recurring events for this location.</div>
                          </div>
                        )}
                      </div>
                      <div style={{ marginTop: '0.75rem' }}>
                        <button
                          type="button"
                          className="schedule-action"
                          onClick={() => {
                            setRecurringFormData({
                              id: null,
                              rescue_location_canonical: selectedAuditedLocation,
                              day_of_week: 1,
                              items: [{
                                name: '',
                                quantity: '',
                                unit: '',
                                subcategory: '',
                                estimated_lbs: '',
                              }],
                            })
                            setRecurringFormStatus({ state: 'idle', message: '' })
                            setShowRecurringForm(true)
                          }}
                        >
                          + Add Recurring Event
                        </button>
                      </div>
                    </>
                  )}

                  {filteredAuditedRecords.length > 0 && (
                    <>
                      <div className="intake-label" style={{ marginTop: '1.25rem' }}>
                        Individual Rescue Events
                      </div>
                      <div className="delivery-table">
                        <div className="delivery-head">
                          <div className="col date">Rescue date</div>
                          <div className="col weight">Weight</div>
                          <div className="col items">Items</div>
                          <div className="col">Cards</div>
                        </div>
                        {filteredAuditedRecords.map((record, idx) => {
                      const rowId = auditedRecordRowId(record, idx)
                      const isExpanded = expandedAuditedId === rowId
                      const cards = buildAuditedCards(record)

                      // Only show cards for selected location
                      const relevantCards = cards.filter(
                        (card) => card.location === selectedAuditedLocation
                      )
                      const items = relevantCards.flatMap((card) =>
                        Array.isArray(card.items) ? card.items : []
                      )
                      const weightTotal = totalRescuedWeight(items)

                      return (
                        <div key={rowId}>
                          <div
                            className={`delivery-row ${isExpanded ? 'expanded' : ''}`}
                            onClick={() => setExpandedAuditedId((prev) =>
                              prev === rowId ? null : rowId
                            )}
                          >
                            <div className="col date">{formatRecordDate(record)}</div>
                            <div className="col weight">
                              {weightTotal ? `${Math.round(weightTotal)} lbs` : '—'}
                            </div>
                            <div className="col items">{items.length}</div>
                            <div className="col">{relevantCards.length}</div>
                          </div>
                          {isExpanded && (
                            <div className="delivery-items-editor" onClick={(e) => e.stopPropagation()}>
                              <div className="delivery-message">
                                <p>{getRecordRawText(record)}</p>
                              </div>
                              {relevantCards.length ? (
                                relevantCards.map((card, cardIdx) => {
                                  const cardItems = Array.isArray(card.items) ? card.items : []
                                  const cardWeight = totalRescuedWeight(cardItems)
                                  const originalCardIndex = cards.findIndex((c) => c === card)
                                  const cardKey = `${rowId}-${originalCardIndex}`
                                  const isEditing = !!editingAuditedCards[cardKey]
                                  const editingItems = editingAuditedCards[cardKey]?.items || []

                                  return (
                                    <details
                                      className="delivery-items-accordion audited-card"
                                      key={`${rowId}-${card.key || cardIdx}`}
                                      open
                                    >
                                      <summary>
                                        {`Items (${cardItems.length}) - ${cardWeight.toFixed(1)} lbs`}
                                      </summary>
                                      {!isEditing ? (
                                        <>
                                          <div className="items-editor">
                                            <div className="items-head">
                                              <div>Item</div>
                                              <div>Qty</div>
                                              <div>Unit</div>
                                              <div>Subcategory</div>
                                              <div>lbs</div>
                                              <div />
                                            </div>
                                            {cardItems.map((item, itemIdx) => {
                                              const name = item.name || item.item_name || 'Unknown item'
                                              const quantity = item.quantity ?? item.qty
                                              const quantityLabel =
                                                quantity === '' || quantity === null || quantity === undefined
                                                  ? '—' : quantity
                                              const unit = item.unit || item.container || '—'
                                              const subcategory = item.subcategory
                                                ? formatSubcategoryLabel(String(item.subcategory))
                                                : '—'
                                              const rawWeight = item.pounds ?? item.estimated_lbs
                                              const weightValue = Number(rawWeight)
                                              const weightLabel = Number.isFinite(weightValue)
                                                ? weightValue.toFixed(1) : '—'
                                              return (
                                                <div
                                                  className="items-row"
                                                  key={`${rowId}-card-${cardIdx}-item-${itemIdx}`}
                                                >
                                                  <div>{name}</div>
                                                  <div className="qty-col">{quantityLabel}</div>
                                                  <div className="unit-col">{unit}</div>
                                                  <div>{subcategory}</div>
                                                  <div className="qty-col">{weightLabel}</div>
                                                  <div />
                                                </div>
                                              )
                                            })}
                                          </div>
                                          <div className="delivery-items-editor items-actions" style={{ marginTop: '0.5rem' }}>
                                            <button
                                              type="button"
                                              className="schedule-action secondary"
                                              onClick={() => startEditingAuditedCard(record, originalCardIndex)}
                                            >
                                              Edit items
                                            </button>
                                          </div>
                                        </>
                                      ) : (
                                        <>
                                          <div className="items-editor">
                                            <div className="items-head">
                                              <div>Item</div>
                                              <div>Qty</div>
                                              <div>Unit</div>
                                              <div>Subcategory</div>
                                              <div>lbs</div>
                                              <div />
                                            </div>
                                            {editingItems.map((item, itemIdx) => (
                                              <div className="items-row" key={`${cardKey}-edit-${itemIdx}`}>
                                                <input
                                                  type="text"
                                                  className="item-col"
                                                  value={item.name}
                                                  onChange={(e) => updateAuditedCardItem(cardKey, itemIdx, 'name', e.target.value)}
                                                  placeholder="Item name"
                                                />
                                                <input
                                                  type="text"
                                                  className="qty-col"
                                                  value={item.quantity}
                                                  onChange={(e) => updateAuditedCardItem(cardKey, itemIdx, 'quantity', e.target.value)}
                                                  placeholder="qty"
                                                />
                                                <input
                                                  type="text"
                                                  className="unit-col"
                                                  value={item.unit}
                                                  onChange={(e) => updateAuditedCardItem(cardKey, itemIdx, 'unit', e.target.value)}
                                                  placeholder="cases / lbs / boxes"
                                                />
                                                <select
                                                  className="category-col"
                                                  value={item.subcategory || ''}
                                                  onChange={(e) => updateAuditedCardItem(cardKey, itemIdx, 'subcategory', e.target.value)}
                                                >
                                                  <option value="">Select</option>
                                                  {WAREHOUSE_SUBCATEGORY_OPTIONS.map((option) => (
                                                    <option key={option} value={option}>{formatSubcategoryLabel(option)}</option>
                                                  ))}
                                                </select>
                                                <input
                                                  type="text"
                                                  className="lbs-col"
                                                  value={item.estimated_lbs}
                                                  onChange={(e) => updateAuditedCardItem(cardKey, itemIdx, 'estimated_lbs', e.target.value)}
                                                  placeholder="lbs"
                                                />
                                                <button type="button" className="link-remove" onClick={() => updateAuditedCardItem(cardKey, itemIdx, 'remove', true)}>
                                                  Remove
                                                </button>
                                              </div>
                                            ))}
                                          </div>
                                          <div className="delivery-items-editor items-actions">
                                            <button
                                              type="button"
                                              className="schedule-action secondary"
                                              onClick={() => addAuditedCardItem(cardKey)}
                                            >
                                              Add item
                                            </button>
                                          </div>
                                          <div className="delivery-items-editor items-actions">
                                            <button
                                              type="button"
                                              className="schedule-action secondary"
                                              onClick={() => handleCancelAuditedCard(cardKey)}
                                            >
                                              Cancel
                                            </button>
                                            <button
                                              type="button"
                                              className="schedule-action"
                                              disabled={auditedCardSaveState[cardKey] === 'saving'}
                                              onClick={() => handleSaveAuditedCard(cardKey)}
                                            >
                                              {auditedCardSaveState[cardKey] === 'saving' ? 'Saving…' : 'Save items'}
                                            </button>
                                          </div>
                                          {auditedCardSaveState[cardKey] === 'saved' && <p className="save-status">Items saved.</p>}
                                          {auditedCardSaveState[cardKey] === 'error' && (
                                            <p className="save-status error">{auditedCardSaveState.message || 'Unable to save items.'}</p>
                                          )}
                                        </>
                                      )}
                                    </details>
                                  )
                                })
                              ) : (
                                <p className="items-empty">No items for this location.</p>
                              )}
                            </div>
                          )}
                        </div>
                      )
                        })}
                      </div>
                    </>
                  )}

                  {(locationUnauditedMessages.length > 0 || unauditedLoading) && (
                    <>
                      <div className="intake-label" style={{ marginTop: '1.5rem' }}>
                        Unaudited Messages Mentioning This Location
                    {unauditedLoading && <span style={{ marginLeft: '0.5rem', opacity: 0.6 }}>
                      (Loading...)
                    </span>}
                  </div>
                  {locationUnauditedMessages.length > 0 ? (
                    <div className="card" style={{ marginTop: '0.5rem' }}>
                      {locationUnauditedMessages.slice(0, 10).map((msg, idx) => (
                        <div
                          key={auditedRecordRowId(msg, idx)}
                          style={{
                            padding: '0.75rem',
                            borderBottom: idx < locationUnauditedMessages.length - 1
                              ? '1px solid #e5e7eb' : 'none'
                          }}
                        >
                          <div style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '0.25rem' }}>
                            {formatRecordDate(msg)}
                          </div>
                          <div style={{ whiteSpace: 'pre-wrap' }}>
                            {getRecordRawText(msg)}
                          </div>
                        </div>
                      ))}
                      {locationUnauditedMessages.length > 10 && (
                        <div style={{ padding: '0.75rem', textAlign: 'center', color: '#6b7280' }}>
                          ... and {locationUnauditedMessages.length - 10} more
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="card" style={{ marginTop: '0.5rem', padding: '1rem', textAlign: 'center' }}>
                      {unauditedLoading
                        ? 'Loading unaudited messages...'
                        : 'No unaudited messages mention this location.'}
                    </div>
                  )}
                    </>
                  )}
                </>
              )}
            </div>

            {!selectedAuditedLocation && (
              <div className="audited-records">
                <div className="audited-records-header">
                  <h3>Audited messages</h3>
                  <p>Chronological list of audited messages used in stats.</p>
                </div>
              {auditedLoading && <div className="loading">Loading audited messages...</div>}
              {!auditedLoading && !sortedAuditedRecords.length && (
                <div className="empty-state">
                  <p>No audited messages for this range yet.</p>
                </div>
              )}
              {!auditedLoading && sortedAuditedRecords.length > 0 && (
                <div className="delivery-table">
                  <div className="delivery-head">
                    <div className="col date">Rescue date</div>
                    <div className="col from">Rescued from</div>
                    <div className="col weight">Rescued weight</div>
                    <div className="col items">Cards</div>
                  </div>
                  {sortedAuditedRecords.map((record, idx) => {
                    const rowId = auditedRecordRowId(record, idx)
                    const isExpanded = expandedAuditedId === rowId
                    const cards = buildAuditedCards(record)
                    const items = cards.flatMap((card) => (Array.isArray(card.items) ? card.items : []))
                    const weightTotal = totalRescuedWeight(items)
                    const cardLocations = Array.from(new Set(cards.map((card) => card.location).filter(Boolean)))
                    const locationLabel = cardLocations[0] || 'Unknown location'
                    const locationSuffix = cardLocations.length > 1 ? ` +${cardLocations.length - 1}` : ''
                    const locationTitle = cardLocations.length > 1 ? cardLocations.join(', ') : undefined
                    return (
                      <div key={rowId}>
                        <div
                          className={`delivery-row ${isExpanded ? 'expanded' : ''}`}
                          onClick={() => setExpandedAuditedId((prev) => (prev === rowId ? null : rowId))}
                        >
                          <div className="col date">{formatRecordDate(record)}</div>
                          <div className="col from">
                            <span className="delivery-pill" title={locationTitle}>{locationLabel}{locationSuffix}</span>
                          </div>
                          <div className="col weight">{weightTotal ? `${Math.round(weightTotal)} lbs` : '—'}</div>
                          <div className="col items">
                            <span className="delivery-items-inline">Cards ({cards.length})</span>
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="delivery-items-editor" onClick={(e) => e.stopPropagation()}>
                            <div className="delivery-message">
                              <p>{getRecordRawText(record)}</p>
                            </div>
                            {cards.length ? (
                              cards.map((card, cardIdx) => {
                                const cardItems = Array.isArray(card.items) ? card.items : []
                                const cardWeight = totalRescuedWeight(cardItems)
                                const cardLocation = card.location || 'Unknown location'
                                return (
                                  <details className="delivery-items-accordion audited-card" key={`${rowId}-${card.key || cardIdx}`} open>
                                    <summary>
                                      {`Card ${cardIdx + 1} - ${cardLocation} - Items (${cardItems.length}) - ${cardWeight.toFixed(1)} lbs`}
                                    </summary>
                                    <div className="items-editor">
                                      <div className="items-head">
                                        <div>Item</div>
                                        <div>Qty</div>
                                        <div>Unit</div>
                                        <div>Subcategory</div>
                                        <div>lbs</div>
                                        <div />
                                      </div>
                                      {cardItems.map((item, itemIdx) => {
                                        const name = item.name || item.item_name || 'Unknown item'
                                        const quantity = item.quantity ?? item.qty
                                        const quantityLabel = quantity === '' || quantity === null || quantity === undefined ? '—' : quantity
                                        const unit = item.unit || item.container || '—'
                                        const subcategory = item.subcategory ? formatSubcategoryLabel(String(item.subcategory)) : '—'
                                        const rawWeight = item.pounds ?? item.estimated_lbs
                                        const weightValue = Number(rawWeight)
                                        const weightLabel = Number.isFinite(weightValue) ? weightValue.toFixed(1) : '—'
                                        return (
                                          <div className="items-row" key={`${rowId}-card-${cardIdx}-item-${itemIdx}`}>
                                            <div>{name}</div>
                                            <div className="qty-col">{quantityLabel}</div>
                                            <div className="unit-col">{unit}</div>
                                            <div>{subcategory}</div>
                                            <div className="qty-col">{weightLabel}</div>
                                            <div />
                                          </div>
                                        )
                                      })}
                                      {!cardItems.length && (
                                        <div className="items-row">
                                          <div style={{ gridColumn: '1 / span 6' }}>No items recorded.</div>
                                        </div>
                                      )}
                                    </div>
                                  </details>
                                )
                              })
                            ) : (
                              <p className="items-empty">No cards recorded.</p>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              </div>
            )}
          </div>
        )}
        {currentView === 'slack-browser' && (
          <div className="deliveries">
            <div className="deliveries-header">
              <div>
                <h2>Slack browser (regex)</h2>
                <p>Browse the parsed Slack messages one by one. Backend: FastAPI on port 5055 running extract_slack_regex.py output.</p>
              </div>
              <div className="deliveries-actions">
                <button
                  className="schedule-action secondary"
                  type="button"
                  onClick={() => loadSlackRecord(slackIndex)}
                  disabled={slackBrowserStatus.state === 'loading'}
                >
                  {slackBrowserStatus.state === 'loading' ? 'Refreshing…' : 'Reload current'}
                </button>
              </div>
              </div>

              <div className="warehouse-intake card">
              <div className="search-container">
                <div className="search-box">
                  <label className="intake-label" htmlFor="slack-search">
                    Search messages
                  </label>
                  <input
                    id="slack-search"
                    type="text"
                    placeholder="Search locations, items, or message text..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value)
                      if (e.target.value.trim().length >= 2) {
                        handleSearch(e.target.value)
                      } else {
                        setShowSearchResults(false)
                      }
                    }}
                    onFocus={() => {
                      if (searchQuery.trim().length >= 2 && searchResults.length > 0) {
                        setShowSearchResults(true)
                      }
                    }}
                  />
                  {searchStatus.state === 'loading' && (
                    <span className="search-status">Searching...</span>
                  )}
                  {searchStatus.state === 'error' && (
                    <span className="search-status error">{searchStatus.message}</span>
                  )}
                </div>

                {showSearchResults && searchResults.length > 0 && (
                  <div className="search-results">
                    <div className="search-results-header">
                      <p>{searchTotal} result{searchTotal !== 1 ? 's' : ''} found</p>
                      <button
                        className="link-remove"
                        onClick={() => setShowSearchResults(false)}
                      >
                        Close
                      </button>
                    </div>
                    <div className="search-results-list">
                      {searchResults.map((result) => (
                        <div
                          key={result.id}
                          className="search-result-item"
                          onClick={() => loadSearchResult(result)}
                        >
                          <div className="result-main">
                            <span className="result-id">#{result.id}</span>
                            <span className="result-date">
                              {new Date(result.start_ts).toLocaleDateString()}
                            </span>
                            <span className={`result-badge ${result.audited ? 'audited' : 'unaudited'}`}>
                              {result.audited ? 'Audited' : 'Unaudited'}
                            </span>
                          </div>
                          <div className="result-preview">
                            {result.match_preview}
                          </div>
                          <div className="result-matched">
                            Matched in: {result.matched_in.join(', ')}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {showSearchResults && searchResults.length === 0 && searchStatus.state === 'idle' && (
                  <div className="search-results">
                    <p className="search-empty">No results found for "{searchQuery}"</p>
                  </div>
                )}
              </div>

              <div className="filter-row">
                <div>
                  <label className="intake-label" htmlFor="slack-start-date">Start date</label>
                  <input
                    id="slack-start-date"
                    type="date"
                    value={slackStartDate}
                    onChange={(e) => setSlackStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="intake-label" htmlFor="slack-end-date">End date</label>
                  <input
                    id="slack-end-date"
                    type="date"
                    value={slackEndDate}
                    onChange={(e) => setSlackEndDate(e.target.value)}
                  />
                </div>
                <div className="item-actions">
                  <button
                    className="schedule-action secondary"
                    type="button"
                    onClick={() => loadSlackRecord(0)}
                    disabled={slackBrowserStatus.state === 'loading'}
                  >
                    Apply
                  </button>
                </div>
              </div>
                <div className="intake-top">
                  <div>
                    <p className="eyebrow">Message {slackIndex + 1} / {slackTotal || 0}</p>
                    <h3>Parsed Slack record</h3>
                    <p>Prev/Next to page through; values are read-only snapshots from regex extraction. Use the audit filter to browse unaudited, all, or audited records.</p>
                  </div>
                  <div className="intake-status">
                    {slackBrowserStatus.state === 'loading' && <span className="status-pill outline">Loading…</span>}
                    {slackBrowserStatus.state === 'error' && <span className="status-pill danger">Error</span>}
                  </div>
                </div>

                <div className="audit-controls">
                  <div className="control-group">
                    <label className="intake-label" htmlFor="audit-filter">Audit filter</label>
                    <select
                      id="audit-filter"
                      value={auditFilter}
                      onChange={(e) => {
                        const nextFilter = e.target.value
                        setAuditFilter(nextFilter)
                        loadSlackRecord(0, nextFilter)
                      }}
                    >
                      <option value="unaudited">Unaudited only</option>
                      <option value="all">All messages</option>
                      <option value="audited">Audited only</option>
                    </select>
                    <p className="audit-hint">Stay on unaudited to move through the backlog; switch to all to spot-check.</p>
                  </div>
                  <div className="audit-actions">
                    <div className="audit-status">
                      <span className={`status-pill ${slackRecord?.audited ? 'filled' : 'outline'}`}>
                        {slackRecord?.audited ? 'Audited' : 'Not audited'}
                      </span>
                      <span className="audit-status-text">
                        {!slackRecord ? 'Load a record to audit' : slackAuditStatus.state === 'saving'
                          ? 'Saving…'
                          : slackRecord.audited ? 'Stored in audit log' : 'Pending review'}
                      </span>
                    </div>
                    <button
                      className="schedule-action primary audit-toggle"
                      type="button"
                      onClick={handleAudit}
                      disabled={slackAuditStatus.state === 'saving' || !slackRecord}
                    >
                      {slackAuditStatus.state === 'saving'
                        ? 'Saving…'
                        : slackRecord?.audited ? 'Unmark audited' : 'Mark audited'}
                    </button>
                    {slackAuditStatus.state === 'saved' && (
                      <span className="audit-flash success">{slackAuditStatus.message || 'Saved'}</span>
                    )}
                    {slackAuditStatus.state === 'error' && (
                      <span className="audit-flash error">{slackAuditStatus.message || 'Audit error'}</span>
                    )}
                  </div>
                </div>

                {trainingStats.has_active_model && (
                <div className="extraction-method-controls">
                  <label className="intake-label">Extraction method</label>
                  <div className="extraction-method-options">
                    <label className="extraction-option">
                      <input
                        type="radio"
                        name="extraction-method"
                        value="regex"
                        checked={extractionMethod === 'regex'}
                        onChange={(e) => setExtractionMethod(e.target.value)}
                      />
                      <span>Regex parser</span>
                    </label>
                    <label className="extraction-option">
                      <input
                        type="radio"
                        name="extraction-method"
                        value="model"
                        checked={extractionMethod === 'model'}
                        onChange={(e) => setExtractionMethod(e.target.value)}
                      />
                      <span>PEFT model</span>
                    </label>
                    <label className="extraction-option">
                      <input
                        type="radio"
                        name="extraction-method"
                        value="compare"
                        checked={extractionMethod === 'compare'}
                        onChange={(e) => setExtractionMethod(e.target.value)}
                      />
                      <span>Compare both</span>
                    </label>
                  </div>
                  {modelInferenceLoading && <span className="status-pill outline">Running inference…</span>}
                  {extractionMethod === 'model' && modelInference?.error && (
                    <p className="error-text">{modelInference.error}</p>
                  )}
                  {extractionMethod === 'compare' && comparisonData?.error && (
                    <p className="error-text">{comparisonData.error}</p>
                  )}
                </div>
              )}

                {slackBrowserStatus.state === 'error' && (
                <div className="error-text">{slackBrowserStatus.message}</div>
              )}

              {slackRecord && (
                <>
                  <div className="warehouse-summary">
                    <div className="summary-block">
                      <p className="summary-label">Rescue date</p>
                      <p className="summary-value">
                        {slackRecord.start_ts ? new Date(slackRecord.start_ts).toLocaleDateString() : 'unknown'}
                      </p>
                    </div>
                    <div className="summary-block">
                      <p className="summary-label">Rescued from</p>
                      <div className="pill-row">
                        {rescueLocations.length
                          ? rescueLocations.map((loc) => (
                            <span className="status-pill outline" key={`rescue-${loc}`}>{loc}</span>
                          ))
                          : <span className="status-pill outline">—</span>}
                      </div>
                    </div>
                    <div className="summary-block">
                      <p className="summary-label">Dropped to</p>
                      <div className="pill-row">
                        {dropOffLocations.length
                          ? dropOffLocations.map((loc) => (
                            <span className="status-pill outline" key={`drop-${loc}`}>{loc}</span>
                          ))
                          : <span className="status-pill outline">—</span>}
                      </div>
                    </div>
                    <div className="summary-block">
                      <p className="summary-label">Rescued weight</p>
                      <p className="summary-value">
                        {(slackItems.reduce((sum, item) => sum + (Number(item.estimated_lbs) || 0), 0)).toFixed(0)} lbs
                      </p>
                    </div>
                    <div className="summary-block">
                      <p className="summary-label">Items</p>
                      <p className="summary-value">{slackItems.length}</p>
                    </div>
                  </div>

                  <div className="intake-label">Raw message</div>
                  <div className="intake-textarea" style={{ minHeight: '120px', whiteSpace: 'pre-wrap' }}>
                    {(slackRecord.raw_messages || []).join(' | ')}
                  </div>

                  <div className="warehouse-items">
                    <div className="items-header">
                      <p className="eyebrow">Items</p>
                      <div className="item-actions">
                        <button
                          className="schedule-action secondary"
                          type="button"
                          onClick={() => loadSlackRecord(Math.max(slackIndex - 1, 0))}
                          disabled={slackBrowserStatus.state === 'loading' || slackTotal === 0}
                        >
                          Prev
                        </button>
                        <button
                          className="schedule-action secondary"
                          type="button"
                          onClick={() => loadSlackRecord(Math.min(slackIndex + 1, Math.max(slackTotal - 1, 0)))}
                          disabled={slackBrowserStatus.state === 'loading' || slackTotal === 0}
                        >
                          Next
                        </button>
                        <button
                          className="schedule-action secondary"
                          type="button"
                          onClick={addSlackSection}
                        >
                          Add card
                        </button>
                      </div>
                    </div>

                    {(slackRecord.sections || []).map((section, secIdx) => (
                      <div key={`${section.location || 'section'}-${secIdx}`} className="section-block">
                        <div className="section-header">
                          <label className="section-location">
                            <span className="eyebrow">Location</span>
                            <select
                              value={canonicalizeLocation(section.location_canonical || section.location) || ''}
                              onChange={(e) => updateSlackSectionLocation(secIdx, e.target.value)}
                            >
                              <option value="">Select location</option>
                              {LOCATION_OPTIONS.map((location) => (
                                <option key={location} value={location}>{location}</option>
                              ))}
                            </select>
                          </label>
                          <button type="button" className="link-remove section-delete" onClick={() => removeSlackSection(secIdx)}>
                            Delete card
                          </button>
                        </div>
                        <div className="items-editor">
                          <div className="items-head">
                            <div>Item</div>
                            <div>Qty</div>
                            <div>Unit</div>
                            <div>Subcategory</div>
                            <div>lbs</div>
                            <div />
                          </div>
                          {(section.items || []).map((item, idx) => (
                            <div key={`${section.location || 'section'}-${idx}`} className="items-row">
                              <div>
                                <input
                                  value={item.name || ''}
                                  onChange={(e) => updateSlackItem(secIdx, idx, 'name', e.target.value)}
                                  placeholder="Item name"
                                />
                              </div>
                              <div className="qty-col">
                                <input
                                  value={item.quantity ?? ''}
                                  onChange={(e) => updateSlackItem(secIdx, idx, 'quantity', e.target.value)}
                                  placeholder="#"
                                />
                              </div>
                              <div className="unit-col">
                                <input
                                  value={item.unit || ''}
                                  onChange={(e) => updateSlackItem(secIdx, idx, 'unit', e.target.value)}
                                  placeholder="cases / lbs / boxes"
                                />
                              </div>
                              <div>
                                <select
                                  className="category-col"
                                  value={item.subcategory || ''}
                                  onChange={(e) => updateSlackItem(secIdx, idx, 'subcategory', e.target.value)}
                                >
                                  <option value="">Select</option>
                                  {WAREHOUSE_SUBCATEGORY_OPTIONS.map((option) => (
                                    <option key={option} value={option}>{formatSubcategoryLabel(option)}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="qty-col">
                                <input
                                  value={item.estimated_lbs ?? ''}
                                  onChange={(e) => updateSlackItem(secIdx, idx, 'estimated_lbs', e.target.value)}
                                  placeholder="~lbs"
                                />
                              </div>
                              <div>
                                <button type="button" className="link-remove" onClick={() => removeSlackItem(secIdx, idx)}>
                                  Remove
                                </button>
                              </div>
                            </div>
                          ))}
                          {!(section.items || []).length && (
                            <div className="items-row">
                              <div style={{ gridColumn: '1 / span 6' }}>No items parsed.</div>
                            </div>
                          )}
                          <div className="items-actions">
                            <button
                              type="button"
                              className="schedule-action secondary"
                              onClick={() => addSlackItem(secIdx)}
                            >
                              Add item
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {!slackRecord && slackBrowserStatus.state !== 'loading' && (
                <div className="error-text">No record loaded. Check that the Python server on port 5055 is running.</div>
              )}
            </div>
          </div>
        )}

        {currentView === 'food-pickup' && (
          <div className="pickup-hub">
            <div className="hub-intro">
              <div>
                <h2>Cover a pickup</h2>
                <p>Claim an urgent slot or grab a weekly run that needs coverage.</p>
              </div>
            </div>

            {unfilledSoon.length > 0 && (
              <div className="unfilled-soon">
                <div className="unfilled-header">
                  <h3>Unfilled in the next 24 hours</h3>
                  <span className="unfilled-count">{unfilledSoon.length} spot{unfilledSoon.length === 1 ? '' : 's'}</span>
                </div>
                <div className="unfilled-grid">
                  {unfilledSoon.map(({ slot, day }) => {
                    const timeDisplay = slot.time || (slot.timeStart && slot.timeEnd
                      ? `${formatTime(slot.timeStart)} - ${formatTime(slot.timeEnd)}`
                      : formatTime(slot.timeStart) || '')
                    const capacity = Number(slot.capacity) || 1
                    const filledCount = slot.filledCountsByDate?.[day.dateKey] || 0
                    return (
                      <div className="unfilled-card" key={slot.id}>
                        <div className="unfilled-meta">
                          <span className="unfilled-day">{day.displayDate}</span>
                          <span className="unfilled-time">{timeDisplay}</span>
                        </div>
                        <h4>{slot.store}</h4>
                        <p className="unfilled-detail">
                          {`${filledCount} of ${capacity} filled`} · {slot.address || 'Location TBD'}
                        </p>
                        <button
                          className="schedule-action primary"
                          onClick={() => handlePickupSelect(slot.id, day.dateKey)}
                        >
                          View & sign up
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {eventsError && (
              <div className="alert error">
                {eventsError}
              </div>
            )}
            {eventsLoading && <div className="loading">Loading events…</div>}

            <div className="weekly-schedule">
              <h3>Weekly Pickup Schedule</h3>
              <p className="schedule-intro">Modeled after signup.com for quick scanning.</p>
              <div className="create-event-bar">
                <button
                  className="schedule-action primary"
                  type="button"
                  onClick={() => setCurrentView('create-event')}
                >
                  ➕ Create new event
                </button>
                <button
                  className="schedule-action secondary"
                  type="button"
                  onClick={handleSendSlackAlert}
                  disabled={slackStatus.state === 'submitting'}
                >
                  {slackStatus.state === 'submitting' ? 'Sending…' : 'Test Slack alert'}
                </button>
              </div>
              {slackStatus.state !== 'idle' && (
                <div className={`slack-status ${slackStatus.state}`}>
                  {slackStatus.message}
                </div>
              )}

              {weeklySchedule.map((day) => (
                <div className="schedule-day" key={day.dateKey}>
                  <button className="day-header-row" type="button" onClick={() => toggleDay(day.dateKey)}>
                    <span className={`day-arrow ${openDays.includes(day.dateKey) ? 'open' : ''}`}>▸</span>
                    <span className="day-label">{day.displayDate}</span>
                    <span className="day-filled">{day.slots.length ? `${day.slots.length} slots` : 'No events'}</span>
                  </button>

                  {openDays.includes(day.dateKey) && (
                    <>
                      {day.slots.length === 0 ? (
                        <div className="schedule-empty">No pickups scheduled.</div>
                      ) : (
                        <div className="schedule-table" role="table" aria-label={`${day.label} pickups`}>
                          <div className="schedule-head" role="row">
                            <div className="col spot" role="columnheader">Spot</div>
                            <div className="col time" role="columnheader">Time</div>
                            <div className="col status" role="columnheader">Status</div>
                            <div className="col filled" role="columnheader">Filled</div>
                            <div className="col action" role="columnheader">Action</div>
                          </div>
                          {day.slots.map((slot) => {
                            const isUrgent = !!slot.urgent
                            const statusLabel = slot.assigned ? 'Filled' : isUrgent ? 'Urgent' : 'Open'
                            const statusClass = slot.assigned ? 'filled' : isUrgent ? 'urgent' : 'open'
                            const actionLabel = slot.assigned ? 'View' : 'Sign Up'
                            const capacity = Number(slot.capacity) || 1
                    const filledCountForDay = slot.filledCountsByDate?.[day.dateKey] || 0
                            const filledCount = filledCountForDay
                            const assigned = filledCount >= capacity
                            const statusDisplayClass = assigned ? 'filled' : statusClass
                            const statusDisplayLabel = assigned ? 'Filled' : statusLabel
                            const timeDisplay = slot.time
                              || (slot.timeStart && slot.timeEnd
                                ? `${formatTime(slot.timeStart)} - ${formatTime(slot.timeEnd)}`
                                : formatTime(slot.timeStart) || '')

                            return (
                              <div
                                className="schedule-row"
                                key={`${slot.id}-${day.dateKey}`}
                                role="row"
                                onClick={() => handlePickupSelect(slot.id, day.dateKey)}
                                tabIndex={0}
                                onKeyDown={(e) => e.key === 'Enter' && handlePickupSelect(slot.id, day.dateKey)}
                              >
                                <div className="col spot" role="cell">
                                  <div className="spot-title">{slot.store}</div>
                                  <div className="spot-sub">{slot.address}</div>
                                  {slot.assignee && <div className="spot-assignee">Assigned: {slot.assignee}</div>}
                                </div>
                                <div className="col time" role="cell">
                                  <div className="time-primary">{timeDisplay}</div>
                                </div>
                                <div className="col status" role="cell">
                                  <span className={`status-pill ${statusDisplayClass}`}>{statusDisplayLabel}</span>
                                </div>
                                <div className="col filled" role="cell">
                                  {`${filledCount} of ${capacity}`}
                                </div>
                                <div className="col action" role="cell">
                                  <button
                                    className={`schedule-action ${slot.assigned ? 'secondary' : 'primary'}`}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handlePickupSelect(slot.id, day.dateKey)
                                    }}
                                  >
                                    {actionLabel}
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
              <div ref={loadMoreRef} className="load-more-sentinel" aria-hidden />
            </div>
          </div>
        )}

        {currentView === 'pickup-signup' && selectedPickup && (
          <div className="pickup-signup-view">
            <div className="view-header">
              <button className="back-button" onClick={showPickupHub}>
                ← Back to Pickups
              </button>
              <h2>Sign Up for Pickup</h2>
            </div>
            
            <div className="pickup-detail-card">
              <div className="pickup-header">
                <h3>{selectedPickup.store} - {selectedPickup.day}s</h3>
                <div className="pickup-time-badge">
                  {selectedPickup.time
                    || (selectedPickup.timeStart && selectedPickup.timeEnd
                      ? `${formatTime(selectedPickup.timeStart)} - ${formatTime(selectedPickup.timeEnd)}`
                      : formatTime(selectedPickup.timeStart) || '')}
                </div>
              </div>
              
              <div className="pickup-info-grid">
                <div className="info-section">
                  <h4>📍 Location</h4>
                  <p className="address">{selectedPickup.address}</p>
                  <a 
                    href={`https://maps.google.com/?q=${encodeURIComponent(selectedPickup.address)}`}
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="maps-link"
                  >
                    Open in Google Maps →
                  </a>
                </div>
                
                <div className="info-section">
                  <h4>⏱️ Details</h4>
                  <p><strong>Duration:</strong> {selectedPickup.duration || '—'}</p>
                  <p><strong>Items:</strong> {selectedPickup.items || selectedPickup.description || '—'}</p>
                  <p><strong>Contact:</strong> {selectedPickup.contact || '—'}</p>
                </div>
              </div>

              <div className="requirements-section">
                <h4>✅ Requirements</h4>
                <ul className="requirements-list">
                  {selectedPickup.requirements?.length
                    ? selectedPickup.requirements.map((req, index) => (
                      <li key={index}>{req}</li>
                    ))
                    : <li>No specific requirements listed.</li>}
                </ul>
              </div>

              <div className="instructions-section">
                <h4>📝 Special Instructions</h4>
                <ul className="instructions-list">
                  {selectedPickup.specialInstructions?.length
                    ? selectedPickup.specialInstructions.map((instruction, index) => (
                      <li key={index}>{instruction}</li>
                    ))
                    : <li>No special instructions yet.</li>}
                </ul>
              </div>

              <div className="signup-actions">
                <div className="login-optional">
                  <h4>Account optional</h4>
                  <p>{isLoggedIn ? 'Using your account for this signup.' : 'Continue with just email, or log in/create account for faster approvals.'}</p>
                  <div className="auth-buttons">
                    <button className={`login-btn ${isLoggedIn ? 'active' : ''}`} onClick={handleLogin}>
                      {isLoggedIn ? 'Using my account' : 'Log In / Create Account'}
                    </button>
                    <button className="register-btn" onClick={() => setIsLoggedIn(false)}>
                      Continue with email only
                    </button>
                  </div>
                </div>

                <div className="logged-in-actions">
                  <div className="signup-form-grid">
                    <div className="input-field">
                      <label htmlFor="name">Full name *</label>
                      <input
                        id="name"
                        name="name"
                        value={signupForm.name}
                        onChange={(e) => setSignupForm((prev) => ({ ...prev, name: e.target.value }))}
                        placeholder="e.g., Alex Rivera"
                      />
                    </div>
                    <div className="input-field">
                      <label htmlFor="email">Email *</label>
                      <input
                        id="email"
                        name="email"
                        type="email"
                        value={signupForm.email}
                        onChange={(e) => setSignupForm((prev) => ({ ...prev, email: e.target.value }))}
                        placeholder="you@example.com"
                      />
                    </div>
                    <div className="input-field">
                      <label htmlFor="phone">Phone</label>
                      <input
                        id="phone"
                        name="phone"
                        value={signupForm.phone}
                        onChange={(e) => setSignupForm((prev) => ({ ...prev, phone: e.target.value }))}
                        placeholder="(415) 555-0123"
                      />
                    </div>
                    <div className="input-field full-width">
                      <label htmlFor="notes">Notes (vehicle, helpers, timing)</label>
                      <textarea
                        id="notes"
                        name="notes"
                        value={signupForm.notes}
                        onChange={(e) => setSignupForm((prev) => ({ ...prev, notes: e.target.value }))}
                        placeholder="I have an SUV and can bring cooler bags."
                      />
                    </div>
                    <label className="checkbox-field full-width">
                      <input
                        type="checkbox"
                        checked={signupForm.firstTime}
                        onChange={(e) => setSignupForm((prev) => ({ ...prev, firstTime: e.target.checked }))}
                      />
                      <span>First time doing a pickup</span>
                    </label>
                  </div>

                  <button
                    className="confirm-signup-btn"
                    onClick={handleSignupForPickup}
                    disabled={signupStatus.state === 'submitting' || !isFormValid || selectedPickup.assigned}
                  >
                    {selectedPickup.assigned
                      ? 'Slot is assigned'
                      : signupStatus.state === 'submitting'
                        ? 'Submitting…'
                        : `✅ Submit signup for ${selectedPickup.store}`}
                  </button>
                  <p className="signup-note">
                    {selectedPickup.assigned
                      ? 'This slot is already assigned. Reach out in chat if you need to swap.'
                      : (
                        <>
                          This signup is marked <strong>pending review</strong>. We&apos;ll confirm by email{isLoggedIn ? ' and in your account' : ''}.
                        </>
                        )}
                  </p>
                  {signupStatus.state !== 'idle' && (
                    <p className={`signup-status ${signupStatus.state}`}>
                      {signupStatus.message}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {currentView === 'create-event' && (
          <div className="create-event-page">
            <div className="view-header">
              <button className="back-button" onClick={showPickupHub}>
                ← Back to schedule
              </button>
              <h2>Create a new pickup event</h2>
            </div>

            <div className="new-event-form card">
              {eventsError && <div className="alert error">{eventsError}</div>}
              <div className="form-row">
                <label className="field-large">
                  Title
                  <input
                    value={newEvent.title}
                    onChange={(e) => setNewEvent((prev) => ({ ...prev, title: e.target.value }))}
                    placeholder="Store or location name"
                  />
                </label>
                <label className="field-medium">
                  Recurrence
                  <select
                    value={newEvent.recurrenceType}
                    onChange={(e) => setNewEvent((prev) => ({ ...prev, recurrenceType: e.target.value }))}
                  >
                    <option value="weekly">Weekly</option>
                    <option value="one-off">One-off date</option>
                    <option value="monthly">Monthly (nth weekday)</option>
                  </select>
                </label>
              </div>

              <div className="form-row time-row">
                <div className="time-group">
                  <span className="time-group-label">From</span>
                  <div className="time-inline">
                    <select
                      className="time-number"
                      value={newEvent.startHour}
                      onChange={(e) => setNewEvent((prev) => ({ ...prev, startHour: e.target.value }))}
                    >
                      <option value="">HH</option>
                      {Array.from({ length: 12 }, (_, i) => (i + 1).toString().padStart(2, '0')).map((hour) => (
                        <option key={hour} value={hour}>{hour}</option>
                      ))}
                    </select>
                    <span className="time-separator">:</span>
                    <select
                      className="time-number"
                      value={newEvent.startMinute}
                      onChange={(e) => setNewEvent((prev) => ({ ...prev, startMinute: e.target.value }))}
                    >
                      <option value="">MM</option>
                      {['00', '15', '30', '45'].map((min) => (
                        <option key={min} value={min}>{min}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="meridiem-toggle"
                      onClick={() => setNewEvent((prev) => ({
                        ...prev,
                        startMeridiem: prev.startMeridiem === 'AM' ? 'PM' : 'AM',
                      }))}
                    >
                      {newEvent.startMeridiem || 'AM/PM'}
                    </button>
                  </div>
                </div>

                <div className="time-group">
                  <span className="time-group-label">To</span>
                  <div className="time-inline">
                    <select
                      className="time-number"
                      value={newEvent.endHour}
                      onChange={(e) => setNewEvent((prev) => ({ ...prev, endHour: e.target.value }))}
                    >
                      <option value="">HH</option>
                      {Array.from({ length: 12 }, (_, i) => (i + 1).toString().padStart(2, '0')).map((hour) => (
                        <option key={hour} value={hour}>{hour}</option>
                      ))}
                    </select>
                    <span className="time-separator">:</span>
                    <select
                      className="time-number"
                      value={newEvent.endMinute}
                      onChange={(e) => setNewEvent((prev) => ({ ...prev, endMinute: e.target.value }))}
                    >
                      <option value="">MM</option>
                      {['00', '15', '30', '45'].map((min) => (
                        <option key={min} value={min}>{min}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="meridiem-toggle"
                      onClick={() => setNewEvent((prev) => ({
                        ...prev,
                        endMeridiem: prev.endMeridiem === 'AM' ? 'PM' : 'AM',
                      }))}
                    >
                      {newEvent.endMeridiem || 'AM/PM'}
                    </button>
                  </div>
                </div>
              </div>

              {newEvent.recurrenceType === 'weekly' && (
                <div className="form-row">
                  <label className="field-small">
                    Day of week
                    <select
                      value={newEvent.day}
                      onChange={(e) => setNewEvent((prev) => ({ ...prev, day: e.target.value }))}
                    >
                      <option value="">Select a day</option>
                      {dayOrder.map((day) => (
                        <option key={day} value={day}>{day}</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              {newEvent.recurrenceType === 'one-off' && (
                <div className="form-row">
                  <label className="field-small">
                    Date
                    <input
                      type="date"
                      value={newEvent.singleDate}
                      onChange={(e) => setNewEvent((prev) => ({ ...prev, singleDate: e.target.value }))}
                    />
                  </label>
                </div>
              )}

              {newEvent.recurrenceType === 'monthly' && (
                <div className="form-row">
                  <label className="field-small">
                    Week
                    <select
                      value={newEvent.recurrenceNth}
                      onChange={(e) => setNewEvent((prev) => ({ ...prev, recurrenceNth: e.target.value }))}
                    >
                      <option value="1">1st</option>
                      <option value="2">2nd</option>
                      <option value="3">3rd</option>
                      <option value="4">4th</option>
                      <option value="last">Last</option>
                    </select>
                  </label>
                  <label className="field-small">
                    Weekday
                    <select
                      value={newEvent.recurrenceWeekday}
                      onChange={(e) => setNewEvent((prev) => ({ ...prev, recurrenceWeekday: e.target.value }))}
                    >
                      {dayOrder.map((day) => (
                        <option key={day} value={day}>{day}</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              <div className="form-row">
                <label className="full-width">
                  Address
                  <input
                    value={newEvent.address}
                    onChange={(e) => setNewEvent((prev) => ({ ...prev, address: e.target.value }))}
                    placeholder="123 Main St, City"
                  />
                </label>
              </div>

              <div className="form-row">
                <label className="full-width description-field">
                  Description
                  <textarea
                    value={newEvent.description}
                    onChange={(e) => setNewEvent((prev) => ({ ...prev, description: e.target.value }))}
                    placeholder="Pickup notes, instructions, contact"
                  />
                </label>
              </div>

              <div className="form-row">
                <label className="volunteers-field">
                  Volunteers Needed
                  <input
                    type="number"
                    min="1"
                    value={newEvent.capacity}
                    onChange={(e) => setNewEvent((prev) => ({ ...prev, capacity: e.target.value }))}
                  />
                </label>
              </div>

              <div className="form-row actions-row">
                <button className="schedule-action secondary" type="button" onClick={showPickupHub}>
                  Cancel
                </button>
                <button className="schedule-action primary" type="button" onClick={handleCreateEvent}>
                  Save event
                </button>
              </div>
            </div>
          </div>
        )}

        {showRecurringForm && (
          <div className="modal-overlay" onClick={() => setShowRecurringForm(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h3>{recurringFormData.id ? 'Edit Recurring Event' : 'Add Recurring Event'}</h3>

              <div className="form-row">
                <label className="full-width">
                  Location
                  <input
                    type="text"
                    value={recurringFormData.rescue_location_canonical}
                    readOnly
                    style={{ backgroundColor: '#f5f5f5', cursor: 'not-allowed' }}
                  />
                </label>
              </div>

              <div className="form-row">
                <label className="full-width">
                  Day of Week
                  <select
                    value={recurringFormData.day_of_week}
                    onChange={(e) => setRecurringFormData(prev => ({ ...prev, day_of_week: parseInt(e.target.value) }))}
                  >
                    <option value={0}>Sunday</option>
                    <option value={1}>Monday</option>
                    <option value={2}>Tuesday</option>
                    <option value={3}>Wednesday</option>
                    <option value={4}>Thursday</option>
                    <option value={5}>Friday</option>
                    <option value={6}>Saturday</option>
                  </select>
                </label>
              </div>

              <div className="form-row" style={{ marginTop: '1rem' }}>
                <label className="full-width">
                  Items
                </label>
                <div className="items-editor">
                  <div className="items-head">
                    <div>Item</div>
                    <div>Qty</div>
                    <div>Unit</div>
                    <div>Subcategory</div>
                    <div>lbs</div>
                    <div />
                  </div>
                  {recurringFormData.items.map((item, idx) => (
                    <div className="items-row" key={idx}>
                      <input
                        type="text"
                        className="item-col"
                        value={item.name}
                        onChange={(e) => updateRecurringFormItem(idx, 'name', e.target.value)}
                        placeholder="Item name"
                      />
                      <input
                        type="text"
                        className="qty-col"
                        value={item.quantity}
                        onChange={(e) => updateRecurringFormItem(idx, 'quantity', e.target.value)}
                        placeholder="qty"
                      />
                      <input
                        type="text"
                        className="unit-col"
                        value={item.unit}
                        onChange={(e) => updateRecurringFormItem(idx, 'unit', e.target.value)}
                        placeholder="cases / lbs / boxes"
                      />
                      <select
                        className="category-col"
                        value={item.subcategory || ''}
                        onChange={(e) => updateRecurringFormItem(idx, 'subcategory', e.target.value)}
                      >
                        <option value="">Select</option>
                        {WAREHOUSE_SUBCATEGORY_OPTIONS.map((option) => (
                          <option key={option} value={option}>{formatSubcategoryLabel(option)}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        className="lbs-col"
                        value={item.estimated_lbs}
                        onChange={(e) => updateRecurringFormItem(idx, 'estimated_lbs', e.target.value)}
                        placeholder="lbs"
                      />
                      <button
                        type="button"
                        className="link-remove"
                        onClick={() => removeRecurringFormItem(idx)}
                        disabled={recurringFormData.items.length === 1}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: '0.5rem' }}>
                  <button
                    type="button"
                    className="schedule-action secondary"
                    onClick={addRecurringFormItem}
                  >
                    Add item
                  </button>
                </div>
              </div>

              {recurringFormStatus.state === 'error' && (
                <p className="save-status error">{recurringFormStatus.message}</p>
              )}

              {recurringFormStatus.state === 'saved' && (
                <p className="save-status">Recurring event saved successfully!</p>
              )}

              <div className="form-row actions-row" style={{ marginTop: '1.5rem' }}>
                <button
                  className="schedule-action secondary"
                  type="button"
                  onClick={() => {
                    setShowRecurringForm(false)
                    setRecurringFormStatus({ state: 'idle', message: '' })
                  }}
                  disabled={recurringFormStatus.state === 'saving'}
                >
                  Cancel
                </button>
                <button
                  className="schedule-action primary"
                  type="button"
                  onClick={handleSaveRecurringEvent}
                  disabled={recurringFormStatus.state === 'saving'}
                >
                  {recurringFormStatus.state === 'saving' ? 'Saving...' : 'Save Event'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
