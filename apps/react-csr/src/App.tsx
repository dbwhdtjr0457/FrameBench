import { useEffect, useMemo, useRef } from 'react'
import { Link, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useReactQueryCaseController } from './cases/reactQueryCase'
import { BENCH_CASES, findBenchCase, parseBenchCaseId, type BenchCaseId, type BenchController } from './cases/types'
import { useUseStateCaseController } from './cases/useStateCase'
import { useZustandCaseController } from './cases/zustandCase'
import { CATEGORIES, filterAndSortItems, type SortOption } from './domain'
import { mark, measure } from './metrics'

function withCase(path: string, caseId: BenchCaseId) {
  const [pathname, query = ''] = path.split('?')
  const params = new URLSearchParams(query)
  params.set('case', caseId)
  const nextQuery = params.toString()
  return nextQuery ? `${pathname}?${nextQuery}` : pathname
}

function CaseHeader({
  caseId,
  onChangeCase,
}: {
  caseId: BenchCaseId
  onChangeCase: (next: BenchCaseId) => void
}) {
  const benchCase = findBenchCase(caseId)

  return (
    <section className="panel case-header">
      <div>
        <h1>FrameBench React CSR</h1>
        <p>{benchCase.description}</p>
      </div>
      <div className="case-controls">
        <label htmlFor="case-select">실험 케이스</label>
        <select
          id="case-select"
          value={caseId}
          onChange={(event) => onChangeCase(parseBenchCaseId(event.target.value))}
        >
          {BENCH_CASES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
    </section>
  )
}

function HomePage({ caseId }: { caseId: BenchCaseId }) {
  const benchCase = findBenchCase(caseId)
  return (
    <section className="panel">
      <h2>{benchCase.name}</h2>
      <p>동일 UI/기능에서 라이브러리 케이스만 바꿔 성능을 비교합니다.</p>
      <div className="actions">
        <Link to={withCase('/list', caseId)}>
          <button type="button">목록 보기</button>
        </Link>
      </div>
    </section>
  )
}

function ListPage({ controller, caseId }: { controller: BenchController; caseId: BenchCaseId }) {
  const searchPendingRef = useRef(false)

  const filtered = useMemo(
    () =>
      filterAndSortItems(
        controller.items,
        controller.debouncedSearch,
        controller.category,
        controller.sort,
      ),
    [controller.category, controller.debouncedSearch, controller.items, controller.sort],
  )

  useEffect(() => {
    if (controller.search !== controller.debouncedSearch) {
      performance.mark('search:input')
      searchPendingRef.current = true
    }
  }, [controller.search, controller.debouncedSearch])

  useEffect(() => {
    mark('list:rendered')
    if (!searchPendingRef.current || controller.search !== controller.debouncedSearch) {
      return
    }
    performance.mark('search:rendered')
    measure('search:input_to_render', 'search:input', 'search:rendered')
    searchPendingRef.current = false
  }, [filtered, controller.search, controller.debouncedSearch])

  return (
    <section className="panel">
      <div className="head">
        <h2>아이템 목록 (2000개)</h2>
        <span className="pill">장바구니 {controller.cartCount}</span>
      </div>
      <div className="toolbar">
        <input
          value={controller.search}
          onChange={(event) => controller.setSearch(event.target.value)}
          placeholder="제목 검색"
        />
        <select
          value={controller.sort}
          onChange={(event) => controller.setSort(event.target.value as SortOption)}
        >
          <option value="id-asc">ID 오름차순</option>
          <option value="title-asc">제목 오름차순</option>
          <option value="title-desc">제목 내림차순</option>
          <option value="price-asc">가격 오름차순</option>
          <option value="price-desc">가격 내림차순</option>
        </select>
        <select value={controller.category} onChange={(event) => controller.setCategory(event.target.value)}>
          {CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {value === 'all' ? '전체' : value}
            </option>
          ))}
        </select>
      </div>
      <p>총 {filtered.length}개 일치. 가독성을 위해 상위 200개만 렌더링합니다.</p>
      {controller.items.length === 0 ? (
        <p>데이터 로딩 중입니다...</p>
      ) : null}
      <ul className="items">
        {filtered.slice(0, 200).map((item) => (
          <li key={item.id}>
            <Link className="item-link" to={withCase(`/detail/${item.id}`, caseId)}>
              <strong>{item.title}</strong>
              <span>{item.category}</span>
              <em>${item.price.toFixed(2)}</em>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function DetailPage({ controller, caseId }: { controller: BenchController; caseId: BenchCaseId }) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const itemId = Number(id)
  const item = controller.items.find((candidate) => candidate.id === itemId)

  useEffect(() => {
    if (item) {
      mark('detail:rendered')
    }
  }, [item])

  if (!item && controller.items.length === 0) {
    return (
      <section className="panel">
        <h2>상세 데이터를 로딩 중입니다...</h2>
      </section>
    )
  }

  if (!item) {
    return (
      <section className="panel">
        <h2>페이지를 찾을 수 없습니다</h2>
        <button type="button" onClick={() => navigate(withCase('/list', caseId))}>
          목록으로 돌아가기
        </button>
      </section>
    )
  }

  const inCart = controller.hasInCart(item.id)

  return (
    <section className="panel">
      <div className="head">
        <h2>{item.title}</h2>
        <span className="pill">장바구니 {controller.cartCount}</span>
      </div>
      <p>
        <strong>카테고리:</strong> {item.category}
      </p>
      <p>
        <strong>가격:</strong> ${item.price.toFixed(2)}
      </p>
      <p>{item.description}</p>
      <div className="actions">
        <button type="button" disabled={inCart} onClick={() => controller.addToCart(item.id)}>
          {inCart ? '이미 담긴 상품' : '장바구니 담기'}
        </button>
        <button type="button" onClick={() => navigate(withCase('/list', caseId))}>
          목록으로 돌아가기
        </button>
      </div>
    </section>
  )
}

function CaseRoutes({ caseId, onChangeCase }: { caseId: BenchCaseId; onChangeCase: (next: BenchCaseId) => void }) {
  return (
    <main className="layout">
      <CaseHeader caseId={caseId} onChangeCase={onChangeCase} />
      <UseStateCaseRoutes caseId={caseId} />
    </main>
  )
}

function UseStateCaseRoutes({ caseId }: { caseId: BenchCaseId }) {
  const controller = useUseStateCaseController()
  return <CaseRouteContents caseId={caseId} controller={controller} />
}

function ZustandCaseRoutes({ caseId }: { caseId: BenchCaseId }) {
  const controller = useZustandCaseController()
  return <CaseRouteContents caseId={caseId} controller={controller} />
}

function ReactQueryCaseRoutes({ caseId }: { caseId: BenchCaseId }) {
  const controller = useReactQueryCaseController()
  return <CaseRouteContents caseId={caseId} controller={controller} />
}

function CaseRouteContents({ caseId, controller }: { caseId: BenchCaseId; controller: BenchController }) {
  return (
    <Routes>
      <Route path="/" element={<HomePage caseId={caseId} />} />
      <Route path="/list" element={<ListPage caseId={caseId} controller={controller} />} />
      <Route path="/detail/:id" element={<DetailPage caseId={caseId} controller={controller} />} />
      <Route path="*" element={<Navigate to={withCase('/', caseId)} replace />} />
    </Routes>
  )
}

function CaseHost({ caseId, onChangeCase }: { caseId: BenchCaseId; onChangeCase: (next: BenchCaseId) => void }) {
  if (caseId === 'zustand') {
    return (
      <main className="layout">
        <CaseHeader caseId={caseId} onChangeCase={onChangeCase} />
        <ZustandCaseRoutes caseId={caseId} />
      </main>
    )
  }

  if (caseId === 'react-query') {
    return (
      <main className="layout">
        <CaseHeader caseId={caseId} onChangeCase={onChangeCase} />
        <ReactQueryCaseRoutes caseId={caseId} />
      </main>
    )
  }

  return <CaseRoutes caseId={caseId} onChangeCase={onChangeCase} />
}

export default function App() {
  const [searchParams, setSearchParams] = useSearchParams()
  const caseId = parseBenchCaseId(searchParams.get('case'))

  useEffect(() => {
    mark('app:start')
  }, [])

  const onChangeCase = (next: BenchCaseId) => {
    const params = new URLSearchParams(searchParams)
    params.set('case', next)
    setSearchParams(params, { replace: true })
  }

  return <CaseHost caseId={caseId} onChangeCase={onChangeCase} />
}
