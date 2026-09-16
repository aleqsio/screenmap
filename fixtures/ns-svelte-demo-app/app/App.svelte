<script lang="ts">
  import { navigate } from '@nativescript-community/svelte-native';
  import Details from './pages/Details.svelte';

  const items = [{ id: 1, title: 'First' }, { id: 2, title: 'Second' }];
  function open(item) {
    navigate({ page: Details, props: { id: item.id } });
  }
</script>

<frame>
  <page>
    <actionBar title="Home" />
    <listView {items} on:itemTap={(e) => open(e.item)}>
      <Template let:item>
        <label text={item.title} />
      </Template>
    </listView>
  </page>
</frame>
