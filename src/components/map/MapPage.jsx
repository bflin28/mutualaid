import { useState, useEffect } from 'react'
import { RescueMap } from './RescueMap'
import { LocationsPanel } from './LocationsPanel'
import { useMapData } from './useMapData'
import { Table2 } from 'lucide-react'

export function MapPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [yearFilter, setYearFilter] = useState(null)
  const [selectedLocation, setSelectedLocation] = useState(null)
  const [panelOpen, setPanelOpen] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch('/api/food-logs?limit=10000')
      .then(r => r.json())
      .then(result => setData(Array.isArray(result) ? result : result.data || []))
      .catch(err => console.error('Failed to load parsed data:', err))
      .finally(() => setLoading(false))
  }, [])

  const { flows, locationTotals, summary, years } = useMapData(data, yearFilter)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-900">
        <div className="text-slate-400 text-lg">Loading map...</div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-900">
        <div className="text-red-400">Failed to load data.</div>
      </div>
    )
  }

  return (
    <div
      className="relative map-dark -m-4 md:-m-8"
      style={{ width: 'calc(100% + 4rem)', height: '100vh' }}
    >
      {/* Full-bleed map */}
      <RescueMap
        flows={flows}
        locationTotals={locationTotals}
        selectedLocation={selectedLocation}
        onSelectLocation={setSelectedLocation}
      />

      {/* Glass overlay: stats + controls */}
      <div className="absolute top-4 left-4 right-4 z-[1000] pointer-events-none">
        <div className="flex flex-wrap items-start gap-3">
          {/* Stat cards */}
          <GlassStatCard
            label="Total Rescued"
            value={`${(summary.totalLbs || 0).toLocaleString()}`}
            unit="lbs"
            color="#34d399"
          />
          <GlassStatCard
            label="Rescues"
            value={summary.totalTrips?.toLocaleString() || '0'}
            color="#38bdf8"
          />
          <GlassStatCard
            label="Locations"
            value={summary.locationCount || 0}
            color="#a78bfa"
          />
          <GlassStatCard
            label="Top Source"
            value={summary.topLocation || '—'}
            subtitle={summary.topLocationLbs ? `${summary.topLocationLbs.toLocaleString()} lbs` : ''}
            color="#fb923c"
          />

          {/* Year filter */}
          <div className="pointer-events-auto ml-auto">
            <select
              value={yearFilter || ''}
              onChange={e => setYearFilter(e.target.value || null)}
              className="px-3 py-2 rounded-xl text-sm font-medium
                bg-slate-900/80 backdrop-blur-xl border border-white/10
                text-slate-200 shadow-lg shadow-black/30
                hover:border-white/20 focus:outline-none focus:border-sky-400/50
                focus:ring-2 focus:ring-sky-400/20 transition-all cursor-pointer"
            >
              <option value="">All Years</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Locations panel toggle */}
      <button
        onClick={() => setPanelOpen(p => !p)}
        className="absolute bottom-20 right-4 z-[1001] pointer-events-auto
          px-3 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2
          bg-slate-900/80 backdrop-blur-xl border border-white/10
          text-slate-200 shadow-lg shadow-black/30
          hover:bg-slate-900/90 hover:border-white/20
          transition-all duration-300"
      >
        <Table2 className="w-4 h-4" />
        Locations
      </button>

      {/* Locations panel */}
      <LocationsPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        locationTotals={locationTotals}
        flows={flows}
        selectedLocation={selectedLocation}
        onSelectLocation={setSelectedLocation}
      />
    </div>
  )
}

function GlassStatCard({ label, value, unit, subtitle, color }) {
  return (
    <div
      className="pointer-events-auto px-4 py-3 rounded-xl
        bg-slate-900/75 backdrop-blur-xl border border-white/10
        shadow-lg shadow-black/30
        hover:bg-slate-900/85 hover:border-white/20 hover:-translate-y-0.5
        transition-all duration-300 cursor-default min-w-[130px]"
    >
      <div className="text-[10px] font-semibold tracking-widest uppercase mb-1" style={{ color }}>
        {label}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-xl font-bold text-white leading-none">{value}</span>
        {unit && <span className="text-xs text-slate-400 font-medium">{unit}</span>}
      </div>
      {subtitle && <div className="text-[11px] text-slate-400 mt-0.5">{subtitle}</div>}
    </div>
  )
}
