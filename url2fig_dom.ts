// url2fig_dom — 브라우저 렌더링 기반 .fig (URL → headless Chrome → rect/computedStyle → auto-layout .fig)
// 브라우저가 확정한 layout 의도(display/flex-direction/gap/padding)와 rect를 그대로 auto-layout으로 직역.
// 정확도(브라우저 급) + 편집가능성(auto-layout) 둘 다. 사용: bun url2fig_dom.ts <url> <out.fig> [width]
import puppeteer from 'puppeteer-core'
import { SceneGraph } from '@open-pencil/scene-graph'
import { computeAllLayouts } from '@open-pencil/core'
import { writeFig } from './normalize_graph.ts'

const [urlArg, outArg, widthArg] = process.argv.slice(2)
if (!urlArg || !outArg) {
  console.error('usage: bun url2fig_dom.ts <url> <out.fig> [width]')
  process.exit(1)
}
const VW = Number(widthArg ?? 360)

const parseNum = (s: string | null): number | null => {
  if (!s) return null
  const m = s.match(/-?[\d.]+/)
  return m ? parseFloat(m[0]) : null
}
const parseColor = (s: string | null): { r: number; g: number; b: number; a: number } | null => {
  if (!s) return null
  const m = s.match(/rgba?\(([^)]+)\)/)
  if (!m) return null
  const p = m[1].split(',').map((x) => parseFloat(x))
  if (p.slice(0, 3).some((x) => Number.isNaN(x))) return null
  return { r: p[0] / 255, g: p[1] / 255, b: p[2] / 255, a: p[3] == null || Number.isNaN(p[3]) ? 1 : p[3] }
}

// 1. 캡처: DOM 트리 + rect + computedStyle
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars']
})
const page = await browser.newPage()
await page.setViewport({ width: VW, height: 800 })
await page.goto(urlArg, { waitUntil: 'networkidle0', timeout: 60000 })

const tree = await page.evaluate((vw) => {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'HEAD', 'LINK', 'META', 'TITLE'])
  function walk(el: Element): any | null {
    if (SKIP.has(el.tagName)) return null
    const r = (el as HTMLElement).getBoundingClientRect()
    const cs = getComputedStyle(el as HTMLElement)
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return null
    if (r.width < 1 || r.height < 1) return null
    const node: any = {
      tag: el.tagName,
      cls: el.getAttribute('class') ?? '',
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      cs: {
        display: cs.display,
        flexDirection: cs.flexDirection,
        gap: cs.gap,
        padT: cs.paddingTop, padR: cs.paddingRight, padB: cs.paddingBottom, padL: cs.paddingLeft,
        bg: cs.backgroundColor,
        color: cs.color,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        fontFamily: cs.fontFamily,
        radius: cs.borderTopLeftRadius,
        position: cs.position
      },
      text: Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent!.trim())
        .filter(Boolean)
        .join(' '),
      kids: [] as any[]
    }
    for (const c of Array.from(el.children)) {
      const k = walk(c)
      if (k) node.kids.push(k)
    }
    return node
  }
  const body = document.body
  return { root: walk(body), scrollHeight: body.scrollHeight, vw }
}, VW)
await browser.close()
console.log(`captured: root kids=${tree.root?.kids?.length ?? 0}, scrollH=${tree.scrollHeight}`)

// 2. 빌드: captured tree → auto-layout scene-graph
const g = new SceneGraph()
const pg = g.getPages()[0] // 기본 'Page 1'에 빌드 (export 기본 대상)

const weightToStyle = (w: number): string => (w >= 700 ? 'Bold' : w >= 600 ? 'SemiBold' : 'Regular')
// 로컬에서 로드되는 유일한 폰트 = Pretendard (~/Library/Fonts). Latin 글리프 포함.
// Helvetica.ttc 등 시스템 폰트는 host loader가 인식 못 함 → 글리프 누락.
const pickFont = (_txt: string): string => 'Pretendard'

function makeText(parentId: string, n: any, parentRect: { x: number; y: number }, isRoot: boolean, x?: number, y?: number): void {
  const fw = parseNum(n.cs.fontWeight) ?? 400
  const family = pickFont(n.text)
  const col = parseColor(n.cs.color) ?? { r: 0.11, g: 0.12, b: 0.16, a: 1 }
  g.createNode('TEXT', parentId, {
    name: n.text.slice(0, 40),
    text: n.text,
    fontSize: parseNum(n.cs.fontSize) ?? 14,
    fontWeight: fw,
    fontFamily: family,
    fontName: { family, style: weightToStyle(fw) },
    fills: [{ type: 'SOLID', color: col }],
    width: Math.round(n.rect.w),
    height: Math.round(n.rect.h),
    x: x ?? (isRoot ? 0 : Math.round(n.rect.x - parentRect.x)),
    y: y ?? (isRoot ? 0 : Math.round(n.rect.y - parentRect.y))
  })
}

function build(parentId: string, n: any, parentRect: { x: number; y: number }, isRoot: boolean): void {
  // leaf 텍스트 요소(자식 요소 없음, 텍스트만) → TEXT 노드 직접 (사이즈 붕괴 방지)
  if (n.kids.length === 0 && n.text) {
    makeText(parentId, n, parentRect, isRoot)
    return
  }
  const bg = parseColor(n.cs.bg)
  const props: any = {
    name: String(n.cls || n.tag || 'node').slice(0, 60),
    // 절대 배치 — 브라우저 rect가 ground truth. Figma auto-layout은 flex-wrap/grid를 못 다루므로 rect 직접 사용.
    layoutMode: 'NONE',
    width: Math.round(n.rect.w),
    height: Math.round(n.rect.h),
    x: isRoot ? 0 : Math.round(n.rect.x - parentRect.x),
    y: isRoot ? 0 : Math.round(n.rect.y - parentRect.y),
    cornerRadius: parseNum(n.cs.radius) ?? 0,
    fills: bg && bg.a > 0 ? [{ type: 'SOLID', color: bg }] : []
  }
  const frame = g.createNode('FRAME', parentId, props)
  if (n.text) makeText(frame.id, n, parentRect, false, parseNum(n.cs.padL) ?? 0, parseNum(n.cs.padT) ?? 0)
  for (const k of n.kids) build(frame.id, k, n.rect, false)
}

if (tree.root) build(pg.id, tree.root, { x: 0, y: 0 }, true)
computeAllLayouts(g)
await writeFig(g, outArg)
