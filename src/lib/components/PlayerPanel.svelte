<script lang="ts">
  export let videoUrl: string | null
  export let videoEl: HTMLVideoElement
  // PlayerPanel is focused on displaying the video only. Actions are handled in parent layout now.
</script>

<div class="player-panel">
  <!-- svelte-ignore a11y-media-has-caption -->
  <video bind:this={videoEl} src={videoUrl || ''} controls playsinline on:timeupdate></video>
</div>

<style>
  .player-panel video {
    width: 100%;
    max-height: 60vh;
    background: black;
    border-radius: 8px;
  }
</style>