// url2fig_dom — 브라우저 캡처 기반 .fig (반응형 3해상도: mobile/tablet/desktop → 페이지 3개)
// 헤드리스 Chrome이 각 해상도로 렌더 → rect/computedStyle/<img> src 캡처 → 절대좌표 .fig.
// 사용: bun url2fig_dom.ts <url> <out.fig>
import puppeteer from 'puppeteer-core'
import { SceneGraph } from '@open-pencil/scene-graph'
import { computeAllLayouts } from '@open-pencil/core'
import { computeImageHash } from '#core/figma-api'
import { writeFig } from './normalize_graph.ts'

const [urlArg, outArg] = process.argv.slice(2)
if (!urlArg || !outArg) {
  console.error('usage: bun url2fig_dom.ts <url> <out.fig>')
  process.exit(1)
}

const VIEWPORTS = [
  { name: 'mobile', w: 390 },
  { name: 'tablet', w: 768 },
  { name: 'desktop', w: 1280 }
]

const parseNum = (s: string | null): number | null => {
  if (!s) return null
  const m = s.match(/-?[\d.]+/)
  return m ? parseFloat(m[0]) : null
}
const parseColor = (s: string | null): { r: number; g: number; b: number; a: number } | null => {
  if (!s) return null
  const m = s.match(/rgba?\(([^)]+)\)/)
  if (m) {
    const p = m[1].split(',').map((x) => parseFloat(x))
    if (p.slice(0, 3).some((x) => Number.isNaN(x))) return null
    return { r: p[0] / 255, g: p[1] / 255, b: p[2] / 255, a: p[3] == null || Number.isNaN(p[3]) ? 1 : p[3] }
  }
  const hx = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hx) {
    const h = hx[1].length === 3 ? hx[1].split('').map((c) => c + c).join('') : hx[1]
    const n = parseInt(h, 16)
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: 1 }
  }
  return null
}
// Pretendard 전 가중치 매핑 (로컬 ~/Library/Fonts 에 Thin~Black 9종)
const weightToStyle = (w: number): string =>
  w >= 900 ? 'Black' : w >= 800 ? 'ExtraBold' : w >= 700 ? 'Bold' : w >= 600 ? 'SemiBold' : w >= 500 ? 'Medium' : w >= 300 ? 'Light' : w >= 200 ? 'ExtraLight' : 'Thin'
const pickFont = (_txt: string): string => 'Pretendard'

// 1. 해상도별 캡처
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars']
})
const page = await browser.newPage()
await page.goto(urlArg, { waitUntil: 'networkidle0', timeout: 60000 })

const captures: { name: string; tree: any }[] = []
for (const vp of VIEWPORTS) {
  await page.setViewport({ width: vp.w, height: 800 })
  await new Promise((r) => setTimeout(r, 500)) // 반응형 리플로우 대기
  const tree = await page.evaluate(() => {
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
          bg: cs.backgroundColor, color: cs.color, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
          fontFamily: cs.fontFamily, radius: cs.borderTopLeftRadius, position: cs.position,
          padL: cs.paddingLeft, padT: cs.paddingTop, fill: el.getAttribute('fill')
        },
        img: el.tagName === 'IMG' ? (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src : '',
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
    return walk(document.body)
  })
  captures.push({ name: vp.name, tree })
  console.log(`captured ${vp.name} (${vp.w}w): root kids=${tree?.kids?.length ?? 0}`)
}
await browser.close()

// 2. 이미지 수집·다운로드 (URL dedup → hash)
const imgCache = new Map<string, string>()
for (const { tree } of captures) {
  ;(function collect(n: any) {
    if (n.img && !imgCache.has(n.img)) imgCache.set(n.img, '')
    n.kids.forEach(collect)
  })(tree)
}
const g = new SceneGraph()
let imgOk = 0
for (const url of imgCache.keys()) {
  try {
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
    const hash = computeImageHash(bytes)
    g.images.set(hash, bytes)
    imgCache.set(url, hash)
    imgOk++
  } catch {
    imgCache.set(url, '') // 다운로드 실패 → placeholder
  }
}
console.log(`images: ${imgOk}/${imgCache.size} downloaded`)

// 3. 빌드
function makeText(parentId: string, n: any, x: number, y: number): void {
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
    x,
    y
  })
}

function build(parentId: string, n: any, parentRect: { x: number; y: number }, isRoot: boolean): void {
  if (n.kids.length === 0 && n.text) {
    makeText(parentId, n, isRoot ? 0 : Math.round(n.rect.x - parentRect.x), isRoot ? 0 : Math.round(n.rect.y - parentRect.y))
    return
  }
  const bg = parseColor(n.cs.bg)
  const svgFill = parseColor(n.cs.fill)
  const imgHash = n.img ? imgCache.get(n.img) ?? '' : ''
  const props: any = {
    name: String(n.cls || n.tag || 'node').slice(0, 60),
    layoutMode: 'NONE',
    width: Math.round(n.rect.w),
    height: Math.round(n.rect.h),
    x: isRoot ? 0 : Math.round(n.rect.x - parentRect.x),
    y: isRoot ? 0 : Math.round(n.rect.y - parentRect.y),
    cornerRadius: parseNum(n.cs.radius) ?? 0,
    fills: imgHash
      ? [{ type: 'IMAGE', imageHash: imgHash, imageScaleMode: 'FILL', color: { r: 0.9, g: 0.9, b: 0.9, a: 1 }, opacity: 1, visible: true }]
      : bg && bg.a > 0
        ? [{ type: 'SOLID', color: bg }]
        : svgFill
          ? [{ type: 'SOLID', color: svgFill }]
          : []
  }
  const frame = g.createNode('FRAME', parentId, props)
  if (n.text) makeText(frame.id, n, parseNum(n.cs.padL) ?? 0, parseNum(n.cs.padT) ?? 0)
  for (const k of n.kids) build(frame.id, k, n.rect, false)
}

for (const { name, tree } of captures) {
  const pg = g.addPage(name)
  if (tree) build(pg.id, tree, { x: 0, y: 0 }, true)
}
computeAllLayouts(g)
await writeFig(g, outArg)
