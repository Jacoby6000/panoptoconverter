<script lang="ts">
  import type { AspectPreset } from '../types'

  export let aspectPreset: AspectPreset
  export let customAspectW: number
  export let customAspectH: number
  export let samplesPerSecond: number
  export let aspectPresets: readonly string[]
</script>

<div class="panel export-panel">
  <h2 class="panel-title">Export Options</h2>
  <div class="row two-cols">
    <div class="field aspect">
      <label for="aspect">Aspect ratio</label>
      <div class="aspect-row">
        <select id="aspect" bind:value={aspectPreset}>
          {#each aspectPresets as p}
            <option value={p}>{p}</option>
          {/each}
          <option value="Custom">Custom…</option>
        </select>
        {#if aspectPreset === 'Custom'}
          <input aria-label="Aspect width" type="number" min="1" bind:value={customAspectW} />
          <span>:</span>
          <input aria-label="Aspect height" type="number" min="1" bind:value={customAspectH} />
        {/if}
      </div>
    </div>
    <div class="field">
      <label for="nth">Samples per second</label>
      <input id="nth" type="number" min="1" bind:value={samplesPerSecond} on:change={() => { /* keep same fps var */ }} />
    </div>
  </div>
  <div class="hint">
    Orientation transforms and stereoscopic mapping are applied on export. Previews are untransformed for now.
  </div>
</div>

<style>
  .export-panel .aspect .aspect-row { display: flex; align-items: center; gap: 0.5rem; }
</style>
