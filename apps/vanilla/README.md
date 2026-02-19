# 바닐라 구현

순수 HTML/CSS/TypeScript + Vite 기반 구현입니다.

## 구현 포인트

- SPA 라우팅: `/`, `/list`, `/detail/:id`
- 2000개 로컬 JSON 데이터 렌더
- 검색(250ms 디바운스), 정렬, 카테고리 필터
- 장바구니 메모리 상태
- 성능 마크/측정: `window.__APP_METRICS__`
- `public/manifest.json` 제공
- 대시보드 자동화 시나리오 단계(DSL) 실행 지원

## 실행

```bash
corepack pnpm --filter @framebench/vanilla dev
```
