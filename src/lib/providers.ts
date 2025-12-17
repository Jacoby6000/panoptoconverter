// Unified interfaces and providers scaffolding for dual-track INSV decoding
// This introduces a class-based abstraction that can be backed by WebCodecs
// (for fast preview on supported systems) or by the existing ffmpeg.wasm path
// (for compatibility and export). No functional behavior change is introduced
// for the existing FFmpeg-based path; WebCodecs provider is a skeleton to be
// filled in incrementally.

import type {Angle, ProjectionType} from "./types";

export type StereoFrame = {
  tsSec: number
  left: ImageBitmap | ImageData
  right: ImageBitmap | ImageData
}

export interface IVideoFrameProvider {
  load(name: string, bytes: ArrayBuffer): Promise<void>
  frameAt(tsSec: number, angle: Angle): Promise<StereoFrame>
  close(): void
}

// Minimal types to avoid bringing mp4box/WebCodecs right away as hard deps
type VideoDecoderConfigLike = Partial<{
  codec: string
  description: BufferSource
  codedWidth: number
  codedHeight: number
}>

/**
 * Skeleton for a WebCodecs-based dual-track HEVC preview provider.
 * NOTE: This is a placeholder; implementation will require a demuxer
 * (e.g., mp4box.js) to extract two HEVC tracks and feed WebCodecs.
 */
export class WebCodecsHevcProvider implements IVideoFrameProvider {
  private supported = false
  private name: string | null = null
  private bytes: ArrayBuffer | null = null
  private projectionType: ProjectionType;

  constructor(projectionType: ProjectionType) {
    this.projectionType = projectionType;
  }

  async load(name: string, bytes: ArrayBuffer): Promise<void> {
    this.name = name
    this.bytes = bytes
    // TODO: parse INSV/MP4 container, identify two HEVC tracks and build
    // VideoDecoderConfig objects (from hvcC box) for capability probe.

    const maybeConfigs: VideoDecoderConfigLike[] = [
      { codec: 'hvc1' },
      { codec: 'hev1' },
    ]

    this.supported = await this.probeHevcSupport(maybeConfigs)
    if (!this.supported) {
      throw new Error('WebCodecs HEVC not supported on this system')
    }

    // TODO: instantiate demuxer, create two VideoDecoders, prepare sample indices
  }

  async frameAt(tsSec: number, angle: Angle): Promise<StereoFrame> {
    if (!this.supported) throw new Error('WebCodecs provider not initialized')
    // TODO: seek to nearest keyframe <= tsSec for both tracks, decode forward,
    // produce VideoFrames, convert to ImageBitmap for return.
    throw new Error('WebCodecsHevcProvider.frameAt not implemented yet')
  }

  close(): void {
    // TODO: close VideoDecoders, release VideoFrames, dispose demuxer
  }

  private async probeHevcSupport(configs: VideoDecoderConfigLike[]): Promise<boolean> {
    const anyGlobal: any = globalThis as any
    const vd = anyGlobal?.VideoDecoder
    if (!vd?.isConfigSupported) return false
    for (const cfg of configs) {
      try {
        const res = await vd.isConfigSupported({ codec: cfg.codec })
        if (res?.supported) return true
      } catch {
        // continue
      }
    }
    return false
  }
}

/**
 * Practical HEVC provider based on a hidden HTMLVideoElement. This relies on the
 * browser's native demux/decoder support (HEVC may require platform codecs).
 * It is suitable for previews and frame grabs. For stereo inputs, it will split
 * the rendered frame according to the selected projection type.
 */
export class HevcMediaElementProvider implements IVideoFrameProvider {
  private url: string | null = null
  private video: HTMLVideoElement | null = null
  private canvas: OffscreenCanvas | HTMLCanvasElement | null = null
  private ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null
  private name: string | null = null
  private projectionType: ProjectionType

  constructor(projectionType: ProjectionType) {
    this.projectionType = projectionType
  }

