import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import { AntPath } from 'leaflet-ant-path'
import LOCATIONS from '../../data/locationCoordinates'

function getLineWeight(totalLbs, maxLbs) {
  if (maxLbs === 0) return 2
  const normalized = Math.log10(totalLbs + 1) / Math.log10(maxLbs + 1)
  return Math.max(2, Math.min(normalized * 6, 8))
}

function formatLbs(lbs) {
  if (lbs >= 1000) return `${(lbs / 1000).toFixed(1)}k`
  return Math.round(lbs).toLocaleString()
}

function getFlowColor(fromType, toType) {
  if (toType === 'warehouse') return '#22d3ee'  // cyan-400 - inbound
  if (fromType === 'warehouse') return '#f472b6' // pink-400 - outbound
  return '#94a3b8' // slate-400 - direct
}

function offsetLine(from, to, offset = 0.0008) {
  const dx = to[1] - from[1]
  const dy = to[0] - from[0]
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len === 0) return [from, to]
  const nx = (-dy / len) * offset
  const ny = (dx / len) * offset
  return [
    [from[0] + nx, from[1] + ny],
    [to[0] + nx, to[1] + ny],
  ]
}

function AnimatedFlow({ flow, maxLbs }) {
  const map = useMap()
  const layerRef = useRef(null)

  const fromCoords = LOCATIONS[flow.from]
  const toCoords = LOCATIONS[flow.to]

  useEffect(() => {
    if (!fromCoords || !toCoords) return

    const color = getFlowColor(fromCoords.type, toCoords.type)
    const weight = getLineWeight(flow.totalLbs, maxLbs)

    const positions = offsetLine(
      [fromCoords.lat, fromCoords.lng],
      [toCoords.lat, toCoords.lng],
    )

    const antPath = new AntPath(positions, {
      color: color,
      pulseColor: '#ffffff',
      weight: weight,
      opacity: 0.7,
      delay: 600,
      dashArray: [12, 24],
      hardwareAccelerated: true,
      interactive: false,
    })

    antPath.addTo(map)
    layerRef.current = antPath

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current)
      }
    }
  }, [map, flow, maxLbs, fromCoords, toCoords])

  return null
}

export function FlowLines({ flows }) {
  if (!flows || flows.length === 0) return null

  const maxLbs = Math.max(...flows.map(f => f.totalLbs))

  return (
    <>
      {flows
        .filter(f => LOCATIONS[f.from] && LOCATIONS[f.to])
        .map((flow, i) => (
          <AnimatedFlow key={`${flow.from}-${flow.to}-${i}`} flow={flow} maxLbs={maxLbs} />
        ))}
    </>
  )
}
