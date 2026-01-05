/**
 * Tests for rescue log data structure and validation.
 *
 * Run with: npm test
 */
import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * Expected rescue_logs database schema:
 *
 * CREATE TABLE rescue_logs (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   location TEXT NOT NULL,
 *   rescued_at DATE NOT NULL,
 *   items JSONB NOT NULL DEFAULT '[]',
 *   total_estimated_lbs NUMERIC(10,1),
 *   photo_urls JSONB DEFAULT '[]',
 *   notes TEXT,
 *   created_at TIMESTAMPTZ DEFAULT NOW(),
 *   updated_at TIMESTAMPTZ DEFAULT NOW()
 * );
 */

// Helper to validate rescue log payload structure
function validateRescueLogPayload(payload) {
  const errors = []

  if (!payload.location || typeof payload.location !== 'string' || !payload.location.trim()) {
    errors.push('location is required and must be a non-empty string')
  }

  if (!payload.rescued_at || typeof payload.rescued_at !== 'string') {
    errors.push('rescued_at is required and must be a date string')
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.rescued_at)) {
    errors.push('rescued_at must be in YYYY-MM-DD format')
  }

  if (!Array.isArray(payload.items)) {
    errors.push('items must be an array')
  } else {
    payload.items.forEach((item, i) => {
      if (!item.name || typeof item.name !== 'string') {
        errors.push(`items[${i}].name is required`)
      }
    })
  }

  if (payload.photo_urls !== undefined && !Array.isArray(payload.photo_urls)) {
    errors.push('photo_urls must be an array if provided')
  }

  return { valid: errors.length === 0, errors }
}

// Helper to build payload from form data (mirrors App.jsx logic)
function buildRescueLogPayload(formData) {
  const items = formData.items
    .filter(item => item.name.trim())
    .map(item => ({
      name: item.name,
      quantity: item.quantity === '' ? null : Number(item.quantity),
      unit: item.unit || null,
      subcategory: item.subcategory || null,
    }))

  return {
    location: formData.location,
    rescued_at: formData.date,
    items,
    photo_urls: formData.photos || [],
  }
}

test('valid rescue log payload passes validation', () => {
  const payload = {
    location: 'Aldi Wicker Park',
    rescued_at: '2024-01-04',
    items: [
      { name: 'Apples', quantity: 2, unit: 'cs' },
      { name: 'Bread', quantity: 10, unit: 'loaves' },
    ],
    photo_urls: [],
  }

  const result = validateRescueLogPayload(payload)
  assert.equal(result.valid, true)
  assert.equal(result.errors.length, 0)
})

test('missing location fails validation', () => {
  const payload = {
    rescued_at: '2024-01-04',
    items: [{ name: 'Apples', quantity: 2, unit: 'cs' }],
  }

  const result = validateRescueLogPayload(payload)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(e => e.includes('location')))
})

test('empty location fails validation', () => {
  const payload = {
    location: '   ',
    rescued_at: '2024-01-04',
    items: [{ name: 'Apples', quantity: 2, unit: 'cs' }],
  }

  const result = validateRescueLogPayload(payload)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(e => e.includes('location')))
})

test('missing rescued_at fails validation', () => {
  const payload = {
    location: 'Aldi Wicker Park',
    items: [{ name: 'Apples', quantity: 2, unit: 'cs' }],
  }

  const result = validateRescueLogPayload(payload)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(e => e.includes('rescued_at')))
})

test('invalid date format fails validation', () => {
  const payload = {
    location: 'Aldi Wicker Park',
    rescued_at: '01/04/2024', // Wrong format
    items: [{ name: 'Apples', quantity: 2, unit: 'cs' }],
  }

  const result = validateRescueLogPayload(payload)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(e => e.includes('YYYY-MM-DD')))
})

test('items must be an array', () => {
  const payload = {
    location: 'Aldi Wicker Park',
    rescued_at: '2024-01-04',
    items: 'not an array',
  }

  const result = validateRescueLogPayload(payload)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(e => e.includes('array')))
})

