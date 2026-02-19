# 리액트 CSR 구현

React + React Router + Vite 기반 CSR 구현입니다.
하나의 앱에서 라이브러리 케이스를 전환하며 동일 UI/기능 성능을 비교합니다.

## 구현 포인트

- 라우팅: `/`, `/list`, `/detail/:id`
- 2000개 로컬 JSON 데이터 렌더
- 검색(250ms 디바운스), 정렬, 카테고리 필터
- 장바구니 메모리 상태
- 케이스 전환: `?case=use-state | zustand | react-query`
- 성능 마크/측정: `window.__APP_METRICS__`
- `public/manifest.json` 제공
- 대시보드 자동화 시나리오 단계(DSL) 실행 지원

## 실행

```bash
corepack pnpm --filter @framebench/react-csr dev
```
