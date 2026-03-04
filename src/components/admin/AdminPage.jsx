import { useState, useEffect, useMemo } from 'react'
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Clock, MapPin, Package, Trash2, UserPlus, RotateCw } from 'lucide-react'
import { fetchEvents, fetchFoodLogs, fetchAllowedEmails, inviteUser, resendInvite, deleteAllowedEmail, verifyAdminPassword } from '../../lib/api'
import { DAYS_OF_WEEK } from '../../lib/constants'
import { StatCard } from '../statistics/StatCard'
import { toast } from 'sonner'

// ── Utilities ──────────────────────────────────────────────

function getWeekDates(refDate) {
  const d = new Date(refDate)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(d)
  monday.setDate(d.getDate() + diff)
  monday.setHours(0, 0, 0, 0)
  const dates = []
  for (let i = 0; i < 7; i++) {
    const dt = new Date(monday)
    dt.setDate(monday.getDate() + i)
    dates.push(dt)
  }
  return { weekStart: dates[0], weekEnd: dates[6], dates }
}

function formatShortDate(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatTime(timeStr) {
  if (!timeStr) return ''
  const [h, m] = timeStr.split(':')
  const hour = parseInt(h)
  const ampm = hour >= 12 ? 'pm' : 'am'
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
  return m === '00' ? `${h12}${ampm}` : `${h12}:${m}${ampm}`
}

/** Convert a rescued_at timestamp to local YYYY-MM-DD */
function toLocalDate(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return formatDate(d)
}

const SLACK_CHANNELS = {
  'C026VATTHDE': '#urban-canopy-log',
  'C031JSTNV6H': '#keystone-log',
}

// ── Matching Logic ─────────────────────────────────────────

// Map event names to the rescue_location_name that should match
const EVENT_NAME_OVERRIDES = {
  'keystone food delivery': 'nws',
}

function matchEventToLogs(event, logsForDay) {
  const eventName = event.name.toLowerCase().trim()
  const matchName = EVENT_NAME_OVERRIDES[eventName] || eventName
  return logsForDay.filter(log => {
    const logLoc = (log.rescue_location_name || '').toLowerCase().trim()
    if (!logLoc) return false
    // Exact match
    if (logLoc === matchName) return true
    // Contained match (handles "Aldi Belmont" matching event "Aldi Belmont")
    if (logLoc.includes(matchName) || matchName.includes(logLoc)) return true
    return false
  })
}

// ── Sub-components ─────────────────────────────────────────

function ItemsTable({ items }) {
  if (!items || items.length === 0) return null
  return (
    <table className="w-full text-sm mt-2">
      <thead>
        <tr className="text-left text-gray-500 text-xs">
          <th className="pb-1 font-medium">Item</th>
          <th className="pb-1 font-medium text-right">Qty</th>
          <th className="pb-1 font-medium pl-2">Unit</th>
          <th className="pb-1 font-medium pl-3">Category</th>
          <th className="pb-1 font-medium text-right">Est. Lbs</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, i) => (
          <tr key={i} className="border-t border-gray-50">
            <td className="py-1 text-gray-700">{item.name}</td>
            <td className="py-1 text-right text-gray-600">{item.quantity}</td>
            <td className="py-1 pl-2 text-gray-500">{item.unit}</td>
            <td className="py-1 pl-3">
              {item.gcfd_category && (
                <span className="text-xs bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded">
                  {item.gcfd_category}
                </span>
              )}
            </td>
            <td className="py-1 text-right text-gray-600">
              {item.estimated_lbs != null ? item.estimated_lbs.toLocaleString() : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function LogDetail({ log }) {
  const channel = SLACK_CHANNELS[log.slack_channel] || log.slack_channel
  return (
    <div className="bg-gray-50 rounded-lg p-3 mt-2">
      <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
        <span>{log.rescued_at?.slice(0, 10)}</span>
        <span className="font-medium text-gray-700">{log.rescue_location_name}</span>
        <span className="text-gray-400">→</span>
        <span className="text-gray-600">{log.drop_off_location_name || '?'}</span>
        {channel && (
          <span className="bg-green-50 text-green-700 px-1.5 py-0.5 rounded text-xs">
            {channel}
          </span>
        )}
        <span className="ml-auto font-semibold text-green-700">
          {log.total_estimated_lbs?.toLocaleString()} lbs
        </span>
      </div>
      <ItemsTable items={log.items} />
      {log.raw_text && (
        <details className="mt-2">
          <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
            Raw Slack text · {log.classification} {channel && <span className="ml-1 bg-green-50 text-green-700 px-1 py-0.5 rounded">{channel}</span>}
          </summary>
          <pre className="mt-1 text-xs text-gray-600 bg-white border border-gray-200 rounded p-2 whitespace-pre-wrap max-h-40 overflow-y-auto">
            {log.raw_text}
          </pre>
        </details>
      )}
    </div>
  )
}

function EventSlot({ event, matchedLogs, dimmed }) {
  const [expanded, setExpanded] = useState(false)
  const hasLogs = matchedLogs.length > 0
  const totalLbs = matchedLogs.reduce((sum, l) => sum + (l.total_estimated_lbs || 0), 0)
  const totalItems = matchedLogs.reduce((sum, l) => sum + (l.items?.length || 0), 0)

  return (
    <div className={`${dimmed ? 'opacity-60' : ''}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        {/* Time */}
        <div className="flex items-center gap-1 text-xs text-gray-400 w-20 shrink-0">
          <Clock className="w-3 h-3" />
          {formatTime(event.start_time)}
          {event.end_time && <span>–{formatTime(event.end_time)}</span>}
        </div>

        {/* Event name */}
        <div className="font-medium text-gray-800 flex-1 min-w-0 truncate">
          {event.name}
        </div>

        {/* Status badge */}
        {hasLogs ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold bg-green-100 text-green-700 px-2 py-1 rounded-full whitespace-nowrap">
            ✓ {totalLbs.toLocaleString()} lbs · {totalItems} items
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-semibold bg-red-100 text-red-600 px-2 py-1 rounded-full">
            ✗ Missing
          </span>
        )}

        {/* Expand icon */}
        {hasLogs && (
          expanded
            ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
            : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
        )}
      </button>

      {/* Expanded log details */}
      {expanded && hasLogs && (
        <div className="px-4 pb-3">
          {matchedLogs.map(log => (
            <LogDetail key={log.id} log={log} />
          ))}
        </div>
      )}
    </div>
  )
}

function UnscheduledLogs({ logs }) {
  const [expanded, setExpanded] = useState(false)
  if (logs.length === 0) return null

  return (
    <div className="border-t border-dashed border-gray-200 mt-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="text-xs text-gray-400 flex-1">
          + {logs.length} unscheduled rescue{logs.length !== 1 ? 's' : ''} this day
        </div>
        {expanded
          ? <ChevronUp className="w-4 h-4 text-gray-400" />
          : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {logs.map(log => (
            <div key={log.id} className="flex items-center gap-3 text-sm py-1">
              <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">unscheduled</span>
              <span className="font-medium text-gray-700">{log.rescue_location_name}</span>
              <span className="text-gray-400">→</span>
              <span className="text-gray-500">{log.drop_off_location_name || '?'}</span>
              <span className="ml-auto text-xs font-semibold text-gray-600">
                {log.total_estimated_lbs?.toLocaleString()} lbs
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────

export function AdminPage() {
  // Admin password gate
  const [adminPassword, setAdminPassword] = useState(() => sessionStorage.getItem('adminPw') || '')
  const [authenticated, setAuthenticated] = useState(false)
  const [pwInput, setPwInput] = useState('')
  const [pwLoading, setPwLoading] = useState(false)

  const [events, setEvents] = useState([])
  const [foodLogs, setFoodLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [weekOffset, setWeekOffset] = useState(0)

  // Allowed emails state
  const [allowedEmails, setAllowedEmails] = useState([])
  const [newEmail, setNewEmail] = useState('')
  const [userLoading, setUserLoading] = useState(false)

  // Verify stored admin password on mount
  useEffect(() => {
    if (adminPassword) {
      verifyAdminPassword(adminPassword)
        .then(() => setAuthenticated(true))
        .catch(() => {
          sessionStorage.removeItem('adminPw')
          setAdminPassword('')
        })
    }
  }, [])

  const handleAdminLogin = async (e) => {
    e.preventDefault()
    setPwLoading(true)
    try {
      await verifyAdminPassword(pwInput)
      setAdminPassword(pwInput)
      sessionStorage.setItem('adminPw', pwInput)
      setAuthenticated(true)
    } catch {
      toast.error('Invalid admin password')
    }
    setPwLoading(false)
  }

  // Fetch data once authenticated
  useEffect(() => {
    if (!authenticated) return
    setLoading(true)
    Promise.all([
      fetchEvents(),
      fetchFoodLogs({ limit: 10000 }),
    ])
      .then(([evts, logsResult]) => {
        setEvents(evts)
        const logs = Array.isArray(logsResult) ? logsResult : logsResult.data || []
        setFoodLogs(logs.filter(l => l.record_type !== 'inventory'))
      })
      .catch(err => console.error('Admin data fetch failed:', err))
      .finally(() => setLoading(false))

    fetchAllowedEmails(adminPassword)
      .then(setAllowedEmails)
      .catch(err => console.error('Failed to load allowed emails:', err))
  }, [authenticated])

  const handleInviteUser = async (e) => {
    e.preventDefault()
    if (!newEmail.trim()) return
    setUserLoading(true)
    try {
      const added = await inviteUser(newEmail.trim(), adminPassword)
      setAllowedEmails(prev => [added, ...prev])
      setNewEmail('')
      toast.success(`Invite sent to ${added.email}`)
    } catch (err) {
      toast.error(err.message)
    }
    setUserLoading(false)
  }

  const handleResendInvite = async (email) => {
    try {
      await resendInvite(email, adminPassword)
      toast.success(`Invite resent to ${email}`)
    } catch (err) {
      toast.error(err.message)
    }
  }

  const handleDeleteEmail = async (id, email) => {
    try {
      await deleteAllowedEmail(id, adminPassword)
      setAllowedEmails(prev => prev.filter(e => e.id !== id))
      toast.success(`Removed ${email}`)
    } catch (err) {
      toast.error(err.message)
    }
  }

  // Week navigation
  const today = new Date()
  const refDate = new Date(today)
  refDate.setDate(today.getDate() + weekOffset * 7)
  const week = getWeekDates(refDate)

  const isToday = (date) => {
    const t = new Date()
    return date.getFullYear() === t.getFullYear() &&
      date.getMonth() === t.getMonth() &&
      date.getDate() === t.getDate()
  }

  const isPast = (date) => {
    const t = new Date()
    t.setHours(0, 0, 0, 0)
    return date < t
  }

  // Build day-by-day coverage data
  const coverage = useMemo(() => {
    const displayOrder = [1, 2, 3, 4, 5, 6, 0] // Mon..Sun
    let totalScheduled = 0
    let totalLogged = 0
    let totalLbs = 0

    const days = displayOrder.map((dow, idx) => {
      const date = week.dates[idx]
      const dateStr = formatDate(date)

      // Events for this day of week
      const dayEvents = events
        .filter(e => e.day_of_week === dow)
        .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))

      // Food logs for this calendar date (convert to local time)
      const dayLogs = foodLogs.filter(l => toLocalDate(l.rescued_at) === dateStr)

      // Match events to logs
      const matchedLogIds = new Set()
      const slots = dayEvents.map(event => {
        const matched = matchEventToLogs(event, dayLogs)
        matched.forEach(l => matchedLogIds.add(l.id))
        return { event, matchedLogs: matched }
      })

      // Unscheduled logs (didn't match any event)
      const unscheduled = dayLogs.filter(l => !matchedLogIds.has(l.id))

      // Stats
      totalScheduled += dayEvents.length
      const loggedCount = slots.filter(s => s.matchedLogs.length > 0).length
      totalLogged += loggedCount
      totalLbs += dayLogs.reduce((sum, l) => sum + (l.total_estimated_lbs || 0), 0)

      return { dow, dayName: DAYS_OF_WEEK[dow], date, dateStr, slots, unscheduled }
    })

    const coveragePct = totalScheduled > 0
      ? Math.round((totalLogged / totalScheduled) * 100)
      : 0

    return {
      days,
      summary: { totalScheduled, totalLogged, totalMissing: totalScheduled - totalLogged, coveragePct, totalLbs },
    }
  }, [events, foodLogs, week.dates])

  // Admin password gate
  if (!authenticated) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <img src="/favicon.png" alt="CFSC" className="w-12 h-12 mx-auto mb-3" />
            <h1 className="text-xl font-semibold text-gray-900">Admin Access</h1>
            <p className="text-sm text-gray-500 mt-1">Enter the admin password to continue</p>
          </div>
          <form
            onSubmit={handleAdminLogin}
            className="bg-white border border-gray-200 rounded-lg p-6 space-y-4 shadow-sm"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Admin Password</label>
              <input
                type="password"
                required
                value={pwInput}
                onChange={(e) => setPwInput(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm
                  focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>
            <button
              type="submit"
              disabled={pwLoading}
              className="w-full py-2.5 bg-green-600 text-white font-medium rounded-md
                hover:bg-green-700 disabled:opacity-50 transition-colors text-sm"
            >
              {pwLoading ? 'Verifying...' : 'Continue'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gray-400">Loading admin data...</div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-gray-900">Rescue Coverage</h2>
        <p className="text-gray-500 mt-1">
          Scheduled events vs. actual food logs — per rescue, per day
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard
          title="SCHEDULED"
          value={coverage.summary.totalScheduled}
          subtitle="events this week"
          color="blue"
        />
        <StatCard
          title="LOGGED"
          value={coverage.summary.totalLogged}
          subtitle="with food logs"
          color="green"
        />
        <StatCard
          title="MISSING"
          value={coverage.summary.totalMissing}
          subtitle="no log found"
          color={coverage.summary.totalMissing > 0 ? 'red' : 'green'}
        />
        <StatCard
          title="COVERAGE"
          value={`${coverage.summary.coveragePct}%`}
          subtitle={`${coverage.summary.totalLbs.toLocaleString()} lbs rescued`}
          color={coverage.summary.coveragePct >= 80 ? 'green' : coverage.summary.coveragePct >= 50 ? 'orange' : 'red'}
        />
      </div>

      {/* Week navigator */}
      <div className="flex items-center justify-between mb-6 bg-white border border-gray-200 rounded-lg px-4 py-3 shadow-sm">
        <button
          onClick={() => setWeekOffset(w => w - 1)}
          className="p-1 hover:bg-gray-100 rounded-md transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div className="text-center">
          <div className="text-sm font-semibold text-gray-900">
            {formatShortDate(week.weekStart)} — {formatShortDate(week.weekEnd)}
          </div>
          {weekOffset !== 0 && (
            <button
              onClick={() => setWeekOffset(0)}
              className="text-xs text-green-600 hover:text-green-700 mt-0.5"
            >
              Jump to this week
            </button>
          )}
        </div>
        <button
          onClick={() => setWeekOffset(w => w + 1)}
          className="p-1 hover:bg-gray-100 rounded-md transition-colors"
        >
          <ChevronRight className="w-5 h-5 text-gray-600" />
        </button>
      </div>

      {/* Day-by-day schedule with coverage */}
      <div className="space-y-2">
        {coverage.days.map(day => {
          const dayIsToday = isToday(day.date)
          const dayIsPast = isPast(day.date)
          const hasSlots = day.slots.length > 0
          const loggedCount = day.slots.filter(s => s.matchedLogs.length > 0).length
          const missedCount = day.slots.length - loggedCount

          return (
            <div
              key={day.dow}
              className={`rounded-lg border transition-colors ${
                dayIsToday
                  ? 'border-green-300 bg-green-50/50'
                  : dayIsPast
                    ? 'border-gray-100 bg-gray-50/50'
                    : 'border-gray-200 bg-white'
              }`}
            >
              {/* Day header */}
              <div className={`flex items-center justify-between px-4 py-3 ${
                hasSlots || day.unscheduled.length > 0 ? 'border-b border-gray-100' : ''
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`text-center w-12 ${dayIsToday ? 'text-green-700' : dayIsPast ? 'text-gray-400' : 'text-gray-700'}`}>
                    <div className="text-xs font-medium uppercase tracking-wide">
                      {day.dayName.slice(0, 3)}
                    </div>
                    <div className="text-lg font-bold">
                      {day.date.getDate()}
                    </div>
                  </div>
                  {dayIsToday && (
                    <span className="text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                      Today
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {hasSlots ? (
                    <>
                      {loggedCount > 0 && (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                          {loggedCount} logged
                        </span>
                      )}
                      {missedCount > 0 && (
                        <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">
                          {missedCount} missing
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-gray-400">No events</span>
                  )}
                </div>
              </div>

              {/* Event slots */}
              {hasSlots && (
                <div className="divide-y divide-gray-100">
                  {day.slots.map(slot => (
                    <EventSlot
                      key={slot.event.id}
                      event={slot.event}
                      matchedLogs={slot.matchedLogs}
                      dimmed={dayIsPast}
                    />
                  ))}
                </div>
              )}

              {/* Unscheduled rescues */}
              <UnscheduledLogs logs={day.unscheduled} />
            </div>
          )
        })}
      </div>

      {/* Manage Access section */}
      <div className="mt-10 border-t border-gray-200 pt-8">
        <h3 className="text-lg font-semibold text-gray-900 mb-1">Manage Access</h3>
        <p className="text-sm text-gray-500 mb-4">
          Invite users by email. They'll receive a link to set their own password.
        </p>

        <form onSubmit={handleInviteUser} className="flex flex-col sm:flex-row gap-2 mb-4">
          <input
            type="email"
            required
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="email@example.com"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm
              focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
          <button
            type="submit"
            disabled={userLoading}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-green-600 text-white text-sm font-medium
              rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            Send Invite
          </button>
        </form>

        {allowedEmails.length === 0 ? (
          <p className="text-sm text-gray-400">No users yet.</p>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
            {allowedEmails.map(entry => (
              <div key={entry.id} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-sm text-gray-800">{entry.email}</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleResendInvite(entry.email)}
                    className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors"
                    title="Resend invite"
                  >
                    <RotateCw className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteEmail(entry.id, entry.email)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                    title="Remove"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
