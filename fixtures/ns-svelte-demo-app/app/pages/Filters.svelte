<script lang="ts">
  import { closeModal } from 'svelte-native';
</script>

<page>
  <stackLayout>
    <label text="Filters" />
    <button text="Done" on:tap={() => closeModal()} />
  </stackLayout>
</page>
