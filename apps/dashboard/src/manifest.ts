import type { VariantManifest } from './types'

const REQUIRED_ROUTES = ['/', '/list', '/detail/:id']

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function hasRequiredRoutes(routes: string[]) {
  return REQUIRED_ROUTES.every((route) => routes.includes(route))
}

export function validateManifest(value: unknown): VariantManifest {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Manifest는 객체여야 합니다')
  }

  const manifest = value as Partial<VariantManifest>

  if (!manifest.id || !manifest.name || !manifest.version || !manifest.baseUrl) {
    throw new Error('Manifest 필수 메타데이터가 누락되었습니다')
  }

  if (!isStringArray(manifest.tech) || !isStringArray(manifest.routes) || !isStringArray(manifest.supportedFeatures)) {
    throw new Error('Manifest 배열 필드 형식이 올바르지 않습니다')
  }

  if (!hasRequiredRoutes(manifest.routes)) {
    throw new Error('Manifest routes에는 /, /list, /detail/:id가 포함되어야 합니다')
  }

  if (!manifest.build || typeof manifest.build.commit !== 'string' || typeof manifest.build.timestamp !== 'string') {
    throw new Error('Manifest build 메타데이터가 올바르지 않습니다')
  }

  return manifest as VariantManifest
}

export async function fetchAndValidateManifest(manifestUrl: string): Promise<VariantManifest> {
  const response = await fetch(manifestUrl)
  if (!response.ok) {
    throw new Error(`Manifest 조회 실패: ${response.status}`)
  }
  const payload = (await response.json()) as unknown
  return validateManifest(payload)
}
