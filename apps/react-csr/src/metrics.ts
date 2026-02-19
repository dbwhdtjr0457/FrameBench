export type MetricEntry = {
  type: 'mark' | 'measure'
  name: string
  time: number
  duration?: number
}

declare global {
  interface Window {
    __APP_METRICS__?: MetricEntry[]
  }
}

function metricStore() {
  if (!window.__APP_METRICS__) {
    window.__APP_METRICS__ = []
  }
  return window.__APP_METRICS__
}

export function clearMetrics() {
  window.__APP_METRICS__ = []
  performance.clearMarks()
  performance.clearMeasures()
}

export function getMetrics() {
  return window.__APP_METRICS__ ?? []
}

export function mark(name: string) {
  performance.mark(name)
  metricStore().push({ type: 'mark', name, time: performance.now() })
}

export function measure(name: string, startMark: string, endMark: string) {
  performance.measure(name, startMark, endMark)
  const entries = performance.getEntriesByName(name, 'measure')
  const entry = entries[entries.length - 1]
  if (entry) {
    metricStore().push({ type: 'measure', name, time: entry.startTime, duration: entry.duration })
  }
}
