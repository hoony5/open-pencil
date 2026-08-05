import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { computeAllLayouts } from '@open-pencil/core'
import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { createHeadlessCSSRuntime, htmlToSceneGraph } from '@open-pencil/dom-css'
import { createCollection, createVariable } from './packages/scene-graph/src/variables.ts'
import { fontManager } from './packages/core/src/text/fonts.ts'

// 헤드리스 폰트 해결: 브라우저 Local Font Access 불가 환경에서 시스템 폰트 파일 로드
const FONT_DIRS = [
  join(homedir(), 'Library/Fonts'),
  '/Library/Fonts',
  '/System/Library/Fonts',
  '/System/Library/Fonts/Supplemental'
]

export function installHostFontLoader(): void {
  fontManager.setHostFontLoader(async (family: string, style: string) => {
    const fam = family.toLowerCase().replace(/\s+/g, '')
    const sty = style.toLowerCase().replace(/\s+/g, '')
    for (const dir of FONT_DIRS) {
      if (!existsSync(dir)) continue
      for (const file of readdirSync(dir)) {
        if (!/\.(otf|ttf)$/i.test(file)) continue
        const base = file.replace(/\.(otf|ttf)$/i, '').toLowerCase().replace(/\s+/g, '')
        const famHit = base.includes(fam)
        const styHit =
          sty === 'regular' ? !/-/.test(base.replace(fam, '')) || base.includes('regular') : base.includes(sty)
        if (famHit && styHit) {
          const buf = readFileSync(join(dir, file))
          return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
        }
      }
    }
    return null
  })
}

export async function preloadGraphFonts(graph: any): Promise<number> {
  installHostFontLoader()
  const seen = new Set<string>()
  let loaded = 0
  for (const n of graph.getAllNodes()) {
    if (n.type !== 'TEXT') continue
    const family = n.fontFamily ?? 'Pretendard'
    const style = n.fontName?.style ?? 'Regular'
    const key = `${family}|${style}`
    if (seen.has(key)) continue
    seen.add(key)
    const data = await fontManager.loadLocalFont(family, style)
    if (data) loaded++
  }
  return loaded
}

export interface TokenDef {
  varName: string
  name: string
  type: 'COLOR' | 'FLOAT'
  value: any
  hex?: string
  num?: number
}

export function extractTokens(css: string): TokenDef[] {
  const m = css.match(/:root\s*\{([^}]*)\}/)
  if (!m) return []
  const tokens: TokenDef[] = []
  const re = /--([\w-]+)\s*:\s*([^;]+);/g
  let t: RegExpExecArray | null
  while ((t = re.exec(m[1]))) {
    const raw = t[2].trim()
    const name = t[1].replace(/^(color|radius|space)-/, '')
    const hex = raw.match(/^#([0-9a-f]{6})/i)
    if (hex) {
      const h = hex[1].toLowerCase()
      tokens.push({
        varName: t[1],
        name,
        type: 'COLOR',
        hex: '#' + h,
        value: {
          r: parseInt(h.slice(0, 2), 16) / 255,
          g: parseInt(h.slice(2, 4), 16) / 255,
          b: parseInt(h.slice(4, 6), 16) / 255,
          a: 1
        }
      })
    } else {
      const f = parseFloat(raw)
      if (!Number.isNaN(f)) tokens.push({ varName: t[1], name, type: 'FLOAT', num: f, value: f })
    }
  }
  return tokens
}

export const num = (v: unknown): number | null => {
  const m = v == null ? null : String(v).match(/[\d.]+/)
  return m ? parseFloat(m[0]) : null
}

export function mkText(
  graph: any,
  parent: any,
  txt: string,
  size = 12,
  weight = 400,
  color = { r: 0.11, g: 0.12, b: 0.16, a: 1 }
): any {
  const lh = Math.round(size * 1.5)
  const cjk = (txt.match(/[가-힣]/g) ?? []).length
  const w = Math.max(40, Math.round(cjk * size + (txt.length - cjk) * size * 0.6))
  return graph.createNode('TEXT', parent.id, {
    name: txt.slice(0, 40),
    text: txt,
    fontSize: size,
    fontWeight: weight,
    fontFamily: 'Pretendard',
    fontName: { family: 'Pretendard', style: weight >= 700 ? 'Bold' : weight >= 600 ? 'SemiBold' : 'Regular' },
    fills: [{ type: 'SOLID', color }],
    lineHeight: lh,
    width: w,
    height: lh
  })
}

