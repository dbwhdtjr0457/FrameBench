import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ITEMS, type Item, type SortOption } from '../domain'
import type { BenchController } from './types'

const DEBOUNCE_MS = 250

async function loadItems(): Promise<Item[]> {
  await Promise.resolve()
  return ITEMS
}

export function useReactQueryCaseController(): BenchController {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sort, setSort] = useState<SortOption>('id-asc')
  const [category, setCategory] = useState('all')
  const [cartIds, setCartIds] = useState<number[]>([])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [search])

  const itemsQuery = useQuery({
    queryKey: ['framebench', 'items'],
    queryFn: loadItems,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  })

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
    items: itemsQuery.data ?? [],
    cartCount: cartIds.length,
    hasInCart: (id: number) => cartIds.includes(id),
    addToCart,
  }
}
