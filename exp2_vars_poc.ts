import { writeFileSync } from 'node:fs'
import { computeAllLayouts } from '@open-pencil/core'
import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { createHeadlessCSSRuntime, htmlToSceneGraph } from '@open-pencil/dom-css'
import { createCollection, createVariable } from './packages/scene-graph/src/variables.ts'

const HTML = '<main class="root"><div class="box_Primary_500"></div></main>'
const CSS = '.root{display:flex;flex-direction:column;gap:8px;width:200px}.box_Primary_500{width:100px;height:56px;background:#2661AC;border-radius:8px}'
const OUT = '/Users/hoony5/openpencil-roundtrip/exp2/tokens.fig'

async function main(): Promise<void> {
  const runtime = createHeadlessCSSRuntime()
  const graph = await htmlToSceneGraph(HTML, { cssText: CSS, runtime })

  let seq = 0
  const gen = (): string => `tok_${++seq}`
  const col = createCollection(graph, gen, 'block-tokens')
  createVariable(graph, gen, 'primary500', 'COLOR', col.id, { r: 0.15, g: 0.38, b: 0.67, a: 1 })
  createVariable(graph, gen, 'gray500', 'COLOR', col.id, { r: 0.45, g: 0.48, b: 0.55, a: 1 })
  createVariable(graph, gen, 'radius8', 'FLOAT', col.id, 8)

  computeAllLayouts(graph)
  const io = new IORegistry(BUILTIN_IO_FORMATS)
  const result = await io.writeDocument('fig', graph)
  writeFileSync(OUT, result.data as Uint8Array)
  console.log('written', OUT, 'collections:', graph.variableCollections.size, 'variables:', graph.variables.size)
}

void main()
