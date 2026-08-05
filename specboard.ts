import { readFileSync } from 'node:fs'
import { computeAllLayouts } from '@open-pencil/core'
import { createHeadlessCSSRuntime, htmlToSceneGraph } from '@open-pencil/dom-css'
import { buildStyleMap, mkSection, mkText, normalizeFromHtml, writeFig } from './normalize_graph.ts'

const PROJ = Bun.env.PROJ ?? '/Users/hoony5/openpencil-roundtrip/exp5/project.json'
const OUT = Bun.env.OUT ?? '/Users/hoony5/openpencil-roundtrip/exp5/board.fig'
const CLI = '/Users/hoony5/openpencil-roundtrip/open-pencil/packages/cli/src/index.ts'

const PAGE_W = 360
const COL_GAP = 170
const COL_W = 500
const FLOW_GAP = 140

const proj = JSON.parse(readFileSync(PROJ, 'utf8'))
const runtime = createHeadlessCSSRuntime()
const board = await htmlToSceneGraph('<main class="shell"></main>', {
  cssText: '.shell{display:flex;flex-direction:column}',
  runtime
})
const boardPage = board.getPages()[0]
boardPage.name = 'BOARD'
if (boardPage.childIds[0]) board.deleteNode(boardPage.childIds[0])
const overviewPage = board.addPage('OVERVIEW')

function cloneInto(srcGraph: any, srcId: string, dstParentId: string): any {
  const src = srcGraph.getNode(srcId) as any
  const props: any = {}
  for (const [k, v] of Object.entries(src)) {
    if (k === 'id' || k === 'childIds' || k === 'parentId') continue
    props[k] = v
  }
  const node = board.createNode(src.type, dstParentId, props)
  for (const cid of [...src.childIds]) cloneInto(srcGraph, cid, node.id)
  return node
}

function styleMapFor(html: string, css: string): Record<string, Record<string, string>> {
  const tmp = `/tmp/specboard_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.json`
  const p = Bun.spawnSync(['bun', CLI, 'import', html, '--css', css, '-o', tmp, '-f', 'json', '--json'])
  if (p.exitCode !== 0) throw new Error(`import failed: ${p.stderr?.toString()}`)
  return buildStyleMap(JSON.parse(readFileSync(tmp, 'utf8')))
}

const pos: Record<string, { x: number; y: number; h: number; flow: number; bottom: number }> = {}
const flowFrames: any[] = []
let flowY = 0

for (let fi = 0; fi < proj.flows.length; fi++) {
  const flow = proj.flows[fi]
  const flowFrame = board.createNode('FRAME', boardPage.id, {
    name: `flow_${flow.name}`,
    layoutMode: 'NONE',
    x: 0,
    y: flowY,
    fills: [{ type: 'SOLID', color: { r: 0.98, g: 0.98, b: 0.99, a: 1 } }]
  })
  flowFrames.push(flowFrame)
  mkText(board, flowFrame, `FLOW · ${flow.label ?? flow.name}`, 14, 700, { r: 0.16, g: 0.24, b: 0.42, a: 1 }).x = 0
  ;(flowFrame.childIds.length ? (board.getNode(flowFrame.childIds.at(-1)) as any) : null) &&
    ((board.getNode(flowFrame.childIds.at(-1)) as any).y = 0)

  let maxBlockH = 0
  for (let pi = 0; pi < flow.pages.length; pi++) {
    const p = flow.pages[pi]
    const html = readFileSync(p.html, 'utf8')
    const css = readFileSync(p.css, 'utf8')
    const pg = await normalizeFromHtml(html, css, styleMapFor(p.html, p.css), { rootWidth: PAGE_W, meta: p.meta })
    const designPage = pg.getPages()[0]
    const root = pg.getNode(designPage.childIds[0]) as any
    const footer = designPage.childIds[1] ? (pg.getNode(designPage.childIds[1]) as any) : null
    const annPage = pg.getPages()[1]
    const ann = annPage?.childIds?.[0] ? (pg.getNode(annPage.childIds[0]) as any) : null

    const x = 24 + pi * (COL_W + COL_GAP)
    const y = 40
    const pageClone = cloneInto(pg, root.id, flowFrame.id)
    pageClone.name = `page_${p.id}`
    pageClone.x = x
    pageClone.y = y

    let cursor = y + root.height
    if (footer) {
      const fc = cloneInto(pg, footer.id, flowFrame.id)
      fc.name = `postprocess_${p.id}`
      fc.x = x
      fc.y = cursor + 24
      cursor = fc.y + fc.height
    }
    if (ann) {
      const ac = cloneInto(pg, ann.id, flowFrame.id)
      ac.name = `anno_${p.id}`
      ac.x = x
      ac.y = cursor + 24
      cursor = ac.y + ac.height
    }
    pos[p.id] = { x, y: flowY + y, h: root.height, flow: fi, bottom: flowY + cursor }
    maxBlockH = Math.max(maxBlockH, cursor - y)
  }

  flowFrame.width = 24 + flow.pages.length * (COL_W + COL_GAP)
  flowFrame.height = 40 + maxBlockH + 24
  flowY += flowFrame.height + FLOW_GAP
}

