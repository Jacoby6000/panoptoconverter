<script lang="ts">
  import type { VirtualCamera } from '../types'

  export let camera: VirtualCamera
  export let onTouch: () => void // notify parent to trigger reactive update (angles = [...angles])
  export let onUpdatePreview: (angle: VirtualCamera) => void
</script>

<div class="angle-card">
  <img src={camera.previewDataUrl} alt={camera.label} />
  <div class="meta">
    <input type="text" bind:value={camera.label} on:change={onTouch} />
    <small>@ {camera.time.toFixed(2)}s</small>
  </div>
  <div class="sliders">
    <label>
      <span>Pitch {camera.angle.pitch}°</span>
      <input
        type="range"
        min="-90"
        max="90"
        step="1"
        bind:value={camera.angle.pitch}
        on:input={() => onUpdatePreview(camera)}
        on:change={onTouch}
      />
    </label>
    <label>
      <span>Yaw {camera.angle.yaw}°</span>
      <input
        type="range"
        min="-180"
        max="180"
        step="1"
        bind:value={camera.angle.yaw}
        on:input={() => onUpdatePreview(camera)}
        on:change={onTouch}
      />
    </label>
    <label>
      <span>Roll {camera.angle.roll}°</span>
      <input
        type="range"
        min="-180"
        max="180"
        step="1"
        bind:value={camera.angle.roll}
        on:input={() => onUpdatePreview(camera)}
        on:change={onTouch}
      />
    </label>
  </div>
  <div class="card-actions">
    <button class="secondary" on:click={() => onUpdatePreview(camera)}>Update preview</button>
  </div>
</div>

<style>
  .angle-card {
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    overflow: hidden;
    background: #ffffff;
  }
  .angle-card img { display: block; width: 100%; height: auto; background: #111; }
  .angle-card .meta { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.5rem; color:#111827; }
  .angle-card input { flex: 1; min-width: 0; }
  .angle-card .sliders { padding: 0.5rem; display: grid; gap: 0.5rem; }
  .angle-card .sliders label { display: grid; gap: 0.25rem; font-size: 0.9rem; color:#111827; }
  .card-actions { padding: 0.5rem; }
  .card-actions button { width: 100%; padding: 0.4rem 0.6rem; border-radius: 6px; border: 1px solid #d1d5db; background: #f3f4f6; cursor: pointer; color:#111827; }

  input[type="text"],
  input[type="range"] {
    background: #ffffff;
    color: #111827;
    display: block;
  }

  small, .meta, .sliders label span { color: #111827; }
</style>