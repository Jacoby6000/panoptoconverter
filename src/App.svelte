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

  onDestroy(async () => {
    cleanupUrl()
    try { await frameProvider?.close() } catch {}
    frameProvider = null
  })

  let lastFile: File | null = null;
  let providerLoading = false;
  let providerBusy = false;

  $: {
    // Poll for provider busy state if needed, though Svelte 5 might handle it differently.
    // In Svelte 5, if frameProvider is a state, its properties are reactive.
    // However, frameProvider is not necessarily a Svelte state here.
    // But since we update angles which triggers updateAnglePreviewInternal, 
    // we can sync it there.
  }

  async function handleFiles(files: FileList | null) {
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
    lastFile = f
    cleanupUrl()
    videoUrl = URL.createObjectURL(f)
    projection = 'Dual Fisheye (Insta360)'
    angles = [] // reset angles when new video is loaded

    await reloadProvider();
  }

  async function reloadProvider() {
    if (!lastFile) return;
    providerLoading = true;
    try {
      if (frameProvider) {
        try { await frameProvider.close() } catch (e) {
          console.warn('Failed to close frame provider.', e);
        }
        frameProvider = null;
      }
      frameProvider = await createProvider(lastFile, lastFile.name, projection)
    } catch (e: any) {
      error = 'Provider load error: ' + (e?.message || String(e))
    } finally {
      providerLoading = false;
    }
  }

  // Reload provider when projection changes (important for INSV dual-track)
  $: if (projection && lastFile) {
    reloadProvider();
  }

  function touchAngles() { angles = [...angles] }

  async function addCameraAngle() {
    const time = videoEl?.currentTime ?? 0
    const newAngle: VirtualCamera = {
      id: nextId++,
      label: `Angle ${nextId - 1}`,
      previewDataUrl: '', // Will be updated immediately
      time,
      angle: {
        pitch: 0,
        yaw: 0,
        roll: 0
      }
    }
    angles = [...angles, newAngle]
    // The reactive block will pick this up and update the preview
  }


  let lastPreviewTick = 0
  const PREVIEW_THROTTLE_MS = 200

  // Update all previews when time or relevant settings change
  $: if (videoEl && !exporting) {
    // Watch relevant settings to update previews
    projection;
    aspectPreset;
    customAspectW;
    customAspectH;
    
    // We also want to update when angles are added/removed or changed
    for (const angle of angles) {
      angle.angle.pitch;
      angle.angle.yaw;
      angle.angle.roll;
    }

    const now = Date.now()
    if (now - lastPreviewTick >= PREVIEW_THROTTLE_MS) {
      // Use untrack if using Svelte 5, but here we are in a reactive block
      // that we want to trigger on these dependencies.
      // However, we only want to trigger the loop once per tick.
      // updateAnglePreview itself is throttled.
      for (const angle of angles) {
        updateAnglePreview(angle)
      }
    }
  }

  function handleTimeUpdate() {
    // timeupdate will trigger the reactive block above because videoEl.currentTime changes
    // Wait, the reactive block doesn't explicitly watch videoEl.currentTime.
    // Let's add it there or keep handleTimeUpdate but ensure it respects the same throttle.
    const now = Date.now()
    if (now - lastPreviewTick < PREVIEW_THROTTLE_MS) return
    // We don't set lastPreviewTick here, let updateAnglePreview do it to keep it unified
    for (const angle of angles) {
      updateAnglePreview(angle)
    }
  }

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
    providerBusy = true

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
            const processed = await frameProvider.frameAt(ts, cam.angle, outW, outH)
            const img = new Image()
            img.src = processed.dataUrl
            await new Promise((res) => img.onload = res)
            outCtx.clearRect(0, 0, outW, outH)
            outCtx.drawImage(img, 0, 0)

            const blob: Blob = await new Promise((res) => outCanvas.toBlob((b) => res(b!), 'image/jpeg', 0.92))
            const tsStr = ts.toFixed(2).replace(/\./g, '_')
            const safeLabel = cam.label.replace(/[^a-z0-9-_]+/gi, '_') || `Angle_${cam.id}`
            const fname = `${safeLabel}_${tsStr}.jpg`
            zip.file(fname, blob)
            
            // Cleanup dataUrl to free memory
            URL.revokeObjectURL(processed.dataUrl)
          } catch (e: any) {
            if (e?.message === 'FFmpeg is busy') {
              // During export, we shouldn't be busy, but if we are, wait a bit and retry once
              await new Promise(r => setTimeout(r, 100));
              try {
                const processed = await frameProvider.frameAt(ts, cam.angle, outW, outH)
                const img = new Image()
                img.src = processed.dataUrl
                await new Promise((res) => img.onload = res)
                outCtx.clearRect(0, 0, outW, outH)
                outCtx.drawImage(img, 0, 0)
                const blob: Blob = await new Promise((res) => outCanvas.toBlob((b) => res(b!), 'image/jpeg', 0.92))
                const tsStr = ts.toFixed(2).replace(/\./g, '_')
                const safeLabel = cam.label.replace(/[^a-z0-9-_]+/gi, '_') || `Angle_${cam.id}`
                const fname = `${safeLabel}_${tsStr}.jpg`
                zip.file(fname, blob)
                URL.revokeObjectURL(processed.dataUrl)
              } catch (e2) {
                console.warn('Export frame failed at', ts, cam, e2)
              }
            } else {
              console.warn('Export frame failed at', ts, cam, e)
            }
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
      providerBusy = frameProvider?.busy ?? false
    }
  }

  async function updateAnglePreview(angle: VirtualCamera) {
    if (exporting) return

    const now = Date.now()
    if (now - lastPreviewTick < PREVIEW_THROTTLE_MS) return
    lastPreviewTick = now
    await updateAnglePreviewInternal(angle)
  }


  async function updateAnglePreviewInternal(angle: VirtualCamera) {
    if (!frameProvider || !videoEl) return
    const ts = videoEl.currentTime || 0

    providerBusy = frameProvider.busy;
    try {
      const maxW = 240
      const ratio = aspectRatioValue()
      const w = maxW
      const h = Math.max(1, Math.round(w / ratio))

      const processed = await frameProvider.frameAt(ts, angle.angle, w, h)
      angle.previewDataUrl = processed.dataUrl
      touchAngles()
    } catch (e: any) {
      if (e?.message !== 'FFmpeg is busy') {
        console.warn('Preview update failed', e)
      }
    } finally {
      providerBusy = frameProvider?.busy ?? false;
    }
  }

  </script>

<main>
  {#if !videoUrl}
    <DropZone {error} on:files={(e) => handleFiles(e.detail)} />
  {:else}
    <section class="workspace">
      {#if providerLoading}
        <div class="loading-overlay">Initializing video tracks...</div>
      {/if}
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
          <PlayerPanel {videoUrl} bind:videoEl on:timeupdate={handleTimeUpdate} />
        </div>
      </div>

      <section class="bottom">
        <div class="angles-and-actions">
          <div class="angles-toolbar">
            <button class="primary" on:click={addCameraAngle} disabled={providerLoading || providerBusy || exporting}>
              Add camera angle from current frame
            </button>
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

  .loading-overlay {
    position: fixed;
    top: 1rem;
    right: 1rem;
    background: #2563eb;
    color: white;
    padding: 0.5rem 1rem;
    border-radius: 8px;
    z-index: 1000;
    box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
  }
</style>
