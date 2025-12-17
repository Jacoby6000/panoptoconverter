<script lang="ts">
  import { createEventDispatcher } from 'svelte'

  export let error: string | null = null

  const dispatch = createEventDispatcher<{ files: FileList | null }>()

  let dragActive = false

  function onDrop(e: DragEvent) {
    e.preventDefault()
    dragActive = false
    const dt = e.dataTransfer
    if (!dt) return
    dispatch('files', dt.files)
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault()
    dragActive = true
  }

  function onDragLeave(e: DragEvent) {
    e.preventDefault()
    dragActive = false
  }

  function onFileInputChange(e: Event) {
    const input = e.target as HTMLInputElement
    dispatch('files', input.files)
  }
</script>

<section class="drop-area" class:active={dragActive}
  role="region" aria-label="File upload drop zone"
  on:drop={onDrop}
  on:dragover={onDragOver}
  on:dragleave={onDragLeave}
>
  <div class="drop-content">
    <h1>Drag & drop a video file</h1>
    <p>We currently support MP4 and Insta360 INSV files.</p>
    <div>
      <label class="browse-btn">
        <input type="file" accept="video/mp4,.insv" on:change={onFileInputChange} hidden />
        Browse for a file
      </label>
    </div>
    {#if error}
      <p class="error">{error}</p>
    {/if}
  </div>
</section>

<style>
  .drop-area {
    border: 2px dashed #888;
    border-radius: 12px;
    padding: 4rem 2rem;
    text-align: center;
    color: #666;
    background: #f9fafb;
    transition: border-color 0.2s, background 0.2s;
  }
  .drop-area.active {
    border-color: #3b82f6;
    background: #eef6ff;
  }
  .browse-btn {
    display: inline-block;
    margin-top: 1rem;
    padding: 0.6rem 1rem;
    background: #3b82f6;
    color: white;
    border-radius: 8px;
    cursor: pointer;
  }
  .error { color: #b91c1c; }
</style>
