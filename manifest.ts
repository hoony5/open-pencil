import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const ROOT = '/Users/hoony5/openpencil-roundtrip'
const CLONE = `${ROOT}/open-pencil`
const OUT = `${ROOT}/exp6/manifest.json`

interface EntryDef {
  id: string
  html: string
  fig: string
  md: string
  dart: string
  className: string
}

const ENTRIES: EntryDef[] = [
  {
    id: 'home',
    html: 'exp1/page.html',
    fig: 'exp1/page.fig',
    md: 'exp6/snippets_home.md',
    dart: 'exp6/gate/lib/home_snippet.dart',
    className: 'HomeSnippet'
  },
  {
    id: 'detail',
    html: 'exp5/detail.html',
    fig: 'exp5/detail.fig',
    md: 'exp6/snippets.md',
    dart: 'exp6/gate/lib/detail_snippet.dart',
    className: 'DetailSnippet'
  }
]

interface FigNode {
  id: string
  name: string
  type: string
}

function figNodes(figRel: string): FigNode[] {
  const js = readFileSync(`${ROOT}/exp6/dump_ids.js`, 'utf8')
  const r = spawnSync('bun', ['packages/cli/src/index.ts', 'eval', `${ROOT}/${figRel}`, '-c', js], {
    cwd: CLONE,
    encoding: 'utf8'
  })
  if (r.status !== 0) throw new Error(`eval failed for ${figRel}: ${r.stderr}`)
  const line = r.stdout.split('\n').find((l) => l.trim().startsWith('['))
  if (!line) throw new Error(`no JSON in eval output for ${figRel}`)
  return JSON.parse(line)
}

function parseMd(mdRel: string): { rootName: string; components: string[]; tokenCount: number } {
  const md = readFileSync(`${ROOT}/${mdRel}`, 'utf8')
  const rootName = md.match(/^# (\S+)/m)?.[1] ?? ''
  const components = [...md.matchAll(/^### (.+)$/gm)].map((m) => m[1].trim())
  const tokenCount = [...md.matchAll(/^const c_[0-9a-f]+ = Color/gm)].length
  return { rootName, components, tokenCount }
}

// Dart 식별자 정규화 — html2snippet의 componentSnippet과 동일 규칙 (fig 레이어명 ↔ 스니펫명 매핑)
const normName = (s: string): string => s.replace(/[^a-zA-Z0-9_]/g, '_')

function main(): void {
  const entries: any[] = []
  let pass = true

  for (const e of ENTRIES) {
    const files = [e.html, e.fig, e.md, e.dart]
    const fileExistence = files.every((f) => existsSync(`${ROOT}/${f}`))
    if (!fileExistence) {
      pass = false
      entries.push({ id: e.id, html: e.html, checks: { fileExistence: false } })
      console.log(`FAIL ${e.id}: missing file(s):`, files.filter((f) => !existsSync(`${ROOT}/${f}`)))
      continue
    }

    const nodes = figNodes(e.fig)
    const md = parseMd(e.md)
    const figRoot = nodes[0]
    const dartSrc = readFileSync(`${ROOT}/${e.dart}`, 'utf8')

    const rootNameEquivalence = md.rootName === figRoot.name
    const layerNames = new Set(nodes.map((n) => normName(n.name)))
    const missingComponents = md.components.filter((c) => !layerNames.has(normName(c)))
    const componentSubset = missingComponents.length === 0
    const classPresent = dartSrc.includes(`class ${e.className} extends`)

    const entryPass = fileExistence && rootNameEquivalence && componentSubset && classPresent
    if (!entryPass) pass = false

    entries.push({
      id: e.id,
      html: e.html,
      fig: { file: e.fig, rootId: figRoot.id, rootName: figRoot.name, layerCount: nodes.length },
      snippet: {
        md: e.md,
        dart: e.dart,
        className: e.className,
        rootName: md.rootName,
        components: md.components,
        tokenCount: md.tokenCount
      },
      checks: { fileExistence, rootNameEquivalence, componentSubset, missingComponents, classPresent }
    })
    console.log(
      `${entryPass ? 'PASS' : 'FAIL'} ${e.id}: root=${figRoot.name}(${figRoot.id}) layers=${nodes.length} components=${md.components.length} missing=[${missingComponents}]`
    )
  }

  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    generator: 'manifest.ts',
    entries,
    pass
  }
  writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n')
  console.log('written', OUT, '| pass:', pass)
  if (!pass) process.exit(1)
}

main()
