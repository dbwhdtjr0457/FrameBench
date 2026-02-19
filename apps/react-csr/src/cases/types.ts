import type { Item, SortOption } from '../domain'

export type BenchCaseId = 'use-state' | 'zustand' | 'react-query'

export type BenchCaseDescriptor = {
  id: BenchCaseId
  name: string
  description: string
  tech: string[]
}

export type BenchController = {
  search: string
  debouncedSearch: string
  sort: SortOption
  category: string
  setSearch: (value: string) => void
  setSort: (value: SortOption) => void
  setCategory: (value: string) => void
  items: Item[]
  cartCount: number
  hasInCart: (id: number) => boolean
  addToCart: (id: number) => void
}

export const BENCH_CASES: BenchCaseDescriptor[] = [
  {
    id: 'use-state',
    name: 'React useState',
    description: '기본 React 상태(useState + useMemo)로 동작하는 기준 케이스',
    tech: ['react'],
  },
  {
    id: 'zustand',
    name: 'Zustand',
    description: '필터/장바구니 상태를 Zustand 스토어로 관리하는 케이스',
    tech: ['react', 'zustand'],
  },
  {
    id: 'react-query',
    name: 'React Query',
    description: '로컬 데이터 로딩을 React Query 캐시 계층으로 처리하는 케이스',
    tech: ['react', 'tanstack-query'],
  },
]

export function parseBenchCaseId(value: string | null): BenchCaseId {
  const found = BENCH_CASES.find((item) => item.id === value)
  return found?.id ?? 'use-state'
}

export function findBenchCase(caseId: BenchCaseId): BenchCaseDescriptor {
  return BENCH_CASES.find((item) => item.id === caseId) ?? BENCH_CASES[0]
}
