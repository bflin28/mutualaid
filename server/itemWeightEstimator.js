/* eslint-env node */
/**
 * Item weight estimation logic
 * Estimates pounds based on quantity, unit, and item name
 */

// Weight conversion table: unit -> approximate pounds
const UNIT_CONVERSIONS = {
  // Direct weight units
  'lb': 1,
  'lbs': 1,
  'pound': 1,
  'pounds': 1,

  // Volume/container units (estimated averages)
  'case': 25,      // Average case of produce/goods
  'cases': 25,
  'box': 15,       // Average box
  'boxes': 15,
  'bag': 5,        // Average bag
  'bags': 5,
  'pallets (full)': 800,   // Full pallet
  'pallets (small)': 250,  // Small/partial pallet
  'pallet': 500,   // Generic pallet (middle estimate)
  'pallets': 500,
  'crate': 30,     // Produce crate
  'crates': 30,

  // Count-based (rough estimates)
  'item': 1,
  'items': 1,
  'unit': 1,
  'units': 1,
}

// Item-specific weight multipliers (per unit/item)
const ITEM_WEIGHT_MULTIPLIERS = {
  // Produce (per item/unit)
  'apple': 0.33,
  'apples': 0.33,
  'banana': 0.25,
  'bananas': 0.25,
  'orange': 0.3,
  'oranges': 0.3,
  'potato': 0.5,
  'potatoes': 0.5,
  'sweet potato': 0.5,
  'sweet potatoes': 0.5,
  'onion': 0.3,
  'onions': 0.3,
  'carrot': 0.1,
  'carrots': 0.1,
  'broccoli': 1.5,
  'cauliflower': 2,
  'lettuce': 1,
  'cabbage': 2,

  // Dairy (per item/container)
  'milk': 8.6,     // Gallon of milk
  'yogurt': 2,
  'cheese': 1,

  // Meat (per package)
  'chicken': 3,
  'beef': 3,
  'pork': 3,
  'meat': 2.5,

  // Packaged goods (per item/package)
  'bread': 1.5,
  'cereal': 1,
  'pasta': 1,
  'rice': 2,

  // Eggs (per dozen)
  'eggs': 1.5,
  'egg': 1.5,
}

// Special case: if item contains certain keywords, use case-specific weights
const ITEM_CASE_WEIGHTS = {
  'produce': 30,
  'fruit': 30,
  'vegetables': 30,
  'veggies': 30,
  'meat': 40,
  'chicken': 40,
  'beef': 40,
  'pork': 40,
  'dairy': 35,
  'bread': 20,
  'baked goods': 15,
  'frozen': 35,
}

/**
 * Estimate weight in pounds for an item
 * @param {Object} item - Item object with name, quantity, unit, subcategory
 * @returns {number|null} - Estimated weight in pounds, or null if can't estimate
 */
export function estimateItemWeight(item) {
  if (!item) return null

  const { name = '', quantity = null, unit = '', subcategory = '' } = item

  // If quantity is missing or zero, can't estimate
  const qty = Number(quantity)
  if (!qty || !Number.isFinite(qty) || qty <= 0) {
    return null
  }

  // Normalize unit for lookup
  const normalizedUnit = String(unit || '').toLowerCase().trim()

  // Step 1: Check if unit is a direct weight unit (lbs, pounds)
  if (normalizedUnit === 'lb' || normalizedUnit === 'lbs' ||
      normalizedUnit === 'pound' || normalizedUnit === 'pounds') {
    return qty
  }

  // Step 2: Check for case/box with item-specific case weights
  if (normalizedUnit === 'case' || normalizedUnit === 'cases' ||
      normalizedUnit === 'box' || normalizedUnit === 'boxes') {
    const normalizedName = String(name || '').toLowerCase()

    // Check for keyword matches in item name
    for (const [keyword, weight] of Object.entries(ITEM_CASE_WEIGHTS)) {
      if (normalizedName.includes(keyword)) {
        return qty * weight
      }
    }

    // Check subcategory
    const normalizedSubcat = String(subcategory || '').toLowerCase()
    if (ITEM_CASE_WEIGHTS[normalizedSubcat]) {
      return qty * ITEM_CASE_WEIGHTS[normalizedSubcat]
    }

    // Fall back to default case weight
    return qty * UNIT_CONVERSIONS[normalizedUnit]
  }

  // Step 3: Check for item-specific weight multipliers
  const normalizedName = String(name || '').toLowerCase().trim()
  for (const [itemKey, weight] of Object.entries(ITEM_WEIGHT_MULTIPLIERS)) {
    if (normalizedName.includes(itemKey)) {
      return qty * weight
    }
  }

  // Step 4: Use generic unit conversion
  if (UNIT_CONVERSIONS[normalizedUnit]) {
    return qty * UNIT_CONVERSIONS[normalizedUnit]
  }

  // Step 5: If we have subcategory but no unit, make rough estimate
  if (!normalizedUnit || normalizedUnit === 'items' || normalizedUnit === 'item') {
    const normalizedSubcat = String(subcategory || '').toLowerCase()
    if (normalizedSubcat === 'produce') return qty * 1
    if (normalizedSubcat === 'meat') return qty * 2
    if (normalizedSubcat === 'dairy') return qty * 2
    if (normalizedSubcat === 'bread' || normalizedSubcat === 'grain') return qty * 1.5
    if (normalizedSubcat === 'snacks') return qty * 0.5
  }

  // Can't estimate - return null
  return null
}

/**
 * Calculate total estimated weight for an array of items
 * @param {Array} items - Array of item objects
 * @returns {number} - Total estimated weight in pounds
 */
export function calculateTotalWeight(items) {
  if (!Array.isArray(items)) return 0

  return items.reduce((total, item) => {
    const weight = estimateItemWeight(item)
    return total + (weight || 0)
  }, 0)
}

/**
 * Add estimated_lbs to items that don't have it
 * @param {Array} items - Array of item objects
 * @returns {Array} - Items with estimated_lbs added
 */
export function addEstimatedWeights(items) {
  if (!Array.isArray(items)) return []

  return items.map(item => {
    // If item already has estimated_lbs, keep it
    if (item.estimated_lbs !== null && item.estimated_lbs !== undefined) {
      return item
    }

    // Otherwise, estimate it
    const estimated_lbs = estimateItemWeight(item)
    return {
      ...item,
      estimated_lbs: estimated_lbs !== null ? Math.round(estimated_lbs * 10) / 10 : null
    }
  })
}