  async load(name: string, bytes: ArrayBuffer): Promise<void> {
    this.name = name
    // Create object URL
    const blob = new Blob([bytes], { type: 'video/mp4' })
    const url = URL.createObjectURL(blob)
    this.url = url

    // Create hidden video element
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.preload = 'auto'
    video.muted = true
    video.playsInline = true as any
    video.style.position = 'fixed'
    video.style.left = '-9999px'
    video.style.top = '-9999px'
    video.src = url

    // Wait for metadata to know dimensions/duration
    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => resolve()
      const onErr = () => reject(new Error('Failed to load video metadata'))
      video.addEventListener('loadedmetadata', onLoaded, { once: true })
      video.addEventListener('error', onErr, { once: true })
    })

    // Prepare canvas
    const width = Math.max(1, Math.floor(video.videoWidth))
    const height = Math.max(1, Math.floor(video.videoHeight))
    // Prefer OffscreenCanvas when available
    const anyGlobal: any = globalThis as any
    if (anyGlobal.OffscreenCanvas) {
      this.canvas = new OffscreenCanvas(width, height)
      this.ctx = (this.canvas as OffscreenCanvas).getContext('2d')
    } else {
      const c = document.createElement('canvas')
      c.width = width
      c.height = height
      this.canvas = c
      this.ctx = c.getContext('2d')
    }

    if (!this.ctx) throw new Error('2D canvas context unavailable')

    // Attach to DOM only if it's a normal canvas (not offscreen), to allow drawImage from video
    if (this.canvas instanceof HTMLCanvasElement) {
      this.canvas.style.position = 'fixed'
      this.canvas.style.left = '-9999px'
      this.canvas.style.top = '-9999px'
      document.body.appendChild(this.canvas)
    }

    // Keep reference for seeking/capture
    this.video = video
    // Append the video to DOM so that it can advance/seek on iOS/Safari if required
    document.body.appendChild(video)
  }

  private async seekTo(timeSec: number): Promise<void> {
    const v = this.video!
    // Clamp into duration
    const t = Math.max(0, Math.min(timeSec, isFinite(v.duration) ? v.duration : timeSec))
    if (Math.abs(v.currentTime - t) < 0.0005) return
    v.currentTime = t
    await new Promise<void>((resolve, reject) => {
      const onSeeked = () => resolve()
      const onErr = () => reject(new Error('Seek failed'))
      v.addEventListener('seeked', onSeeked, { once: true })
      v.addEventListener('error', onErr, { once: true })
    })
  }

  private async captureCurrentFrame(): Promise<ImageBitmap | ImageData> {
    const v = this.video!
    const ctx = this.ctx!
    const can = this.canvas!
    const vw = v.videoWidth || (can as any).width
    const vh = v.videoHeight || (can as any).height
    // Resize canvas if dimension changed
    if ((can as any).width !== vw || (can as any).height !== vh) {
      if (can instanceof HTMLCanvasElement) {
        can.width = vw
        can.height = vh
      } else {
        ;(can as OffscreenCanvas).width = vw
        ;(can as OffscreenCanvas).height = vh
      }
    }
    ctx.drawImage(v, 0, 0, vw, vh)
    // Prefer ImageBitmap for efficiency
    try {
      // OffscreenCanvas supports convertToBlob in most browsers; fall back to ImageData
      if ('transferToImageBitmap' in (can as any)) {
        return (can as any).transferToImageBitmap()
      }
      const bm = await createImageBitmap(can as any)
      return bm
    } catch {
      const imgData = ctx.getImageData(0, 0, vw, vh)
      return imgData
    }
  }

  async frameAt(tsSec: number, _angle: Angle): Promise<StereoFrame> {
    if (!this.video || !this.canvas || !this.ctx) throw new Error('Provider not loaded')
    await this.seekTo(tsSec)
    const full = await this.captureCurrentFrame()

    const split = async (): Promise<{ left: ImageBitmap | ImageData; right: ImageBitmap | ImageData }> => {
      const proj = this.projectionType
      // If full is ImageBitmap, draw to canvas again to crop; reuse ctx
      const ensureOnCanvas = async (src: ImageBitmap | ImageData) => {
        const can = this.canvas!
        const ctx = this.ctx!
        const w = src instanceof ImageBitmap ? src.width : (src as ImageData).width
        const h = src instanceof ImageBitmap ? src.height : (src as ImageData).height
        // Draw src to canvas
        if ((can as any).width !== w || (can as any).height !== h) {
          if (can instanceof HTMLCanvasElement) { can.width = w; can.height = h } else { (can as OffscreenCanvas).width = w; (can as OffscreenCanvas).height = h }
        }
        if (src instanceof ImageBitmap) {
          ctx.clearRect(0, 0, w, h)
          ctx.drawImage(src, 0, 0)
          return { w, h }
        } else {
          ctx.putImageData(src, 0, 0)
          return { w, h }
        }
      }

      const { w, h } = await ensureOnCanvas(full)

      const cropToBitmap = async (sx: number, sy: number, sw: number, sh: number): Promise<ImageBitmap | ImageData> => {
        const can = this.canvas!
        const anyGlobal: any = globalThis as any
        // Use a temp offscreen canvas for crop to avoid clobbering main canvas
        const tmp = anyGlobal.OffscreenCanvas ? new OffscreenCanvas(sw, sh) : (() => { const c = document.createElement('canvas'); c.width = sw; c.height = sh; return c })()
        const tctx = (tmp as any).getContext('2d')!
        tctx.drawImage(can as any, sx, sy, sw, sh, 0, 0, sw, sh)
        try {
          if ('transferToImageBitmap' in (tmp as any)) {
            return (tmp as any).transferToImageBitmap()
          }
          return await createImageBitmap(tmp as any)
        } catch {
          return tctx.getImageData(0, 0, sw, sh)
        }
      }

      if (proj === 'Stereoscopic SBS') {
        const halfW = Math.floor(w / 2)
        const left = await cropToBitmap(0, 0, halfW, h)
        const right = await cropToBitmap(w - halfW, 0, halfW, h)
        return { left, right }
      }
      if (proj === 'Stereoscopic OU') {
        const halfH = Math.floor(h / 2)
        const left = await cropToBitmap(0, 0, w, halfH)
        const right = await cropToBitmap(0, h - halfH, w, halfH)
        return { left, right }
      }
      // For mono/equirectangular or dual-fisheye (not yet warped), return same frame for both eyes
      return { left: full, right: full }
    }

    const { left, right } = await split()
    return { tsSec, left, right }
  }

  close(): void {
    if (this.video) {
      try { this.video.pause() } catch {}
      if (this.video.parentNode) this.video.parentNode.removeChild(this.video)
      this.video.src = ''
      this.video.removeAttribute('src')
      this.video.load()
    }
    if (this.canvas instanceof HTMLCanvasElement && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas)
    }
    if (this.url) URL.revokeObjectURL(this.url)
    this.video = null
    this.canvas = null
    this.ctx = null
    this.url = null
  }
}

export async function createProvider(
  bytes: ArrayBuffer,
  name: string,
  videoProjectionType: ProjectionType
): Promise<IVideoFrameProvider | null> {
  const useWc = (import.meta as any).env?.VITE_EXPERIMENTAL_WEBCODECS == 1 || (import.meta as any).env?.VITE_EXPERIMENTAL_WEBCODECS === '1'
  if (useWc) {
    try {
      const wc = new WebCodecsHevcProvider(videoProjectionType)
      await wc.load(name, bytes)
      return wc
    } catch (e) {
      console.warn('[ProviderFactory] WebCodecs unavailable, falling back to media element:', e)
    }
  }

  // Fallback: use HTMLVideoElement-based provider
  const me = new HevcMediaElementProvider(videoProjectionType)
  await me.load(name, bytes)
  return me
}
