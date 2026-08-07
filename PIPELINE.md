# HTML / Figma → Flutter Pipeline

`openpencil-roundtrip` 실험 파이프라인. HTML 또는 Figma(.fig) → Flutter 위젯.

## 아키텍처

- HTML 경로: `html` → `normalize_graph.ts` → `.fig`(SceneGraph) → `fig2flutter.ts` → Flutter(Dart)
- Figma 경로: Figma 에서 내보낸 `.fig` → `fig2flutter.ts` → Flutter(Dart)
- 두 경로 모두 `.fig`(SceneGraph) → Flutter 단은 **`fig2flutter.ts` 하나**로 통일.

## 컴포넌트

- `normalize_graph.ts` — HTML+CSS → SceneGraph(`.fig`). 헤드리스 CSS 런타임(`@open-pencil/dom-css`) + yoga 로 레이아웃. 폰트는 Pretendard(로컬).
- `fig2flutter.ts` — `.fig` → Flutter 위젯. **노드 TYPE + auto-layout 기반**(클래스명 아님). 패턴은 FigmaToCode(bernaferrari) 참조.
  - `FRAME`(auto-layout) → `Row`/`Column`(`spacing`, `mainAxisAlignment`, `crossAxisAlignment`), absolute/NONE → `Stack`
  - `TEXT` → `Text` + `TextStyle`
  - `RECTANGLE`/`ELLIPSE` → `SizedBox`
  - 모듈式 속성 헬퍼: 컬러 토큰·padding·boxDecoration·textStyle·drop-shadow + 미지원 타입 warnings
- `html2fig.sh`(부모 디렉터리, 비관리) — 로컬 HTML+CSS 파일 → `.fig` 진입점.
- `scripts/snippet-gate/` — 컴파일 게이트.

## 게이트 실행

```bash
bash scripts/snippet-gate/gate.sh
# 각 픽스처 .fig(exp1/page, exp5/detail, exp5/write) → fig2flutter → flutter analyze
# "No issues found!" = PASS
```

## 의사결정 기록

- **웹사이트 스크래핑(url→.fig) 파이프라인은 제거됨** — `html.to.design` Figma 플러그인이 URL→Figma 를 더 잘/네이티브로 지원해서 중복.
  - 삭제: `url2fig.ts`, `url2fig_dom.ts`, `scrape.ts`, 에디터 `?file=` 로더, `puppeteer-core`.
- **`fig2flutter.ts` 가 유일한 →Flutter 엔진.** 구 `html2snippet.ts`(클래스명 regex 기반)와 스니펫 동치 `manifest` 게이트는 폐기 — 노드 TYPE 기반이 임의 디자인에 더 견고해서.
- **Figma 플러그인은 원격 실행 불가**(클라이언트 사이드 전용). 에디터도 파일 오픈 RPC 없음(드래그드롭/File 메뉴만).

## 로컬 폰트

- Pretendard 전 가중치(`~/Library/Fonts/Pretendard-*.otf`)만 host font loader 가 인식. 시스템 폰트(Helvetica 등)는 인식 안 됨.

## 남은 과제

- 진짜 Figma 앱 `.fig` 로 엔드투엔드 검증(현재 검증은 html 유래 .fig).
- `normalize_graph.ts` 가 html→그래프에 alignment 속성을 더 채우면 html→Flutter 정밀도 향상.