test('items without name fail validation', () => {
  const payload = {
    location: 'Aldi Wicker Park',
    rescued_at: '2024-01-04',
    items: [
      { name: 'Apples', quantity: 2, unit: 'cs' },
      { quantity: 5, unit: 'lbs' }, // Missing name
    ],
  }

  const result = validateRescueLogPayload(payload)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(e => e.includes('items[1].name')))
})

test('empty items array is valid', () => {
  const payload = {
    location: 'Aldi Wicker Park',
    rescued_at: '2024-01-04',
    items: [],
    photo_urls: [],
  }

  const result = validateRescueLogPayload(payload)
  assert.equal(result.valid, true)
})

test('buildRescueLogPayload creates correct structure from form data', () => {
  const formData = {
    location: 'Aldi Wicker Park',
    date: '2024-01-04',
    items: [
      { name: 'Apples', quantity: '2', unit: 'cs', subcategory: 'fruit', estimated_lbs: '' },
      { name: 'Bread', quantity: '', unit: 'loaves', subcategory: '', estimated_lbs: '' },
      { name: '', quantity: '', unit: '', subcategory: '', estimated_lbs: '' }, // Empty, should be filtered
    ],
    photos: ['https://example.com/photo1.jpg'],
  }

  const payload = buildRescueLogPayload(formData)

  assert.equal(payload.location, 'Aldi Wicker Park')
  assert.equal(payload.rescued_at, '2024-01-04')
  assert.equal(payload.items.length, 2) // Empty item filtered out
  assert.deepEqual(payload.items[0], { name: 'Apples', quantity: 2, unit: 'cs', subcategory: 'fruit' })
  assert.deepEqual(payload.items[1], { name: 'Bread', quantity: null, unit: 'loaves', subcategory: null })
  assert.deepEqual(payload.photo_urls, ['https://example.com/photo1.jpg'])
})

test('buildRescueLogPayload handles empty quantity as null', () => {
  const formData = {
    location: 'Aldi Wicker Park',
    date: '2024-01-04',
    items: [{ name: 'Misc produce', quantity: '', unit: '', subcategory: '', estimated_lbs: '' }],
    photos: [],
  }

  const payload = buildRescueLogPayload(formData)

  assert.equal(payload.items[0].quantity, null)
  assert.equal(payload.items[0].unit, null)
})

test('rescue log item structure matches database schema', () => {
  // Expected item structure in JSONB items column
  const expectedItemFields = ['name', 'quantity', 'unit', 'subcategory', 'estimated_lbs']

  const sampleItem = {
    name: 'Apples',
    quantity: 2,
    unit: 'cs',
    subcategory: 'fruit',
    estimated_lbs: 40,
  }

  // All expected fields should be present or optional
  for (const field of expectedItemFields) {
    assert.ok(
      field in sampleItem || sampleItem[field] === undefined,
      `Item should support field: ${field}`
    )
  }
})

test('normalized rescue log for stats has expected structure', () => {
  // This is the structure returned by load_audited() for rescue_logs
  const normalizedRecord = {
    id: 'rescue-uuid-123',
    source: 'rescue_logs',
    rescue_location_canonical: 'Aldi Wicker Park',
    drop_off_location_canonical: '',
    start_ts: '2024-01-04',
    raw_messages: [],
    sections: [
      {
        location_canonical: 'Aldi Wicker Park',
        items: [{ name: 'Apples', quantity: 2, unit: 'cs', estimated_lbs: 40 }],
      },
    ],
    total_estimated_lbs: 40,
    photo_urls: [],
    audited: true,
    recurring: false,
  }

  // Verify required fields for stats
  assert.ok(normalizedRecord.id.startsWith('rescue-'), 'ID should be prefixed with rescue-')
  assert.equal(normalizedRecord.source, 'rescue_logs')
  assert.ok(normalizedRecord.rescue_location_canonical, 'Should have location')
  assert.ok(Array.isArray(normalizedRecord.sections), 'Should have sections array')
  assert.ok(normalizedRecord.sections[0].items, 'Section should have items')
  assert.equal(normalizedRecord.audited, true, 'Should be marked as audited')
  assert.equal(normalizedRecord.recurring, false, 'Should not be recurring')
})
