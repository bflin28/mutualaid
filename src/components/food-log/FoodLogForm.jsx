import { useState, useEffect } from 'react'
import { Plus, ClipboardPaste, Send } from 'lucide-react'
import { toast } from 'sonner'
import { ItemRow } from './ItemRow'
import { useLocations } from '../../hooks/useLocations'
import { createFoodLog, parseFoodText } from '../../lib/api'

const emptyItem = () => ({
  id: Date.now().toString() + Math.random(),
  name: '',
  quantity: '',
  unit: '',
  gcfd_category: '',
  estimated_lbs: '',
})

export function FoodLogForm() {
  const { locations } = useLocations()
  const [rescueLocation, setRescueLocation] = useState('')
  const [dropOffLocation, setDropOffLocation] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [rescuedBy, setRescuedBy] = useState('')
  const [items, setItems] = useState([emptyItem()])
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [pasteMode, setPasteMode] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [parsing, setParsing] = useState(false)

  const rescueLocations = locations.filter(l => l.type === 'rescue' || l.type === 'both')
  const dropOffLocations = locations.filter(l => l.type === 'drop_off' || l.type === 'both')

  const addItem = () => setItems([...items, emptyItem()])

  const removeItem = (id) => {
    if (items.length > 1) setItems(items.filter(i => i.id !== id))
  }

  const updateItem = (id, updated) => {
    setItems(items.map(i => i.id === id ? { ...i, ...updated } : i))
  }

  const totalLbs = items.reduce((sum, i) => sum + (Number(i.estimated_lbs) || 0), 0)

  const handlePaste = async () => {
    if (!pasteText.trim()) return
    setParsing(true)
    try {
      const result = await parseFoodText(pasteText)
      if (result.items?.length) {
        const newItems = result.items.map(item => ({
          ...emptyItem(),
          name: item.name || '',
          quantity: item.quantity || '',
          unit: item.unit || '',
          gcfd_category: item.gcfd_category || '',
          estimated_lbs: item.estimated_lbs || '',
        }))
        setItems(newItems)
      }
      if (result.inferred_location) {
        setRescueLocation(result.inferred_location)
      }
      setPasteMode(false)
      setPasteText('')
      toast.success(`Parsed ${result.items?.length || 0} items`)
    } catch (err) {
      toast.error('Failed to parse text: ' + err.message)
    } finally {
      setParsing(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!rescueLocation) {
      toast.error('Please select a rescue location')
      return
    }

    const validItems = items.filter(i => i.name.trim())
    if (validItems.length === 0) {
      toast.error('Please add at least one item')
      return
    }

    setSubmitting(true)
    try {
      await createFoodLog({
        rescue_location: rescueLocation,
        drop_off_location: dropOffLocation || undefined,
        rescued_at: date,
        rescued_by: rescuedBy || undefined,
        items: validItems.map(({ name, quantity, unit, gcfd_category, estimated_lbs }) => ({
          name,
          quantity: Number(quantity) || undefined,
          unit: unit || undefined,
          gcfd_category: gcfd_category || undefined,
          estimated_lbs: Number(estimated_lbs) || undefined,
        })),
        notes: notes || undefined,
      })

      toast.success('Food rescue logged successfully!')

      // Reset form
      setRescueLocation('')
      setDropOffLocation('')
      setDate(new Date().toISOString().slice(0, 10))
      setRescuedBy('')
      setItems([emptyItem()])
      setNotes('')
    } catch (err) {
      toast.error('Failed to save: ' + err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-gray-900">Log Food Rescue</h2>
        <p className="text-gray-500 mt-1">Record rescued food items and estimated weights</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Rescue location */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Rescued From</label>
          <select
            value={rescueLocation}
            onChange={(e) => setRescueLocation(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
          >
            <option value="">Select location...</option>
            {rescueLocations.map(l => (
              <option key={l.id} value={l.name}>{l.name}</option>
            ))}
          </select>
        </div>

        {/* Drop-off location */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Drop Off To</label>
          <select
            value={dropOffLocation}
            onChange={(e) => setDropOffLocation(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
          >
            <option value="">Select location...</option>
            {dropOffLocations.map(l => (
              <option key={l.id} value={l.name}>{l.name}</option>
            ))}
          </select>
        </div>

        {/* Date and rescued by */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Rescued By</label>
            <input
              type="text"
              placeholder="Volunteer name"
              value={rescuedBy}
              onChange={(e) => setRescuedBy(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
            />
          </div>
        </div>

        {/* Items header */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-medium text-gray-700">Items</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPasteMode(!pasteMode)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-gray-300 text-gray-600 rounded-md hover:bg-gray-50 transition-colors"
              >
                <ClipboardPaste className="w-4 h-4" />
                Paste
              </button>
              <button
                type="button"
                onClick={addItem}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-green-600 text-green-600 rounded-md hover:bg-green-600 hover:text-white transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Item
              </button>
            </div>
          </div>

          {/* Paste from Slack */}
          {pasteMode && (
            <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg space-y-3">
              <p className="text-sm text-amber-800">Paste a Slack message or food list to auto-parse items:</p>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="e.g.&#10;3 cases produce&#10;2 boxes bread&#10;1 case meat"
                rows={5}
                className="w-full px-3 py-2 border border-amber-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handlePaste}
                  disabled={parsing}
                  className="px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-md hover:bg-amber-700 disabled:opacity-50 transition-colors"
                >
                  {parsing ? 'Parsing...' : 'Parse Items'}
                </button>
                <button
                  type="button"
                  onClick={() => { setPasteMode(false); setPasteText('') }}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Item rows */}
          <div className="space-y-3">
            {items.map((item, index) => (
              <ItemRow
                key={item.id}
                item={item}
                index={index}
                onChange={(updated) => updateItem(item.id, updated)}
                onRemove={() => removeItem(item.id)}
                canRemove={items.length > 1}
              />
            ))}
          </div>
        </div>

        {/* Total weight */}
        {totalLbs > 0 && (
          <div className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg">
            <span className="text-sm font-medium text-green-800">Estimated Total</span>
            <span className="text-xl font-bold text-green-700">{Math.round(totalLbs)} lbs</span>
          </div>
        )}

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes..."
            rows={2}
            className="w-full px-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting}
          className="w-full flex items-center justify-center gap-2 py-3 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          <Send className="w-4 h-4" />
          {submitting ? 'Saving...' : 'Save Log'}
        </button>
      </form>
    </div>
  )
}
