// fig2flutter — .fig(Figma/OpenPencil) → Flutter 위젯 (노드 TYPE + auto-layout 기반).
// html2snippet(클래스명 기반, 게이트용)과 별개. FigmaToCode 패턴 차용.
// 사용: bun fig2flutter.ts <in.fig> <out.dart> [ClassName]
import { readFileSync, writeFileSync } from 'node:fs'
import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { computeAllLayouts } from '@open-pencil/core'

const [figPath, outPath, cls] = process.argv.slice(2)
if (!figPath || !outPath) {
  console.error('usage: bun fig2flutter.ts <in.fig> <out.dart> [ClassName]')
  process.exit(1)
}
const className = cls || 'GeneratedWidget'

const bytes = new Uint8Array(readFileSync(figPath))
const io = new IORegistry(BUILTIN_IO_FORMATS)
const { graph } = await io.readDocument({ name: figPath, data: bytes })
computeAllLayouts(graph)
const page = graph.getPages()[0]
const topVisible = page.childIds.map((id: string) => graph.getNode(id)).filter((n: any) => n && n.visible !== false)

// ---- 속성 헬퍼 (모듈式) ----
const tokens = new Map<string, string>() // name → AARRGGBB
const warnings: string[] = []
const h2 = (v: number) => Math.round((v ?? 0) * 255).toString(16).padStart(2, '0')
const solidFill = (n: any) => (n.fills || []).find((f: any) => f.type === 'SOLID' && f.visible !== false) || null
const colorToken = (c: { r: number; g: number; b: number; a: number }): string => {
  const hex = h2(c.a ?? 1) + h2(c.r) + h2(c.g) + h2(c.b) // AARRGGBB
  const name = `c_${h2(c.r)}${h2(c.g)}${h2(c.b)}`
  tokens.set(name, hex)
  return name
}
const weightOf = (w: number) => (w >= 800 ? 'FontWeight.w800' : w >= 700 ? 'FontWeight.w700' : w >= 600 ? 'FontWeight.w600' : w >= 500 ? 'FontWeight.w500' : 'FontWeight.w400')

function padding(n: any): string {
  const t = Math.round(n.paddingTop ?? 0), r = Math.round(n.paddingRight ?? 0), b = Math.round(n.paddingBottom ?? 0), l = Math.round(n.paddingLeft ?? 0)
  if (!t && !r && !b && !l) return ''
  if (t === b && l === r && t === l) return `EdgeInsets.all(${t})`
  return `EdgeInsets.fromLTRB(${l}, ${t}, ${r}, ${b})`
}

function boxDeco(n: any): string {
  const f = solidFill(n)
  const parts: string[] = []
  if (f) parts.push(`color: ${colorToken(f.color)}`)
  if (n.cornerRadius) parts.push(`borderRadius: BorderRadius.circular(${Math.round(n.cornerRadius)})`)
  const sh = (n.effects || []).find((e: any) => e.type === 'DROP_SHADOW' && e.visible !== false)
  if (sh) parts.push(`boxShadow: [BoxShadow(color: ${colorToken(sh.color)}, offset: const Offset(${Math.round(sh.offset?.x ?? 0)}, ${Math.round(sh.offset?.y ?? 0)}), blurRadius: ${Math.round(sh.radius ?? 0)})]`)
  return parts.length ? `BoxDecoration(${parts.join(', ')})` : ''
}

function textStyle(n: any): string {
  const f = solidFill(n)
  const parts = [`fontSize: ${Math.round(n.fontSize ?? 14)}`, `fontWeight: ${weightOf(Number(n.fontWeight ?? 400))}`]
  if (f) parts.push(`color: ${colorToken(f.color)}`)
  if (n.lineHeight && n.lineHeight > 4) parts.push(`height: ${(n.lineHeight / (n.fontSize ?? 14)).toFixed(2)}`)
  return `TextStyle(${parts.join(', ')})`
}

const mainAlign = (v: string) => ({ MIN: 'start', CENTER: 'center', MAX: 'end', SPACE_BETWEEN: 'spaceBetween' }[v] || 'start')
const crossAlign = (v: string) => ({ MIN: 'start', CENTER: 'center', MAX: 'end', BASELINE: 'baseline' }[v] || 'start')

