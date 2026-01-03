import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyTotals, formatNormalizedSummary, mergeTotals } from './slackUtils.js'

test('formats a concise Slack summary with canonical units', () => {
  const summary = formatNormalizedSummary({
    items: [
      {
        quantity: 2,
        unit: 'sacks',
        item: 'potatoes',
        canonicalQuantity: 2,
        canonicalUnit: 'bag',
        unitKind: 'container',
      },
      {
        quantity: 5,
        unit: 'lbs',
        item: 'onions',
        canonicalQuantity: 5,
        canonicalUnit: 'lb',
        unitKind: 'weight',
      },
    ],
    totals: {
      weightLb: 5,
      volumeGallons: 0,
      containers: { bag: 2 },
      countEach: 0,
    },
  })

  assert.ok(summary.includes('Parsed food log'))
  assert.ok(summary.includes('2 sacks'))
  assert.ok(summary.includes('5 lbs') || summary.includes('5 lb'))
  assert.ok(summary.toLowerCase().includes('totals'))
})

test('mergeTotals sums weight, volume, count, and containers', () => {
  const merged = mergeTotals(
    {
      weightLb: 5,
      volumeGallons: 1,
      containers: { bag: 2 },
      countEach: 0,
    },
    {
      weightLb: 3,
      volumeGallons: 0.5,
      containers: { bag: 1, case: 3 },
      countEach: 4,
    },
  )

  assert.equal(merged.weightLb, 8)
  assert.equal(merged.volumeGallons, 1.5)
  assert.equal(merged.containers.bag, 3)
  assert.equal(merged.containers.case, 3)
  assert.equal(merged.countEach, 4)
  assert.deepEqual(emptyTotals().containers, {})
})
