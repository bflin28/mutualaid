export function MapLegend({ selectedLocation }) {
  return (
    <div className="leaflet-bottom leaflet-right hidden md:block" style={{ pointerEvents: 'auto' }}>
      <div
        className="leaflet-control m-3 px-4 py-3 rounded-xl text-xs"
        style={{
          background: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(16px) saturate(180%)',
          WebkitBackdropFilter: 'blur(16px) saturate(180%)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          color: '#e2e8f0',
        }}
      >
        <div className="font-semibold text-white text-[11px] tracking-wider uppercase mb-2.5">Legend</div>

        <div className="space-y-2 mb-3">
          <LegendDot color="#34d399" label="Rescue Source" />
          <LegendDot color="#fb923c" label="Warehouse Hub" shape="square" />
          <LegendDot color="#a78bfa" label="Distribution" />
        </div>

        {selectedLocation ? (
          <div className="border-t border-white/10 pt-2.5 space-y-2">
            <LegendLine color="#22d3ee" label="Inbound flow" />
            <LegendLine color="#f472b6" label="Outbound flow" />
          </div>
        ) : (
          <div className="border-t border-white/10 pt-2.5">
            <div className="text-slate-500 italic text-[11px]">Click a marker to see flows</div>
          </div>
        )}
      </div>
    </div>
  )
}

function LegendDot({ color, label, shape = 'circle' }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="inline-block shrink-0"
        style={{
          width: 10,
          height: 10,
          borderRadius: shape === 'square' ? 3 : '50%',
          background: color,
          boxShadow: `0 0 6px ${color}80`,
        }}
      />
      <span className="text-slate-300">{label}</span>
    </div>
  )
}

function LegendLine({ color, label }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="inline-block shrink-0"
        style={{
          width: 20,
          height: 3,
          borderRadius: 2,
          background: color,
          boxShadow: `0 0 6px ${color}80`,
        }}
      />
      <span className="text-slate-300">{label}</span>
    </div>
  )
}
