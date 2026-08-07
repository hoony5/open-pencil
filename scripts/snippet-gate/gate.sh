#!/usr/bin/env bash
# 컴파일 게이트: .fig → fig2flutter → Dart → flutter analyze (error 0건 = PASS)
# 사용: ./gate.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
CLONE="$(cd "$DIR/../.." && pwd)"   # fork root (fig2flutter.ts 위치)
ROOT="$(dirname "$CLONE")"          # 부모 (exp1/exp5 .fig 픽스처)
GATE="$DIR"

mkdir -p "$GATE/lib"
cd "$CLONE"
bun fig2flutter.ts "$ROOT/exp1/page.fig"   "$GATE/lib/home.dart"   HomeWidget
bun fig2flutter.ts "$ROOT/exp5/detail.fig" "$GATE/lib/detail.dart" DetailWidget
bun fig2flutter.ts "$ROOT/exp5/write.fig"  "$GATE/lib/write.dart"  WriteWidget

cd "$GATE"
flutter pub get > /dev/null
flutter analyze
