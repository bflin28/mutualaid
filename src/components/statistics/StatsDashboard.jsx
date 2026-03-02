import { useState, useEffect, useMemo } from 'react'
import { RefreshCw, ChevronDown, ChevronRight, MapPin, Store, Package, ArrowUpDown, Warehouse } from 'lucide-react'
import { StatCard } from './StatCard'

// Store groups — parent store that groups multiple locations
const STORE_GROUPS = {
  'Aldi': loc => loc.startsWith('Aldi'),
  "Mariano's": loc => loc.startsWith("Mariano"),
}

// Slack channel ID → display name mapping
const SLACK_CHANNELS = {
  'C026VATTHDE': '#urban-canopy-log',
  'C031JSTNV6H': '#keystone-log',
}

function slackChannelName(channelId) {
  if (!channelId) return null
  return SLACK_CHANNELS[channelId] || `#${channelId}`
}

// Warehouse locations are distribution hubs, not rescue sources
const WAREHOUSE_LOCATIONS = new Set(['Urban Canopy', 'Keystone'])
const isWarehouse = (loc) => WAREHOUSE_LOCATIONS.has(loc)

function getStoreGroup(locationName) {
  for (const [group, test] of Object.entries(STORE_GROUPS)) {
    if (test(locationName)) return group
  }
  return null
}

