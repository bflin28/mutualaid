import { Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import LOCATIONS from '../../data/locationCoordinates'

const TYPE_COLORS = {
  rescue: '#34d399',       // emerald-400
  warehouse: '#fb923c',    // orange-400
  distribution: '#a78bfa', // violet-400
}

const TYPE_LABELS = {
  rescue: 'Rescue Source',
  warehouse: 'Warehouse Hub',
  distribution: 'Distribution',
}

function getSize(totalLbs, type) {
  if (type === 'warehouse') return 22
  const base = Math.log10(Math.max(totalLbs, 1) + 1) * 4
  return Math.max(10, Math.min(base, 26))
}

function formatLbs(lbs) {
  if (lbs >= 1000) return `${(lbs / 1000).toFixed(1)}k`
  return Math.round(lbs).toLocaleString()
}

function createPulsingIcon(color, size, isSelected, isDimmed, type) {
  const opacity = isDimmed ? 0.2 : 1
  const glowIntensity = isSelected ? '20px' : '10px'
  const extraClass = [
    type === 'warehouse' ? 'warehouse' : '',
    isSelected ? 'selected' : '',
  ].filter(Boolean).join(' ')

  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
    html: `
      <div class="marker-pulse ${extraClass}" style="width:${size}px;height:${size}px;opacity:${opacity}">
        <div class="ring" style="
          border: 2px solid ${color};
          opacity: 0.5;
          border-radius: 50%;
          width: 100%;
          height: 100%;
          position: absolute;
        "></div>
        <div class="dot" style="
          background: ${color};
          border-radius: 50%;
          width: 100%;
          height: 100%;
          position: absolute;
          box-shadow: 0 0 ${glowIntensity} ${color}, 0 0 ${parseInt(glowIntensity) * 2}px ${color}40;
        "></div>
      </div>
    `,
  })
}

export function LocationMarkers({ locationTotals, selectedLocation, connectedLocations, onSelectLocation }) {
  return (
    <>
      {Object.entries(locationTotals).map(([name, data]) => {
        const coords = LOCATIONS[name]
        if (!coords) return null

        const type = coords.type || data.type || 'rescue'
        const color = TYPE_COLORS[type]
        const size = getSize(data.totalLbs, type)
        const isSelected = selectedLocation === name
        const isConnected = connectedLocations?.has(name)
        const isDimmed = selectedLocation && !isSelected && !isConnected

        const icon = createPulsingIcon(color, size, isSelected, isDimmed, type)

        const topCategories = Object.entries(data.categories || {})
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)

        return (
          <Marker
            key={name}
            position={[coords.lat, coords.lng]}
            icon={icon}
            eventHandlers={{
              click: () => onSelectLocation(isSelected ? null : name),
            }}
          >
            <Popup>
              <div className="min-w-[200px] text-slate-200" x-apple-data-detectors="false">
                <div className="font-semibold text-sm mb-1 text-white">{name}</div>
                <div
                  className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full inline-block mb-2"
                  style={{ backgroundColor: `${color}25`, color, border: `1px solid ${color}40` }}
                >
                  {TYPE_LABELS[type]}
                </div>
                {coords.address && (
                  <div className="text-xs text-slate-400 mb-2" style={{ WebkitTextSizeAdjust: 'none' }}>
                    <span style={{ pointerEvents: 'none' }}>{coords.address}</span>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-2">
                  <div className="text-slate-400">Total lbs</div>
                  <div className="font-semibold text-white">{formatLbs(data.totalLbs)}</div>
                  <div className="text-slate-400">Trips</div>
                  <div className="font-semibold text-white">{data.tripCount}</div>
                </div>
                {topCategories.length > 0 && (
                  <div className="border-t border-white/10 pt-2 mt-2">
                    <div className="text-[10px] text-slate-500 font-semibold tracking-wider uppercase mb-1">Top Categories</div>
                    {topCategories.map(([cat, lbs]) => (
                      <div key={cat} className="flex justify-between text-xs py-0.5">
                        <span className="text-slate-400">{cat}</span>
                        <span className="text-slate-200 font-medium">{formatLbs(lbs)} lbs</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Popup>
          </Marker>
        )
      })}
    </>
  )
}
