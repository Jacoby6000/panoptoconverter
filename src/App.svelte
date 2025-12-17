<script lang="ts">
  import { onDestroy } from 'svelte'
  import DropZone from './lib/components/DropZone.svelte'
  import SettingsPanel from './lib/components/SettingsPanel.svelte'
  import ExportOptionsPanel from './lib/components/ExportOptionsPanel.svelte'
  import PlayerPanel from './lib/components/PlayerPanel.svelte'
  import AnglesPanel from './lib/components/AnglesPanel.svelte'
  import type { VirtualCamera, ProjectionType, AspectPreset } from './lib/types'
  import { aspectPresets } from './lib/types'
  import { createProvider } from './lib/providers'
  import type { IVideoFrameProvider } from './lib/providers'
  import JSZip from 'jszip'

  let file: File | null = null
  let videoUrl: string | null = null
  let error: string | null = null
  let videoEl: HTMLVideoElement
  let insvInfo: string | null = null
  let frameProvider: IVideoFrameProvider | null = null

  let angles: VirtualCamera[] = []
  let nextId = 1

  // Global settings
  let projection: ProjectionType = 'Equirectangular (mono)'
  let aspectPreset: AspectPreset = '16:9'
  let customAspectW = 16
  let customAspectH = 9

  // Export options
  let samplesPerSecond = 30 // extract every Nth frame
  let assumedFps = 30 // used to derive time step from Nth

  // Export state
  let exporting = false
  let exportProgress = 0 // 0..1
  let cancelExport = false

  function cleanupUrl() {
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    videoUrl = null
  }

  onDestroy(() => {
    cleanupUrl()
    try { frameProvider?.close() } catch {}
    frameProvider = null
  })

  function handleFiles(files: FileList | null) {
    error = null
    if (!files || files.length === 0) return
    const f = files[0]
    const name = (f.name || '').toLowerCase()
    const isMp4 = f.type === 'video/mp4' || name.endsWith('.mp4')
    const isInsv = name.endsWith('.insv')
    if (!isMp4 && !isInsv) {
      error = 'Only MP4 and Insta360 INSV files are supported right now.'
      return
    }
    file = f
    cleanupUrl()
    videoUrl = URL.createObjectURL(f)
    angles = [] // reset angles when new video is loaded
    if (isInsv) {
      // Set a sensible default projection for Insta360 dual-fisheye
      projection = 'Dual Fisheye (Insta360)'
    }

    // Read file as ArrayBuffer and send to worker
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const buf = reader.result as ArrayBuffer
        try { frameProvider?.close() } catch {
          console.warn('Failed to close frame provider.');
        }
        frameProvider = await createProvider(buf, f.name, projection)
      } catch (e: any) {
        error = 'INSV load error: ' + (e?.message || String(e))
        insvInfo = null
      }
    }
    reader.onerror = () => {
      error = 'Failed to read INSV file.'
      insvInfo = null
    }
    reader.readAsArrayBuffer(f)
  }

  function touchAngles() { angles = [...angles] }

  function captureCurrentFrame(): string | null {
    if (!videoEl || isNaN(videoEl.videoWidth) || videoEl.videoWidth === 0) return null
    const maxW = 320
    const scale = Math.min(1, maxW / videoEl.videoWidth)
    const w = Math.round(videoEl.videoWidth * scale)
    const h = Math.round(videoEl.videoHeight * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(videoEl, 0, 0, w, h)
    return canvas.toDataURL('image/png')
  }

  function addCameraAngle() {
    const fallbackPreview = captureCurrentFrame()
    if (!fallbackPreview) return
    const newAngle: VirtualCamera = {
      id: nextId++,
      label: `Angle ${nextId - 1}`,
      previewDataUrl: fallbackPreview,
      time: videoEl?.currentTime ?? 0,
      angle: {
        pitch: 0,
        yaw: 0,
        roll: 0
      }
    }
    angles = [...angles, newAngle]
  }

  let lastPreviewTick = 0
  const PREVIEW_THROTTLE_MS = 200

  function aspectRatioValue(): number {
    if (aspectPreset !== 'Custom') {
      const [w, h] = aspectPreset.split(':').map(Number)
      return w / h
    }
    if (customAspectW > 0 && customAspectH > 0) return customAspectW / customAspectH
    return 16 / 9
  }

  function computeOutputSize(): { w: number; h: number } {
    // Choose a reasonable default width based on source, cap to 1920 to keep memory manageable
    const ratio = aspectRatioValue()
    const baseW = Math.min(1920, videoEl?.videoWidth || 1920)
    const w = Math.max(320, Math.round(baseW))
    const h = Math.max(320, Math.round(w / ratio))
    return { w, h }
  }

  function drawToAspect(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    // Draw the current video frame to fill canvas (cover), cropping excess
    const vidW = videoEl.videoWidth
    const vidH = videoEl.videoHeight
    const canW = canvas.width
    const canH = canvas.height
    const scale = Math.max(canW / vidW, canH / vidH)
    const drawW = Math.round(vidW * scale)
    const drawH = Math.round(vidH * scale)
    const dx = Math.round((canW - drawW) / 2)
    const dy = Math.round((canH - drawH) / 2)
    ctx.drawImage(videoEl, dx, dy, drawW, drawH)
  }

  // ---- Preview orientation mapping helpers (equirect -> rectilinear) ----
  function toRad(deg: number) { return (deg * Math.PI) / 180 }

  function ensureImageData(src: ImageBitmap | ImageData): ImageData {
    if (src instanceof ImageBitmap) {
      const c = document.createElement('canvas')
      c.width = src.width
      c.height = src.height
      const cctx = c.getContext('2d')!
      cctx.drawImage(src, 0, 0)
      return cctx.getImageData(0, 0, c.width, c.height)
    }
    return src
  }

  function bilinearSample(img: ImageData, u: number, v: number, out: Uint8ClampedArray, o: number) {
    // u,v in [0,1], u wraps, v clamps
    const w = img.width
    const h = img.height
    // wrap u
    u = u - Math.floor(u)
    // clamp v
    v = Math.max(0, Math.min(1, v))
    const x = u * (w - 1)
    const y = v * (h - 1)
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const x1 = Math.min(x0 + 1, w - 1)
    const y1 = Math.min(y0 + 1, h - 1)
    const dx = x - x0
    const dy = y - y0
    const d = img.data
    const idx = (xx: number, yy: number) => (yy * w + xx) * 4
    const i00 = idx(x0, y0)
    const i10 = idx(x1, y0)
    const i01 = idx(x0, y1)
    const i11 = idx(x1, y1)
    for (let c = 0; c < 4; c++) {
      const p00 = d[i00 + c]
      const p10 = d[i10 + c]
      const p01 = d[i01 + c]
      const p11 = d[i11 + c]
      const p0 = p00 + (p10 - p00) * dx
      const p1 = p01 + (p11 - p01) * dx
      out[o + c] = Math.round(p0 + (p1 - p0) * dy)
    }
  }

  function rotateVec(vx: number, vy: number, vz: number, yawDeg: number, pitchDeg: number, rollDeg: number) {
    const yaw = toRad(yawDeg)
    const pitch = toRad(pitchDeg)
    const roll = toRad(rollDeg)
    // Ry(yaw)
    let x = vx * Math.cos(yaw) + vz * Math.sin(yaw)
    let y = vy
    let z = -vx * Math.sin(yaw) + vz * Math.cos(yaw)
    // Rx(pitch)
    let x2 = x
    let y2 = y * Math.cos(pitch) - z * Math.sin(pitch)
    let z2 = y * Math.sin(pitch) + z * Math.cos(pitch)
    // Rz(roll)
    const xr = x2 * Math.cos(roll) - y2 * Math.sin(roll)
    const yr = x2 * Math.sin(roll) + y2 * Math.cos(roll)
    const zr = z2
    return { x: xr, y: yr, z: zr }
  }

  function renderRectilinearPreview(src: ImageBitmap | ImageData, outW: number, outH: number, angle: { pitch: number; yaw: number; roll: number }, fovDeg = 90): HTMLCanvasElement {
    const srcData = ensureImageData(src)
    const outCanvas = document.createElement('canvas')
    outCanvas.width = outW
    outCanvas.height = outH
    const outCtx = outCanvas.getContext('2d')!
    const outImg = outCtx.createImageData(outW, outH)
    const dst = outImg.data

    // pinhole camera model
    const fov = toRad(Math.max(1, Math.min(175, fovDeg)))
    const fx = 0.5 * outW / Math.tan(fov / 2)
    const fy = fx // square pixels

    // Map each pixel
    let o = 0
    for (let j = 0; j < outH; j++) {
      const ny = (j + 0.5) - outH / 2
      for (let i = 0; i < outW; i++, o += 4) {
        const nx = (i + 0.5) - outW / 2
        // camera ray in camera space
        const rx = nx / fx
        const ry = -ny / fy // screen y down -> world y up
        const rz = 1
        // normalize
        const invLen = 1 / Math.hypot(rx, ry, rz)
        const rnx = rx * invLen
        const rny = ry * invLen
        const rnz = rz * invLen
        // rotate by yaw/pitch/roll
        const v = rotateVec(rnx, rny, rnz, angle.yaw, angle.pitch, angle.roll)
        // spherical
        const lon = Math.atan2(v.x, v.z) // [-pi, pi]
        const lat = Math.asin(Math.max(-1, Math.min(1, v.y))) // [-pi/2, pi/2]
        const u = (lon + Math.PI) / (2 * Math.PI)
        const vcoord = (Math.PI / 2 - lat) / Math.PI
        bilinearSample(srcData, u, vcoord, dst, o)
      }
    }
    outCtx.putImageData(outImg, 0, 0)
    return outCanvas
  }

  async function extractFrames() {
    if (!frameProvider || !videoEl) {
      error = 'No video/provider loaded.'
      return
    }
    if (!angles.length) {
      error = 'Please add at least one camera angle.'
      return
    }
    const duration = isFinite(videoEl.duration) ? videoEl.duration : 0
    if (duration <= 0) {
      error = 'Unknown video duration.'
      return
    }

    exporting = true
    exportProgress = 0
    cancelExport = false

    const step = 1 / Math.max(1, samplesPerSecond)
    const times: number[] = []
    for (let t = 0; t <= duration + 1e-6; t += step) times.push(Math.min(t, duration))

    const { w: outW, h: outH } = computeOutputSize()
    const outCanvas = document.createElement('canvas')
    outCanvas.width = outW
    outCanvas.height = outH
    const outCtx = outCanvas.getContext('2d')!

    const total = times.length * angles.length
    let done = 0

    const zip = new JSZip()

    try {
      for (const ts of times) {
        if (cancelExport) break
        for (const cam of angles) {
          if (cancelExport) break
          try {
            const stereo = await frameProvider.frameAt(ts, cam.angle)
            // Draw selected eye (use left by default) to fill output canvas (cover)
            outCtx.clearRect(0, 0, outW, outH)

            const src = stereo.left
            const sW = src instanceof ImageBitmap ? src.width : src.width
            const sH = src instanceof ImageBitmap ? src.height : src.height

            // Compute cover fit
            const scale = Math.max(outW / sW, outH / sH)
            const dW = Math.round(sW * scale)
            const dH = Math.round(sH * scale)
            const dx = Math.round((outW - dW) / 2)
            const dy = Math.round((outH - dH) / 2)

            if (src instanceof ImageBitmap) {
              outCtx.drawImage(src, dx, dy, dW, dH)
            } else {
              // ImageData path: draw to a temp canvas first
              const tmp = document.createElement('canvas')
              tmp.width = src.width
              tmp.height = src.height
              const tctx = tmp.getContext('2d')!
              tctx.putImageData(src, 0, 0)
              outCtx.drawImage(tmp, dx, dy, dW, dH)
            }

            const blob: Blob = await new Promise((res) => outCanvas.toBlob((b) => res(b!), 'image/jpeg', 0.92))
            const tsStr = ts.toFixed(2).replace(/\./g, '_')
            const safeLabel = cam.label.replace(/[^a-z0-9-_]+/gi, '_') || `Angle_${cam.id}`
            const fname = `${safeLabel}_${tsStr}.jpg`
            zip.file(fname, blob)
          } catch (e) {
            console.warn('Export frame failed at', ts, cam, e)
          } finally {
            done++
            exportProgress = done / total
          }
        }
      }

      if (!cancelExport) {
        const zipBlob = await zip.generateAsync({ type: 'blob' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(zipBlob)
        a.download = (file?.name?.replace(/\.[^.]+$/, '') || 'export') + '.zip'
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(a.href), 5000)
      }
    } finally {
      exporting = false
    }
  }

  async function updateAnglePreview(angle: VirtualCamera) {
    const now = Date.now()
    if (now - lastPreviewTick < PREVIEW_THROTTLE_MS) return
    lastPreviewTick = now

    if (!frameProvider || !videoEl) return

    const ts = videoEl.currentTime || 0
    try {
      const stereo = await frameProvider.frameAt(ts, angle.angle)
      // Render a small preview respecting the selected aspect and orientation
      const maxW = 240
      const ratio = aspectRatioValue()
      const w = maxW
      const h = Math.max(1, Math.round(w / ratio))
      const src = stereo.left // choose left eye for preview

      let canvas: HTMLCanvasElement
      if (projection === 'Equirectangular (mono)' || projection === 'Stereoscopic SBS' || projection === 'Stereoscopic OU') {
        canvas = renderRectilinearPreview(src, w, h, angle.angle, 90)
      } else {
        // Dual fisheye not mapped yet — fallback to cover-fit
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const ctx = c.getContext('2d')!
        const sW = src instanceof ImageBitmap ? src.width : src.width
        const sH = src instanceof ImageBitmap ? src.height : src.height
        const scale = Math.max(w / sW, h / sH)
        const dW = Math.round(sW * scale)
        const dH = Math.round(sH * scale)
        const dx = Math.round((w - dW) / 2)
        const dy = Math.round((h - dH) / 2)
        if (src instanceof ImageBitmap) {
          ctx.drawImage(src, dx, dy, dW, dH)
        } else {
          const tmp = document.createElement('canvas')
          tmp.width = src.width
          tmp.height = src.height
          const tctx = tmp.getContext('2d')!
          tctx.putImageData(src, 0, 0)
          ctx.drawImage(tmp, dx, dy, dW, dH)
        }
        canvas = c
      }

      angle.previewDataUrl = canvas.toDataURL('image/jpeg', 0.85)
      touchAngles()
    } catch (e) {
      console.warn('Preview update failed', e)
    }
  }

  </script>

<main>
  {#if !videoUrl}
    <DropZone {error} on:files={(e) => handleFiles(e.detail)} />
  {:else}
    <section class="workspace">
      <div class="top">
        <aside class="sidebar">
          <SettingsPanel
            bind:projection
            bind:assumedFps
          />
          {#if insvInfo}
            <div class="hint insv-hint">{insvInfo}</div>
          {/if}
          <ExportOptionsPanel
                  bind:aspectPreset
                  bind:customAspectW
                  bind:customAspectH
                  bind:samplesPerSecond
                  {aspectPresets}
          />
        </aside>
        <div class="main">
          <PlayerPanel {videoUrl} bind:videoEl />
        </div>
      </div>

      <section class="bottom">
        <div class="angles-and-actions">
          <div class="angles-toolbar">
            <button class="primary" on:click={addCameraAngle}>Add camera angle from current frame</button>
          </div>
          <AnglesPanel {angles} onTouch={touchAngles} onUpdatePreview={updateAnglePreview} />
        </div>

        <div class="export-actions">
          <button class="save" on:click={extractFrames} disabled={exporting}>Export / Save</button>
          {#if exporting}
            <button class="warn" on:click={() => (cancelExport = true)}>Cancel</button>
            <div class="progress"><div class="bar" style={`width: ${Math.round(exportProgress*100)}%`}></div></div>
          {/if}
        </div>
      </section>
    </section>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
  }
  main { padding: 2rem; color: #111827; }

  .workspace { display: grid; gap: 1rem; }
  .top {
    display: grid;
    grid-template-columns: 320px 1fr;
    gap: 1rem;
    align-items: start;
  }
  .sidebar { min-width: 280px; }
  .main { }

  .bottom { display: grid; gap: 1rem; }
  .angles-and-actions { display: grid; gap: 0.5rem; }
  .angles-toolbar { display:flex; justify-content: flex-end; }
  .export-actions { display: grid; gap: 0.5rem; }
  .export-actions .save { background: #2563eb; color: #fff; border: none; padding: 0.65rem 1rem; border-radius: 8px; cursor: pointer; }
  .export-actions .warn { background: #ef4444; color: #fff; border: none; padding: 0.5rem 0.9rem; border-radius: 8px; cursor: pointer; }
  .progress { height: 6px; background: #e5e7eb; border-radius: 999px; overflow: hidden; }
  .progress .bar { height: 100%; background: #3b82f6; width: 0; transition: width 0.2s; }
</style>
