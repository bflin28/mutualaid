import { useEffect, useState } from 'react'

const API_BASE = import.meta.env.VITE_SLACK_BROWSER_API || 'http://localhost:5055'

function UnitsApp() {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saveStatus, setSaveStatus] = useState({ state: 'idle', message: '' })

  // New item override form
  const [newOverride, setNewOverride] = useState({ item: '', unit: '', weight: '' })

  // New unit form
  const [newUnit, setNewUnit] = useState({ name: '', weight: '' })

  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    setLoading(true)
    setError('')
    try {
      const resp = await fetch(`${API_BASE}/weight-config`)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json()
      setConfig(data)
    } catch (err) {
      setError(err.message || 'Failed to load config')
    }
    setLoading(false)
  }

  const handleSave = async () => {
    setSaveStatus({ state: 'saving', message: 'Saving...' })
    try {
      const resp = await fetch(`${API_BASE}/weight-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}))
        throw new Error(errData.detail || `HTTP ${resp.status}`)
      }
      setSaveStatus({ state: 'saved', message: 'Saved!' })
      setTimeout(() => setSaveStatus({ state: 'idle', message: '' }), 2000)
    } catch (err) {
      setSaveStatus({ state: 'error', message: err.message || 'Failed to save' })
    }
  }

  // Update a unit override weight
  const updateUnitWeight = (unit, value) => {
    const numValue = parseFloat(value)
    if (isNaN(numValue)) return
    setConfig(prev => ({
      ...prev,
      unit_overrides: {
        ...prev.unit_overrides,
        [unit]: numValue,
      },
    }))
  }

  // Delete a unit override
  const deleteUnit = (unit) => {
    setConfig(prev => {
      const newOverrides = { ...prev.unit_overrides }
      delete newOverrides[unit]
      return { ...prev, unit_overrides: newOverrides }
    })
  }

  // Add a new unit
  const addUnit = () => {
    if (!newUnit.name.trim() || !newUnit.weight) return
    const weight = parseFloat(newUnit.weight)
    if (isNaN(weight)) return
    setConfig(prev => ({
      ...prev,
      unit_overrides: {
        ...prev.unit_overrides,
        [newUnit.name.trim().toLowerCase()]: weight,
      },
    }))
    setNewUnit({ name: '', weight: '' })
  }

  // Update a base weight
  const updateBaseWeight = (category, value) => {
    const numValue = parseFloat(value)
    if (isNaN(numValue)) return
    setConfig(prev => ({
      ...prev,
      base: {
        ...prev.base,
        [category]: numValue,
      },
    }))
  }

  // Update an item-specific weight
  const updateItemWeight = (item, unit, value) => {
    const numValue = parseFloat(value)
    if (isNaN(numValue)) return
    setConfig(prev => ({
      ...prev,
      item_specific: {
        ...prev.item_specific,
        [item]: {
          ...prev.item_specific[item],
          [unit]: numValue,
        },
      },
    }))
  }

  // Delete an item-specific override
  const deleteItemOverride = (item, unit) => {
    setConfig(prev => {
      const newItemSpecific = { ...prev.item_specific }
      if (newItemSpecific[item]) {
        const newItemUnits = { ...newItemSpecific[item] }
        delete newItemUnits[unit]
        if (Object.keys(newItemUnits).length === 0) {
          delete newItemSpecific[item]
        } else {
          newItemSpecific[item] = newItemUnits
        }
      }
      return { ...prev, item_specific: newItemSpecific }
    })
  }

  // Add a new item override
  const addItemOverride = () => {
    if (!newOverride.item.trim() || !newOverride.unit.trim() || !newOverride.weight) return
    const weight = parseFloat(newOverride.weight)
    if (isNaN(weight)) return
    const item = newOverride.item.trim().toLowerCase()
    const unit = newOverride.unit.trim().toLowerCase()
    setConfig(prev => ({
      ...prev,
      item_specific: {
        ...prev.item_specific,
        [item]: {
          ...(prev.item_specific[item] || {}),
          [unit]: weight,
        },
      },
    }))
    setNewOverride({ item: '', unit: '', weight: '' })
  }

  if (loading) {
    return (
      <div className="units-container">
        <div className="units-loading">Loading configuration...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="units-container">
        <div className="units-error">{error}</div>
        <button onClick={loadConfig}>Retry</button>
      </div>
    )
  }

  // Flatten item_specific for display
  const itemOverrides = []
  if (config?.item_specific) {
    Object.entries(config.item_specific).forEach(([item, units]) => {
      Object.entries(units).forEach(([unit, weight]) => {
        itemOverrides.push({ item, unit, weight })
      })
    })
  }
  itemOverrides.sort((a, b) => a.item.localeCompare(b.item) || a.unit.localeCompare(b.unit))

  // Sort unit overrides for display
  const unitOverrides = Object.entries(config?.unit_overrides || {}).sort((a, b) => a[0].localeCompare(b[0]))

  // Sort base weights for display
  const baseWeights = Object.entries(config?.base || {}).sort((a, b) => a[0].localeCompare(b[0]))

  return (
    <div className="units-container">
      <header className="units-header">
        <h1>Unit Weight Configuration</h1>
        <button
          className="units-save-btn"
          onClick={handleSave}
          disabled={saveStatus.state === 'saving'}
        >
          {saveStatus.state === 'saving' ? 'Saving...' : 'Save Changes'}
        </button>
      </header>

      {saveStatus.state !== 'idle' && (
        <div className={`units-status ${saveStatus.state}`}>
          {saveStatus.message}
        </div>
      )}

      <div className="units-content">
        {/* Unit Weights Section */}
        <section className="units-section">
          <h2>Unit Weights</h2>
          <p className="units-section-desc">Default weight in pounds for each unit type</p>
          <table className="units-table">
            <thead>
              <tr>
                <th>Unit</th>
                <th>Weight (lbs)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {unitOverrides.map(([unit, weight]) => (
                <tr key={unit}>
                  <td className="unit-name">{unit}</td>
                  <td>
                    <input
                      type="number"
                      value={weight}
                      onChange={(e) => updateUnitWeight(unit, e.target.value)}
                      step="0.1"
                      min="0"
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="units-remove-btn"
                      onClick={() => deleteUnit(unit)}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="units-add-row">
            <input
              type="text"
              placeholder="Unit name"
              value={newUnit.name}
              onChange={(e) => setNewUnit(prev => ({ ...prev, name: e.target.value }))}
            />
            <input
              type="number"
              placeholder="Weight"
              value={newUnit.weight}
              onChange={(e) => setNewUnit(prev => ({ ...prev, weight: e.target.value }))}
              step="0.1"
              min="0"
            />
            <button type="button" className="units-add-btn" onClick={addUnit}>
              + Add
            </button>
          </div>
        </section>

        {/* Category Base Weights Section */}
        <section className="units-section">
          <h2>Category Base Weights</h2>
          <p className="units-section-desc">Fallback weights by food category</p>
          <table className="units-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Weight (lbs)</th>
              </tr>
            </thead>
            <tbody>
              {baseWeights.map(([category, weight]) => (
                <tr key={category}>
                  <td className="unit-name">{category}</td>
                  <td>
                    <input
                      type="number"
                      value={weight}
                      onChange={(e) => updateBaseWeight(category, e.target.value)}
                      step="0.1"
                      min="0"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Item-Specific Overrides Section */}
        <section className="units-section">
          <h2>Item-Specific Overrides</h2>
          <p className="units-section-desc">Custom weights for specific item + unit combinations</p>
          <table className="units-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Unit</th>
                <th>Weight (lbs)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {itemOverrides.map(({ item, unit, weight }) => (
                <tr key={`${item}-${unit}`}>
                  <td className="unit-name">{item}</td>
                  <td className="unit-name">{unit}</td>
                  <td>
                    <input
                      type="number"
                      value={weight}
                      onChange={(e) => updateItemWeight(item, unit, e.target.value)}
                      step="0.1"
                      min="0"
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="units-remove-btn"
                      onClick={() => deleteItemOverride(item, unit)}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
              {itemOverrides.length === 0 && (
                <tr>
                  <td colSpan="4" className="units-empty">No item-specific overrides</td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="units-add-row">
            <input
              type="text"
              placeholder="Item name"
              value={newOverride.item}
              onChange={(e) => setNewOverride(prev => ({ ...prev, item: e.target.value }))}
            />
            <input
              type="text"
              placeholder="Unit"
              value={newOverride.unit}
              onChange={(e) => setNewOverride(prev => ({ ...prev, unit: e.target.value }))}
            />
            <input
              type="number"
              placeholder="Weight"
              value={newOverride.weight}
              onChange={(e) => setNewOverride(prev => ({ ...prev, weight: e.target.value }))}
              step="0.1"
              min="0"
            />
            <button type="button" className="units-add-btn" onClick={addItemOverride}>
              + Add
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

export default UnitsApp
