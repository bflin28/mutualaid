import { MapContainer, TileLayer } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { LocationMarkers } from './LocationMarkers'
import { FlowLines } from './FlowLines'
import { MapLegend } from './MapLegend'

const CHICAGO_CENTER = [41.8781, -87.6298]
const DEFAULT_ZOOM = 11

// CartoDB Dark Matter — free, no API key
const DARK_TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
const DARK_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'

export function RescueMap({ flows, locationTotals, selectedLocation, onSelectLocation }) {
  const visibleFlows = selectedLocation
    ? flows.filter(f => f.from === selectedLocation || f.to === selectedLocation)
    : []

  // Build set of locations connected to the selected one
  const connectedLocations = new Set()
  if (selectedLocation) {
    connectedLocations.add(selectedLocation)
    for (const f of visibleFlows) {
      connectedLocations.add(f.from)
      connectedLocations.add(f.to)
    }
  }

  return (
    <div className="w-full h-full">
      <MapContainer
        center={CHICAGO_CENTER}
        zoom={DEFAULT_ZOOM}
        className="w-full h-full"
        style={{ minHeight: '100%', background: '#0f172a' }}
        scrollWheelZoom={true}
        zoomControl={true}
      >
        <TileLayer
          attribution={DARK_ATTR}
          url={DARK_TILES}
          subdomains="abcd"
          maxZoom={20}
        />
        <FlowLines flows={visibleFlows} />
        <LocationMarkers
          locationTotals={locationTotals}
          selectedLocation={selectedLocation}
          connectedLocations={connectedLocations}
          onSelectLocation={onSelectLocation}
        />
        <MapLegend selectedLocation={selectedLocation} />
      </MapContainer>
    </div>
  )
}
