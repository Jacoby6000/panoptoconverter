# PanoptoConverter (Svelte + TypeScript + Vite)

PanoptoConverter is a browser-based tool to extract still images from 360° video. It supports both equirectangular and stereoscopic inputs and can export photos at a specified aspect ratio/resolution, at N frames per second, for a set of user-defined angles. Built with Svelte, TypeScript, and Vite.

## Project Goals

- Accept local 360° video files via drag-and-drop and an “Open file” dialog.
- Support input formats:
  - Equirectangular 360° video
  - Stereoscopic 360° video (over-under / side-by-side, where feasible)
- Provide an in-app video player with timeline scrubbing and playback controls for previewing the source video.
- Allow users to define one or more camera angles (yaw/pitch/roll presets) and preview each angle in real time.
- Configure export parameters:
  - Output aspect ratio (e.g., 1:1, 4:5, 3:2, 16:9, custom)
  - Output resolution (width/height or long-edge with auto scale)
  - Export frame rate (N frames per second)
  - Angle set(s) to render for each sampled frame
- Export a sequence of photos for the selected time range and configuration.
- Provide visual feedback/progress during export; allow canceling long-running exports.
- Ensure accurate 360° projection handling and high-quality sampling.
- Maintain responsive performance in the browser; leverage Web Workers/WebGL when appropriate.
- Keep the UI clean and modern with reusable components and a DRY codebase.

## Tech Stack

- Svelte (component-based UI)
- TypeScript (type safety)
- Vite (fast dev server and build)

## Development

- Install dependencies: `npm install`
- Start dev server: `npm run dev`
- Build for production: `npm run build`
- Preview production build: `npm run preview`

### Experimental WebCodecs preview
- A class-based provider abstraction has been added to support an experimental hardware-decoded preview path using WebCodecs when available, with automatic fallback to ffmpeg.wasm.
- Toggle the preview preference in the UI: Settings → “Use hardware decoder for preview (experimental)”.
- Additionally, at build/runtime you can enable the experiment via env flag `VITE_EXPERIMENTAL_WEBCODECS=1`. The WebCodecs provider is scaffolded and capability-probed but currently not used for decoding until its implementation is completed; the factory will fall back to ffmpeg to keep behavior stable.

### Tests
- Run unit tests: `npm run test`
- The tests cover provider selection and fallback behavior under various flags/capabilities.

---

This project was scaffolded with the Svelte + TypeScript + Vite template.
