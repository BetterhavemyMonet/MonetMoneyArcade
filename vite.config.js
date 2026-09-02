import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [],
  build: {
    rollupOptions: {
      input: {
        analytics: resolve(__dirname, 'analytics.js')
      },
      output: {
        entryFileNames: '[name].js',
        dir: 'dist'
      }
    }
  }
})
