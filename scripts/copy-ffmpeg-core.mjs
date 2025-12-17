import fs from 'fs'
import path from 'path'

const srcDirEsm = path.resolve('node_modules', '@ffmpeg', 'core', 'dist', 'esm')
const dstDir = path.resolve('public', 'ffmpeg')

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }) }

function copyFile(file) {
  const src = path.join(srcDirEsm, file)
  const dst = path.join(dstDir, file)
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dst)
    console.log(`[copy-ffmpeg-core] Copied ${file}`)
  } else {
    console.warn(`[copy-ffmpeg-core] Missing ${src}`)
  }
}

ensureDir(dstDir)
;['ffmpeg-core.js', 'ffmpeg-core.wasm', 'ffmpeg-core.worker.js'].forEach(copyFile)