// 화살표 2패스: 전체 페이지 위치 확정 후 사용자 행동 라벨과 함께描
for (let fi = 0; fi < proj.flows.length; fi++) {
  const flow = proj.flows[fi]
  const flowFrame = flowFrames[fi]
  for (const p of flow.pages) {
    for (const t of p.transitions ?? []) {
      const s = pos[p.id]
      const d = pos[t.to]
      if (!s || !d) continue
      if (s.flow === d.flow) {
        const ax = s.x + PAGE_W + 10
        const ay = s.y - flowFrames[fi].y + s.h / 2
        board.createNode('FRAME', flowFrame.id, {
          name: `arrow_${p.id}_${t.to}`,
          layoutMode: 'NONE',
          x: ax,
          y: ay,
          width: COL_GAP - 20,
          height: 2,
          fills: [{ type: 'SOLID', color: { r: 0.45, g: 0.48, b: 0.55, a: 1 } }]
        })
        const lb = mkText(board, flowFrame, `${t.label} ▶`, 11, 600, { r: 0.45, g: 0.48, b: 0.55, a: 1 })
        lb.x = ax + 8
        lb.y = ay - 22
      } else {
        const ax = d.x + PAGE_W / 2
        const srcFlowBottom = flowFrames[s.flow].y + flowFrames[s.flow].height
        const dstFlowTop = flowFrames[d.flow].y
        const ay = d.flow > s.flow ? srcFlowBottom + 8 : dstFlowTop - 40
        const h = d.flow > s.flow ? Math.max(24, flowFrames[d.flow].y - srcFlowBottom - 16) : 32
        board.createNode('FRAME', boardPage.id, {
          name: `arrow_${p.id}_${t.to}`,
          layoutMode: 'NONE',
          x: ax,
          y: ay,
          width: 2,
          height: h,
          fills: [{ type: 'SOLID', color: { r: 0.45, g: 0.48, b: 0.55, a: 1 } }]
        })
        const lb = mkText(board, boardPage, d.flow > s.flow ? `▼ ${t.label}` : `▲ ${t.label}`, 11, 600, {
          r: 0.45,
          g: 0.48,
          b: 0.55,
          a: 1
        })
        lb.x = ax + 8
        lb.y = ay + 8
      }
    }
  }
}

// OVERVIEW: 기획 체인 + 인덱스 + 확인사항
const ov = board.createNode('FRAME', overviewPage.id, {
  name: 'overview',
  layoutMode: 'VERTICAL',
  primaryAxisSizing: 'HUG',
  counterAxisSizing: 'FIXED',
  width: 640,
  itemSpacing: 8,
  paddingTop: 32,
  paddingRight: 32,
  paddingBottom: 32,
  paddingLeft: 32,
  x: 0,
  y: 0,
  fills: [{ type: 'SOLID', color: { r: 0.97, g: 0.98, b: 1, a: 1 } }]
})
mkText(board, ov, proj.title, 20, 700)
if (proj.prd) mkText(board, ov, proj.prd, 12, 400)
mkText(board, ov, (proj.stages ?? []).join('  →  '), 12, 600, { r: 0.16, g: 0.24, b: 0.42, a: 1 })
mkSection(
  board,
  ov,
  'FLOWS',
  proj.flows.map((f: any) => `${f.label ?? f.name}: ${f.pages.map((p: any) => p.id).join(' → ')}`)
)
mkSection(board, ov, '확인사항', proj.open_questions, '⚠ ')

computeAllLayouts(board)
const ovKids = ov.childIds.map((id: string) => board.getNode(id) as any)
ov.height = ovKids.reduce((s: number, k: any) => s + k.height, 0) + ov.itemSpacing * (ovKids.length - 1) + 64

await writeFig(board, OUT)
