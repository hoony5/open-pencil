import { getActiveEditorStoreOrNull } from '@/app/editor/active-store'

// ?file=<url> 쿼리 파라미터로 .fig를 에디터에 자동 로드 (scrape CLI와 연동).
// 브라우저는 로컬 경로를 못 읽으므로 URL(HTTP)로 serve된 .fig를 fetch한다.
export async function loadFileFromUrlParam(): Promise<void> {
  const params = new URLSearchParams(window.location.search)
  const file = params.get('file')
  if (!file) return
  const url = file.startsWith('http') ? file : new URL(file, window.location.origin).href
  const name = decodeURIComponent(url.split('/').pop() ?? 'import.fig')
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const fileObj = new File([blob], name.endsWith('.fig') ? name : `${name}.fig`)
    const store = (await waitForStore()) as any
    await store.openFigFile(fileObj)
    console.log('[url-file-loader] opened', name)
  } catch (e) {
    console.error('[url-file-loader] failed:', e)
  }
}

async function waitForStore(): Promise<unknown> {
  for (let i = 0; i < 100; i++) {
    const s = getActiveEditorStoreOrNull()
    if (s) return s
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('editor store not ready (timeout 10s)')
}
