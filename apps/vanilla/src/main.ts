import './style.css'
import './automation'
import items from './data/items.json'

type Item = {
  id: number
  title: string
  category: string
  price: number
  description: string
}

type MetricEntry = {
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

const state = {
  cartIds: [] as number[],
  search: '',
  debouncedSearch: '',
  searchPending: false,
  sort: 'id-asc',
  category: 'all',
  debounceTimer: 0,
}

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('App root not found')
const appRoot = app

const allItems = items as Item[]
const categories = ['all', ...Array.from(new Set(allItems.map((item) => item.category)))]

function metricsStore(): MetricEntry[] {
  if (!window.__APP_METRICS__) {
    window.__APP_METRICS__ = []
  }
  return window.__APP_METRICS__
}

function mark(name: string) {
  performance.mark(name)
  metricsStore().push({ type: 'mark', name, time: performance.now() })
}

function measure(name: string, startMark: string, endMark: string) {
  performance.measure(name, startMark, endMark)
  const entries = performance.getEntriesByName(name, 'measure')
  const entry = entries[entries.length - 1]
  if (entry) {
    metricsStore().push({ type: 'measure', name, time: entry.startTime, duration: entry.duration })
  }
}

function getPath() {
  return window.location.pathname
}

function navigate(path: string) {
  window.history.pushState({}, '', path)
  renderRoute()
}

function filteredItems() {
  let result = allItems

  if (state.debouncedSearch.trim()) {
    const needle = state.debouncedSearch.trim().toLowerCase()
    result = result.filter((item) => item.title.toLowerCase().includes(needle))
  }

  if (state.category !== 'all') {
    result = result.filter((item) => item.category === state.category)
  }

  const sorted = [...result]
  switch (state.sort) {
    case 'title-asc':
      sorted.sort((a, b) => a.title.localeCompare(b.title))
      break
    case 'title-desc':
      sorted.sort((a, b) => b.title.localeCompare(a.title))
      break
    case 'price-asc':
      sorted.sort((a, b) => a.price - b.price)
      break
    case 'price-desc':
      sorted.sort((a, b) => b.price - a.price)
      break
    default:
      sorted.sort((a, b) => a.id - b.id)
  }
  return sorted
}

function homeView() {
  return `
    <section class="panel">
      <h1>FrameBench 바닐라</h1>
      <p>프레임워크 비교를 위한 동일 기능 구현입니다.</p>
      <div class="actions">
        <button data-nav="/list">목록 보기</button>
      </div>
    </section>
  `
}

function listView() {
  const rows = filteredItems()
  const listMarkup = rows
    .slice(0, 200)
    .map(
      (item) => `
      <li>
        <a href="/detail/${item.id}" data-nav="/detail/${item.id}">
          <strong>${item.title}</strong>
          <span>${item.category}</span>
          <em>$${item.price.toFixed(2)}</em>
        </a>
      </li>
    `,
    )
    .join('')

  return `
    <section class="panel">
      <header class="panel-head">
        <h1>아이템 목록 (2000개)</h1>
        <span class="cart">장바구니 ${state.cartIds.length}</span>
      </header>
      <div class="toolbar">
        <input id="search-input" placeholder="제목 검색" value="${state.search}" />
        <select id="sort-select">
          <option value="id-asc" ${state.sort === 'id-asc' ? 'selected' : ''}>ID 오름차순</option>
          <option value="title-asc" ${state.sort === 'title-asc' ? 'selected' : ''}>제목 오름차순</option>
          <option value="title-desc" ${state.sort === 'title-desc' ? 'selected' : ''}>제목 내림차순</option>
          <option value="price-asc" ${state.sort === 'price-asc' ? 'selected' : ''}>가격 오름차순</option>
          <option value="price-desc" ${state.sort === 'price-desc' ? 'selected' : ''}>가격 내림차순</option>
        </select>
        <select id="category-select">
          ${categories
            .map(
              (category) =>
                `<option value="${category}" ${state.category === category ? 'selected' : ''}>${category === 'all' ? '전체' : category}</option>`,
            )
            .join('')}
        </select>
      </div>
      <p class="meta">총 ${rows.length}개 일치. 가독성을 위해 상위 200개만 렌더링합니다.</p>
      <ul class="item-list">${listMarkup}</ul>
    </section>
  `
}

function detailView(id: number) {
  const item = allItems.find((candidate) => candidate.id === id)
  if (!item) {
    return `
      <section class="panel">
        <h1>페이지를 찾을 수 없습니다</h1>
        <button data-nav="/list">목록으로 돌아가기</button>
      </section>
    `
  }

  const inCart = state.cartIds.includes(item.id)
  return `
    <section class="panel">
      <header class="panel-head">
        <h1>${item.title}</h1>
        <span class="cart">장바구니 ${state.cartIds.length}</span>
      </header>
      <p><strong>카테고리:</strong> ${item.category}</p>
      <p><strong>가격:</strong> $${item.price.toFixed(2)}</p>
      <p>${item.description}</p>
      <div class="actions">
        <button data-add-cart="${item.id}" ${inCart ? 'disabled' : ''}>
          ${inCart ? '이미 담긴 상품' : '장바구니 담기'}
        </button>
        <button data-nav="/list">목록으로 돌아가기</button>
      </div>
    </section>
  `
}

function bindCommonEvents() {
  appRoot.querySelectorAll<HTMLElement>('[data-nav]').forEach((el) => {
    el.addEventListener('click', (event) => {
      event.preventDefault()
      const path = el.dataset.nav
      if (path) navigate(path)
    })
  })

  appRoot.querySelectorAll<HTMLElement>('[data-add-cart]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = Number(el.dataset.addCart)
      if (!state.cartIds.includes(id)) {
        state.cartIds.push(id)
        renderRoute()
      }
    })
  })
}

