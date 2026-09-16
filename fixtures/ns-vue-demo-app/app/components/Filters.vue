<script lang="ts" setup>
import { $closeModal } from 'nativescript-vue';
</script>

<template>
  <Page>
    <StackLayout>
      <Label text="Filters" />
      <Button text="Done" @tap="$closeModal()" />
    </StackLayout>
  </Page>
</template>
