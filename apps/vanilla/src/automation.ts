type AppMetric = {
  type: 'mark' | 'measure'
  name: string
  time: number
  duration?: number
}

type RunMessage = {
  type: 'FRAMEBENCH_RUN_SCENARIO'
  runId: string
  scenarioSteps?: string[]
}

type ParsedStep =
  | { kind: 'open'; path: string; raw: string }
  | { kind: 'search'; text: string; raw: string }
  | { kind: 'click'; selector: string; raw: string }
  | { kind: 'wait-metric'; metric: string; timeoutMs: number; raw: string }
  | { kind: 'wait-selector'; selector: string; timeoutMs: number; raw: string }
  | { kind: 'sleep'; ms: number; raw: string }

const DEFAULT_TIMEOUT_MS = 6000
const SEARCH_INPUT_SELECTOR = '#search-input'
const DEFAULT_STEPS = ['open /list', 'search 상품 20', 'open /detail/20', 'click .actions button']

function normalizeClickSelector(selector: string) {
  const normalized = selector.trim().toLowerCase()
  if (normalized === 'add-to-cart' || normalized === 'add_to_cart' || normalized === 'cart') {
    return '.actions button'
  }
  return selector
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms))
}

function getMetrics() {
  return (window.__APP_METRICS__ ?? []) as AppMetric[]
}

function clearMetrics() {
  window.__APP_METRICS__ = []
  performance.clearMarks()
  performance.clearMeasures()
}

function inferLegacySearchText(step: string) {
  const tail = step.replace(/검색/gi, '').trim()
  if (tail) {
    return tail
  }
  const numberHit = step.match(/(\d+)/)
  if (numberHit) {
    return `상품 ${numberHit[1]}`
  }
  return '상품 20'
}

function parseLegacyStep(raw: string): ParsedStep | null {
  if (raw.includes('/list')) {
    return { kind: 'open', path: '/list', raw }
  }

  const detailPath = raw.match(/\/detail\/\d+/)
  if (detailPath) {
    return { kind: 'open', path: detailPath[0], raw }
  }

  if (/검색/i.test(raw)) {
    return { kind: 'search', text: inferLegacySearchText(raw), raw }
  }

  if (raw.includes('장바구니') || raw.toLowerCase().includes('add-to-cart')) {
    return { kind: 'click', selector: '.actions button', raw }
  }

  return null
}

function parseStep(rawStep: string): ParsedStep {
  const raw = rawStep.trim()
  if (!raw) {
    throw new Error('빈 단계는 허용되지 않습니다')
  }

  const [command, ...args] = raw.split(/\s+/)
  const cmd = command.toLowerCase()

  if (cmd === 'open') {
    const path = args.join(' ').trim()
    if (!path.startsWith('/')) {
      throw new Error('open 단계는 /로 시작하는 경로여야 합니다')
    }
    return { kind: 'open', path, raw }
  }

  if (cmd === 'search') {
    const text = args.join(' ').trim()
    if (!text) {
      throw new Error('search 단계는 검색어가 필요합니다')
    }
    return { kind: 'search', text, raw }
  }

  if (cmd === 'click') {
    const selector = normalizeClickSelector(args.join(' ').trim())
    if (!selector) {
      throw new Error('click 단계는 CSS selector가 필요합니다')
    }
    return { kind: 'click', selector, raw }
  }

  if (cmd === 'wait') {
    const [waitKind, ...waitArgs] = args
    const lastToken = waitArgs[waitArgs.length - 1]
    const parsedTimeout = Number(lastToken)
    const hasTimeout = Number.isFinite(parsedTimeout)
    const timeoutMs = hasTimeout ? parsedTimeout : DEFAULT_TIMEOUT_MS
    const body = (hasTimeout ? waitArgs.slice(0, -1) : waitArgs).join(' ').trim()

    if (waitKind === 'metric') {
      const metric = body
      if (!metric) {
        throw new Error('wait metric 단계는 메트릭 이름이 필요합니다')
      }
      return { kind: 'wait-metric', metric, timeoutMs, raw }
    }
    if (waitKind === 'selector') {
      const selector = body
      if (!selector) {
        throw new Error('wait selector 단계는 CSS selector가 필요합니다')
      }
      return { kind: 'wait-selector', selector, timeoutMs, raw }
    }
    throw new Error('wait 단계는 metric 또는 selector를 사용해야 합니다')
  }

  if (cmd === 'sleep') {
    const ms = Number(args[0] ?? 0)
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error('sleep 단계의 시간(ms)이 올바르지 않습니다')
    }
    return { kind: 'sleep', ms, raw }
  }

  const legacy = parseLegacyStep(raw)
  if (legacy) {
    return legacy
  }

  throw new Error(`지원하지 않는 단계입니다: "${raw}"`)
}

