// Unified interfaces and providers scaffolding for dual-track INSV decoding
// This uses the ffmpeg.wasm path for compatibility and export.

import type {Angle, ProjectionType} from "./types";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import { FFFSType } from "@ffmpeg/ffmpeg";
import { renderRectilinear } from "./core/projection";

export type ProcessedFrame = {
  tsSec: number
  dataUrl: string
  width: number
  height: number
}

export interface IVideoFrameProvider {
  load(name: string, source: File | Blob): Promise<void>
  frameAt(tsSec: number, angle: Angle, width: number, height: number): Promise<ProcessedFrame>
  close(): Promise<void>
  get busy(): boolean
}

export class InsvFrameProvider implements IVideoFrameProvider {
  private ffmpeg: FFmpeg | null = null;
  private name: string | null = null;
  private _isProcessing = false;
  private source: File | Blob | null = null;
  private originalName: string | null = null;
  private lastProcessedKey: string | null = null;
  private lastProcessedResult: ProcessedFrame | null = null;

  get busy(): boolean {
    return this._isProcessing;
  }

  async load(name: string, source: File | Blob): Promise<void> {
    this.source = source;
    this.originalName = name;
    this.ffmpeg = new FFmpeg();
    this.ffmpeg.on('log', ({ message }) => console.log('[FFmpeg]', message));
    
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm';
    await this.ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    
    await this.mountSource();
  }

  private async mountSource(): Promise<void> {
    if (!this.ffmpeg || !this.source) return;
    
    try {
      console.log(`[InsvFrameProvider] Attempting to mount WORKERFS for ${this.source instanceof File ? this.source.name : this.originalName}`);
      await this.ffmpeg.createDir('/mnt');
      
      const mountConfig = this.source instanceof File 
        ? { files: [this.source] }
        : { blobs: [{ name: this.originalName!, data: this.source }] };

      await this.ffmpeg.mount(FFFSType.WORKERFS, mountConfig, '/mnt');
      
      this.name = `/mnt/${this.source instanceof File ? this.source.name : this.originalName}`;
      console.log(`[InsvFrameProvider] Mounted at ${this.name}`);
    } catch (e) {
      console.warn('[InsvFrameProvider] Mount failed, falling back to writeFile', e);
      const bytes = await this.source.arrayBuffer();
      await this.ffmpeg.writeFile(this.originalName!, new Uint8Array(bytes));
      this.name = this.originalName;
    }
  }

  private async reinit(): Promise<void> {
    console.warn('[InsvFrameProvider] Re-initializing FFmpeg after error...');
    try {
      if (this.ffmpeg) {
        await this.ffmpeg.terminate();
      }
    } catch {}
    
    this.ffmpeg = new FFmpeg();
    this.ffmpeg.on('log', ({ message }) => console.log('[FFmpeg]', message));
    
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm';
    await this.ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    
    await this.mountSource();
  }

  async frameAt(tsSec: number, angle: Angle, width: number, height: number): Promise<ProcessedFrame> {
    if (!this.ffmpeg || !this.name) throw new Error('FFmpeg not loaded');

    const key = `${tsSec.toFixed(3)}-${angle.pitch}-${angle.yaw}-${angle.roll}-${width}-${height}`;
    if (this.lastProcessedKey === key && this.lastProcessedResult) {
      console.log(`[InsvFrameProvider] Returning cached frame for ${key}`);
      return this.lastProcessedResult;
    }

    if (this._isProcessing) {
      throw new Error('FFmpeg is busy');
    }

    this._isProcessing = true;
    const outName = 'out.jpg';

    const readImage = async (filename: string) => {
      let data: any = null;
      try {
        console.log(`[InsvFrameProvider] Reading file: ${filename}`);
        data = await this.ffmpeg!.readFile(filename);
        if (typeof data === 'string') {
          console.warn(`[InsvFrameProvider] Read file ${filename} returned string instead of bytes`);
          return null;
        }
        console.log(`[InsvFrameProvider] Read file ${filename} successful, size: ${data.length}`);
        
        const blob = new Blob([data as BlobPart], { type: 'image/jpeg' });
        return await createImageBitmap(blob);
      } catch (e) {
        console.error(`[InsvFrameProvider] Error reading image ${filename}`, e);
        return null;
      }
    };

    let resultBitmap: ImageBitmap | null = null;

    try {
          console.log(`[InsvFrameProvider] Extracting reprojected frame at ${tsSec}s, width: ${width}, height: ${height}`);
      
          const filter = 
            // 1. Correct Front Lens (Stream 0)
            `[0:v:0]v360=input=fisheye:output=fisheye[front_corr]; ` +
            // 2. Correct Rear Lens (Stream 1)
            `[0:v:1]v360=input=fisheye:output=fisheye[rear_corr]; ` +
            // 3. Stack and Project
            `[front_corr][rear_corr]hstack=inputs=2[stacked]; ` +
            `[stacked]v360=input=dfisheye:output=rectilinear:ih_fov=190:iv_fov=190:` +
            `yaw=${angle.yaw}:pitch=${angle.pitch}:roll=${angle.roll}:` +
            `h_fov=90:v_fov=90:w=${width}:h=${height},format=yuvj420p`;

          const args = [
        '-threads', '1',
        '-ss', tsSec.toFixed(3),
        '-i', this.name!,
        '-filter_complex', filter,
        '-frames:v', '1',
        '-c:v', 'mjpeg',
        '-pix_fmt', 'yuvj420p',
        '-q:v', '4',
        '-update', '1',
        outName
      ];
      
      console.log(`[InsvFrameProvider] Running FFmpeg for reprojection...`);
      try {
        await this.ffmpeg!.exec(args);
      } catch (e: any) {
        console.error(`[InsvFrameProvider] FFmpeg reproject failed`, e);
        if (e?.message?.includes('out of bounds') || e?.message?.includes('Aborted')) {
          await this.reinit();
          throw e;
        }
      }

      resultBitmap = await readImage(outName);
      try { await this.ffmpeg.deleteFile(outName); } catch {}

      if (!resultBitmap) throw new Error('Failed to extract reprojected frame');
    } catch (e: any) {
      // ... existing error handling ...
      throw e;
    } finally {
      this._isProcessing = false;
    }

    try {
      // No longer need manual renderRectilinear call as FFmpeg did the work
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(resultBitmap, 0, 0);
      
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);

      const result = {
        tsSec,
        dataUrl,
        width,
        height
      };
      
      this.lastProcessedKey = key;
      this.lastProcessedResult = result;
      return result;
    } finally {
      if (resultBitmap) resultBitmap.close();
    }
  }

  async close(): Promise<void> {
    if (this.ffmpeg) {
      try {
        console.log('[InsvFrameProvider] Closing provider and terminating FFmpeg');
        if (this.name) {
          if (this.name.startsWith('/mnt/')) {
            try { await this.ffmpeg.unmount('/mnt'); } catch {}
          } else {
            try { await this.ffmpeg.deleteFile(this.name); } catch {}
          }
        }
        await this.ffmpeg.terminate();
      } catch (e) {
        console.warn('Error during FFmpeg termination', e);
      }
    }
    this.ffmpeg = null;
    this.name = null;
    this._isProcessing = false;
  }
}

export async function createProvider(
  source: File | Blob,
  name: string,
  _videoProjectionType: ProjectionType
): Promise<IVideoFrameProvider | null> {
  // Always use the dual-track INSV provider as requested
  const fmp = new InsvFrameProvider();
  await fmp.load(name, source);
  return fmp;
}
