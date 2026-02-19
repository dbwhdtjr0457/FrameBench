import { useEffect, useReducer, useRef, useState } from 'react'
import { fetchAndValidateManifest } from './manifest'
import { buildManifestUrl, nowIso, persistDashboardData, readDashboardData } from './storage'
import type {
  AppMetric,
  DashboardData,
  FeatureSet,
  ImportExportPayload,
  Scenario,
  Variant,
  VariantManifest,
} from './types'

type State = DashboardData

type Action =
  | { type: 'hydrate'; payload: State }
  | { type: 'variant:add'; payload: Variant }
  | { type: 'variant:soft-delete'; payload: { id: string } }
  | { type: 'variant:restore'; payload: { id: string } }
  | { type: 'variant:toggle-enabled'; payload: { id: string } }
  | { type: 'variant:update-tags'; payload: { id: string; tags: string[] } }
  | { type: 'featureset:add'; payload: FeatureSet }
  | { type: 'featureset:delete'; payload: { id: string } }
  | { type: 'featureset:set-active'; payload: { id: string } }
  | { type: 'scenario:add'; payload: Scenario }
  | { type: 'scenario:delete'; payload: { id: string } }
  | { type: 'run:add-many'; payload: { runs: State['runs'] } }
  | { type: 'run:update-status'; payload: { id: string; status: State['runs'][number]['status'] } }
  | { type: 'run:set-result'; payload: { id: string; ok: boolean; metrics?: AppMetric[]; error?: string } }
  | { type: 'run:delete'; payload: { id: string } }
  | { type: 'run:clear' }
  | { type: 'measurement:toggle-exclude' }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'hydrate':
      return action.payload
    case 'variant:add':
      return { ...state, variants: [action.payload, ...state.variants] }
    case 'variant:soft-delete':
      return {
        ...state,
        variants: state.variants.map((variant) =>
          variant.id === action.payload.id ? { ...variant, deletedAt: nowIso() } : variant,
        ),
      }
    case 'variant:restore':
      return {
        ...state,
        variants: state.variants.map((variant) =>
          variant.id === action.payload.id ? { ...variant, deletedAt: undefined } : variant,
        ),
      }
    case 'variant:toggle-enabled':
      return {
        ...state,
        variants: state.variants.map((variant) =>
          variant.id === action.payload.id ? { ...variant, enabled: !variant.enabled } : variant,
        ),
      }
    case 'variant:update-tags':
      return {
        ...state,
        variants: state.variants.map((variant) =>
          variant.id === action.payload.id ? { ...variant, tags: action.payload.tags } : variant,
        ),
      }
    case 'featureset:add':
      return { ...state, featureSets: [action.payload, ...state.featureSets] }
    case 'featureset:delete': {
      const nextFeatureSets = state.featureSets.filter((set) => set.id !== action.payload.id)
      const nextActive =
        state.activeFeatureSetId === action.payload.id && nextFeatureSets[0]
          ? nextFeatureSets[0].id
          : state.activeFeatureSetId
      return { ...state, featureSets: nextFeatureSets, activeFeatureSetId: nextActive }
    }
    case 'featureset:set-active':
      return { ...state, activeFeatureSetId: action.payload.id }
    case 'scenario:add':
      return { ...state, scenarios: [action.payload, ...state.scenarios] }
    case 'scenario:delete':
      return { ...state, scenarios: state.scenarios.filter((scenario) => scenario.id !== action.payload.id) }
    case 'run:add-many':
      return { ...state, runs: [...action.payload.runs, ...state.runs] }
    case 'run:update-status':
      return {
        ...state,
        runs: state.runs.map((run) =>
          run.id === action.payload.id
            ? {
                ...run,
                status: action.payload.status,
                endedAt:
                  action.payload.status === 'completed' || action.payload.status === 'failed'
                    ? nowIso()
                    : undefined,
              }
            : run,
        ),
      }
    case 'run:set-result':
      return {
        ...state,
        runs: state.runs.map((run) =>
          run.id === action.payload.id
            ? {
                ...run,
                status: action.payload.ok ? 'completed' : 'failed',
                endedAt: nowIso(),
                metrics: action.payload.metrics,
                error: action.payload.error,
              }
            : run,
        ),
      }
    case 'run:delete':
      return { ...state, runs: state.runs.filter((run) => run.id !== action.payload.id) }
    case 'run:clear':
      return { ...state, runs: [] }
    case 'measurement:toggle-exclude':
      return {
        ...state,
        excludeUnsupportedFromMeasurement: !state.excludeUnsupportedFromMeasurement,
      }
    default:
      return state
  }
}

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}

type RunPlan = {
  run: State['runs'][number]
  variant: Variant
  scenario: Scenario
}

type ComparisonRow = {
  variantId: string
  variantName: string
  total: number
  completed: number
  failed: number
  successRate: number
  avgSearchMs?: number
  p95SearchMs?: number
  speedScore: number
  effectivenessScore: number
}

function pickMeasureDuration(metrics: AppMetric[] | undefined, name: string) {
  if (!metrics) {
    return undefined
  }
  const hit = [...metrics].reverse().find((metric) => metric.name === name && metric.type === 'measure')
  return hit?.duration
}

function average(values: number[]) {
  if (values.length === 0) {
    return undefined
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function percentile(values: number[], p: number) {
  if (values.length === 0) {
    return undefined
  }
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))
  return sorted[index]
}

function parseRepeatCount(value: string) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return 1
  }
  const normalized = Math.floor(parsed)
  if (normalized < 1) {
    return 1
  }
  if (normalized > 30) {
    return 30
  }
  return normalized
}

function parseRoundFromNotes(notes?: string) {
  if (!notes) {
    return undefined
  }
  const hit = notes.match(/반복\s*(\d+)\s*\/\s*(\d+)/)
  if (!hit) {
    return undefined
  }
  const round = Number(hit[1])
  return Number.isFinite(round) ? round : undefined
}

