<script lang="ts">
  import { showModal } from 'svelte-native';
  import Filters from './Filters.svelte';

  export let id: number;
  function filters() {
    showModal({ page: Filters, props: {} });
  }
</script>

<page>
  <actionBar title="Details" />
  <stackLayout>
    <label text={'Item ' + id} />
    <button text="Filters" on:tap={filters} />
  </stackLayout>
</page>
