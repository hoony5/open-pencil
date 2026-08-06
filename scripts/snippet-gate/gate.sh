#!/usr/bin/env bash
# 컴파일 게이트: HTML → 스니펫 md + 조립 Dart → flutter analyze (error 0건 = PASS)
# 사용: ./gate.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
CLONE="$(cd "$DIR/../.." && pwd)"   # fork root (packages/cli 접근)
ROOT="$(dirname "$CLONE")"          # 부모 (exp1/exp5 픽스처)
GATE="$DIR"

run_one() {
  local html="$1" css="$2" md="$3" dart="$4" cls="$5"
  local tmpjson
  tmpjson="$(mktemp -t html2snippet_map.XXXXXX.json)"
  cd "$CLONE"
  bun packages/cli/src/index.ts import "$html" --css "$css" -o "$tmpjson" -f json --json > /dev/null
  STYLE_MAP_JSON="$tmpjson" HTML="$html" CSS="$css" OUT="$md" DART_OUT="$dart" CLASS_NAME="$cls" \
    bun html2snippet.ts
  rm -f "$tmpjson"
}

mkdir -p "$GATE/lib"
run_one "$ROOT/exp1/page.html"  "$ROOT/exp1/page.css"  "$DIR/snippets_home.md" "$GATE/lib/home_snippet.dart"   HomeSnippet
run_one "$ROOT/exp5/detail.html" "$ROOT/exp5/base.css" "$DIR/snippets.md"      "$GATE/lib/detail_snippet.dart" DetailSnippet
run_one "$ROOT/exp5/write.html"  "$ROOT/exp5/base.css" "$DIR/snippets_write.md" "$GATE/lib/write_snippet.dart"  WriteSnippet

cd "$GATE"
flutter pub get > /dev/null
flutter analyze
