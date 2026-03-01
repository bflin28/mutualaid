import { useState, useRef, useEffect } from 'react'
import { Trash2 } from 'lucide-react'
import { FOOD_CATEGORIES, UNIT_OPTIONS } from '../../lib/constants'
import itemSuggestions from '../../data/item_suggestions.json'

export function ItemRow({ item, index, onChange, onRemove, canRemove }) {
  const [suggestions, setSuggestions] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const inputRef = useRef(null)

  const handleNameChange = (value) => {
    onChange({ ...item, name: value })

    if (value.length >= 2) {
      const lower = value.toLowerCase()
      const matches = itemSuggestions
        .filter(s => s.toLowerCase().includes(lower))
        .slice(0, 8)
      setSuggestions(matches)
      setShowSuggestions(matches.length > 0)
    } else {
      setShowSuggestions(false)
    }
  }

  const selectSuggestion = (name) => {
    onChange({ ...item, name })
    setShowSuggestions(false)
  }

  const handleQuantityChange = (qty) => {
    const quantity = qty === '' ? '' : Number(qty)
    const cat = FOOD_CATEGORIES.find(c => c.name === item.gcfd_category)
    const estimated_lbs = quantity && cat ? Math.round(quantity * cat.avgLbs * 10) / 10 : ''
    onChange({ ...item, quantity, estimated_lbs: estimated_lbs || item.estimated_lbs })
  }

  const handleCategoryChange = (gcfd_category) => {
    const cat = FOOD_CATEGORIES.find(c => c.name === gcfd_category)
    const estimated_lbs = item.quantity && cat ? Math.round(item.quantity * cat.avgLbs * 10) / 10 : ''
    onChange({ ...item, gcfd_category, estimated_lbs: estimated_lbs || item.estimated_lbs })
  }

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e) => {
      if (inputRef.current && !inputRef.current.contains(e.target)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-green-600 text-xs font-semibold tracking-wide">
          ITEM {index + 1}
        </span>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1 rounded transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="space-y-3">
        {/* Item name with autocomplete */}
        <div className="relative" ref={inputRef}>
          <label className="block text-xs font-medium text-gray-500 mb-1">ITEM</label>
          <input
            type="text"
            placeholder="Type to search..."
            value={item.name}
            onChange={(e) => handleNameChange(e.target.value)}
            onFocus={() => item.name.length >= 2 && suggestions.length > 0 && setShowSuggestions(true)}
            className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
          />
          {showSuggestions && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-auto">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => selectSuggestion(s)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-green-50 hover:text-green-700"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Qty and Unit */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">QTY</label>
            <input
              type="number"
              placeholder="0"
              value={item.quantity}
              onChange={(e) => handleQuantityChange(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">UNIT</label>
            <select
              value={item.unit}
              onChange={(e) => onChange({ ...item, unit: e.target.value })}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
            >
              <option value="">--</option>
              {UNIT_OPTIONS.map(u => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Category and estimated lbs */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">CATEGORY</label>
            <select
              value={item.gcfd_category}
              onChange={(e) => handleCategoryChange(e.target.value)}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
            >
              <option value="">--</option>
              {FOOD_CATEGORIES.map(c => (
                <option key={c.name} value={c.name}>{c.name} ({c.avgLbs} lbs)</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">EST. LBS</label>
            <input
              type="number"
              placeholder="auto"
              value={item.estimated_lbs}
              onChange={(e) => onChange({ ...item, estimated_lbs: e.target.value === '' ? '' : Number(e.target.value) })}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
