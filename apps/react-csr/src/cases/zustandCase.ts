import { useEffect } from 'react'
import { create } from 'zustand'
import { ITEMS, type SortOption } from '../domain'
import type { BenchController } from './types'

const DEBOUNCE_MS = 250

type ZustandBenchState = {
  search: string
  debouncedSearch: string
  sort: SortOption
  category: string
  cartIds: number[]
  setSearch: (value: string) => void
  setDebouncedSearch: (value: string) => void
  setSort: (value: SortOption) => void
  setCategory: (value: string) => void
  addToCart: (id: number) => void
  reset: () => void
}

const initialState = {
  search: '',
  debouncedSearch: '',
  sort: 'id-asc' as SortOption,
  category: 'all',
  cartIds: [] as number[],
}

const useZustandStore = create<ZustandBenchState>((set) => ({
  ...initialState,
  setSearch: (value) => set({ search: value }),
  setDebouncedSearch: (value) => set({ debouncedSearch: value }),
  setSort: (value) => set({ sort: value }),
  setCategory: (value) => set({ category: value }),
  addToCart: (id) =>
    set((state) => ({
      cartIds: state.cartIds.includes(id) ? state.cartIds : [...state.cartIds, id],
    })),
  reset: () => set(initialState),
}))

export function useZustandCaseController(): BenchController {
  const search = useZustandStore((state) => state.search)
  const debouncedSearch = useZustandStore((state) => state.debouncedSearch)
  const sort = useZustandStore((state) => state.sort)
  const category = useZustandStore((state) => state.category)
  const cartIds = useZustandStore((state) => state.cartIds)

  const setSearch = useZustandStore((state) => state.setSearch)
  const setDebouncedSearch = useZustandStore((state) => state.setDebouncedSearch)
  const setSort = useZustandStore((state) => state.setSort)
  const setCategory = useZustandStore((state) => state.setCategory)
  const addToCart = useZustandStore((state) => state.addToCart)
  const reset = useZustandStore((state) => state.reset)

  useEffect(() => {
    reset()
  }, [reset])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [search, setDebouncedSearch])

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
