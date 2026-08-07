import { createHead } from '@unhead/vue/client'
import { createApp } from 'vue'

import './app.css'
import { preloadFonts } from '@/app/editor/fonts'
import { loadFileFromUrlParam } from '@/app/url-file-loader'
import { IS_TAURI } from '@/constants'

import App from './App.vue'
import router from './router'

preloadFonts()
const head = createHead()
createApp(App).use(router).use(head).mount('#app')

// ?file=<url> 로 scrape 결과 .fig를 자동 로드 (dev 서버가 public/ 으로 serve)
void loadFileFromUrlParam()

if (!IS_TAURI) {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({ immediate: true })
    return undefined
  })
}