export function mkSection(
  graph: any,
  parent: any,
  label: string,
  items: string[] | undefined,
  prefix = '• '
): void {
  if (!items || !items.length) return
  mkText(graph, parent, label, 12, 700, { r: 0.16, g: 0.24, b: 0.42, a: 1 })
  for (const it of items) mkText(graph, parent, prefix + it, 12, 400)
}

export interface NormalizeOpts {
  rootWidth?: number
  meta?: any
  tokens?: boolean
}

export async function normalizeFromHtml(
  html: string,
  css: string,
  styleMap: Record<string, Record<string, string>>,
  opts: NormalizeOpts = {}
): Promise<any> {
  const ROOT_WIDTH = opts.rootWidth ?? 360
  const runtime = createHeadlessCSSRuntime()
  const graph = await htmlToSceneGraph(html, { cssText: css, runtime })

  const visit = (id: string, isRoot: boolean, parentMode: string): void => {
    const n = graph.getNode(id) as any
    if (!n) return
    const cssm = styleMap[n.name] ?? {}
    if (n.type === 'FRAME') {
      const pad = [
        num(cssm['padding-top']),
        num(cssm['padding-right']),
        num(cssm['padding-bottom']),
        num(cssm['padding-left'])
      ]
      const hasPad = pad.some((p) => p)
      if (n.layoutMode === 'NONE' && hasPad) n.layoutMode = 'VERTICAL'
      if (n.layoutMode !== 'NONE') {
        if (hasPad) {
          n.paddingTop = pad[0] || 0
          n.paddingRight = pad[1] || 0
          n.paddingBottom = pad[2] || 0
          n.paddingLeft = pad[3] || 0
        }
        n.primaryAxisSizing = 'HUG'
        n.counterAxisSizing = 'HUG'
        if (isRoot) {
          n.counterAxisSizing = 'FIXED'
          n.width = ROOT_WIDTH
        } else if (parentMode !== 'NONE' && n.layoutPositioning !== 'ABSOLUTE') {
          if (parentMode === 'VERTICAL') {
            if (n.layoutMode === 'HORIZONTAL') n.primaryAxisSizing = 'FILL'
            else n.counterAxisSizing = 'FILL'
          } else {
            if (n.layoutMode === 'HORIZONTAL') n.counterAxisSizing = 'FILL'
            else n.primaryAxisSizing = 'FILL'
          }
        }
      }
      if (cssm['flex'] && String(cssm['flex']).includes('1')) n.layoutGrow = 1
      if (n.layoutMode === 'NONE' && parentMode !== 'NONE' && n.layoutPositioning !== 'ABSOLUTE') {
        n.layoutAlignSelf = 'STRETCH'
      }
      const bs = cssm['box-shadow']
      if (bs && n.effects && n.effects[0]) {
        const am = String(bs).match(/rgba\(\s*[^)]*?,\s*([\d.]+)\s*\)/)
        if (am) n.effects[0].color = { ...n.effects[0].color, a: parseFloat(am[1]) }
      }
    }
    if (n.type === 'TEXT') {
      const lh = Number(n.lineHeight ?? 0)
      if (lh > 0 && lh < 4) n.lineHeight = Math.round(lh * (n.fontSize ?? 14))
    }
    if (n.type === 'TEXT' && parentMode === 'VERTICAL' && n.layoutPositioning !== 'ABSOLUTE') {
      n.textAutoResize = 'HEIGHT'
      n.layoutAlignSelf = 'STRETCH'
    }
    if (n.type === 'TEXT') {
      const w = Number(n.fontWeight ?? 400)
      n.fontFamily = 'Pretendard'
      n.fontName = {
        family: 'Pretendard',
        style: w >= 700 ? 'Bold' : w >= 600 ? 'SemiBold' : 'Regular'
      }
    }
    const ownMode = n.type === 'FRAME' ? n.layoutMode : 'NONE'
    for (const c of [...n.childIds]) visit(c, false, ownMode)
  }
  for (const page of graph.getPages()) for (const c of [...page.childIds]) visit(c, true, 'NONE')

  const refits: any[] = []
  if (opts.meta) {
    const meta = opts.meta
    const designPage = graph.getPages()[0]
    const rootFrame = designPage.childIds.length
      ? (graph.getNode(designPage.childIds[0]) as any)
      : null

    if (rootFrame && (meta.post_process ?? []).length) {
      const footer = graph.createNode('FRAME', designPage.id, {
        name: 'postprocess_footer',
        layoutMode: 'VERTICAL',
        primaryAxisSizing: 'HUG',
        counterAxisSizing: 'HUG',
        itemSpacing: 4,
        x: 0,
        y: (rootFrame.height ?? 0) + 48
      })
      mkText(graph, footer, 'POST-PROCESS (수동)', 11, 700, { r: 0.7, g: 0.2, b: 0.2, a: 1 })
      for (const it of meta.post_process)
        mkText(graph, footer, '⚠ ' + it, 11, 400, { r: 0.45, g: 0.48, b: 0.55, a: 1 })
      refits.push(footer)
    }

    const annPage = graph.addPage('ANNOTATION')
    const ann = graph.createNode('FRAME', annPage.id, {
      name: `anno_${(meta.title ?? 'page').replace(/\s+/g, '_')}`,
      layoutMode: 'VERTICAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'FIXED',
      width: 480,
      itemSpacing: 8,
      paddingTop: 24,
      paddingRight: 24,
      paddingBottom: 24,
      paddingLeft: 24,
      x: 0,
      y: 0,
      fills: [{ type: 'SOLID', color: { r: 0.97, g: 0.98, b: 1, a: 1 } }]
    })
    mkText(graph, ann, meta.title ?? 'page', 16, 700)
    if (meta.description) mkText(graph, ann, meta.description, 12, 400)
    mkSection(graph, ann, 'UX FLOW', meta.ux_flow)
    mkSection(graph, ann, 'UI NOTES', meta.ui_notes)
    mkSection(graph, ann, 'TODOS', meta.todos, '□ ')
    mkSection(graph, ann, 'POST-PROCESS', meta.post_process, '⚠ ')
    refits.push(ann)
  }

  computeAllLayouts(graph)

  // TOKENS: :root CSS 변수 → Figma Variables 컬렉션 + 값 매칭 바인딩
  // (바인딩은 인메모리 — fig writer가 nodeChange variableConsumptionMap 미직렬화, 업스트림 갭)
  if (opts.tokens) {
    const tokens = extractTokens(css)
    if (tokens.length) {
      let seq = 0
      const gen = (): string => `tok_${++seq}`
      const col = createCollection(graph, gen, 'design-tokens')
      const bindAll = (id: string, t: TokenDef): void => {
        const n = graph.getNode(id) as any
        if (!n) return
        if (t.type === 'COLOR' && n.fills?.[0]?.color) {
          const c = n.fills[0].color
          if (
            Math.abs(c.r - t.value.r) < 0.01 &&
            Math.abs(c.g - t.value.g) < 0.01 &&
            Math.abs(c.b - t.value.b) < 0.01
          ) {
            n.boundVariables = { ...n.boundVariables, fills: [t.varName] }
          }
        }
        if (t.type === 'FLOAT') {
          if (Math.abs((n.cornerRadius ?? -1) - t.num) < 0.01)
            n.boundVariables = { ...n.boundVariables, cornerRadius: t.varName }
          if (Math.abs((n.itemSpacing ?? -1) - t.num) < 0.01)
            n.boundVariables = { ...n.boundVariables, itemSpacing: t.varName }
        }
        for (const cid of [...n.childIds]) bindAll(cid, t)
      }
      for (const t of tokens) {
        createVariable(graph, gen, t.name, t.type, col.id, t.value)
        for (const pg of graph.getPages()) for (const cid of [...pg.childIds]) bindAll(cid, t)
      }
    }
  }

  for (const f of refits) {
    const kids = f.childIds.map((id: string) => graph.getNode(id) as any)
    if (!kids.length) continue
    if (f.counterAxisSizing === 'HUG')
      f.width = Math.max(...kids.map((k: any) => k.width)) + f.paddingLeft + f.paddingRight
    f.height =
      kids.reduce((s: number, k: any) => s + k.height, 0) +
      f.itemSpacing * (kids.length - 1) +
      f.paddingTop +
      f.paddingBottom
  }

  const fixAbsolute = (id: string): void => {
    const n = graph.getNode(id) as any
    if (!n) return
    if (n.layoutPositioning === 'ABSOLUTE' && n.parentId) {
      const parent = graph.getNode(n.parentId) as any
      const cssm = styleMap[n.name] ?? {}
      if (n.layoutMode !== 'NONE' && n.childIds.length > 0) {
        const kids = n.childIds.map((cid: string) => graph.getNode(cid) as any)
        if (n.layoutMode === 'VERTICAL') {
          n.width = Math.max(...kids.map((k: any) => k.width)) + n.paddingLeft + n.paddingRight
          n.height =
            kids.reduce((s: number, k: any) => s + k.height, 0) +
            n.itemSpacing * (kids.length - 1) +
            n.paddingTop +
            n.paddingBottom
        } else {
          n.height = Math.max(...kids.map((k: any) => k.height)) + n.paddingTop + n.paddingBottom
          n.width =
            kids.reduce((s: number, k: any) => s + k.width, 0) +
            n.itemSpacing * (kids.length - 1) +
            n.paddingLeft +
            n.paddingRight
        }
      }
      const right = num(cssm['right'])
      const bottom = num(cssm['bottom'])
      if (right != null && parent) n.x = parent.width - right - n.width
      if (bottom != null && parent) n.y = parent.height - bottom - n.height
    }
    for (const c of [...n.childIds]) fixAbsolute(c)
  }
  for (const page of graph.getPages()) for (const c of [...page.childIds]) fixAbsolute(c)

  // 뷰어 무관 기하 보존: yoga 해결값을 FIXED로 핀(FILL/STRETCH은 뷰어별 해석 드리프트)
  const pin = (id: string): void => {
    const n = graph.getNode(id) as any
    if (!n) return
    if (n.type === 'FRAME') {
      if (n.counterAxisSizing === 'FILL') n.counterAxisSizing = 'FIXED'
      if (n.primaryAxisSizing === 'FILL') n.primaryAxisSizing = 'FIXED'
    }
    if (n.type === 'TEXT' && n.layoutAlignSelf === 'STRETCH') {
      n.layoutAlignSelf = 'INHERIT'
    }
    for (const c of [...n.childIds]) pin(c)
  }
  for (const page of graph.getPages()) for (const c of [...page.childIds]) pin(c)

  return graph
}

