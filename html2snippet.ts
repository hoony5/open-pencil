import { readFileSync, writeFileSync } from 'node:fs'
import { buildStyleMap, normalizeFromHtml } from './normalize_graph.ts'

const HTML = Bun.env.HTML ?? '/Users/hoony5/openpencil-roundtrip/exp5/detail.html'
const CSS = Bun.env.CSS ?? '/Users/hoony5/openpencil-roundtrip/exp5/base.css'
const OUT = Bun.env.OUT ?? '/Users/hoony5/openpencil-roundtrip/exp6/snippets.md'

const hex = (c: any): string =>
  '#' +
  [c.r, c.g, c.b]
    .map((v: number) => Math.round(v * 255).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()

const weight = (n: any): string => {
  const w = Number(n.fontWeight ?? 400)
  return w >= 700 ? 'FontWeight.w700' : w >= 600 ? 'FontWeight.w600' : w >= 500 ? 'FontWeight.w500' : 'FontWeight.w400'
}

const tokens = new Map<string, string>()
const components: { name: string; code: string }[] = []

function textStyle(n: any): string {
  const color = n.fills?.[0]?.color ? hex(n.fills[0].color) : '#191C25'
  const tName = `c_${color.slice(1).toLowerCase()}`
  tokens.set(tName, color)
  return `TextStyle(fontSize: ${n.fontSize ?? 14}, fontWeight: ${weight(n)}, color: ${tName})`
}

function pad(n: any): string {
  const t = n.paddingTop ?? 0, r = n.paddingRight ?? 0, b = n.paddingBottom ?? 0, l = n.paddingLeft ?? 0
  if (t === b && l === r && t === l) return `EdgeInsets.all(${Math.round(t)})`
  return `EdgeInsets.fromLTRB(${Math.round(l)}, ${Math.round(t)}, ${Math.round(r)}, ${Math.round(b)})`
}

function deco(n: any): string {
  const color = n.fills?.[0]?.color ? hex(n.fills[0].color) : '#FFFFFF'
  const cName = `c_${color.slice(1).toLowerCase()}`
  tokens.set(cName, color)
  const radius = n.cornerRadius ? `BorderRadius.circular(${Math.round(n.cornerRadius)})` : null
  const shadow = n.effects?.[0]?.color
    ? `BoxShadow(color: Colors.black.withValues(alpha: ${Number(n.effects[0].color.a.toFixed(2))}), blurRadius: 8, offset: const Offset(0, 2))`
    : null
  return `BoxDecoration(color: ${cName}${radius ? `, borderRadius: ${radius}` : ''}${shadow ? `, boxShadow: [${shadow}]` : ''})`
}

const isButton = (n: any) => /button/.test(n.name)
const isChip = (n: any) => /chip|badge/.test(n.name)
const isCard = (n: any) => /_card$|^card/.test(n.name)
const isListItem = (n: any) => /^list_item/.test(n.name)
const isInput = (n: any) => /^(input|textarea)_box/.test(n.name)

function textOf(n: any): string {
  if (n.type === 'TEXT') return n.text ?? ''
  for (const cid of n.childIds ?? []) {
    const t = textOf(globalThis.__graph.getNode(cid))
    if (t) return t
  }
  return ''
}

function componentSnippet(n: any): string {
  const label = textOf(n)
  const name = n.name.replace(/[^a-zA-Z0-9_]/g, '_')
  if (components.some((c) => c.name === name)) return name
  let code = ''
  if (isButton(n) || isChip(n)) {
    const fg = n.type === 'FRAME' && n.childIds.length ? (globalThis.__graph.getNode(n.childIds[0]) as any) : n
    code = `Widget ${name}(String label) => Container(
  padding: ${pad(n)},
  decoration: ${deco(n)},
  alignment: Alignment.center,
  child: Text(label, style: ${textStyle(fg)}),
);`
  } else if (isListItem(n) || isInput(n)) {
    code = `Widget ${name}(String text) => Container(
  padding: ${pad(n)},
  decoration: ${deco(n)},
  child: Text(text, style: ${textStyle(n.childIds.length ? (globalThis.__graph.getNode(n.childIds[0]) as any) : n)}),
);`
  }
  components.push({ name, code })
  return name
}

function compose(n: any, depth: number): string {
  const ind = '  '.repeat(depth)
  if (n.type === 'TEXT') {
    return `${ind}Text(${JSON.stringify(n.text ?? '')}, style: ${textStyle(n)}),`
  }
  if (isButton(n) || isChip(n) || isListItem(n) || isInput(n)) {
    const cname = componentSnippet(n)
    return `${ind}${cname}(${JSON.stringify(textOf(n))}),`
  }
  const isRow = n.layoutMode === 'HORIZONTAL'
  const kidsOf = (node: any, row: boolean, d: number): string[] => {
    const ks: string[] = []
    const childNodes = (node.childIds ?? [])
      .map((cid: string) => globalThis.__graph.getNode(cid))
      .filter(Boolean)
    childNodes.forEach((c: any, i: number) => {
      if (i > 0 && node.itemSpacing)
        ks.push(`${'  '.repeat(d + 1)}SizedBox(${row ? 'width' : 'height'}: ${Math.round(node.itemSpacing)}),`)
      ks.push(compose(c, d + 1))
    })
    return ks
  }
  if (isCard(n)) {
    const cname = n.name.replace(/[^a-zA-Z0-9_]/g, '_')
    if (!components.some((c) => c.name === cname)) {
      components.push({
        name: cname,
        code: `Widget ${cname}({required Widget child}) => Container(
  padding: ${pad(n)},
  decoration: ${deco(n)},
  child: child,
);`
      })
    }
    const kids = kidsOf(n, false, depth + 2)
    return `${ind}Container(
${ind}  padding: ${pad(n)},
${ind}  decoration: ${deco(n)},
${ind}  child: Column(
${ind}    mainAxisSize: MainAxisSize.min,
${ind}    crossAxisAlignment: CrossAxisAlignment.stretch,
${ind}    children: [
${kids.join('\n')}
${ind}    ],
${ind}  ),
${ind}),`
  }
  if (!(n.childIds ?? []).length) {
    return `${ind}Container(
${ind}  width: ${Math.round(n.width ?? 0)},
${ind}  height: ${Math.round(n.height ?? 0)},
${ind}  decoration: ${deco(n)},
),`
  }
  const kids = kidsOf(n, isRow, depth)
  const cross = isRow ? 'CrossAxisAlignment.center' : 'CrossAxisAlignment.stretch'
  return `${ind}${isRow ? 'Row' : 'Column'}(
${ind}  mainAxisSize: MainAxisSize.min,
${ind}  crossAxisAlignment: ${cross},
${ind}  children: [
${kids.join('\n')}
${ind}  ],
${ind}),`
}

async function main(): Promise<void> {
  const styleMap = buildStyleMap(JSON.parse(readFileSync(Bun.env.STYLE_MAP_JSON ?? '/tmp/html2snippet_map.json', 'utf8')))
  const graph = await normalizeFromHtml(readFileSync(HTML, 'utf8'), readFileSync(CSS, 'utf8'), styleMap, {
    rootWidth: 360
  })
  ;(globalThis as any).__graph = graph
  const root = graph.getNode(graph.getPages()[0].childIds[0]) as any

  const body = compose(root, 1).replace(/^ {2}/, '').replace(/,\s*$/, '')

  const tokenBlock = [...tokens.entries()]
    .map(([k, v]) => `const ${k} = Color(0xFF${v.slice(1)});`)
    .join('\n')

  const md = `# ${root.name} — Flutter 스니펫 추출

소스: \`${HTML.split('/').pop()}\` · 생성: html2snippet (구조 보존 1:1)

## tokens

\`\`\`dart
${tokenBlock}
\`\`\`

## components

${components.map((c) => `### ${c.name}\n\n\`\`\`dart\n${c.code}\n\`\`\``).join('\n\n')}

## composition

\`\`\`dart
Widget build(BuildContext context) {
  return ${body};
}
\`\`\`
`
  writeFileSync(OUT, md)
  console.log('written', OUT, '| components:', components.length, '| tokens:', tokens.size)

  const dartOut = Bun.env.DART_OUT
  if (dartOut) {
    const cls = Bun.env.CLASS_NAME ?? 'GeneratedSnippet'
    const dart = `// GENERATED by html2snippet — compile gate assembly. Source: ${HTML.split('/').pop()}
// ignore_for_file: non_constant_identifier_names

import 'package:flutter/material.dart';

${tokenBlock}

${components.map((c) => c.code).join('\n\n')}

class ${cls} extends StatelessWidget {
  const ${cls}({super.key});

  @override
  Widget build(BuildContext context) {
    return ${body};
  }
}
`
    writeFileSync(dartOut, dart)
    console.log('written', dartOut, '| class:', cls)
  }
}

void main()