function parseScenarioSteps(rawSteps?: string[]) {
  const lines = rawSteps?.map((line) => line.trim()).filter(Boolean) ?? []
  const source = lines.length > 0 ? lines : DEFAULT_STEPS
  return source.map((line) => parseStep(line))
}

async function waitFor(predicate: () => boolean, timeoutMs: number) {
  const start = performance.now()
  while (performance.now() - start < timeoutMs) {
    if (predicate()) {
      return
    }
    await sleep(50)
  }
  throw new Error('조건 대기 시간 초과')
}

function navigate(path: string) {
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function setInputValue(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function metricCount(name: string, type: AppMetric['type']) {
  return getMetrics().filter((entry) => entry.type === type && entry.name === name).length
}

async function executeStep(step: ParsedStep) {
  if (step.kind === 'open') {
    navigate(step.path)

    if (step.path.startsWith('/list')) {
      await waitFor(() => document.querySelector(SEARCH_INPUT_SELECTOR) !== null, DEFAULT_TIMEOUT_MS)
    }

    if (step.path.startsWith('/detail/')) {
      await waitFor(
        () => getMetrics().some((entry) => entry.type === 'mark' && entry.name === 'detail:rendered'),
        DEFAULT_TIMEOUT_MS,
      )
    }
    return
  }

  if (step.kind === 'search') {
    await waitFor(() => document.querySelector(SEARCH_INPUT_SELECTOR) !== null, DEFAULT_TIMEOUT_MS)
    const input = document.querySelector<HTMLInputElement>(SEARCH_INPUT_SELECTOR)
    if (!input) {
      throw new Error('검색 입력창을 찾을 수 없습니다')
    }

    const beforeCount = metricCount('search:input_to_render', 'measure')
    setInputValue(input, step.text)
    await waitFor(
      () => metricCount('search:input_to_render', 'measure') > beforeCount,
      DEFAULT_TIMEOUT_MS + 1000,
    )
    return
  }

  if (step.kind === 'click') {
    await waitFor(() => document.querySelector(step.selector) !== null, DEFAULT_TIMEOUT_MS)
    const target = document.querySelector<HTMLElement>(step.selector)
    if (!target) {
      throw new Error(`클릭할 요소를 찾을 수 없습니다: ${step.selector}`)
    }
    target.click()
    return
  }

  if (step.kind === 'wait-metric') {
    await waitFor(
      () => getMetrics().some((entry) => entry.name === step.metric),
      step.timeoutMs,
    )
    return
  }

  if (step.kind === 'wait-selector') {
    await waitFor(() => document.querySelector(step.selector) !== null, step.timeoutMs)
    return
  }

  await sleep(step.ms)
}

async function runScenario(rawSteps: string[] | undefined) {
  clearMetrics()

  const parsedSteps = parseScenarioSteps(rawSteps)
  for (let i = 0; i < parsedSteps.length; i += 1) {
    const step = parsedSteps[i]
    try {
      await executeStep(step)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error'
      throw new Error(`${i + 1}번째 단계 실패 (${step.raw}): ${message}`)
    }
  }

  return getMetrics()
}

function postToParent(payload: Record<string, unknown>) {
  window.parent.postMessage(payload, '*')
}

window.addEventListener('message', async (event: MessageEvent) => {
  const data = event.data as RunMessage | undefined
  if (!data || data.type !== 'FRAMEBENCH_RUN_SCENARIO') {
    return
  }

  try {
    const metrics = await runScenario(data.scenarioSteps)
    postToParent({ type: 'FRAMEBENCH_RUN_RESULT', runId: data.runId, ok: true, metrics })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    postToParent({ type: 'FRAMEBENCH_RUN_RESULT', runId: data.runId, ok: false, error: message })
  }
})

if (window.parent !== window) {
  postToParent({ type: 'FRAMEBENCH_AUTOMATION_READY' })
}
