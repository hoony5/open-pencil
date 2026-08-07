// scrape — URL → .fig → OpenPencil 에디터에서 자동 오픈 (통합 CLI)
// 내부: url2fig_dom 으로 .fig 생성 → public/scrape/ 에 배치 → ?file= 로 에디터 오픈
// 사용: bun scrape.ts <url>   (사전: bun run dev 로 에디터가 :1420 에 떠 있어야 함)
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const [urlArg] = process.argv.slice(2)
if (!urlArg) {
  console.error('usage: bun scrape.ts <url>')
  console.error('  사전: bun run dev (OpenPencil 에디터가 :1420 에 실행 중이어야 함)')
  process.exit(1)
}

const fork = import.meta.dir
const outDir = join(fork, 'public', 'scrape')
mkdirSync(outDir, { recursive: true })
const outFig = join(outDir, 'last.fig')

const r = spawnSync('bun', ['url2fig_dom.ts', urlArg, outFig], { cwd: fork, stdio: 'inherit' })
if (r.status !== 0) process.exit(r.status ?? 1)

const editorUrl = process.env.EDITOR_URL ?? 'http://localhost:1420/?file=/scrape/last.fig'
console.log('opening in OpenPencil:', editorUrl)
spawnSync('open', [editorUrl])
