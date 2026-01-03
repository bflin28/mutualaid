import { useEffect, useMemo, useState } from 'react'
import { fetchPendingSignups, updateSignupStatus } from './lib/pickupApi'

const formatDateTime = (timestamp) => {
  if (!timestamp) return '—'
  return new Date(timestamp).toLocaleString()
}

const formatDateOnly = (dateStr) => {
  if (!dateStr) return '—'
  const parts = dateStr.split('-').map((p) => parseInt(p, 10))
  if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
    const dt = new Date(parts[0], parts[1] - 1, parts[2])
    return dt.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
  }
  return dateStr
}

function ReviewApp() {
  const [pending, setPending] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [actionState, setActionState] = useState({ id: null, status: null })

  const loadPending = async () => {
    setLoading(true)
    setError(null)
    const { data, error: queryError } = await fetchPendingSignups()
    if (queryError) {
      setError(queryError.message || 'Unable to load pending signups.')
      setPending([])
    } else {
      setPending(data || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    loadPending()
  }, [])

  const handleStatusChange = async (id, status) => {
    setActionState({ id, status })
    const { error: updateError } = await updateSignupStatus(id, status)
    if (updateError) {
      setError(updateError.message || 'Could not update signup.')
    } else {
      await loadPending()
    }
    setActionState({ id: null, status: null })
  }

  const hasNoPending = useMemo(() => !pending || pending.length === 0, [pending])

  return (
    <div className="review-app">
      <header className="review-header">
        <div>
          <p className="eyebrow">Pending approvals</p>
          <h1>Pickup Signups</h1>
        </div>
        <button className="refresh-btn" onClick={loadPending}>Refresh</button>
      </header>

      {error && (
        <div className="alert error">
          <strong>Supabase error:</strong> {error}
        </div>
      )}

      {loading && <div className="loading">Loading pending signups…</div>}

      {!loading && hasNoPending && !error && (
        <div className="empty-state">No pending signups.</div>
      )}

      {!loading && !hasNoPending && (
        <div className="table-wrapper">
          <table className="pending-table">
            <thead>
              <tr>
                <th>Store / Slot</th>
                <th>Day / Time</th>
                <th>Volunteer</th>
                <th>Contact</th>
                <th>Notes</th>
                <th>Submitted</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="cell-title">{row.store || '—'}</div>
                    <div className="cell-sub">Slot: {row.slot_key}</div>
                    <div className="cell-sub">{row.address || '—'}</div>
                  </td>
                  <td>
                    <div className="cell-title">{formatDateOnly(row.occurrence_date)}</div>
                    <div className="cell-sub">{row.time || row.day || '—'}</div>
                  </td>
                  <td className="cell-title">{row.volunteer_name || '—'}</td>
                  <td>
                    <div className="cell-sub">{row.volunteer_email || '—'}</div>
                    <div className="cell-sub">{row.volunteer_phone || ''}</div>
                  </td>
                  <td className="cell-notes">{row.notes || '—'}</td>
                  <td>{formatDateTime(row.created_at)}</td>
                  <td className="actions-cell">
                    <button
                      className="approve"
                      onClick={() => handleStatusChange(row.id, 'approved')}
                      disabled={actionState.id === row.id}
                    >
                      {actionState.id === row.id && actionState.status === 'approved' ? 'Approving…' : 'Approve'}
                    </button>
                    <button
                      className="decline"
                      onClick={() => handleStatusChange(row.id, 'declined')}
                      disabled={actionState.id === row.id}
                    >
                      {actionState.id === row.id && actionState.status === 'declined' ? 'Declining…' : 'Decline'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default ReviewApp
