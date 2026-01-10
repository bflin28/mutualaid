import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchSlackMessage } from './lib/slackBrowserApi'
import { saveRescueLog } from './lib/slackAuditApi'
import rescueLocations from './data/rescue_locations.json'
import dropOffLocations from './data/drop_off_locations.json'

// API base for reviewed messages tracking (main server)
const MAIN_API_BASE = '/api'

// Fetch reviewed message IDs from server
const fetchReviewedIds = async () => {
  try {
    const resp = await fetch(`${MAIN_API_BASE}/import/reviewed`)
    if (!resp.ok) return []
    const json = await resp.json()
    return json.data?.ids || []
  } catch {
    return []
  }
}

// Mark message IDs as reviewed
const markAsReviewed = async (ids) => {
  try {
    const resp = await fetch(`${MAIN_API_BASE}/import/reviewed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.isArray(ids) ? ids : [ids] }),
    })
    return resp.ok
  } catch {
    return false
  }
}

const LOCATION_OPTIONS = Array.isArray(rescueLocations) ? rescueLocations : []
const DROP_OFF_OPTIONS = Array.isArray(dropOffLocations) ? dropOffLocations : []
const SUBCATEGORY_OPTIONS = ['produce', 'grain', 'meat', 'drinks', 'snacks', 'dry goods', 'dairy']
const UNIT_OPTIONS = [
  'cases', 'boxes', 'boxes (small)', 'boxes (large)', 'bags', 'bins', 'lbs', 'pounds', 'pallets (full)', 'pallets (small)',
  'crates', 'flats', 'items', 'dozen', 'each', 'gallons', 'packages', 'sacks',
  'loaves', 'gaylords',
]

// Tag input component for multi-value fields
function TagInput({ tags, setTags, suggestions = [], placeholder = 'Type and press Enter' }) {
  const [inputValue, setInputValue] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const inputRef = useRef(null)

  const filteredSuggestions = useMemo(() => {
    if (!inputValue.trim() || inputValue.length < 2) return []
    const lower = inputValue.toLowerCase()
    return suggestions
      .filter(s => s.toLowerCase().includes(lower) && !tags.includes(s))
      .slice(0, 8)
  }, [inputValue, suggestions, tags])

  const addTag = (tag) => {
    const trimmed = tag.trim()
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed])
    }
    setInputValue('')
    setShowSuggestions(false)
  }

  const removeTag = (tagToRemove) => {
    setTags(tags.filter(t => t !== tagToRemove))
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (inputValue.trim()) {
        addTag(inputValue)
      }
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      removeTag(tags[tags.length - 1])
    }
  }

  return (
    <div className="tag-input-container">
      <div className="tag-input-tags">
        {tags.map((tag, idx) => (
          <span key={idx} className="tag-input-tag">
            {tag}
            <button type="button" className="tag-input-remove" onClick={() => removeTag(tag)}>×</button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value)
            setShowSuggestions(true)
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          placeholder={tags.length === 0 ? placeholder : ''}
          className="tag-input-field"
        />
      </div>
      {showSuggestions && filteredSuggestions.length > 0 && (
        <ul className="tag-input-suggestions">
          {filteredSuggestions.map((suggestion, idx) => (
            <li
              key={idx}
              onMouseDown={() => addTag(suggestion)}
              className="tag-input-suggestion"
            >
              {suggestion}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Parse timestamp to date string (YYYY-MM-DD)
function parseDate(ts) {
  if (!ts) return new Date().toISOString().split('T')[0]
  try {
    const date = new Date(ts)
    if (isNaN(date.getTime())) return new Date().toISOString().split('T')[0]
    return date.toISOString().split('T')[0]
  } catch {
    return new Date().toISOString().split('T')[0]
  }
}

// Clean location string - remove parenthetical notes, extra whitespace
function cleanLocationString(loc) {
  if (!loc) return ''
  return loc
    .replace(/\s*\([^)]*\)\s*/g, '') // Remove (yesterday), (earlier), etc.
    .replace(/\s*-\s*(yesterday|today|earlier|this morning|this afternoon).*$/i, '')
    .trim()
}

// Try to match a location string to a known location alias
function matchLocation(rawLoc) {
  if (!rawLoc) return null

  const cleaned = cleanLocationString(rawLoc)
  if (!cleaned) return null

  // Exact match first
  if (LOCATION_OPTIONS.includes(cleaned)) {
    return cleaned
  }

  // Case-insensitive match
  const lowerCleaned = cleaned.toLowerCase()
  const exactMatch = LOCATION_OPTIONS.find(opt => opt.toLowerCase() === lowerCleaned)
  if (exactMatch) return exactMatch

  // Partial match - location contains the alias or alias contains location
  const partialMatch = LOCATION_OPTIONS.find(opt => {
    const lowerOpt = opt.toLowerCase()
    return lowerOpt.includes(lowerCleaned) || lowerCleaned.includes(lowerOpt)
  })
  if (partialMatch) return partialMatch

  // No match found - return cleaned string anyway (user can edit)
  return cleaned
}

// Extract locations from a record
function extractLocations(record) {
  const locations = new Set()

  // From sections
  if (Array.isArray(record.sections)) {
    record.sections.forEach(sec => {
      const matched = matchLocation(sec.location)
      if (matched) locations.add(matched)
    })
  }

  // Fallback to rescue_location
  if (record.rescue_location) {
    const matched = matchLocation(record.rescue_location)
    if (matched) locations.add(matched)
  }

  return Array.from(locations).filter(Boolean)
}

// Extract drop-off locations
function extractDropOffs(record) {
  const dropOffs = new Set()

  if (record.drop_off_location) {
    const matched = matchLocation(record.drop_off_location)
    if (matched) dropOffs.add(matched)
  }

  return Array.from(dropOffs).filter(Boolean)
}

// Extract items from a record
function extractItems(record) {
  let items = []

  // Prefer items from sections
  if (Array.isArray(record.sections)) {
    record.sections.forEach(sec => {
      if (Array.isArray(sec.items)) {
        items = items.concat(sec.items)
      }
    })
  }

  // Fallback to top-level items
  if (items.length === 0 && Array.isArray(record.items)) {
    items = record.items
  }

  // Normalize items
  return items.map(item => ({
    name: item.name || '',
    quantity: item.quantity ?? '',
    unit: item.unit || '',
    subcategory: item.subcategory || '',
  })).filter(item => item.name)
}

// Get raw message text for display
function getRawText(record) {
  if (Array.isArray(record.raw_messages)) {
    return record.raw_messages.join('\n\n---\n\n')
  }
  return record.raw_text || record.raw_message || ''
}

// Get a unique ID for a record (Slack browser API uses message_key or ts)
function getRecordId(record) {
  if (!record) return null
  // Try various ID fields that the Slack browser API might use
  return record.message_key || record.id || record.ts || record.slack_ts || null
}

// Group consecutive messages from the same user within a time window
function groupConsecutiveMessages(records, windowMinutes = 60) {
  if (!records.length) return []

  // Sort by timestamp descending (most recent first)
  const sorted = [...records].sort((a, b) => {
    const dateA = new Date(a.start_ts || 0)
    const dateB = new Date(b.start_ts || 0)
    return dateB - dateA
  })

  const grouped = []
  let current = null

  for (const record of sorted) {
    const recordTime = new Date(record.start_ts || 0)
    const currentTime = current ? new Date(current.start_ts || 0) : null

    // Check if should merge with current group
    const sameUser = current && record.user === current.user
    const withinWindow = currentTime && Math.abs(currentTime - recordTime) <= windowMinutes * 60 * 1000

    if (sameUser && withinWindow) {
      // Merge into current group
      current.raw_messages = [
        ...(current.raw_messages || []),
        ...(record.raw_messages || [record.raw_text || record.raw_message || '']),
      ]
      current.items = [...(current.items || []), ...(record.items || [])]
      current.sections = [...(current.sections || []), ...(record.sections || [])]

      // Merge locations
      if (record.rescue_location && !current.rescue_location) {
        current.rescue_location = record.rescue_location
      }
      if (record.drop_off_location && !current.drop_off_location) {
        current.drop_off_location = record.drop_off_location
      }

      // Track all merged IDs using getRecordId
      const recordId = getRecordId(record)
      if (recordId) {
        current._mergedIds = [...(current._mergedIds || []), recordId]
      }

      // Use earlier timestamp as start
      if (recordTime < new Date(current.start_ts)) {
        current.start_ts = record.start_ts
      }
    } else {
      // Start new group
      if (current) {
        grouped.push(current)
      }
      const recordId = getRecordId(record)
      current = {
        ...record,
        raw_messages: record.raw_messages || [record.raw_text || record.raw_message || ''],
        _mergedIds: recordId ? [recordId] : [],
      }
    }
  }

  if (current) {
    grouped.push(current)
  }

  return grouped
}

function ImportApp() {
  const [messages, setMessages] = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saveStatus, setSaveStatus] = useState({ state: 'idle', message: '' })

  // Form state
  const [formData, setFormData] = useState({
    locations: [],
    dropOffs: [],
    date: '',
    items: [],
  })

  // Load messages on mount
  useEffect(() => {
    loadMessages()
  }, [])

  const loadMessages = async () => {
    setLoading(true)
    setError('')

    // Fetch reviewed message IDs first
    const reviewedIds = await fetchReviewedIds()
    const reviewedSet = new Set(reviewedIds)

    const { data, error: err } = await fetchSlackMessage({
      start: 0,
      limit: 5000,
      auditFilter: 'unaudited',
    })

    if (err) {
      setError(err.message || 'Failed to load messages')
      setLoading(false)
      return
    }

    // Filter to only messages with items or sections
    const records = Array.isArray(data?.records) ? data.records : []
    const withContent = records.filter(rec =>
      (Array.isArray(rec.items) && rec.items.length > 0) ||
      (Array.isArray(rec.sections) && rec.sections.length > 0)
    )

    // Group consecutive messages and sort by most recent
    const grouped = groupConsecutiveMessages(withContent, 60)

    // Filter out already-reviewed messages
    const notReviewed = grouped.filter(rec => {
      // Check if any merged IDs are reviewed (all IDs are now in _mergedIds)
      if (Array.isArray(rec._mergedIds) && rec._mergedIds.length > 0) {
        if (rec._mergedIds.some(id => id && reviewedSet.has(id))) return false
      }
      return true
    })

    setMessages(notReviewed)
    setLoading(false)

    if (notReviewed.length > 0) {
      populateForm(notReviewed[0])
    }
  }

  // Populate form from a record
  const populateForm = useCallback((record) => {
    if (!record) return

    setFormData({
      locations: extractLocations(record),
      dropOffs: extractDropOffs(record),
      date: parseDate(record.start_ts),
      items: extractItems(record).length > 0
        ? extractItems(record)
        : [{ name: '', quantity: '', unit: '', subcategory: '' }],
    })
    setSaveStatus({ state: 'idle', message: '' })
  }, [])

  // Navigation
  const goToMessage = useCallback((index) => {
    if (index >= 0 && index < messages.length) {
      setCurrentIndex(index)
      populateForm(messages[index])
    }
  }, [messages, populateForm])

  const goNext = () => goToMessage(currentIndex + 1)
  const goPrev = () => goToMessage(currentIndex - 1)

  // Skip current message (mark as reviewed and move to next)
  const handleSkip = async () => {
    const currentRecord = messages[currentIndex]

    // All IDs are stored in _mergedIds
    const idsToMark = Array.isArray(currentRecord?._mergedIds)
      ? currentRecord._mergedIds.filter(Boolean)
      : []

    // Mark as reviewed in the background
    if (idsToMark.length > 0) {
      markAsReviewed(idsToMark)
    }

    // Remove from current list and move to next
    setMessages(prev => prev.filter((_, i) => i !== currentIndex))

    if (currentIndex >= messages.length - 1) {
      if (messages.length <= 1) {
        setSaveStatus({ state: 'info', message: 'No more messages to review' })
      } else {
        setCurrentIndex(Math.max(0, currentIndex - 1))
        populateForm(messages[currentIndex - 1])
      }
    } else {
      populateForm(messages[currentIndex + 1])
    }
  }

  // Update item field
  const updateItem = (index, field, value) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.map((item, i) =>
        i === index ? { ...item, [field]: value } : item
      ),
    }))
  }

  // Add new item
  const addItem = () => {
    setFormData(prev => ({
      ...prev,
      items: [...prev.items, { name: '', quantity: '', unit: '', subcategory: '' }],
    }))
  }

  // Remove item
  const removeItem = (index) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }))
  }

  // Save current form
  const handleSave = async () => {
    // Validation
    if (formData.locations.length === 0) {
      setSaveStatus({ state: 'error', message: 'Please enter at least one location' })
      return
    }

    const validItems = formData.items.filter(item => item.name.trim())
    if (validItems.length === 0) {
      setSaveStatus({ state: 'error', message: 'Please add at least one item' })
      return
    }

    const itemMissingQty = validItems.find(item => !item.quantity)
    if (itemMissingQty) {
      setSaveStatus({ state: 'error', message: `Please enter quantity for "${itemMissingQty.name}"` })
      return
    }

    setSaveStatus({ state: 'saving', message: 'Saving...' })

    const payload = {
      location: formData.locations.join(', '),
      drop_off: formData.dropOffs.join(', '),
      rescued_at: formData.date,
      items: validItems.map(item => ({
        name: item.name,
        quantity: parseFloat(item.quantity) || null,
        unit: item.unit || null,
        subcategory: item.subcategory || null,
      })),
      source: 'slack',
    }

    const { error: err } = await saveRescueLog(payload)

    if (err) {
      setSaveStatus({ state: 'error', message: err.message || 'Failed to save' })
      return
    }

    setSaveStatus({ state: 'saved', message: 'Saved!' })

    // Mark as reviewed - all IDs are stored in _mergedIds
    const currentRecord = messages[currentIndex]
    const idsToMark = Array.isArray(currentRecord?._mergedIds)
      ? currentRecord._mergedIds.filter(Boolean)
      : []
    if (idsToMark.length > 0) {
      markAsReviewed(idsToMark)
    }

    // Remove from list and move to next
    setTimeout(() => {
      setMessages(prev => prev.filter((_, i) => i !== currentIndex))
      if (currentIndex >= messages.length - 1) {
        setCurrentIndex(Math.max(0, currentIndex - 1))
      }
      if (messages.length > 1) {
        populateForm(messages[currentIndex === messages.length - 1 ? currentIndex - 1 : currentIndex + 1])
      }
    }, 800)
  }

  const currentRecord = messages[currentIndex]

  if (loading) {
    return (
      <div className="import-container">
        <div className="import-loading">Loading messages...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="import-container">
        <div className="import-error">{error}</div>
        <button onClick={loadMessages}>Retry</button>
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className="import-container">
        <div className="import-empty">
          <h2>All Done!</h2>
          <p>No more messages to import.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="import-container">
      <header className="import-header">
        <h1>Import Slack Messages</h1>
        <span className="import-counter">{currentIndex + 1} of {messages.length} remaining</span>
      </header>

      <div className="import-content">
        {/* Raw message display */}
        <div className="import-raw-section">
          <label>Raw Slack Message</label>
          <pre className="import-raw-text">{getRawText(currentRecord)}</pre>
          {currentRecord.start_ts && (
            <div className="import-raw-meta">
              Posted: {new Date(currentRecord.start_ts).toLocaleString()}
              {currentRecord.user && ` by ${currentRecord.user}`}
            </div>
          )}
        </div>

        {/* Form fields */}
        <div className="import-form">
          <div className="import-field">
            <label>Date</label>
            <input
              type="date"
              value={formData.date}
              onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
            />
          </div>

          <div className="import-field">
            <label>Rescued From</label>
            <TagInput
              tags={formData.locations}
              setTags={(locations) => setFormData(prev => ({ ...prev, locations }))}
              suggestions={LOCATION_OPTIONS}
              placeholder="Type location and press Enter"
            />
          </div>

          <div className="import-field">
            <label>Drop Off To</label>
            <TagInput
              tags={formData.dropOffs}
              setTags={(dropOffs) => setFormData(prev => ({ ...prev, dropOffs }))}
              suggestions={DROP_OFF_OPTIONS}
              placeholder="Type location and press Enter"
            />
          </div>

          <div className="import-field">
            <label>Items</label>
            <table className="import-items-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Category</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {formData.items.map((item, idx) => (
                  <tr key={idx}>
                    <td>
                      <input
                        type="text"
                        value={item.name}
                        onChange={(e) => updateItem(idx, 'name', e.target.value)}
                        placeholder="Item name"
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                        placeholder="Qty"
                        step="0.1"
                        min="0"
                      />
                    </td>
                    <td>
                      <select
                        value={item.unit}
                        onChange={(e) => updateItem(idx, 'unit', e.target.value)}
                      >
                        <option value="">Unit</option>
                        {UNIT_OPTIONS.map(u => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={item.subcategory}
                        onChange={(e) => updateItem(idx, 'subcategory', e.target.value)}
                      >
                        <option value="">Category</option>
                        {SUBCATEGORY_OPTIONS.map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="import-remove-btn"
                        onClick={() => removeItem(idx)}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="import-add-btn" onClick={addItem}>
              + Add Item
            </button>
          </div>

          {saveStatus.state !== 'idle' && (
            <div className={`import-status ${saveStatus.state}`}>
              {saveStatus.message}
            </div>
          )}
        </div>
      </div>

      <footer className="import-footer">
        <button
          className="import-nav-btn"
          onClick={goPrev}
          disabled={currentIndex === 0}
        >
          Previous
        </button>
        <button
          className="import-skip-btn"
          onClick={handleSkip}
        >
          Skip
        </button>
        <button
          className="import-save-btn"
          onClick={handleSave}
          disabled={saveStatus.state === 'saving'}
        >
          {saveStatus.state === 'saving' ? 'Saving...' : 'Approve & Save'}
        </button>
      </footer>
    </div>
  )
}

export default ImportApp
