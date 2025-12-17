<script lang="ts">
  import type { ProjectionType } from '../types'

  export let projection: ProjectionType
  export let assumedFps: number
  // Experimental HW preview toggle (WebCodecs)
  export let useHardwarePreview: boolean = false
  // Export-related options moved to ExportOptionsPanel
</script>

<div class="panel controls-panel">
  <h2 class="panel-title">Input Video Options</h2>
  <div class="row two-cols">
    <div class="field">
      <label for="projection">Projection</label>
      <select id="projection" bind:value={projection}>
        <option>Equirectangular (mono)</option>
        <option>Stereoscopic SBS</option>
        <option>Stereoscopic OU</option>
        <option>Dual Fisheye (Insta360)</option>
      </select>
    </div>
    <div class="field">
      <label for="fps">FPS</label>
      <input id="fps" type="number" min="1" max="120" bind:value={assumedFps} />
    </div>
  </div>
  <div class="row">
    <label class="checkbox">
      <input type="checkbox" bind:checked={useHardwarePreview} />
      <span>Use hardware decoder for preview (experimental)</span>
    </label>
  </div>
  <div class="hint">Choose the format that matches your source video.</div>
</div>
