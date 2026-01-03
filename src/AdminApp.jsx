import { useEffect, useMemo, useState } from 'react'
import './admin.css'
import { fetchPendingSignups, updateSignupStatus } from './lib/pickupApi'

const formatDate = (timestamp) => {
  if (!timestamp) return '—'
  return new Date(timestamp).toLocaleString()
}

function AdminApp() {
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
    <div className="admin-app">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Admin Review</p>
          <h1>Pickup Approvals</h1>
          <p className="subtitle">Approve or decline volunteer signups before slots are confirmed.</p>
        </div>
        <div className="admin-header-actions">
          <a className="nav-button" href="/">← Open volunteer view</a>
          <button className="nav-button" onClick={loadPending}>↻ Refresh</button>
        </div>
      </header>

      <div className="admin-panels">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h3>Pending signups</h3>
              <p>Queued for manual approval</p>
            </div>
            <span className="badge neutral">{pending?.length ?? 0}</span>
          </div>

          {error && (
            <div className="alert error">
              <strong>Supabase error:</strong> {error}
            </div>
          )}

          {loading && <div className="loading">Loading…</div>}

          {!loading && hasNoPending && !error && (
            <div className="empty-state">
              <p>No pending signups right now.</p>
            </div>
          )}

          <div className="signup-list">
            {pending?.map((row) => (
              <div className="signup-card" key={row.id}>
                <div className="card-top">
                  <div>
                    <div className="store-line">{row.store} — {row.day} @ {row.time}</div>
                    <div className="slot-line">Slot key: {row.slot_key}</div>
                    <div className="slot-line subtle">Submitted: {formatDate(row.created_at)}</div>
                  </div>
                  <span className="badge pending">Pending</span>
                </div>

                <div className="card-details">
                  <div>
                    <strong>Volunteer:</strong> {row.volunteer_name || 'N/A'}
                  </div>
                  <div>
                    <strong>Email:</strong> {row.volunteer_email || '—'}
                  </div>
                  <div>
                    <strong>Phone:</strong> {row.volunteer_phone || '—'}
                  </div>
                  <div>
                    <strong>Notes:</strong> {row.notes || '—'}
                  </div>
                </div>

                <div className="card-actions">
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
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

export default AdminApp
