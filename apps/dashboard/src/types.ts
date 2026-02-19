export type Variant = {
  id: string
  name: string
  baseUrl: string
  manifestUrl: string
  enabled: boolean
  deletedAt?: string
  tags: string[]
  supportedFeatures?: string[]
}

export type FeatureSet = {
  id: string
  name: string
  features: string[]
}

export type Scenario = {
  id: string
  name: string
  steps: string[]
  requiredFeatures: string[]
}

export type RunRecord = {
  id: string
  scenarioId: string
  variantId: string
  startedAt: string
  endedAt?: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  notes?: string
  metrics?: AppMetric[]
  error?: string
}

export type AppMetric = {
  type: 'mark' | 'measure'
  name: string
  time: number
  duration?: number
}

export type DashboardData = {
  variants: Variant[]
  featureSets: FeatureSet[]
  scenarios: Scenario[]
  runs: RunRecord[]
  activeFeatureSetId: string
  excludeUnsupportedFromMeasurement: boolean
}

export type VariantManifest = {
  id: string
  name: string
  tech: string[]
  version: string
  baseUrl: string
  routes: string[]
  supportedFeatures: string[]
  build: {
    commit: string
    timestamp: string
  }
}

export type ImportExportPayload = {
  exportedAt: string
  data: DashboardData
}
