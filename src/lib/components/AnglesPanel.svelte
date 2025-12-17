<script lang="ts">
  import type { VirtualCamera } from '../types'
  import AngleCard from './AngleCard.svelte'

  export let angles: VirtualCamera[]
  export let onTouch: () => void
  export let onUpdatePreview: (virtualCamera: VirtualCamera) => void
</script>

<div class="panel angles-panel">
  <h2 class="panel-title">Camera Angles ({angles.length})</h2>
  {#if angles.length === 0}
    <p>No angles yet. Click "Add camera angle" to capture the current frame.</p>
  {/if}
  <div class="angles-grid">
    {#each angles as camera}
      <AngleCard {camera} {onTouch} {onUpdatePreview} />
    {/each}
  </div>
</div>

<style>
  .angles-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 0.75rem;
  }
</style>