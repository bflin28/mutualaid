import { MapPin } from 'lucide-react'

export function EventCard({ event, occurrenceDate, dimmed, onSignUp }) {
  const isFull = event.spots_remaining <= 0

  const formatTime = (time) => {
    if (!time) return ''
    const [h, m] = time.split(':')
    const hour = parseInt(h)
    const ampm = hour >= 12 ? 'pm' : 'am'
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour
    return m === '00' ? `${displayHour}${ampm}` : `${displayHour}:${m}${ampm}`
  }

  const timeRange = [formatTime(event.start_time), formatTime(event.end_time)]
    .filter(Boolean)
    .join(' – ')

  const spotsText = event.capacity > 1
    ? `${event.spots_remaining}/${event.capacity} spots`
    : event.spots_remaining > 0
      ? 'Open'
      : 'Full'

  const spotsBadge = (
    <span className={`shrink-0 text-xs px-1.5 py-0.5 rounded-full font-medium ${
      isFull ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-700'
    }`}>
      {spotsText}
    </span>
  )

  const signUpButton = (
    <button
      onClick={onSignUp}
      disabled={isFull || dimmed}
      className={`shrink-0 px-3 py-1.5 text-xs font-semibold rounded-full transition-colors ${
        isFull || dimmed
          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
          : 'bg-green-600 text-white hover:bg-green-700'
      }`}
    >
      {isFull ? 'Full' : 'Sign Up'}
    </button>
  )

  return (
    <div className={`px-4 py-3 ${dimmed ? 'opacity-50' : 'hover:bg-gray-50'} transition-colors`}>
      {/* Desktop: row layout | Mobile: stacked */}

      {/* Desktop row (hidden on mobile) */}
      <div className="hidden sm:flex items-start gap-3">
        <div className="shrink-0 w-28 text-right pt-0.5">
          <span className="text-sm font-medium text-gray-700">{timeRange}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-900 truncate">{event.name}</span>
            {spotsBadge}
          </div>
          {event.address && (
            <div className="flex items-center gap-1 mt-0.5">
              <MapPin className="w-3 h-3 text-gray-400 shrink-0" />
              <span className="text-xs text-gray-500 truncate">{event.address}</span>
            </div>
          )}
          {event.notes && (
            <p className="text-xs text-amber-600 mt-0.5">{event.notes}</p>
          )}
        </div>
        {signUpButton}
      </div>

      {/* Mobile stacked (hidden on desktop) */}
      <div className="sm:hidden">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-gray-900">{event.name}</span>
              {spotsBadge}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">{timeRange}</div>
            {event.address && (
              <div className="flex items-center gap-1 mt-0.5">
                <MapPin className="w-3 h-3 text-gray-400 shrink-0" />
                <span className="text-xs text-gray-500">{event.address}</span>
              </div>
            )}
            {event.notes && (
              <p className="text-xs text-amber-600 mt-0.5">{event.notes}</p>
            )}
          </div>
          {signUpButton}
        </div>
      </div>
    </div>
  )
}
