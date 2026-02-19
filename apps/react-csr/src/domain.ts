import itemsData from './data/items.json'

export type Item = {
  id: number
  title: string
  category: string
  price: number
  description: string
}

export type SortOption = 'id-asc' | 'title-asc' | 'title-desc' | 'price-asc' | 'price-desc'

export const ITEMS = itemsData as Item[]
export const CATEGORIES = ['all', ...Array.from(new Set(ITEMS.map((item) => item.category)))]

export function filterAndSortItems(
  source: Item[],
  search: string,
  category: string,
  sort: SortOption,
) {
  let result = source

  if (search.trim()) {
    const needle = search.toLowerCase().trim()
    result = result.filter((item) => item.title.toLowerCase().includes(needle))
  }

  if (category !== 'all') {
    result = result.filter((item) => item.category === category)
  }

  const sorted = [...result]
  switch (sort) {
    case 'title-asc':
      sorted.sort((a, b) => a.title.localeCompare(b.title))
      break
    case 'title-desc':
      sorted.sort((a, b) => b.title.localeCompare(a.title))
      break
    case 'price-asc':
      sorted.sort((a, b) => a.price - b.price)
      break
    case 'price-desc':
      sorted.sort((a, b) => b.price - a.price)
      break
    default:
      sorted.sort((a, b) => a.id - b.id)
  }

  return sorted
}