function bindListEvents() {
  const searchInput = document.querySelector<HTMLInputElement>('#search-input')
  const sortSelect = document.querySelector<HTMLSelectElement>('#sort-select')
  const categorySelect = document.querySelector<HTMLSelectElement>('#category-select')

  searchInput?.addEventListener('input', (event) => {
    const value = (event.target as HTMLInputElement).value
    state.search = value
    state.searchPending = true
    performance.mark('search:input')
    clearTimeout(state.debounceTimer)
    state.debounceTimer = window.setTimeout(() => {
      state.debouncedSearch = value
      renderRoute()
    }, 250)
  })

  sortSelect?.addEventListener('change', (event) => {
    state.sort = (event.target as HTMLSelectElement).value
    renderRoute()
  })

  categorySelect?.addEventListener('change', (event) => {
    state.category = (event.target as HTMLSelectElement).value
    renderRoute()
  })
}

function renderRoute() {
  const path = getPath()

  if (path === '/') {
    appRoot.innerHTML = homeView()
    bindCommonEvents()
    return
  }

  if (path === '/list') {
    appRoot.innerHTML = listView()
    bindCommonEvents()
    bindListEvents()
    mark('list:rendered')
    if (state.searchPending) {
      performance.mark('search:rendered')
      measure('search:input_to_render', 'search:input', 'search:rendered')
      state.searchPending = false
    }
    return
  }

  const detailMatch = path.match(/^\/detail\/(\d+)$/)
  if (detailMatch) {
    appRoot.innerHTML = detailView(Number(detailMatch[1]))
    bindCommonEvents()
    mark('detail:rendered')
    return
  }

  appRoot.innerHTML = `
    <section class="panel">
      <h1>페이지를 찾을 수 없습니다</h1>
      <button data-nav="/">홈으로 이동</button>
    </section>
  `
  bindCommonEvents()
}

mark('app:start')
window.addEventListener('popstate', renderRoute)
renderRoute()


