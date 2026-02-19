# FrameBench

백엔드 없이 운영 가능한 프론트엔드 비교 실험 플랫폼 모노레포입니다.

- 관리 콘솔: `apps/dashboard` (React + Vite + Tailwind)
- 실험 구현: `apps/vanilla`, `apps/react-csr`
- 확장 슬롯: `apps/vue`

## 실행

1. Node.js 20+ 준비
2. 루트에서 의존성 설치

```bash
corepack pnpm install
```

3. 동시 실행

```bash
corepack pnpm dev
```

기본 포트:
- dashboard: `http://localhost:3000`
- vanilla: `http://localhost:3001`
- react-csr: `http://localhost:3002` (`?case=use-state|zustand|react-query`)

## 아키텍처

- 모노레포: `pnpm workspace`
- 저장소: dashboard의 `localStorage` 단일 키 `framebench:dashboard:v1`
- 구현 등록: base URL 입력 -> `${url}/manifest.json` 조회/검증 -> 저장
- 삭제 전략: soft-delete (`deletedAt` 기록, 복구 가능)
- 기능 세트 기반 호환성 표시: 활성 기능 세트와 `supportedFeatures` 비교
- 미지원 구현 측정 제외 토글 제공
- react-csr는 단일 포트에서 쿼리 파라미터 `case`로 라이브러리 케이스 전환

## Manifest 스키마

각 구현 앱은 빌드 산출물 루트에서 `GET /manifest.json` 제공:

```json
{
  "id": "react-csr",
  "name": "리액트 CSR",
  "tech": ["react", "vite", "zustand", "tanstack-query"],
  "version": "0.1.0",
  "baseUrl": "http://localhost:3002",
  "routes": ["/", "/list", "/detail/:id"],
  "supportedFeatures": ["core", "metrics", "multi-case"],
  "build": { "commit": "dev", "timestamp": "dev" }
}
```

## 대시보드 데이터 모델

```ts
Variant: id, name, baseUrl, manifestUrl, enabled, deletedAt?, tags[], supportedFeatures?
FeatureSet: id, name, features[]
Scenario: id, name, steps[], requiredFeatures[]
RunRecord(스켈레톤): id, scenarioId, variantId, startedAt, endedAt?, status, notes?
```

## 가져오기/내보내기 포맷

```json
{
  "exportedAt": "2026-02-19T00:00:00.000Z",
  "data": {
    "variants": [],
    "featureSets": [],
    "scenarios": [],
    "runs": [],
    "activeFeatureSetId": "core-metrics",
    "excludeUnsupportedFromMeasurement": true
  }
}
```

## 자동화 시나리오 단계 문법

- `open /path`
- `search 키워드`
- `click CSS선택자`
- `wait metric 메트릭이름 [timeoutMs]`
- `wait selector CSS선택자 [timeoutMs]`
- `sleep ms`

예시:

```text
open /list
search 상품 20
open /detail/20
click .actions button
```

## 공통 기능

- 라우트: `/`, `/list`, `/detail/:id`
- `/list`: 로컬 JSON 2000개 아이템, 검색(디바운스), 정렬, 카테고리 필터
- `/detail/:id`: 상세 정보, 장바구니 담기(앱 내부 메모리 상태)

## Metrics 훅

각 구현 앱 공통:
- `performance.mark('app:start')`
- list 렌더 완료 시 `mark('list:rendered')`
- detail 렌더 완료 시 `mark('detail:rendered')`
- 검색 반응 측정 `measure('search:input_to_render', ...)`
- 결과 누적: `window.__APP_METRICS__`
