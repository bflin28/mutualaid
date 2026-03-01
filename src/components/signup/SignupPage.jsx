import { useState, useMemo } from 'react'
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'
import { EventCard } from './EventCard'
import { SignupForm } from './SignupForm'
import { useEvents } from '../../hooks/useEvents'
import { DAYS_OF_WEEK } from '../../lib/constants'

/**
 * Get the Monday-based week dates for a given reference date.
 * Returns { weekStart, weekEnd, dates: [Mon..Sun] }
 */
function getWeekDates(refDate) {
  const d = new Date(refDate)
  const day = d.getDay() // 0=Sun, 1=Mon...
  const diff = day === 0 ? -6 : 1 - day // shift to Monday
  const monday = new Date(d)
  monday.setDate(d.getDate() + diff)
  monday.setHours(0, 0, 0, 0)

  const dates = []
  for (let i = 0; i < 7; i++) {
    const dt = new Date(monday)
    dt.setDate(monday.getDate() + i)
    dates.push(dt)
  }

  return {
    weekStart: dates[0],
    weekEnd: dates[6],
    dates,
  }
}

function formatShortDate(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function SignupPage() {
  const { events, loading, reload } = useEvents()
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [weekOffset, setWeekOffset] = useState(0)

  // Current week based on offset
  const today = new Date()
  const refDate = new Date(today)
  refDate.setDate(today.getDate() + weekOffset * 7)
  const week = getWeekDates(refDate)

  // Group events by day_of_week (1=Mon..6=Sat, 0=Sun)
  // Map to our Monday-based array index: Mon=0, Tue=1, ... Sun=6
  const dayGroups = useMemo(() => {
    // day_of_week in DB: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
    // We display Mon-Sun, so reorder: Mon(1) Tue(2) Wed(3) Thu(4) Fri(5) Sat(6) Sun(0)
    const displayOrder = [1, 2, 3, 4, 5, 6, 0]

    return displayOrder.map((dow, idx) => {
      const dayEvents = events
        .filter(e => e.day_of_week === dow)
        .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))

      return {
        dayOfWeek: dow,
        dayName: DAYS_OF_WEEK[dow],
        date: week.dates[idx],
        events: dayEvents,
      }
    })
  }, [events, week.dates])

  // Check if a day is today
  const isToday = (date) => {
    const t = new Date()
    return date.getFullYear() === t.getFullYear() &&
      date.getMonth() === t.getMonth() &&
      date.getDate() === t.getDate()
  }

  // Check if a day is in the past
  const isPast = (date) => {
    const t = new Date()
    t.setHours(0, 0, 0, 0)
    return date < t
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gray-400">Loading schedule...</div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-gray-900">Volunteer Schedule</h2>
        <p className="text-gray-500 mt-1">
          Sign up for weekly food rescue pickups
        </p>
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

      {/* Weekly schedule */}
      <div className="space-y-2">
        {dayGroups.map(group => {
          const dayIsToday = isToday(group.date)
          const dayIsPast = isPast(group.date)
          const hasEvents = group.events.length > 0
          const dateStr = group.date.toISOString().slice(0, 10)

          return (
            <div
              key={group.dayOfWeek}
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
                hasEvents ? 'border-b border-gray-100' : ''
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`text-center w-12 ${dayIsToday ? 'text-green-700' : dayIsPast ? 'text-gray-400' : 'text-gray-700'}`}>
                    <div className="text-xs font-medium uppercase tracking-wide">
                      {group.dayName.slice(0, 3)}
                    </div>
                    <div className={`text-lg font-bold ${dayIsToday ? '' : ''}`}>
                      {group.date.getDate()}
                    </div>
                  </div>
                  {dayIsToday && (
                    <span className="text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                      Today
                    </span>
                  )}
                </div>
                {!hasEvents && (
                  <span className="text-xs text-gray-400">No events</span>
                )}
                {hasEvents && (
                  <span className="text-xs text-gray-500">
                    {group.events.length} event{group.events.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>

              {/* Events for this day */}
              {hasEvents && (
                <div className="divide-y divide-gray-100">
                  {group.events.map(event => (
                    <EventCard
                      key={event.id}
                      event={event}
                      occurrenceDate={dateStr}
                      dimmed={dayIsPast}
                      onSignUp={() => setSelectedEvent({ ...event, next_occurrence: dateStr })}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Signup modal */}
      {selectedEvent && (
        <SignupForm
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onSuccess={() => {
            setSelectedEvent(null)
            reload()
          }}
        />
      )}
    </div>
  )
}
