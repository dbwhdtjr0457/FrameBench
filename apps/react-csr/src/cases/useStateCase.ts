import { useEffect, useState } from 'react'
import { ITEMS, type SortOption } from '../domain'
import type { BenchController } from './types'

const DEBOUNCE_MS = 250

export function useUseStateCaseController(): BenchController {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sort, setSort] = useState<SortOption>('id-asc')
  const [category, setCategory] = useState('all')
  const [cartIds, setCartIds] = useState<number[]>([])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [search])

  const addToCart = (id: number) => {
    setCartIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
  }

  return {
    search,
    debouncedSearch,
    sort,
    category,
    setSearch,
    setSort,
    setCategory,
    items: ITEMS,
    cartCount: cartIds.length,
    hasInCart: (id: number) => cartIds.includes(id),
    addToCart,
  }
}
