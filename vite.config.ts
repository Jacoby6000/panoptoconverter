import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isTest = process.env.VITEST === 'true' || mode === 'test'
  return {
    plugins: isTest ? [] : [svelte()],
    worker: {
      format: 'es'
    },
    optimizeDeps: {
      // Exclude worker-related helpers to avoid prebundle issues in dev
      exclude: ['worker.js', 'vite/worker', 'vite/runtime/dom', '@ffmpeg/ffmpeg']
    },
    test: {
      environment: 'node',
    }
  }
})
