import type { DashboardData, FeatureSet, RunRecord, Scenario, Variant } from './types'

export const DASHBOARD_STORAGE_KEY = 'framebench:dashboard:v1'

const seedVariants: Variant[] = [
  {
    id: 'vanilla',
    name: '바닐라 JS',
    baseUrl: 'http://localhost:3001',
    manifestUrl: 'http://localhost:3001/manifest.json',
    enabled: true,
    tags: ['baseline', 'vanilla'],
    supportedFeatures: ['core', 'metrics'],
  },
  {
    id: 'react-csr-state',
    name: '리액트 CSR (useState)',
    baseUrl: 'http://localhost:3002',
    manifestUrl: 'http://localhost:3002/manifest.json',
    enabled: true,
    tags: ['react', 'csr', 'case:use-state'],
    supportedFeatures: ['core', 'metrics', 'multi-case'],
  },
  {
    id: 'react-csr-zustand',
    name: '리액트 CSR (Zustand)',
    baseUrl: 'http://localhost:3002',
    manifestUrl: 'http://localhost:3002/manifest.json',
    enabled: true,
    tags: ['react', 'csr', 'zustand', 'case:zustand'],
    supportedFeatures: ['core', 'metrics', 'multi-case'],
  },
  {
    id: 'react-csr-query',
    name: '리액트 CSR (React Query)',
    baseUrl: 'http://localhost:3002',
    manifestUrl: 'http://localhost:3002/manifest.json',
    enabled: true,
    tags: ['react', 'csr', 'tanstack-query', 'case:react-query'],
    supportedFeatures: ['core', 'metrics', 'multi-case'],
  },
]

const seedFeatureSets: FeatureSet[] = [
  {
    id: 'core-only',
    name: '코어 기능만',
    features: ['core'],
  },
  {
    id: 'core-metrics',
    name: '코어 + 메트릭',
    features: ['core', 'metrics'],
  },
]

const seedScenarios: Scenario[] = [
  {
    id: 'browse-detail',
    name: '목록 탐색 후 상세 진입',
    steps: ['open /list', 'search 상품 20', 'open /detail/20', 'click .actions button'],
    requiredFeatures: ['core', 'metrics'],
  },
]

const seedRuns: RunRecord[] = []

function appendMissingById<T extends { id: string }>(source: T[], defaults: T[]) {
  const existing = new Set(source.map((item) => item.id))
  const appended = defaults.filter((item) => !existing.has(item.id))
  return [...source, ...appended]
}

export function makeSeedData(): DashboardData {
  return {
    variants: [...seedVariants],
    featureSets: [...seedFeatureSets],
    scenarios: [...seedScenarios],
    runs: [...seedRuns],
    activeFeatureSetId: seedFeatureSets[1].id,
    excludeUnsupportedFromMeasurement: true,
  }
}

export function readDashboardData(): DashboardData {
  const raw = localStorage.getItem(DASHBOARD_STORAGE_KEY)
  if (!raw) {
    const seed = makeSeedData()
    persistDashboardData(seed)
    return seed
  }

  try {
    const parsed = JSON.parse(raw) as DashboardData
    if (!parsed.variants || !parsed.featureSets || !parsed.scenarios || !parsed.runs) {
      throw new Error('저장 데이터 형식이 올바르지 않습니다')
    }

    const merged: DashboardData = {
      ...parsed,
      variants: appendMissingById(parsed.variants, seedVariants),
      featureSets: appendMissingById(parsed.featureSets, seedFeatureSets),
      scenarios: appendMissingById(parsed.scenarios, seedScenarios),
      runs: parsed.runs,
      activeFeatureSetId: parsed.activeFeatureSetId || seedFeatureSets[1].id,
      excludeUnsupportedFromMeasurement: parsed.excludeUnsupportedFromMeasurement ?? true,
    }

    if (JSON.stringify(merged) !== JSON.stringify(parsed)) {
      persistDashboardData(merged)
    }

    return merged
  } catch {
    const seed = makeSeedData()
    persistDashboardData(seed)
    return seed
  }
}

export function persistDashboardData(data: DashboardData) {
  localStorage.setItem(DASHBOARD_STORAGE_KEY, JSON.stringify(data))
}

export function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/$/, '')
  return trimmed
}

export function buildManifestUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/manifest.json`
}

export function nowIso(): string {
  return new Date().toISOString()
}