export function buildStyleMap(doc: any): Record<string, Record<string, string>> {
  const styleMap: Record<string, Record<string, string>> = {}
  const walkDoc = (n: any): void => {
    if (n.type === 'element' && n.attrs?.class) styleMap[n.attrs.class] = n.computedStyle ?? {}
    for (const c of n.children ?? []) walkDoc(c)
  }
  walkDoc(doc)
  return styleMap
}

export async function writeFig(graph: any, out: string): Promise<void> {
  const fonts = await preloadGraphFonts(graph)
  console.log('fonts preloaded:', fonts)
  const io = new IORegistry(BUILTIN_IO_FORMATS)
  const result = await io.writeDocument('fig', graph)
  writeFileSync(out, result.data as Uint8Array)
  console.log('written', out)
}

if (import.meta.main) {
  const HTML = Bun.env.HTML ?? '/Users/hoony5/openpencil-roundtrip/test.html'
  const CSS = Bun.env.CSS ?? '/Users/hoony5/openpencil-roundtrip/test.css'
  const DOC = Bun.env.STYLE_MAP_JSON ?? '/Users/hoony5/openpencil-roundtrip/test.json'
  const OUT = Bun.env.OUT ?? '/Users/hoony5/openpencil-roundtrip/test_norm2.fig'
  const ROOT_WIDTH = Number(Bun.env.ROOT_WIDTH ?? 360)
  const META = Bun.env.META
  const TOKENS = Bun.env.TOKENS

  const styleMap = buildStyleMap(JSON.parse(readFileSync(DOC, 'utf8')))
  const graph = await normalizeFromHtml(readFileSync(HTML, 'utf8'), readFileSync(CSS, 'utf8'), styleMap, {
    rootWidth: ROOT_WIDTH,
    meta: META ? JSON.parse(readFileSync(META, 'utf8')) : undefined,
    tokens: TOKENS === 'true' || TOKENS === '1'
  })
  await writeFig(graph, OUT)
}
