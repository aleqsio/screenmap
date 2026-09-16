<script lang="ts" setup>
import { $navigateTo, $showModal } from 'nativescript-vue';
import Details from './Details.vue';
import Filters from './Filters.vue';

const items = [{ id: 1, title: 'First' }, { id: 2, title: 'Second' }];

function open(id: number) {
  $navigateTo(Details, { props: { id } });
}

function filters() {
  $showModal(Filters);
}
</script>

<template>
  <Frame>
    <Page>
      <ActionBar title="Home" />
      <GridLayout rows="auto, *">
        <Button row="0" text="Filters" @tap="filters" />
        <ListView row="1" :items="items" @itemTap="open($event.item.id)">
          <template #default="{ item }">
            <Label :text="item.title" />
          </template>
        </ListView>
      </GridLayout>
    </Page>
  </Frame>
</template>
