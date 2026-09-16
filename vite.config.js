import {defineConfig} from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  // Relative asset URLs so the dist/ folder works from any host path (GitHub Pages, Netlify, a sub-folder…)
  base: './',
  // Self-signed HTTPS in dev: phones need a secure context for the camera. Accept the certificate warning once.
  plugins: [basicSsl()],
  build: {
    target: 'es2020',
    rollupOptions: {
      input: {
        main: `${root}index.html`,
        experience: `${root}experience.html`,   // a redirect for older links
      },
    },
    chunkSizeWarningLimit: 4000,
  },
  optimizeDeps: {
    exclude: ['@mediapipe/tasks-vision'],
  },
})
