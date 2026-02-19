# 대시보드

관리 콘솔 앱입니다.

## 핵심 기능

- 구현 CRUD (등록/검색/태그 수정/soft-delete/복구/활성 토글)
- 기능 세트 CRUD + 활성 기능 세트 선택
- 시나리오 CRUD
- JSON 가져오기/내보내기
- URL 기반 manifest 조회/검증 후 구현 등록
- 활성 기능 세트 기준 미지원 여부 표시 및 측정 제외 토글
- 실행 비교: 시나리오 단계(DSL)를 각 변형 앱 자동화 런타임으로 전달해 실행

## 시나리오 단계 DSL

- `open /path`
- `search 키워드`
- `click CSS선택자`
- `wait metric 메트릭이름 [timeoutMs]`
- `wait selector CSS선택자 [timeoutMs]`
- `sleep ms`

## 저장소

- localStorage key: `framebench:dashboard:v1`
- seed:
  - `localhost:3001` 바닐라 JS
  - `localhost:3002` 리액트 CSR(`case:use-state`)
  - `localhost:3002` 리액트 CSR(`case:zustand`)
  - `localhost:3002` 리액트 CSR(`case:react-query`)

## 실행

```bash
corepack pnpm --filter @framebench/dashboard dev
```