export function StatsDashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('overview') // overview | store | location
  const [selectedStore, setSelectedStore] = useState(null)
  const [selectedLocation, setSelectedLocation] = useState(null)
  const [selectedDropOff, setSelectedDropOff] = useState(null)
  const [yearFilter, setYearFilter] = useState('')
  const [sortCol, setSortCol] = useState('lbs')
  const [sortDir, setSortDir] = useState('desc')
  const [expandedRows, setExpandedRows] = useState(new Set())

  useEffect(() => {
    setLoading(true)
    fetch('/api/food-logs?limit=10000')
      .then(r => r.json())
      .then(result => setData(Array.isArray(result) ? result : result.data || []))
      .catch(err => console.error('Failed to load food logs:', err))
      .finally(() => setLoading(false))
  }, [])

  // Available years
  const years = useMemo(() => {
    if (!data) return []
    const y = new Set(data.map(r => (r.rescued_at || '').slice(0, 4)))
    return [...y].sort()
  }, [data])

  // Filtered data — split into rescue vs inventory
  const filtered = useMemo(() => {
    if (!data) return []
    let d = data
    if (yearFilter) d = d.filter(r => (r.rescued_at || '').startsWith(yearFilter))
    return d.filter(r => r.record_type !== 'inventory')
  }, [data, yearFilter])

  const inventoryData = useMemo(() => {
    if (!data) return []
    let d = data
    if (yearFilter) d = d.filter(r => (r.rescued_at || '').startsWith(yearFilter))
    return d.filter(r => r.record_type === 'inventory')
      .sort((a, b) => (b.rescued_at || '').localeCompare(a.rescued_at || ''))
  }, [data, yearFilter])

  // Aggregate stats
  const stats = useMemo(() => {
    const totalLbs = filtered.reduce((s, r) => s + (r.total_estimated_lbs || 0), 0)
    const totalRescues = filtered.length

    // Split into direct rescues vs warehouse distributions
    const directRescues = filtered.filter(r => !isWarehouse(r.rescue_location_name))
    const warehouseRecords = filtered.filter(r => isWarehouse(r.rescue_location_name))
    const warehouseLbs = warehouseRecords.reduce((s, r) => s + (r.total_estimated_lbs || 0), 0)
    const directLbs = directRescues.reduce((s, r) => s + (r.total_estimated_lbs || 0), 0)

    // By location (direct rescues only — exclude warehouse)
    const byLoc = {}
    for (const r of directRescues) {
      const loc = r.rescue_location_name || 'Unknown'
      if (!byLoc[loc]) byLoc[loc] = { name: loc, count: 0, lbs: 0 }
      byLoc[loc].count++
      byLoc[loc].lbs += r.total_estimated_lbs || 0
    }

    // By store group (direct rescues only)
    const byGroup = {}
    for (const [loc, d] of Object.entries(byLoc)) {
      const group = getStoreGroup(loc) || loc
      if (!byGroup[group]) byGroup[group] = { name: group, count: 0, lbs: 0, locations: {} }
      byGroup[group].count += d.count
      byGroup[group].lbs += d.lbs
      byGroup[group].locations[loc] = d
    }

    // By category (all records — total is still accurate)
    const byCat = {}
    for (const r of filtered) {
      for (const item of r.items || []) {
        const cat = item.gcfd_category || 'Uncategorized'
        if (!byCat[cat]) byCat[cat] = { category: cat, lbs: 0, count: 0 }
        byCat[cat].lbs += item.estimated_lbs || 0
        byCat[cat].count++
      }
    }

    // By drop-off
    const byDropOff = {}
    for (const r of filtered) {
      if (r.drop_off_location_name) {
        const loc = r.drop_off_location_name
        if (!byDropOff[loc]) byDropOff[loc] = { name: loc, count: 0, lbs: 0 }
        byDropOff[loc].count++
        byDropOff[loc].lbs += r.total_estimated_lbs || 0
      }
    }

    // By year
    const byYear = {}
    for (const r of filtered) {
      const y = (r.rescued_at || '').slice(0, 4)
      if (!byYear[y]) byYear[y] = { year: y, count: 0, lbs: 0 }
      byYear[y].count++
      byYear[y].lbs += r.total_estimated_lbs || 0
    }

    // Unique locations count (direct rescues only, excluding unknown & warehouse)
    const uniqueLocations = Object.keys(byLoc).filter(l => l !== 'Unknown').length

    return {
      totalLbs: Math.round(totalLbs),
      totalRescues,
      uniqueLocations,
      directLbs: Math.round(directLbs),
      directCount: directRescues.length,
      warehouseLbs: Math.round(warehouseLbs),
      warehouseCount: warehouseRecords.length,
      byLocation: Object.values(byLoc),
      byStoreGroup: Object.values(byGroup),
      byCategory: Object.values(byCat).sort((a, b) => b.lbs - a.lbs),
      byDropOff: Object.values(byDropOff).sort((a, b) => b.lbs - a.lbs),
      byYear: Object.values(byYear).sort((a, b) => a.year.localeCompare(b.year)),
    }
  }, [filtered])

  // Sorted data for tables
  const sortedGroups = useMemo(() => {
    return [...stats.byStoreGroup].sort((a, b) =>
      sortDir === 'desc' ? b[sortCol] - a[sortCol] : a[sortCol] - b[sortCol]
    )
  }, [stats.byStoreGroup, sortCol, sortDir])

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortCol(col); setSortDir('desc') }
  }

  // Rescues for a specific location (works for both direct rescue locations and warehouse drill-in)
  const locationRescues = useMemo(() => {
    if (!selectedLocation || !filtered) return []
    return filtered
      .filter(r => r.rescue_location_name === selectedLocation)
      .sort((a, b) => (b.rescued_at || '').localeCompare(a.rescued_at || ''))
  }, [filtered, selectedLocation])

  // Warehouse distribution records (for the drop-offs tab warehouse summary)
  const warehouseRescues = useMemo(() => {
    if (!filtered) return []
    return filtered
      .filter(r => isWarehouse(r.rescue_location_name))
      .sort((a, b) => (b.rescued_at || '').localeCompare(a.rescued_at || ''))
  }, [filtered])

  // Rescues for a specific drop-off destination
  const dropOffRescues = useMemo(() => {
    if (!selectedDropOff || !filtered) return []
    return filtered
      .filter(r => r.drop_off_location_name === selectedDropOff)
      .sort((a, b) => (b.rescued_at || '').localeCompare(a.rescued_at || ''))
  }, [filtered, selectedDropOff])

  // Rescues for a store group
  const storeRescues = useMemo(() => {
    if (!selectedStore || !filtered) return []
    const group = stats.byStoreGroup.find(g => g.name === selectedStore)
    if (!group) return []
    const locs = new Set(Object.keys(group.locations))
    return filtered
      .filter(r => locs.has(r.rescue_location_name))
      .sort((a, b) => (b.rescued_at || '').localeCompare(a.rescued_at || ''))
  }, [filtered, selectedStore, stats.byStoreGroup])

  const toggleRow = (idx) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gray-400">Loading parsed Slack data...</div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-red-500">Failed to load data. Run: node scripts/process_slack_history.js && node scripts/export_parsed.js</div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">Rescue Statistics</h2>
          <p className="text-gray-500 mt-1">
            {data.length.toLocaleString()} parsed Slack messages · Review before import
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={yearFilter}
            onChange={e => setYearFilter(e.target.value)}
            className="px-3 py-2 bg-white border border-gray-300 rounded-md text-sm"
          >
            <option value="">All Years</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard title="TOTAL RESCUED" value={`${stats.totalLbs.toLocaleString()} lbs`} color="green" />
        <StatCard title="FOOD LOGS" value={stats.totalRescues.toLocaleString()} color="blue"
          subtitle={`${stats.directCount} direct · ${stats.warehouseCount} warehouse`}
        />
        <StatCard title="RESCUE SOURCES" value={stats.uniqueLocations} color="purple"
          subtitle="stores, farms, markets"
        />
        <StatCard
          title="WAREHOUSE DISTRIBUTED"
          value={`${stats.warehouseLbs.toLocaleString()} lbs`}
          subtitle={`${stats.warehouseCount} logs via UC/Keystone`}
          color="orange"
        />
      </div>

      {/* Year breakdown */}
      {stats.byYear.length > 1 && (
        <div className="mb-8">
          <h3 className="text-lg font-medium text-gray-900 mb-3">By Year</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {stats.byYear.map(y => (
              <button
                key={y.year}
                onClick={() => setYearFilter(yearFilter === y.year ? '' : y.year)}
                className={`text-left border rounded-lg p-3 transition-colors ${
                  yearFilter === y.year
                    ? 'bg-green-50 border-green-300 ring-2 ring-green-200'
                    : 'bg-white border-gray-200 hover:border-green-300'
                }`}
              >
                <div className="text-sm font-semibold text-gray-900">{y.year}</div>
                <div className="text-xs text-gray-500">{y.count} logs · {Math.round(y.lbs).toLocaleString()} lbs</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Navigation tabs */}
      <div className="flex overflow-x-auto border-b border-gray-200 mb-6 -mx-1 px-1 scrollbar-hide">
        {[
          { id: 'overview', label: 'Overview', icon: Package },
          { id: 'store', label: 'By Store', icon: Store },
          { id: 'dropoff', label: 'Drop-offs', icon: MapPin },
          { id: 'inventory', label: 'Inventory', icon: Warehouse },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => { setView(tab.id); setSelectedStore(null); setSelectedLocation(null); setSelectedDropOff(null); setExpandedRows(new Set()) }}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              view === tab.id
                ? 'border-green-600 text-green-700'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {view === 'overview' && (
        <div className="space-y-8">
          {/* Recent rescues feed */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-3">Recent Rescues</h3>
            <RecentRescuesFeed rescues={filtered} />
          </div>

          {/* Top rescue sources (exclude warehouse) */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-3">Top Rescue Sources</h3>
            <StoreGroupTable
              groups={sortedGroups.slice(0, 15)}
              sortCol={sortCol}
              sortDir={sortDir}
              toggleSort={toggleSort}
              onSelectGroup={(name) => { setView('store'); setSelectedStore(name); setExpandedRows(new Set()) }}
            />
          </div>

          {/* Category breakdown */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-3">By Category</h3>
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left text-xs font-medium text-gray-600 px-4 py-3">CATEGORY</th>
                    <th className="text-right text-xs font-medium text-gray-600 px-4 py-3">EST. LBS</th>
                    <th className="text-right text-xs font-medium text-gray-600 px-4 py-3">ITEMS</th>
                    <th className="text-right text-xs font-medium text-gray-600 px-4 py-3">% OF TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.byCategory.map(cat => (
                    <tr key={cat.category} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{cat.category}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 text-right">{Math.round(cat.lbs).toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 text-right">{cat.count.toLocaleString()}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 bg-gray-100 rounded-full h-2">
                            <div
                              className="bg-green-500 rounded-full h-2"
                              style={{ width: `${stats.totalLbs > 0 ? (cat.lbs / stats.totalLbs) * 100 : 0}%` }}
                            />
                          </div>
                          {stats.totalLbs > 0 ? Math.round((cat.lbs / stats.totalLbs) * 100) : 0}%
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Store tab */}
      {view === 'store' && !selectedStore && (
        <div>
          <h3 className="text-lg font-medium text-gray-900 mb-3">Rescue Sources</h3>
          <p className="text-sm text-gray-500 mb-4">
            Where food was directly rescued from — stores, farms, and markets
          </p>

          {/* Warehouse context banner */}
          {stats.warehouseCount > 0 && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-4">
              <div className="flex items-start gap-3">
                <Package className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-orange-800">
                    {stats.warehouseCount.toLocaleString()} logs ({stats.warehouseLbs.toLocaleString()} lbs) were distributed from the warehouse
                  </p>
                  <p className="text-xs text-orange-600 mt-1">
                    These are pickups from UC/Keystone where the original rescue source is unknown.
                    See the <button onClick={() => { setView('dropoff') }} className="underline font-medium">Drop-offs</button> tab for distribution details.
                  </p>
                </div>
              </div>
            </div>
          )}

          <StoreGroupTable
            groups={sortedGroups}
            sortCol={sortCol}
            sortDir={sortDir}
            toggleSort={toggleSort}
            onSelectGroup={(name) => { setSelectedStore(name); setExpandedRows(new Set()) }}
          />
        </div>
      )}

      {/* Store detail view */}
      {view === 'store' && selectedStore && (
        <StoreDetail
          storeName={selectedStore}
          group={stats.byStoreGroup.find(g => g.name === selectedStore)}
          rescues={storeRescues}
          expandedRows={expandedRows}
          toggleRow={toggleRow}
          onBack={() => { setSelectedStore(null); setExpandedRows(new Set()) }}
          onSelectLocation={(loc) => { setSelectedLocation(loc); setSelectedStore(null); setExpandedRows(new Set()) }}
        />
      )}

      {/* Location detail */}
      {selectedLocation && (
        <LocationDetail
          locationName={selectedLocation}
          rescues={locationRescues}
          expandedRows={expandedRows}
          toggleRow={toggleRow}
          onBack={() => { setSelectedLocation(null); setExpandedRows(new Set()); if (!selectedStore) setView('store') }}
        />
      )}

      {/* Drop-offs tab — list view */}
      {view === 'dropoff' && !selectedDropOff && (
        <div>
          {/* Warehouse summary */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <StatCard title="DISTRIBUTED" value={`${stats.warehouseLbs.toLocaleString()} lbs`} color="orange"
              subtitle={`${stats.warehouseCount} warehouse logs`}
            />
            <StatCard title="ORGS SERVED" value={stats.byDropOff.length} color="purple"
              subtitle="community organizations"
            />
            <StatCard title="AVG PER PICKUP" value={`${stats.warehouseCount > 0 ? Math.round(stats.warehouseLbs / stats.warehouseCount) : 0} lbs`} color="blue" />
          </div>

          <h3 className="text-lg font-medium text-gray-900 mb-3">Drop-off Destinations</h3>
          <p className="text-sm text-gray-500 mb-4">
            Community organizations receiving rescued food — click to see individual logs
          </p>
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left text-xs font-medium text-gray-600 px-4 py-3">ORGANIZATION</th>
                  <th className="text-right text-xs font-medium text-gray-600 px-4 py-3">EST. LBS</th>
                  <th className="text-right text-xs font-medium text-gray-600 px-4 py-3"># PICKUPS</th>
                  <th className="text-right text-xs font-medium text-gray-600 px-4 py-3">AVG LBS</th>
                  <th className="text-right text-xs font-medium text-gray-600 px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {stats.byDropOff.map(d => (
                  <tr
                    key={d.name}
                    className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                    onClick={() => { setSelectedDropOff(d.name); setExpandedRows(new Set()) }}
                  >
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{d.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 text-right">{Math.round(d.lbs).toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 text-right">{d.count}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 text-right">{Math.round(d.lbs / d.count).toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-gray-400 text-right">
                      <ChevronRight className="w-4 h-4 inline" />
                    </td>
                  </tr>
                ))}
                {stats.byDropOff.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-8 text-gray-400">No drop-off data</td></tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      )}

      {/* Drop-offs tab — detail view */}
      {view === 'dropoff' && selectedDropOff && (
        <div>
          <button
            onClick={() => { setSelectedDropOff(null); setExpandedRows(new Set()) }}
            className="text-sm text-green-600 hover:text-green-800 mb-4 flex items-center gap-1"
          >
            ← Back to all drop-offs
          </button>
          <h3 className="text-lg font-medium text-gray-900 mb-1">{selectedDropOff}</h3>
          <p className="text-sm text-gray-500 mb-4">
            {dropOffRescues.length} food logs · {Math.round(dropOffRescues.reduce((s, r) => s + (r.total_estimated_lbs || 0), 0)).toLocaleString()} estimated lbs
          </p>
          <RescueLogList rescues={dropOffRescues} expandedRows={expandedRows} toggleRow={toggleRow} />
        </div>
      )}

      {/* Inventory tab */}
      {view === 'inventory' && (
        <div className="space-y-8">
          {/* Latest snapshots per warehouse */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {['Urban Canopy', 'Keystone'].map(warehouse => {
              const snapshots = inventoryData.filter(r => r.rescue_location_name === warehouse)
              const latest = snapshots[0] || null
              return (
                <InventorySnapshotCard
                  key={warehouse}
                  warehouse={warehouse}
                  snapshot={latest}
                  channelId={latest?.slack_channel}
                />
              )
            })}
          </div>

          {/* All inventory history */}
          {inventoryData.length > 0 && (
            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-3">Inventory History</h3>
              <p className="text-sm text-gray-500 mb-4">
                {inventoryData.length} snapshots logged
              </p>
              <RescueLogList rescues={inventoryData} expandedRows={expandedRows} toggleRow={toggleRow} />
            </div>
          )}

          {inventoryData.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              No inventory snapshots yet. Post an inventory message in Slack to get started.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================
// Sub-components
// ============================================================

function StoreGroupTable({ groups, sortCol, sortDir, toggleSort, onSelectGroup }) {
  const arrow = (col) => sortCol === col ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left text-xs font-medium text-gray-600 px-4 py-3">SOURCE</th>
              <th
                className="text-right text-xs font-medium text-gray-600 px-4 py-3 cursor-pointer hover:text-gray-900 select-none"
                onClick={() => toggleSort('lbs')}
              >
                EST. LBS{arrow('lbs')}
              </th>
              <th
                className="text-right text-xs font-medium text-gray-600 px-4 py-3 cursor-pointer hover:text-gray-900 select-none"
                onClick={() => toggleSort('count')}
              >
                # LOGS{arrow('count')}
              </th>
              <th className="text-right text-xs font-medium text-gray-600 px-4 py-3">AVG LBS</th>
              <th className="text-right text-xs font-medium text-gray-600 px-4 py-3">LOCATIONS</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(g => {
              const locCount = Object.keys(g.locations).length
              const isGroup = locCount > 1
              return (
                <tr
                  key={g.name}
                  className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                  onClick={() => onSelectGroup(g.name)}
                >
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                    <div className="flex items-center gap-2">
                      {isGroup && <Store className="w-4 h-4 text-green-600 shrink-0" />}
                      {g.name}
                      {isGroup && (
                        <span className="text-xs text-gray-400">({locCount} locations)</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 text-right font-medium">
                    {Math.round(g.lbs).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 text-right">{g.count}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 text-right">
                    {g.count > 0 ? Math.round(g.lbs / g.count).toLocaleString() : 0}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-400 text-right">
                    <ChevronRight className="w-4 h-4 inline" />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StoreDetail({ storeName, group, rescues, expandedRows, toggleRow, onBack, onSelectLocation }) {
  if (!group) return null
  const locations = Object.values(group.locations).sort((a, b) => b.lbs - a.lbs)
  const hasMultiple = locations.length > 1

  return (
    <div>
      <button onClick={onBack} className="text-sm text-green-600 hover:text-green-800 mb-4 flex items-center gap-1">
        ← Back to all sources
      </button>
      <h3 className="text-lg font-medium text-gray-900 mb-1">{storeName}</h3>
      <p className="text-sm text-gray-500 mb-4">
        {group.count} food logs · {Math.round(group.lbs).toLocaleString()} estimated lbs
      </p>

      {/* Sub-locations if it's a group */}
      {hasMultiple && (
        <div className="mb-6">
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Locations</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {locations.map(loc => (
              <button
                key={loc.name}
                onClick={() => onSelectLocation(loc.name)}
                className="text-left bg-white border border-gray-200 rounded-lg p-3 hover:border-green-300 transition-colors"
              >
                <div className="text-sm font-medium text-gray-900">{loc.name}</div>
                <div className="text-xs text-gray-500">{loc.count} logs · {Math.round(loc.lbs).toLocaleString()} lbs</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Rescue log list */}
      <h4 className="text-sm font-semibold text-gray-700 mb-2">
        Recent Rescues ({rescues.length})
      </h4>
      <RescueLogList rescues={rescues} expandedRows={expandedRows} toggleRow={toggleRow} />
    </div>
  )
}

function LocationDetail({ locationName, rescues, expandedRows, toggleRow, onBack }) {
  return (
    <div>
      <button onClick={onBack} className="text-sm text-green-600 hover:text-green-800 mb-4 flex items-center gap-1">
        ← Back
      </button>
      <h3 className="text-lg font-medium text-gray-900 mb-1">{locationName}</h3>
      <p className="text-sm text-gray-500 mb-4">
        {rescues.length} food logs · {Math.round(rescues.reduce((s, r) => s + (r.total_estimated_lbs || 0), 0)).toLocaleString()} estimated lbs
      </p>
      <RescueLogList rescues={rescues} expandedRows={expandedRows} toggleRow={toggleRow} />
    </div>
  )
}

// ── Multi-destination grouping ──────────────────────────────
// Groups consecutive _multi records sharing raw_text + rescued_at
// into a single display entry with type:'multi'
function groupMultiDestRescues(rescues) {
  const entries = []
  let i = 0
  while (i < rescues.length) {
    const r = rescues[i]
    if (r.classification?.endsWith('_multi')) {
      const group = [r]
      while (
        i + 1 < rescues.length &&
        rescues[i + 1].classification?.endsWith('_multi') &&
        rescues[i + 1].raw_text === r.raw_text &&
        rescues[i + 1].rescued_at === r.rescued_at
      ) {
        group.push(rescues[++i])
      }
      if (group.length > 1) {
        entries.push({ type: 'multi', rescues: group })
      } else {
        entries.push({ type: 'single', rescue: r })
      }
    } else {
      entries.push({ type: 'single', rescue: r })
    }
    i++
  }
  return entries
}

// ── Shared sub-components ───────────────────────────────────

function ItemsTable({ items }) {
  return (
    <table className="w-full text-sm mb-3">
      <thead>
        <tr className="text-xs text-gray-500">
          <th className="text-left py-1 font-medium">Item</th>
          <th className="text-right py-1 font-medium w-16">Qty</th>
          <th className="text-left py-1 pl-3 font-medium w-20">Unit</th>
          <th className="text-left py-1 font-medium">Category</th>
          <th className="text-right py-1 font-medium w-20">Est. Lbs</th>
        </tr>
      </thead>
      <tbody>
        {(items || []).map((item, j) => (
          <tr key={j} className="border-t border-gray-50">
            <td className="py-1 text-gray-900">{item.name}</td>
            <td className="py-1 text-gray-600 text-right">{item.quantity}</td>
            <td className="py-1 text-gray-600 pl-3">{item.unit}</td>
            <td className="py-1">
              {item.gcfd_category && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                  {item.gcfd_category}
                </span>
              )}
            </td>
            <td className="py-1 text-gray-600 text-right">
              {item.estimated_lbs != null ? Math.round(item.estimated_lbs) : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function SlackChannelBadge({ channelId }) {
  const name = slackChannelName(channelId)
  if (!name) return null
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-medium">
      {name}
    </span>
  )
}

function RawTextDisclosure({ rawText, classification, slackChannel }) {
  return (
    <details className="text-xs">
      <summary className="text-gray-400 cursor-pointer hover:text-gray-600 flex items-center gap-2">
        <span>Raw Slack text · {classification}</span>
        <SlackChannelBadge channelId={slackChannel} />
      </summary>
      <pre className="mt-2 p-3 bg-gray-50 rounded-md text-gray-600 whitespace-pre-wrap break-words max-h-40 overflow-auto border border-gray-100">
        {rawText}
      </pre>
    </details>
  )
}

// ── Card components ─────────────────────────────────────────

function SingleRescueCard({ rescue: r, isOpen, onToggle }) {
  const date = (r.rescued_at || '').slice(0, 10)
  return (
    <div className="border-b border-gray-100 last:border-b-0">
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center gap-3"
      >
        {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
        <span className="text-xs text-gray-400 w-20 shrink-0">{date}</span>
        <span className="text-sm text-gray-900 flex-1 truncate">{r.rescue_location_name}</span>
        {r.drop_off_location_name && (
          <span className="text-xs text-purple-600 shrink-0">→ {r.drop_off_location_name}</span>
        )}
        <SlackChannelBadge channelId={r.slack_channel} />
        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 shrink-0">
          {r.items?.length || 0} items
        </span>
        <span className="text-sm font-medium text-green-700 shrink-0">
          {Math.round(r.total_estimated_lbs || 0).toLocaleString()} lbs
        </span>
      </button>
      {isOpen && (
        <div className="px-4 pb-4 pt-1">
          <ItemsTable items={r.items} />
          <RawTextDisclosure rawText={r.raw_text} classification={r.classification} slackChannel={r.slack_channel} />
        </div>
      )}
    </div>
  )
}

function MultiDestRescueCard({ group, isOpen, onToggle }) {
  const first = group[0]
  const date = (first.rescued_at || '').slice(0, 10)
  const totalLbs = group.reduce((s, r) => s + (r.total_estimated_lbs || 0), 0)
  const totalItems = group.reduce((s, r) => s + (r.items?.length || 0), 0)
  const destinations = group.map(r => r.drop_off_location_name).filter(Boolean)

  return (
    <div className="border-b border-gray-100 last:border-b-0">
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center gap-3"
      >
        {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
        <span className="text-xs text-gray-400 w-20 shrink-0">{date}</span>
        <span className="text-sm text-gray-900 flex-1 truncate">{first.rescue_location_name}</span>
        <span className="text-xs text-purple-600 shrink-0">
          {destinations.map(d => `→ ${d}`).join(' ')}
        </span>
        <SlackChannelBadge channelId={first.slack_channel} />
        <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 shrink-0">
          {group.length} stops
        </span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 shrink-0">
          {totalItems} items
        </span>
        <span className="text-sm font-medium text-green-700 shrink-0">
          {Math.round(totalLbs).toLocaleString()} lbs
        </span>
      </button>
      {isOpen && (
        <div className="px-4 pb-4 pt-1 space-y-4">
          {group.map((r, i) => (
            <div key={i}>
              <div className="text-xs font-semibold text-purple-700 mb-1 flex items-center gap-2">
                <span>→ {r.drop_off_location_name || 'Unknown'}</span>
                <span className="text-gray-400 font-normal">·</span>
                <span className="text-gray-500 font-normal">{r.items?.length || 0} items · {Math.round(r.total_estimated_lbs || 0).toLocaleString()} lbs</span>
              </div>
              <ItemsTable items={r.items} />
            </div>
          ))}
          <RawTextDisclosure
            rawText={first.raw_text}
            classification={(first.classification || '').replace('_multi', '') + ' (multi-dest)'}
            slackChannel={first.slack_channel}
          />
        </div>
      )}
    </div>
  )
}

// ── Rescue log list with multi-dest grouping ────────────────

function RescueLogList({ rescues, expandedRows, toggleRow }) {
  const [page, setPage] = useState(0)
  const grouped = useMemo(() => groupMultiDestRescues(rescues), [rescues])
  const PAGE_SIZE = 25
  const totalPages = Math.ceil(grouped.length / PAGE_SIZE)
  const pageEntries = grouped.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div>
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
        {pageEntries.map((entry, i) => {
          const idx = page * PAGE_SIZE + i
          const isOpen = expandedRows.has(idx)
          if (entry.type === 'multi') {
            return <MultiDestRescueCard key={idx} group={entry.rescues} isOpen={isOpen} onToggle={() => toggleRow(idx)} />
          }
          return <SingleRescueCard key={idx} rescue={entry.rescue} isOpen={isOpen} onToggle={() => toggleRow(idx)} />
        })}
        {pageEntries.length === 0 && (
          <div className="text-center py-8 text-gray-400">No rescues found</div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button
            disabled={page === 0}
            onClick={() => setPage(p => p - 1)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50 disabled:opacity-40"
          >
            ← Prev
          </button>
          <span className="text-sm text-gray-500">
            Page {page + 1} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages - 1}
            onClick={() => setPage(p => p + 1)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}

function RecentRescuesFeed({ rescues }) {
  const [expanded, setExpanded] = useState(new Set())
  const recent = useMemo(() => {
    return [...rescues]
      .sort((a, b) => (b.rescued_at || '').localeCompare(a.rescued_at || ''))
      .slice(0, 10)
  }, [rescues])

  function timeAgo(dateStr) {
    if (!dateStr) return ''
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    if (days < 30) return `${days}d ago`
    const months = Math.floor(days / 30)
    return `${months}mo ago`
  }

  const toggle = (i) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  if (recent.length === 0) {
    return <div className="text-gray-400 text-sm">No rescues yet</div>
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm divide-y divide-gray-100">
      {recent.map((r, i) => {
        const isOpen = expanded.has(i)
        const topItems = (r.items || []).slice(0, 3)
        const moreCount = (r.items || []).length - 3
        return (
          <div key={r.id || i}>
            <button
              onClick={() => toggle(i)}
              className="w-full text-left px-4 py-3 hover:bg-gray-50"
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  {isOpen
                    ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                  }
                  <span className="text-sm font-medium text-gray-900">
                    {r.rescue_location_name || 'Unknown'}
                  </span>
                  {r.drop_off_location_name && (
                    <span className="text-xs text-purple-600">→ {r.drop_off_location_name}</span>
                  )}
                  <SlackChannelBadge channelId={r.slack_channel} />
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                    {(r.items || []).length} items
                  </span>
                  <span className="text-sm font-semibold text-green-700">
                    {Math.round(r.total_estimated_lbs || 0).toLocaleString()} lbs
                  </span>
                  <span className="text-xs text-gray-400">{timeAgo(r.rescued_at)}</span>
                </div>
              </div>
              {!isOpen && (
                <div className="text-xs text-gray-500 ml-6">
                  {topItems.map((item, j) => (
                    <span key={j}>
                      {j > 0 && ' · '}
                      {item.quantity} {item.unit} {item.name}
                    </span>
                  ))}
                  {moreCount > 0 && <span className="text-gray-400"> +{moreCount} more</span>}
                </div>
              )}
            </button>
            {isOpen && (
              <div className="px-4 pb-4 pt-1">
                <ItemsTable items={r.items} />
                <RawTextDisclosure rawText={r.raw_text} classification={r.classification || r.source} slackChannel={r.slack_channel} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function InventorySnapshotCard({ warehouse, snapshot, channelId }) {
  if (!snapshot) {
    return (
      <div className="border rounded-lg p-4 bg-gray-50 border-gray-200">
        <div className="text-sm font-medium text-gray-900">{warehouse}</div>
        <div className="text-xs text-gray-400 mt-1">No inventory snapshots</div>
      </div>
    )
  }

  const date = (snapshot.rescued_at || '').slice(0, 10)
  const itemCount = snapshot.items?.length || 0
  const topItems = (snapshot.items || []).slice(0, 5)

  return (
    <div className="border rounded-lg p-4 bg-white border-gray-200 w-full">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Warehouse className="w-4 h-4 text-gray-400" />
          <span className="text-sm font-semibold text-gray-900">{warehouse}</span>
          <SlackChannelBadge channelId={channelId} />
        </div>
        <span className="text-xs text-gray-400">{date}</span>
      </div>
      <div className="text-2xl font-bold text-gray-900">
        {Math.round(snapshot.total_estimated_lbs || 0).toLocaleString()} lbs
      </div>
      <div className="text-xs text-gray-500 mt-1">{itemCount} items on hand</div>
      <div className="mt-3 space-y-1">
        {topItems.map((item, i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <span className="text-gray-700">{item.quantity} {item.unit} {item.name}</span>
            {item.estimated_lbs != null && (
              <span className="text-gray-400">{Math.round(item.estimated_lbs)} lbs</span>
            )}
          </div>
        ))}
        {itemCount > 5 && (
          <div className="text-xs text-gray-400">+{itemCount - 5} more items</div>
        )}
      </div>
    </div>
  )
}