// ---- 노드 TYPE 디스패치 ----
function walk(n: any, depth: number): string {
  const ind = '  '.repeat(depth)
  const kids = () => (n.childIds || []).map((id: string) => graph.getNode(id)).filter((c: any) => c && c.visible !== false)

  if (n.type === 'TEXT') {
    return `${ind}Text(${JSON.stringify(n.text ?? '')}, style: ${textStyle(n)}),`
  }

  // 컨테이너 내용 (auto-layout → Row/Column/Wrap, NONE → Stack, 도형 → 빈)
  let inner = ''
  if (n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'INSTANCE' || n.type === 'GROUP') {
    const cs = kids()
    if (n.layoutMode === 'HORIZONTAL' || n.layoutMode === 'VERTICAL') {
      const dir = n.layoutMode === 'HORIZONTAL' ? 'Row' : 'Column'
      const props = ['mainAxisSize: MainAxisSize.min']
      if (n.itemSpacing && n.itemSpacing > 0) props.push(`spacing: ${Math.round(n.itemSpacing)}`)
      props.push(`mainAxisAlignment: MainAxisAlignment.${mainAlign(n.primaryAxisAlignItems)}`)
      props.push(`crossAxisAlignment: CrossAxisAlignment.${crossAlign(n.counterAxisAlignItems)}`)
      const body = cs.map((c) => walk(c, depth + 2)).join('\n')
      inner = `${ind}${dir}(\n${ind}  ${props.join(', ')},\n${ind}  children: [\n${body}\n${ind}  ],\n${ind}),`
    } else {
      // NONE / absolute → Stack (Positioned children)
      const body = cs.map((c) => `${ind}  Positioned(left: ${Math.round(c.x ?? 0)}, top: ${Math.round(c.y ?? 0)}, child: ${walk(c, depth + 2).trim()}),`).join('\n')
      inner = `${ind}Stack(children: [\n${body}\n${ind}],),`
    }
  } else if (n.type === 'RECTANGLE' || n.type === 'ELLIPSE') {
    inner = `${ind}SizedBox(width: ${Math.round(n.width ?? 0)}, height: ${Math.round(n.height ?? 0)}),`
  } else {
    warnings.push(`unsupported type: ${n.type} (${n.name})`)
    return `${ind}SizedBox(width: ${Math.round(n.width ?? 0)}, height: ${Math.round(n.height ?? 0)}),`
  }

  // 컨테이너 래핑 (fills/radius/padding 있으면 Container)
  const deco = boxDeco(n)
  const pad = padding(n)
  if (deco || pad) {
    const wrap: string[] = []
    if (pad) wrap.push(`padding: ${pad}`)
    if (deco) wrap.push(`decoration: ${deco}`)
    return `${ind}Container(\n${ind}  ${wrap.join(', ')},\n${ind}  child: ${inner.trim()}\n${ind}),`
  }
  return inner
}

// 루트 (복수면 Column)
const body =
  topVisible.length === 1
    ? walk(topVisible[0], 1).replace(/^ {2}/, '').replace(/,\s*$/, '')
    : topVisible.map((n: any) => walk(n, 2)).join('\n').replace(/,\s*$/, '')

const tokenBlock = [...tokens.entries()].map(([k, v]) => `const ${k} = Color(0x${v});`).join('\n')

const dart = `// GENERATED by fig2flutter (node-type + auto-layout). Source: ${figPath.split('/').pop()}
// ignore_for_file: non_constant_identifier_names

import 'package:flutter/material.dart';

${tokenBlock}

class ${className} extends StatelessWidget {
  const ${className}({super.key});

  @override
  Widget build(BuildContext context) {
    return ${body};
  }
}
`
writeFileSync(outPath, dart)
console.log(`written ${outPath} | tokens: ${tokens.size} | warnings: ${warnings.length}`)
if (warnings.length) warnings.slice(0, 5).forEach((w) => console.log('  ⚠', w))
