// url2fig — 웹사이트 주소 → .fig (주기능 CLI)
// URL의 HTML과 <link>/<style> CSS를 긁어 합친 뒤 import → normalize_graph 파이프라인으로 .fig 생성.
// html2fig.sh(부모 디렉터리)에 의존하지 않고 fork 내에서 자급 동작.
// 사용: bun url2fig.ts <url> <out.fig> [rootWidth]
import { writeFileSync, mkdtempSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [urlArg, outArg, rootWidthArg] = process.argv.slice(2)
if (!urlArg || !outArg) {
  console.error('usage: bun url2fig.ts <url> <out.fig> [rootWidth]')
  process.exit(1)
}

const base = new URL(urlArg)
const absolutize = (u: string): string | null => {
  try {
    return new URL(u, base).href
  } catch {
    return null
  }
}

const html = await fetch(urlArg).then((r) => r.text())

// CSS 수집: <link rel=stylesheet href> (절대화 후 fetch) + <style> 블록
const cssParts: string[] = []
for (const m of html.matchAll(/<link[^>]*rel=["']?stylesheet["']?[^>]*>/gi)) {
  const href = m[0].match(/href=["']([^"']+)["']/i)?.[1]
  if (!href) continue
  const abs = absolutize(href)
  if (!abs) continue
  try {
    cssParts.push(await fetch(abs).then((r) => r.text()))
  } catch {
    console.error('css skip (fetch fail):', abs)
  }
}
for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) cssParts.push(m[1])
if (!cssParts.length) console.error('warn: 수집된 CSS 없음 — 인라인 스타일만으로 제한 동작')
const css = cssParts.join('\n')

const tmp = mkdtempSync(join(tmpdir(), 'url2fig-'))
const htmlPath = join(tmp, 'page.html')
const cssPath = join(tmp, 'all.css')
writeFileSync(htmlPath, html)
writeFileSync(cssPath, css)
console.log(`fetched html ${html.length}B, css ${css.length}B (${cssParts.length} sources)`)

const fork = import.meta.dir
const styleMap = join(tmp, 'map.json')

// 1. import → style map (dom-css 헤드리스 런타임이 HTML+CSS로 computedStyle 계산)
let r = spawnSync(
  'bun',
  ['packages/cli/src/index.ts', 'import', htmlPath, '--css', cssPath, '-o', styleMap, '-f', 'json', '--json'],
  { cwd: fork, stdio: 'inherit' },
)
if (r.status !== 0) process.exit(r.status ?? 1)

// 2. normalize_graph → .fig
r = spawnSync('bun', ['normalize_graph.ts'], {
  cwd: fork,
  stdio: 'inherit',
  env: {
    ...process.env,
    HTML: htmlPath,
    CSS: cssPath,
    OUT: outArg,
    STYLE_MAP_JSON: styleMap,
    ROOT_WIDTH: rootWidthArg ?? '360',
  },
})
process.exit(r.status ?? 1)
