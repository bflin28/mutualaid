import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeFoodLogText, parseFoodLogLine } from './foodLogParser.js'

test('normalizes container-style lines from Slack logs', () => {
  const sample = `
  - 2 sacks potatoes
  - 5 cartons of milk
  -1 pallett blackberries
  `

  const { items, totals, unparsed } = normalizeFoodLogText(sample)

  assert.equal(unparsed.length, 0)
  assert.equal(items.length, 3)

  const potatoes = items.find((item) => item.item.toLowerCase().includes('potato'))
  const milk = items.find((item) => item.item.toLowerCase().includes('milk'))
  const berries = items.find((item) => item.item.toLowerCase().includes('blackberries'))

  assert.equal(potatoes.canonicalUnit, 'bag')
  assert.equal(potatoes.quantity, 2)
  assert.equal(milk.canonicalUnit, 'case')
  assert.equal(berries.canonicalUnit, 'pallet')

  assert.equal(totals.containers.bag, 2)
  assert.equal(totals.containers.case, 5)
  assert.equal(totals.containers.pallet, 1)
})

test('converts weight and volume into canonical gallons and pounds', () => {
  const sample = `
  about 10 lbs apples
  4 kg rice
  3 gallons soup
  `

  const { items, totals } = normalizeFoodLogText(sample)

  const rice = items.find((item) => item.item.toLowerCase().includes('rice'))
  const soup = items.find((item) => item.item.toLowerCase().includes('soup'))

  assert.ok(Math.abs(rice.canonicalQuantity - 8.818) < 0.05)
  assert.equal(soup.canonicalUnit, 'gallon')
  assert.ok(totals.weightLb > 18.7 && totals.weightLb < 19)
  assert.equal(totals.volumeGallons, 3)
})

test('falls back to count when no unit is provided', () => {
  const parsed = parseFoodLogLine('12 cucumbers')

  assert.equal(parsed.canonicalUnit, 'each')
  assert.equal(parsed.unitKind, 'count')
  assert.equal(parsed.quantity, 12)
  assert.ok(parsed.confidence < 0.8)
})
