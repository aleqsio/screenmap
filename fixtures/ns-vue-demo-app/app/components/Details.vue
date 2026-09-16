<script lang="ts" setup>
import { $navigateTo } from 'nativescript-vue';
import Settings from './Settings.vue';

defineProps<{ id: number }>();
</script>

<template>
  <Page>
    <ActionBar title="Details" />
    <StackLayout>
      <Label :text="'Item ' + id" />
      <Button text="Settings" @tap="$navigateTo(Settings)" />
    </StackLayout>
  </Page>
</template>
