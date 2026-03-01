// Cache categories from DB
let categoriesCache = null
let cacheTime = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export async function loadCategories(supabase) {
  const now = Date.now()
  if (categoriesCache && now - cacheTime < CACHE_TTL) {
    return categoriesCache
  }

  const { data, error } = await supabase
    .from('food_categories')
    .select('*')
    .order('sort_order')

  if (error) {
    console.error('Failed to load food categories:', error.message)
    return categoriesCache || getFallbackCategories()
  }

  categoriesCache = data
  cacheTime = now
  return data
}

export function detectCategory(itemName, categories) {
  if (!itemName || !categories) return null
  const normalized = itemName.toLowerCase().trim()

  for (const cat of categories) {
    for (const keyword of cat.keywords || []) {
      if (normalized.includes(keyword)) {
        return cat
      }
    }
  }
  return null
}

export function estimateWeight(quantity, category) {
  if (!quantity || !category) return null
  return Math.round(quantity * category.avg_lbs * 10) / 10
}

export function addCategoryAndWeight(items, categories) {
  return items.map(item => {
    const cat = item.gcfd_category
      ? categories.find(c => c.gcfd_category === item.gcfd_category)
      : detectCategory(item.name, categories)

    const gcfd_category = cat ? cat.gcfd_category : item.gcfd_category || null
    const estimated_lbs = item.estimated_lbs
      || (item.quantity && cat ? estimateWeight(item.quantity, cat) : null)

    return { ...item, gcfd_category, estimated_lbs }
  })
}

function getFallbackCategories() {
  return [
    { gcfd_category: 'Bread/Bakery', avg_lbs: 15, keywords: ['bread', 'bakery', 'pastry', 'roll', 'bun', 'bagel'] },
    { gcfd_category: 'Produce', avg_lbs: 25, keywords: ['apple', 'banana', 'potato', 'tomato', 'carrot', 'lettuce', 'vegetable', 'fruit', 'produce'] },
    { gcfd_category: 'Non-Food', avg_lbs: 25, keywords: ['toilet paper', 'hygiene', 'soap', 'diaper'] },
    { gcfd_category: 'Dairy', avg_lbs: 40, keywords: ['milk', 'water', 'juice', 'soda', 'drink', 'coffee', 'tea'] },
    { gcfd_category: 'Grocery', avg_lbs: 25, keywords: ['cereal', 'pasta', 'rice', 'bean', 'canned', 'soup', 'dry'] },
    { gcfd_category: 'Deli/Prepared', avg_lbs: 30, keywords: ['egg', 'yogurt', 'cheese', 'deli', 'prepared', 'hummus'] },
    { gcfd_category: 'Meat', avg_lbs: 45, keywords: ['chicken', 'beef', 'pork', 'meat', 'fish', 'seafood', 'salmon'] },
    { gcfd_category: 'Assorted Freezer', avg_lbs: 25, keywords: ['frozen', 'ice cream', 'pizza', 'waffle'] },
  ]
}
