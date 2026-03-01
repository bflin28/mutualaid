import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { X, Search, ChevronDown, ChevronRight, ArrowUpRight, ArrowDownLeft, ArrowUpDown } from 'lucide-react'
import LOCATIONS from '../../data/locationCoordinates'

const TYPE_COLORS = {
  rescue: '#34d399',
  warehouse: '#fb923c',
  distribution: '#a78bfa',
}

const TYPE_LABELS = {
  rescue: 'Rescue',
  warehouse: 'Warehouse',
  distribution: 'Distribution',
}

function formatLbs(lbs) {
  if (lbs >= 1000) return `${(lbs / 1000).toFixed(1)}k`
  return Math.round(lbs).toLocaleString()
}

export function LocationsPanel({ open, onClose, locationTotals, flows, selectedLocation, onSelectLocation }) {
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState('totalLbs')
  const [sortDir, setSortDir] = useState('desc')
  const [expandedRows, setExpandedRows] = useState(new Set())
  const rowRefs = useRef({})

  // Merge locationTotals with LOCATIONS data
  const locationRows = useMemo(() => {
    return Object.entries(locationTotals).map(([name, data]) => {
      const coords = LOCATIONS[name]
      return {
        name,
        type: coords?.type || data.type || 'rescue',
        totalLbs: data.totalLbs,
        tripCount: data.tripCount,
        address: coords?.address || null,
        categories: data.categories || {},
      }
    })
  }, [locationTotals])

  // Filter by search
  const filteredRows = useMemo(() => {
    if (!search.trim()) return locationRows
    const q = search.toLowerCase()
    return locationRows.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.type.toLowerCase().includes(q) ||
      (r.address && r.address.toLowerCase().includes(q))
    )
  }, [locationRows, search])

  // Sort
  const sortedRows = useMemo(() => {
    const sorted = [...filteredRows]
    sorted.sort((a, b) => {
      let cmp = 0
      if (sortCol === 'name') {
        cmp = a.name.localeCompare(b.name)
      } else if (sortCol === 'type') {
        cmp = a.type.localeCompare(b.type)
      } else if (sortCol === 'totalLbs') {
        cmp = a.totalLbs - b.totalLbs
      } else if (sortCol === 'tripCount') {
        cmp = a.tripCount - b.tripCount
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [filteredRows, sortCol, sortDir])

  // Get connections for a location
  const getConnectionsFor = useCallback((locationName) => {
    const inbound = flows
      .filter(f => f.to === locationName)
      .sort((a, b) => b.totalLbs - a.totalLbs)
    const outbound = flows
      .filter(f => f.from === locationName)
      .sort((a, b) => b.totalLbs - a.totalLbs)
    return { inbound, outbound }
  }, [flows])

  // Toggle sort
  const toggleSort = (col) => {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir(col === 'name' ? 'asc' : 'desc')
    }
  }

  // Toggle expanded row
  const toggleExpanded = (name) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  // Handle row click — select on map + toggle expansion
  const handleRowClick = (name) => {
    onSelectLocation(selectedLocation === name ? null : name)
    toggleExpanded(name)
  }

  // Auto-scroll to selected location when map marker is clicked
  useEffect(() => {
    if (selectedLocation && open && rowRefs.current[selectedLocation]) {
      rowRefs.current[selectedLocation].scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
      // Also expand the row
      setExpandedRows(prev => {
        const next = new Set(prev)
        next.add(selectedLocation)
        return next
      })
    }
  }, [selectedLocation, open])

  const sortArrow = (col) => {
    if (sortCol !== col) return <ArrowUpDown className="w-3 h-3 text-slate-600 inline ml-1" />
    return (
      <span className="inline ml-1 text-sky-400">
        {sortDir === 'asc' ? '↑' : '↓'}
      </span>
    )
  }

  return (
    <div
      className={`fixed top-0 right-0 h-full z-[1002] transition-transform duration-300 ease-in-out
        ${open ? 'translate-x-0' : 'translate-x-full'}
        w-[420px] max-w-[85vw] flex flex-col`}
      style={{
        background: 'rgba(15, 23, 42, 0.95)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: '-8px 0 40px rgba(0, 0, 0, 0.5)',
      }}
    >
      {/* Header */}
      <div className="p-4 border-b border-white/10 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white tracking-wider uppercase">
            All Locations
            <span className="text-slate-500 font-normal ml-2 normal-case tracking-normal">
              {sortedRows.length}
            </span>
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4 text-slate-400 hover:text-white" />
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search locations..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg text-sm
              bg-slate-800/60 border border-white/10 text-slate-200
              placeholder-slate-500 focus:outline-none focus:border-sky-400/50
              focus:ring-2 focus:ring-sky-400/20 transition-all"
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto locations-panel">
        <table className="w-full">
          <thead className="sticky top-0 z-10">
            <tr style={{ background: 'rgba(15, 23, 42, 0.98)' }}>
              <th
                className="text-left text-[10px] font-semibold tracking-wider uppercase text-slate-400
                  px-3 py-2.5 cursor-pointer hover:text-slate-200 transition-colors border-b border-white/10"
                onClick={() => toggleSort('name')}
              >
                Name {sortArrow('name')}
              </th>
              <th
                className="text-left text-[10px] font-semibold tracking-wider uppercase text-slate-400
                  px-2 py-2.5 cursor-pointer hover:text-slate-200 transition-colors border-b border-white/10"
                onClick={() => toggleSort('type')}
              >
                Type {sortArrow('type')}
              </th>
              <th
                className="text-right text-[10px] font-semibold tracking-wider uppercase text-slate-400
                  px-3 py-2.5 cursor-pointer hover:text-slate-200 transition-colors border-b border-white/10"
                onClick={() => toggleSort('totalLbs')}
              >
                Lbs {sortArrow('totalLbs')}
              </th>
              <th
                className="text-right text-[10px] font-semibold tracking-wider uppercase text-slate-400
                  px-3 py-2.5 cursor-pointer hover:text-slate-200 transition-colors border-b border-white/10"
                onClick={() => toggleSort('tripCount')}
              >
                Trips {sortArrow('tripCount')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map(loc => {
              const isSelected = selectedLocation === loc.name
              const isExpanded = expandedRows.has(loc.name)
              const color = TYPE_COLORS[loc.type]

              return (
                <LocationRow
                  key={loc.name}
                  loc={loc}
                  color={color}
                  isSelected={isSelected}
                  isExpanded={isExpanded}
                  onRowClick={handleRowClick}
                  getConnectionsFor={getConnectionsFor}
                  onSelectLocation={onSelectLocation}
                  rowRef={el => { rowRefs.current[loc.name] = el }}
                />
              )
            })}
          </tbody>
        </table>

        {sortedRows.length === 0 && (
          <div className="text-center text-slate-500 text-sm py-12">
            No locations match "{search}"
          </div>
        )}
      </div>
    </div>
  )
}

function LocationRow({ loc, color, isSelected, isExpanded, onRowClick, getConnectionsFor, onSelectLocation, rowRef }) {
  const { inbound, outbound } = isExpanded ? getConnectionsFor(loc.name) : { inbound: [], outbound: [] }
  const totalConnections = isExpanded ? inbound.length + outbound.length : 0

  return (
    <>
      <tr
        ref={rowRef}
        onClick={() => onRowClick(loc.name)}
        className={`border-b border-white/5 cursor-pointer transition-colors duration-150
          ${isSelected
            ? 'bg-white/10'
            : 'hover:bg-white/5'}`}
      >
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2">
            {isExpanded
              ? <ChevronDown className="w-3 h-3 text-slate-500 shrink-0" />
              : <ChevronRight className="w-3 h-3 text-slate-500 shrink-0" />
            }
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: color, boxShadow: `0 0 8px ${color}60` }}
            />
            <span className="text-sm text-slate-200 truncate max-w-[140px]">{loc.name}</span>
          </div>
        </td>
        <td className="px-2 py-2.5">
          <span
            className="text-[10px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded"
            style={{ backgroundColor: `${color}15`, color }}
          >
            {TYPE_LABELS[loc.type]}
          </span>
        </td>
        <td className="px-3 py-2.5 text-sm text-slate-200 text-right font-medium tabular-nums">
          {formatLbs(loc.totalLbs)}
        </td>
        <td className="px-3 py-2.5 text-sm text-slate-400 text-right tabular-nums">
          {loc.tripCount}
        </td>
      </tr>

      {/* Expanded details */}
      {isExpanded && (
        <tr>
          <td colSpan={4} className="px-4 py-3" style={{ background: 'rgba(15, 23, 42, 0.6)' }}>
            <div className="space-y-3">
              {/* Address */}
              {loc.address && (
                <div className="text-xs text-slate-500 flex items-center gap-1">
                  📍 {loc.address}
                </div>
              )}

              {/* Top categories */}
              {Object.keys(loc.categories).length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold tracking-wider uppercase text-slate-500 mb-1.5">
                    Top Categories
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(loc.categories)
                      .sort(([, a], [, b]) => b - a)
                      .slice(0, 5)
                      .map(([cat, lbs]) => (
                        <span key={cat} className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 text-slate-400 border border-white/5">
                          {cat} <span className="text-slate-500">{formatLbs(lbs)}</span>
                        </span>
                      ))
                    }
                  </div>
                </div>
              )}

              {/* Inbound flows */}
              {inbound.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold tracking-wider uppercase text-emerald-400/80 mb-1.5 flex items-center gap-1">
                    <ArrowDownLeft className="w-3 h-3" />
                    Inbound Sources ({inbound.length})
                  </div>
                  <div className="space-y-0.5">
                    {inbound.map(f => (
                      <button
                        key={f.from}
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelectLocation(f.from)
                        }}
                        className="w-full flex justify-between items-center text-xs py-1.5 px-2
                          rounded hover:bg-white/5 transition-colors text-left group"
                      >
                        <span className="text-slate-300 group-hover:text-white transition-colors truncate mr-2">
                          {f.from}
                        </span>
                        <span className="text-slate-500 shrink-0 tabular-nums">
                          {formatLbs(f.totalLbs)} lbs · {f.tripCount} trips
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Outbound flows */}
              {outbound.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold tracking-wider uppercase text-violet-400/80 mb-1.5 flex items-center gap-1">
                    <ArrowUpRight className="w-3 h-3" />
                    Outbound Destinations ({outbound.length})
                  </div>
                  <div className="space-y-0.5">
                    {outbound.map(f => (
                      <button
                        key={f.to}
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelectLocation(f.to)
                        }}
                        className="w-full flex justify-between items-center text-xs py-1.5 px-2
                          rounded hover:bg-white/5 transition-colors text-left group"
                      >
                        <span className="text-slate-300 group-hover:text-white transition-colors truncate mr-2">
                          {f.to}
                        </span>
                        <span className="text-slate-500 shrink-0 tabular-nums">
                          {formatLbs(f.totalLbs)} lbs · {f.tripCount} trips
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* No connections */}
              {inbound.length === 0 && outbound.length === 0 && (
                <div className="text-xs text-slate-600 italic">No flow connections recorded</div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