const AUTOMATION_TIMEOUT_MIN_MS = 15_000
const AUTOMATION_TIMEOUT_MAX_MS = 180_000

function parseTrailingMs(step: string) {
  const tokens = step.trim().split(/\s+/)
  const last = Number(tokens[tokens.length - 1])
  if (!Number.isFinite(last) || last < 0) {
    return undefined
  }
  return last
}

function estimateScenarioTimeoutMs(steps: string[]) {
  let total = 0
  for (const raw of steps) {
    const step = raw.trim().toLowerCase()
    if (!step) {
      continue
    }

    if (step.startsWith('wait metric') || step.startsWith('wait selector')) {
      total += (parseTrailingMs(step) ?? 6_000) + 500
      continue
    }
    if (step.startsWith('sleep')) {
      total += (parseTrailingMs(step) ?? 0) + 500
      continue
    }
    if (step.startsWith('search')) {
      total += 1_500
      continue
    }
    if (step.startsWith('open')) {
      total += 2_000
      continue
    }
    if (step.startsWith('click')) {
      total += 1_500
      continue
    }
    total += 2_000
  }

  const withBuffer = total + 3_000
  return Math.max(AUTOMATION_TIMEOUT_MIN_MS, Math.min(AUTOMATION_TIMEOUT_MAX_MS, withBuffer))
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, null as unknown as State)
  const [variantSearch, setVariantSearch] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [showDeleted, setShowDeleted] = useState(false)
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [addBaseUrl, setAddBaseUrl] = useState('http://localhost:3001')
  const [statusMessage, setStatusMessage] = useState('')
  const [manifestCache, setManifestCache] = useState<Record<string, VariantManifest | undefined>>({})
  const [featureSetName, setFeatureSetName] = useState('')
  const [featureSetFeatures, setFeatureSetFeatures] = useState('core,metrics')
  const [scenarioName, setScenarioName] = useState('')
  const [scenarioSteps, setScenarioSteps] = useState('open /list\nsearch 상품 20\nopen /detail/20\nclick .actions button')
  const [scenarioFeatures, setScenarioFeatures] = useState('core,metrics')
  const [runScenarioId, setRunScenarioId] = useState('')
  const [selectedRunVariantIds, setSelectedRunVariantIds] = useState<string[]>([])
  const [runNotes, setRunNotes] = useState('')
  const [repeatCountInput, setRepeatCountInput] = useState('5')
  const [isBatchRunning, setIsBatchRunning] = useState(false)
  const [runStatusFilter, setRunStatusFilter] = useState<'all' | State['runs'][number]['status']>('all')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const automationIframeRef = useRef<HTMLIFrameElement | null>(null)
  const automationTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    dispatch({ type: 'hydrate', payload: readDashboardData() })
  }, [])

  useEffect(() => {
    if (!state) {
      return
    }
    persistDashboardData(state)
  }, [state])

  useEffect(() => {
    if (!state) {
      return
    }
    const targets = state.variants.filter((variant) => !variant.deletedAt)
    targets.forEach(async (variant) => {
      try {
        const manifest = await fetchAndValidateManifest(variant.manifestUrl)
        setManifestCache((prev) => ({ ...prev, [variant.id]: manifest }))
      } catch {
        setManifestCache((prev) => ({ ...prev, [variant.id]: undefined }))
      }
    })
  }, [state])

  useEffect(() => {
    if (!state) {
      return
    }
    if (!runScenarioId && state.scenarios[0]) {
      setRunScenarioId(state.scenarios[0].id)
    }
  }, [runScenarioId, state])

  useEffect(() => {
    return () => {
      if (automationTimeoutRef.current) {
        window.clearTimeout(automationTimeoutRef.current)
      }
      if (automationIframeRef.current) {
        automationIframeRef.current.remove()
      }
    }
  }, [])

  if (!state) {
    return <div className="p-6">대시보드 데이터를 불러오는 중입니다...</div>
  }

  const selectedVariant = state.variants.find((variant) => variant.id === selectedVariantId) ?? null
  const activeFeatureSet = state.featureSets.find((featureSet) => featureSet.id === state.activeFeatureSetId) ?? null
  const activeFeatures = activeFeatureSet?.features ?? []
  const activeScenario = state.scenarios.find((scenario) => scenario.id === runScenarioId) ?? null

  const filteredVariants = state.variants.filter((variant) => {
    if (!showDeleted && variant.deletedAt) {
      return false
    }
    const needle = variantSearch.trim().toLowerCase()
    const requiredTag = tagFilter.trim().toLowerCase()
    const nameMatches =
      needle.length === 0 ||
      variant.name.toLowerCase().includes(needle) ||
      variant.id.toLowerCase().includes(needle) ||
      variant.baseUrl.toLowerCase().includes(needle)
    if (!nameMatches) {
      return false
    }
    if (!requiredTag) {
      return true
    }
    return variant.tags.some((tag) => tag.toLowerCase().includes(requiredTag))
  })

  const runCandidates = state.variants.filter((variant) => {
    if (variant.deletedAt || !variant.enabled) {
      return false
    }
    const supported = variant.supportedFeatures ?? manifestCache[variant.id]?.supportedFeatures ?? []
    const unsupported = activeFeatures.some((feature) => !supported.includes(feature))
    if (unsupported && state.excludeUnsupportedFromMeasurement) {
      return false
    }
    return true
  })

  const filteredRuns =
    runStatusFilter === 'all' ? state.runs : state.runs.filter((run) => run.status === runStatusFilter)

  const statusLabel: Record<State['runs'][number]['status'], string> = {
    queued: '대기',
    running: '실행 중',
    completed: '완료',
    failed: '실패',
  }

  const readCaseTag = (variant: Variant) => {
    const caseTag = variant.tags.find((tag) => tag.startsWith('case:'))
    return caseTag ? caseTag.slice('case:'.length) : null
  }

  const buildVariantAppUrl = (variant: Variant) => {
    const url = new URL(variant.baseUrl)
    const caseId = readCaseTag(variant)
    if (caseId) {
      url.searchParams.set('case', caseId)
    }
    return url.toString()
  }

  const buildVariantAutomationUrl = (variant: Variant) => {
    const url = new URL(variant.baseUrl)
    const caseId = readCaseTag(variant)
    if (caseId) {
      url.searchParams.set('case', caseId)
    }
    url.searchParams.set('framebench', 'automation')
    return url.toString()
  }

  const clearAutomationArtifacts = () => {
    if (automationTimeoutRef.current) {
      window.clearTimeout(automationTimeoutRef.current)
      automationTimeoutRef.current = null
    }
    if (automationIframeRef.current) {
      automationIframeRef.current.remove()
      automationIframeRef.current = null
    }
  }

  const onAddVariant = async () => {
    const manifestUrl = buildManifestUrl(addBaseUrl)
    setStatusMessage('manifest 검증 중...')
    try {
      const manifest = await fetchAndValidateManifest(manifestUrl)
      const variant: Variant = {
        id: manifest.id,
        name: manifest.name,
        baseUrl: manifest.baseUrl,
        manifestUrl,
        enabled: true,
        tags: manifest.tech,
        supportedFeatures: manifest.supportedFeatures,
      }
      dispatch({ type: 'variant:add', payload: variant })
      setManifestCache((prev) => ({ ...prev, [variant.id]: manifest }))
      setModalOpen(false)
      setStatusMessage(`변형이 추가되었습니다: ${variant.name}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error'
      setStatusMessage(`변형 추가 실패: ${message}`)
    }
  }

  const onExport = () => {
    const payload: ImportExportPayload = { exportedAt: nowIso(), data: state }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `framebench-dashboard-${Date.now()}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const onImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }
    try {
      const text = await file.text()
      const payload = JSON.parse(text) as ImportExportPayload
      if (!payload.data || !payload.data.variants || !payload.data.featureSets || !payload.data.scenarios || !payload.data.runs) {
        throw new Error('가져오기 데이터 형식이 올바르지 않습니다.')
      }
      dispatch({ type: 'hydrate', payload: payload.data })
      setStatusMessage('가져오기가 완료되었습니다.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error'
      setStatusMessage(`가져오기 실패: ${message}`)
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const onToggleRunVariant = (variantId: string) => {
    setSelectedRunVariantIds((prev) =>
      prev.includes(variantId) ? prev.filter((id) => id !== variantId) : [...prev, variantId],
    )
  }

  const createRunPlans = (repeatCount: number): RunPlan[] | null => {
    if (!runScenarioId) {
      setStatusMessage('시나리오를 먼저 선택하세요.')
      return null
    }

    const scenario = state.scenarios.find((item) => item.id === runScenarioId)
    if (!scenario) {
      setStatusMessage('대상 시나리오를 찾을 수 없습니다.')
      return null
    }

    const targets =
      selectedRunVariantIds.length > 0
        ? runCandidates.filter((variant) => selectedRunVariantIds.includes(variant.id))
        : runCandidates
    if (targets.length === 0) {
      setStatusMessage('실행할 변형을 1개 이상 선택하세요.')
      return null
    }

    const plans: RunPlan[] = []
    const normalizedRepeat = Math.max(1, repeatCount)
    for (let round = 1; round <= normalizedRepeat; round += 1) {
      for (const variant of targets) {
        const roundNote = normalizedRepeat > 1 ? `반복 ${round}/${normalizedRepeat}` : ''
        const mergedNotes = [runNotes.trim(), roundNote].filter(Boolean).join(' | ') || undefined
        const run = {
          id: createId('run'),
          scenarioId: scenario.id,
          variantId: variant.id,
          startedAt: nowIso(),
          status: 'queued' as const,
          notes: mergedNotes,
        }
        plans.push({ run, variant, scenario })
      }
    }
    return plans
  }

  const onCreateRuns = () => {
    const plans = createRunPlans(1)
    if (!plans || plans.length === 0) {
      return
    }
    dispatch({ type: 'run:add-many', payload: { runs: plans.map((plan) => plan.run) } })
    setRunNotes('')
    setStatusMessage(`${plans.length}건의 실행 레코드를 생성했습니다.`)
  }

  const onClearRuns = () => {
    if (state.runs.length === 0) {
      setStatusMessage('지울 실행 로그가 없습니다.')
      return
    }
    const confirmed = window.confirm('실행 로그를 모두 초기화할까요?')
    if (!confirmed) {
      return
    }
    dispatch({ type: 'run:clear' })
    setStatusMessage(`실행 로그 ${state.runs.length}건을 초기화했습니다.`)
  }

  const runAutomationPlan = (plan: RunPlan) =>
    new Promise<void>((resolve) => {
      const { run, variant, scenario } = plan
      const timeoutMs = estimateScenarioTimeoutMs(scenario.steps)
      dispatch({ type: 'run:update-status', payload: { id: run.id, status: 'running' } })
      setStatusMessage(`자동 실행 시작: ${variant.name}`)

      clearAutomationArtifacts()

      const targetOrigin = new URL(variant.baseUrl).origin
      const iframe = document.createElement('iframe')
      iframe.src = buildVariantAutomationUrl(variant)
      iframe.style.display = 'none'
      document.body.appendChild(iframe)
      automationIframeRef.current = iframe

      let finished = false
      const finish = () => {
        if (finished) {
          return
        }
        finished = true
        window.removeEventListener('message', onMessage)
        clearAutomationArtifacts()
        resolve()
      }

      const onMessage = (event: MessageEvent) => {
        if (event.origin !== targetOrigin) {
          return
        }

        const payload = event.data as
          | { type?: string; runId?: string; ok?: boolean; metrics?: AppMetric[]; error?: string }
          | undefined

        if (!payload || !payload.type) {
          return
        }

        if (payload.type === 'FRAMEBENCH_AUTOMATION_READY') {
          iframe.contentWindow?.postMessage(
            {
              type: 'FRAMEBENCH_RUN_SCENARIO',
              runId: run.id,
              scenarioId: run.scenarioId,
              scenarioSteps: scenario.steps,
              caseId: readCaseTag(variant),
            },
            targetOrigin,
          )
          return
        }

        if (payload.type === 'FRAMEBENCH_RUN_RESULT' && payload.runId === run.id) {
          dispatch({
            type: 'run:set-result',
            payload: {
              id: run.id,
              ok: Boolean(payload.ok),
              metrics: payload.metrics,
              error: payload.error,
            },
          })
          setStatusMessage(payload.ok ? `자동 실행 완료: ${variant.name}` : `자동 실행 실패: ${payload.error ?? 'unknown error'}`)
          finish()
        }
      }

      window.addEventListener('message', onMessage)
      automationTimeoutRef.current = window.setTimeout(() => {
        dispatch({
          type: 'run:set-result',
          payload: {
            id: run.id,
            ok: false,
            error: `automation timeout (${Math.ceil(timeoutMs / 1000)}s)`,
          },
        })
        setStatusMessage(`자동 실행 실패: ${variant.name} 시간 초과`)
        finish()
      }, timeoutMs)
    })

  const runAutomation = (runId: string) => {
    const run = state.runs.find((item) => item.id === runId)
    if (!run) {
      setStatusMessage('실행 레코드를 찾을 수 없습니다.')
      return
    }

    const variant = state.variants.find((item) => item.id === run.variantId)
    if (!variant) {
      setStatusMessage('대상 변형을 찾을 수 없습니다.')
      return
    }

    const scenario = state.scenarios.find((item) => item.id === run.scenarioId)
    if (!scenario) {
      setStatusMessage('대상 시나리오를 찾을 수 없습니다.')
      return
    }

    void runAutomationPlan({ run, variant, scenario })
  }

  const onRunBatchAutomation = async () => {
    if (isBatchRunning) {
      return
    }

    const repeatCount = parseRepeatCount(repeatCountInput)
    setRepeatCountInput(String(repeatCount))
    const plans = createRunPlans(repeatCount)
    if (!plans || plans.length === 0) {
      return
    }

    dispatch({ type: 'run:add-many', payload: { runs: plans.map((plan) => plan.run) } })
    setRunNotes('')
    setIsBatchRunning(true)

    try {
      for (let index = 0; index < plans.length; index += 1) {
        const plan = plans[index]
        setStatusMessage(`반복 자동 실행 ${index + 1}/${plans.length}: ${plan.variant.name}`)
        await runAutomationPlan(plan)
      }
      setStatusMessage(`반복 자동 실행 완료: 총 ${plans.length}회`)
    } finally {
      setIsBatchRunning(false)
    }
  }

  const comparisonRows: ComparisonRow[] = (() => {
    const scenarioRuns = state.runs.filter(
      (run) =>
        run.scenarioId === runScenarioId &&
        (run.status === 'completed' || run.status === 'failed'),
    )

    const grouped = new Map<
      string,
      { total: number; completed: number; failed: number; searchDurations: number[] }
    >()

    for (const run of scenarioRuns) {
      const bucket = grouped.get(run.variantId) ?? {
        total: 0,
        completed: 0,
        failed: 0,
        searchDurations: [],
      }
      bucket.total += 1
      if (run.status === 'completed') {
        bucket.completed += 1
        const duration = pickMeasureDuration(run.metrics, 'search:input_to_render')
        if (typeof duration === 'number' && Number.isFinite(duration)) {
          bucket.searchDurations.push(duration)
        }
      }
      if (run.status === 'failed') {
        bucket.failed += 1
      }
      grouped.set(run.variantId, bucket)
    }

    const preferredVariantIds =
      selectedRunVariantIds.length > 0 ? selectedRunVariantIds : runCandidates.map((variant) => variant.id)
    const variantIds = new Set([...preferredVariantIds, ...grouped.keys()])

    const baseRows = Array.from(variantIds).map((variantId) => {
      const bucket = grouped.get(variantId)
      const durations = bucket?.searchDurations ?? []
      const avgSearchMs = average(durations)
      const p95SearchMs = percentile(durations, 0.95)
      const total = bucket?.total ?? 0
      const completed = bucket?.completed ?? 0
      const failed = bucket?.failed ?? 0
      const successRate = total > 0 ? (completed / total) * 100 : 0
      const variantName = state.variants.find((variant) => variant.id === variantId)?.name ?? variantId

      return {
        variantId,
        variantName,
        total,
        completed,
        failed,
        successRate,
        avgSearchMs,
        p95SearchMs,
      }
    })

    const avgCandidates = baseRows
      .map((row) => row.avgSearchMs)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    const bestAvg = avgCandidates.length > 0 ? Math.min(...avgCandidates) : undefined

    return baseRows
      .map((row) => {
        const speedScore =
          row.avgSearchMs && bestAvg ? Math.min(100, (bestAvg / row.avgSearchMs) * 100) : 0
        const effectivenessScore =
          row.total === 0 ? 0 : row.successRate * 0.6 + speedScore * 0.4
        return {
          ...row,
          speedScore,
          effectivenessScore,
        }
      })
      .sort(
        (a, b) =>
          b.effectivenessScore - a.effectivenessScore ||
          b.successRate - a.successRate ||
          a.variantName.localeCompare(b.variantName),
      )
  })()

  const maxEffectivenessScore = Math.max(1, ...comparisonRows.map((row) => row.effectivenessScore))

  const lineSeries = (() => {
    const palette = ['#0284c7', '#0f766e', '#2563eb', '#ca8a04', '#dc2626', '#9333ea', '#059669']
    const byVariant = new Map<string, { variantName: string; points: { x: number; y: number }[] }>()
    const completedRuns = state.runs.filter(
      (run) => run.scenarioId === runScenarioId && run.status === 'completed',
    )

    for (const run of completedRuns) {
      const duration = pickMeasureDuration(run.metrics, 'search:input_to_render')
      if (typeof duration !== 'number' || !Number.isFinite(duration)) {
        continue
      }

      const variantName = state.variants.find((variant) => variant.id === run.variantId)?.name ?? run.variantId
      const bucket = byVariant.get(run.variantId) ?? { variantName, points: [] }
      const x = parseRoundFromNotes(run.notes) ?? bucket.points.length + 1
      bucket.points.push({ x, y: duration })
      byVariant.set(run.variantId, bucket)
    }

    const preferredVariantIds =
      selectedRunVariantIds.length > 0 ? selectedRunVariantIds : runCandidates.map((variant) => variant.id)

    const series = preferredVariantIds
      .map((variantId, index) => {
        const bucket = byVariant.get(variantId)
        if (!bucket || bucket.points.length === 0) {
          return null
        }
        const points = [...bucket.points].sort((a, b) => a.x - b.x)
        return {
          variantId,
          variantName: bucket.variantName,
          color: palette[index % palette.length],
          points,
        }
      })
      .filter(Boolean) as Array<{ variantId: string; variantName: string; color: string; points: { x: number; y: number }[] }>

    if (series.length > 0) {
      return series
    }

    let index = 0
    const fallback: Array<{ variantId: string; variantName: string; color: string; points: { x: number; y: number }[] }> = []
    for (const [variantId, bucket] of byVariant.entries()) {
      fallback.push({
        variantId,
        variantName: bucket.variantName,
        color: palette[index % palette.length],
        points: [...bucket.points].sort((a, b) => a.x - b.x),
      })
      index += 1
    }
    return fallback
  })()

  const chartWidth = 900
  const chartHeight = 300
  const chartPadding = { top: 18, right: 20, bottom: 34, left: 52 }
  const linePoints = lineSeries.flatMap((series) => series.points)
  const minX = linePoints.length === 0 ? 1 : Math.min(...linePoints.map((point) => point.x))
  const maxX = linePoints.length === 0 ? 1 : Math.max(...linePoints.map((point) => point.x))
  const xRange = Math.max(1, maxX - minX)
  const minY = linePoints.length === 0 ? 0 : Math.min(...linePoints.map((point) => point.y))
  const maxY = linePoints.length === 0 ? 1 : Math.max(...linePoints.map((point) => point.y))
  const yRange = Math.max(1, maxY - minY)
  const mapX = (x: number) =>
    chartPadding.left + ((x - minX) / xRange) * (chartWidth - chartPadding.left - chartPadding.right)
  const mapY = (y: number) =>
    chartHeight -
    chartPadding.bottom -
    ((y - minY) / yRange) * (chartHeight - chartPadding.top - chartPadding.bottom)
  const yTicks = Array.from({ length: 5 }, (_, index) => minY + (yRange * index) / 4)
  const xTickCount = Math.min(8, Math.max(2, maxX - minX + 1))
  const xTicks = Array.from({ length: xTickCount }, (_, index) => {
    const ratio = xTickCount === 1 ? 0 : index / (xTickCount - 1)
    return Math.round(minX + ratio * xRange)
  }).filter((value, index, array) => index === 0 || value !== array[index - 1])

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto grid max-w-7xl gap-4 p-4 grid-cols-1">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-2xl font-semibold">FrameBench 대시보드</h1>
              <p className="text-sm text-slate-500">변형 / 기능 세트 / 시나리오 관리 콘솔</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn" onClick={() => setModalOpen(true)}>
                변형 추가
              </button>
              <button className="btn" onClick={onExport}>
                JSON 내보내기
              </button>
              <button className="btn" onClick={() => fileInputRef.current?.click()}>
                JSON 가져오기
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={onImport}
              />
            </div>
          </header>

          <div className="mt-4 grid gap-2 md:grid-cols-4">
            <input
              className="input"
              value={variantSearch}
              onChange={(event) => setVariantSearch(event.target.value)}
              placeholder="변형 검색"
            />
            <input
              className="input"
              value={tagFilter}
              onChange={(event) => setTagFilter(event.target.value)}
              placeholder="태그 필터"
            />
            <select
              className="input"
              value={state.activeFeatureSetId}
              onChange={(event) => dispatch({ type: 'featureset:set-active', payload: { id: event.target.value } })}
            >
              {state.featureSets.map((featureSet) => (
                <option key={featureSet.id} value={featureSet.id}>
                  {featureSet.name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={showDeleted}
                onChange={(event) => setShowDeleted(event.target.checked)}
              />
              삭제 항목 보기
            </label>
          </div>

          <label className="mt-3 flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={state.excludeUnsupportedFromMeasurement}
              onChange={() => dispatch({ type: 'measurement:toggle-exclude' })}
            />
            미지원 변형은 측정 대상에서 제외
          </label>

          <ul className="mt-4 space-y-2">
            {filteredVariants.map((variant) => {
              const manifest = manifestCache[variant.id]
              const supported = variant.supportedFeatures ?? manifest?.supportedFeatures ?? []
              const unsupportedFeatures = activeFeatures.filter((feature) => !supported.includes(feature))
              const unsupported = unsupportedFeatures.length > 0
              const excluded = unsupported && state.excludeUnsupportedFromMeasurement

              return (
                <li
                  key={`${variant.id}-${variant.baseUrl}`}
                  className={`rounded-lg border p-3 ${variant.deletedAt ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50'}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      className="text-left"
                      onClick={() => setSelectedVariantId(variant.id)}
                      title="변형 상세 보기"
                    >
                      <div className="font-medium">{variant.name}</div>
                      <div className="text-xs text-slate-500">{variant.baseUrl}</div>
                    </button>
                    <div className="flex flex-wrap gap-1">
                      {variant.tags.map((tag) => (
                        <span key={`${variant.id}-${tag}`} className="tag">
                          {tag}
                        </span>
                      ))}
                      {unsupported ? <span className="tag-unsupported">미지원</span> : <span className="tag-ok">지원</span>}
                      {excluded ? <span className="tag-muted">측정 제외</span> : null}
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2 text-sm">
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={variant.enabled}
                        onChange={() => dispatch({ type: 'variant:toggle-enabled', payload: { id: variant.id } })}
                      />
                      사용
                    </label>
                    <a className="link" href={buildVariantAppUrl(variant)} target="_blank" rel="noreferrer">
                      앱 열기
                    </a>
                    <a className="link" href={variant.manifestUrl} target="_blank" rel="noreferrer">
                      매니페스트
                    </a>
                    {!variant.deletedAt ? (
                      <button
                        className="link text-rose-600"
                        onClick={() => dispatch({ type: 'variant:soft-delete', payload: { id: variant.id } })}
                      >
                        소프트 삭제
                      </button>
                    ) : (
                      <button
                        className="link text-emerald-700"
                        onClick={() => dispatch({ type: 'variant:restore', payload: { id: variant.id } })}
                      >
                        복구
                      </button>
                    )}
                  </div>

                  {unsupported ? (
                    <p className="mt-2 text-xs text-amber-700">미지원 기능: {unsupportedFeatures.join(', ')}</p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </section>

        <aside className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
            <h2 className="text-lg font-semibold">변형 상세</h2>
            {selectedVariant ? (
              <>
                <p className="mt-2 text-sm text-slate-600">ID: {selectedVariant.id}</p>
                <p className="text-sm text-slate-600">매니페스트: {selectedVariant.manifestUrl}</p>
                <textarea
                  className="input mt-2 h-20 w-full"
                  value={selectedVariant.tags.join(', ')}
                  onChange={(event) =>
                    dispatch({
                      type: 'variant:update-tags',
                      payload: {
                        id: selectedVariant.id,
                        tags: event.target.value
                          .split(',')
                          .map((value) => value.trim())
                          .filter(Boolean),
                      },
                    })
                  }
                />
              </>
            ) : (
              <p className="mt-2 text-sm text-slate-500">목록에서 변형을 선택하세요.</p>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold">기능 세트</h2>
            <div className="mt-2 space-y-2">
              {state.featureSets.map((featureSet) => (
                <div key={featureSet.id} className="rounded-md border border-slate-200 p-2">
                  <div className="font-medium">{featureSet.name}</div>
                  <div className="text-xs text-slate-500">{featureSet.features.join(', ')}</div>
                  <button
                    className="link mt-1 text-rose-600"
                    onClick={() => dispatch({ type: 'featureset:delete', payload: { id: featureSet.id } })}
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
            <input
              className="input mt-2"
              value={featureSetName}
              onChange={(event) => setFeatureSetName(event.target.value)}
              placeholder="기능 세트 이름"
            />
            <input
              className="input mt-2"
              value={featureSetFeatures}
              onChange={(event) => setFeatureSetFeatures(event.target.value)}
              placeholder="core,metrics"
            />
            <button
              className="btn mt-2"
              onClick={() => {
                if (!featureSetName.trim()) {
                  return
                }
                dispatch({
                  type: 'featureset:add',
                  payload: {
                    id: createId('featureset'),
                    name: featureSetName.trim(),
                    features: featureSetFeatures
                      .split(',')
                      .map((value) => value.trim())
                      .filter(Boolean),
                  },
                })
                setFeatureSetName('')
              }}
            >
              기능 세트 추가
            </button>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold">시나리오</h2>
            <div className="mt-2 space-y-2">
              {state.scenarios.map((scenario) => (
                <div key={scenario.id} className="rounded-md border border-slate-200 p-2">
                  <div className="font-medium">{scenario.name}</div>
                  <div className="text-xs text-slate-500">필수 기능: {scenario.requiredFeatures.join(', ')}</div>
                  <button
                    className="link mt-1 text-rose-600"
                    onClick={() => dispatch({ type: 'scenario:delete', payload: { id: scenario.id } })}
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
            <input
              className="input mt-2"
              value={scenarioName}
              onChange={(event) => setScenarioName(event.target.value)}
              placeholder="시나리오 이름"
            />
            <textarea
              className="input mt-2 h-24 w-full"
              value={scenarioSteps}
              onChange={(event) => setScenarioSteps(event.target.value)}
              placeholder={'open /list\nsearch 상품 20\nopen /detail/20\nclick .actions button'}
            />
            <p className="mt-1 text-xs text-slate-500">
              단계 문법: <code>open /path</code>, <code>search 키워드</code>, <code>click CSS선택자</code>,{' '}
              <code>wait metric 이름 [ms]</code>, <code>wait selector 선택자 [ms]</code>, <code>sleep ms</code>
            </p>
            <input
              className="input mt-2"
              value={scenarioFeatures}
              onChange={(event) => setScenarioFeatures(event.target.value)}
              placeholder="필수 기능"
            />
            <button
              className="btn mt-2"
              onClick={() => {
                if (!scenarioName.trim()) {
                  return
                }
                dispatch({
                  type: 'scenario:add',
                  payload: {
                    id: createId('scenario'),
                    name: scenarioName.trim(),
                    steps: scenarioSteps
                      .split('\n')
                      .map((value) => value.trim())
                      .filter(Boolean),
                    requiredFeatures: scenarioFeatures
                      .split(',')
                      .map((value) => value.trim())
                      .filter(Boolean),
                  },
                })
                setScenarioName('')
              }}
            >
              시나리오 추가
            </button>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
            <h2 className="text-lg font-semibold">실행 비교</h2>
            <p className="mt-1 text-xs text-slate-500">
              선택한 시나리오를 기준으로 실행 레코드를 만들고 상태/결과를 비교합니다.
            </p>
            <div className="mt-3 grid gap-4 xl:grid-cols-[320px_1fr]">
              <div>
                <select
                  className="input"
                  value={runScenarioId}
                  onChange={(event) => setRunScenarioId(event.target.value)}
                >
                  {state.scenarios.map((scenario) => (
                    <option key={scenario.id} value={scenario.id}>
                      {scenario.name}
                    </option>
                  ))}
                </select>

                <div className="mt-2 rounded-md border border-slate-200 p-2">
                  <div className="text-xs font-medium text-slate-600">실행 대상 변형</div>
                  <div className="mt-2 space-y-1">
                    {runCandidates.map((variant) => (
                      <label key={`run-target-${variant.id}`} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedRunVariantIds.includes(variant.id)}
                          onChange={() => onToggleRunVariant(variant.id)}
                        />
                        <span>{variant.name}</span>
                      </label>
                    ))}
                    {runCandidates.length === 0 ? (
                      <p className="text-xs text-slate-500">현재 조건에서 실행 가능한 변형이 없습니다.</p>
                    ) : null}
                  </div>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  체크가 없으면 현재 실행 가능한 전체 변형을 대상으로 실행합니다.
                </p>

                <textarea
                  className="input mt-2 h-20 w-full"
                  placeholder="실행 메모 (선택)"
                  value={runNotes}
                  onChange={(event) => setRunNotes(event.target.value)}
                />
                <button className="btn mt-2 w-full" onClick={onCreateRuns}>
                  실행 레코드 생성
                </button>

                <div className="mt-2 grid grid-cols-[110px_1fr] gap-2">
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={30}
                    value={repeatCountInput}
                    onChange={(event) => setRepeatCountInput(event.target.value)}
                    title="반복 횟수"
                  />
                  <button className="btn" onClick={() => void onRunBatchAutomation()} disabled={isBatchRunning}>
                    {isBatchRunning ? '반복 자동 실행 중...' : '반복 자동 실행'}
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  반복 실행 결과를 누적하고 오른쪽 차트에서 추세를 비교합니다.
                </p>

                {activeScenario ? (
                  <div className="mt-2 rounded-md border border-slate-200 p-2 text-xs text-slate-600">
                    <div className="font-medium">선택 시나리오 단계</div>
                    <div>{activeScenario.steps.join(' → ')}</div>
                  </div>
                ) : null}

                <div className="mt-3 flex items-center gap-2">
                  <span className="text-xs text-slate-600">상태 필터</span>
                  <select
                    className="input"
                    value={runStatusFilter}
                    onChange={(event) =>
                      setRunStatusFilter(event.target.value as 'all' | State['runs'][number]['status'])
                    }
                  >
                    <option value="all">전체</option>
                    <option value="queued">대기</option>
                    <option value="running">실행 중</option>
                    <option value="completed">완료</option>
                    <option value="failed">실패</option>
                  </select>
                </div>
                <button
                  className="btn-muted mt-2 w-full text-rose-600"
                  onClick={onClearRuns}
                  disabled={state.runs.length === 0}
                >
                  실행 로그 초기화
                </button>
              </div>

              <div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium text-slate-700">통합 선 그래프 (반복 추세)</div>
                    <div className="text-xs text-slate-500">기준: search:input_to_render (ms)</div>
                  </div>

                  {lineSeries.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-500">완료된 실행 데이터가 아직 없습니다.</p>
                  ) : (
                    <>
                      <div className="mt-3 overflow-x-auto rounded border border-slate-200 bg-white p-2">
                        <svg
                          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                          className="h-72 w-full min-w-[760px]"
                          role="img"
                          aria-label="반복 실행 통합 선 그래프"
                        >
                          <rect x={0} y={0} width={chartWidth} height={chartHeight} fill="white" />

                          {yTicks.map((tick) => (
                            <g key={`y-tick-${tick}`}>
                              <line
                                x1={chartPadding.left}
                                y1={mapY(tick)}
                                x2={chartWidth - chartPadding.right}
                                y2={mapY(tick)}
                                stroke="#e2e8f0"
                                strokeWidth={1}
                              />
                              <text
                                x={chartPadding.left - 8}
                                y={mapY(tick) + 4}
                                fontSize={11}
                                textAnchor="end"
                                fill="#64748b"
                              >
                                {tick.toFixed(0)}
                              </text>
                            </g>
                          ))}

                          {xTicks.map((tick) => (
                            <g key={`x-tick-${tick}`}>
                              <line
                                x1={mapX(tick)}
                                y1={chartPadding.top}
                                x2={mapX(tick)}
                                y2={chartHeight - chartPadding.bottom}
                                stroke="#f1f5f9"
                                strokeWidth={1}
                              />
                              <text
                                x={mapX(tick)}
                                y={chartHeight - chartPadding.bottom + 16}
                                fontSize={11}
                                textAnchor="middle"
                                fill="#64748b"
                              >
                                {tick}
                              </text>
                            </g>
                          ))}

                          <line
                            x1={chartPadding.left}
                            y1={chartHeight - chartPadding.bottom}
                            x2={chartWidth - chartPadding.right}
                            y2={chartHeight - chartPadding.bottom}
                            stroke="#64748b"
                            strokeWidth={1.2}
                          />
                          <line
                            x1={chartPadding.left}
                            y1={chartPadding.top}
                            x2={chartPadding.left}
                            y2={chartHeight - chartPadding.bottom}
                            stroke="#64748b"
                            strokeWidth={1.2}
                          />

                          {lineSeries.map((series) => (
                            <polyline
                              key={`line-${series.variantId}`}
                              fill="none"
                              stroke={series.color}
                              strokeWidth={2.2}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              points={series.points.map((point) => `${mapX(point.x)},${mapY(point.y)}`).join(' ')}
                            />
                          ))}

                          {lineSeries.map((series) =>
                            series.points.map((point) => (
                              <circle
                                key={`point-${series.variantId}-${point.x}-${point.y}`}
                                cx={mapX(point.x)}
                                cy={mapY(point.y)}
                                r={3.2}
                                fill={series.color}
                              >
                                <title>{`${series.variantName}: ${point.y.toFixed(1)}ms (반복 ${point.x})`}</title>
                              </circle>
                            )),
                          )}

                          <text
                            x={(chartWidth + chartPadding.left - chartPadding.right) / 2}
                            y={chartHeight - 6}
                            textAnchor="middle"
                            fontSize={12}
                            fill="#475569"
                          >
                            반복 회차
                          </text>
                          <text
                            x={16}
                            y={(chartHeight + chartPadding.top - chartPadding.bottom) / 2}
                            textAnchor="middle"
                            fontSize={12}
                            fill="#475569"
                            transform={`rotate(-90, 16, ${(chartHeight + chartPadding.top - chartPadding.bottom) / 2})`}
                          >
                            검색 반응 시간 (ms)
                          </text>
                        </svg>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-2">
                        {lineSeries.map((series) => (
                          <span
                            key={`legend-${series.variantId}`}
                            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-xs"
                          >
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: series.color }}
                            />
                            {series.variantName}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {comparisonRows.map((row, index) => (
                    <div key={`summary-${row.variantId}`} className="rounded border border-slate-200 bg-white p-2">
                      <div className="flex items-center justify-between text-xs">
                        <div className="font-medium">
                          {index + 1}. {row.variantName}
                        </div>
                        <div className="text-slate-600">{row.effectivenessScore.toFixed(1)}점</div>
                      </div>
                      <div className="mt-1 h-2 rounded bg-slate-100">
                        <div
                          className="h-2 rounded bg-cyan-500"
                          style={{ width: `${(row.effectivenessScore / maxEffectivenessScore) * 100}%` }}
                        />
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-600">
                        <div>
                          성공률 {row.successRate.toFixed(1)}% ({row.completed}/{row.total})
                        </div>
                        <div>실패 {row.failed}건</div>
                        <div>
                          평균 검색{' '}
                          {typeof row.avgSearchMs === 'number' ? `${row.avgSearchMs.toFixed(1)}ms` : '-'}
                        </div>
                        <div>
                          P95 검색{' '}
                          {typeof row.p95SearchMs === 'number' ? `${row.p95SearchMs.toFixed(1)}ms` : '-'}
                        </div>
                      </div>
                    </div>
                  ))}
                  {comparisonRows.length === 0 ? (
                    <p className="text-sm text-slate-500">집계 가능한 비교 행이 아직 없습니다.</p>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="mt-3 max-h-[28rem] space-y-2 overflow-auto">
              {filteredRuns.map((run) => {
                const scenario = state.scenarios.find((item) => item.id === run.scenarioId)
                const variant = state.variants.find((item) => item.id === run.variantId)
                return (
                  <div key={run.id} className="rounded-md border border-slate-200 p-2 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{variant?.name ?? run.variantId}</div>
                      <span className="tag">{statusLabel[run.status]}</span>
                    </div>
                    <div className="text-slate-500">{scenario?.name ?? run.scenarioId}</div>
                    <div className="mt-1 text-slate-500">시작: {run.startedAt}</div>
                    {run.endedAt ? <div className="text-slate-500">종료: {run.endedAt}</div> : null}
                    {run.notes ? <div className="mt-1 text-slate-600">메모: {run.notes}</div> : null}
                    {run.metrics ? (
                      <div className="mt-1 text-slate-600">
                        검색 지연: {pickMeasureDuration(run.metrics, 'search:input_to_render')?.toFixed(1) ?? '-'}ms
                        {' / '}메트릭 {run.metrics.length}개
                      </div>
                    ) : null}
                    {run.error ? <div className="mt-1 text-rose-600">오류: {run.error}</div> : null}

                    <div className="mt-2 flex flex-wrap gap-1">
                      <button className="btn-muted" onClick={() => runAutomation(run.id)}>
                        자동 실행
                      </button>
                      <button
                        className="btn-muted"
                        onClick={() => dispatch({ type: 'run:update-status', payload: { id: run.id, status: 'queued' } })}
                      >
                        대기
                      </button>
                      <button
                        className="btn-muted"
                        onClick={() => dispatch({ type: 'run:update-status', payload: { id: run.id, status: 'running' } })}
                      >
                        실행 중
                      </button>
                      <button
                        className="btn-muted"
                        onClick={() => dispatch({ type: 'run:update-status', payload: { id: run.id, status: 'completed' } })}
                      >
                        완료
                      </button>
                      <button
                        className="btn-muted"
                        onClick={() => dispatch({ type: 'run:update-status', payload: { id: run.id, status: 'failed' } })}
                      >
                        실패
                      </button>
                      <button
                        className="btn-muted text-rose-600"
                        onClick={() => dispatch({ type: 'run:delete', payload: { id: run.id } })}
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                )
              })}
              {filteredRuns.length === 0 ? (
                <p className="text-xs text-slate-500">표시할 실행 기록이 없습니다.</p>
              ) : null}
            </div>
          </section>
        </aside>
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
            <h2 className="text-lg font-semibold">URL로 변형 등록</h2>
            <p className="mt-1 text-sm text-slate-500">
              입력한 URL의 manifest.json을 검증한 뒤 변형으로 등록합니다.
            </p>
            <input
              className="input mt-3"
              value={addBaseUrl}
              onChange={(event) => setAddBaseUrl(event.target.value)}
              placeholder="http://localhost:3001"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button className="btn-muted" onClick={() => setModalOpen(false)}>
                취소
              </button>
              <button className="btn" onClick={onAddVariant}>
                검증 후 추가
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <footer className="mx-auto max-w-7xl px-4 pb-4 text-sm text-slate-600">
        {statusMessage || '준비 완료'}
      </footer>
    </div>
  )
}
