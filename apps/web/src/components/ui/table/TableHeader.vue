<script setup lang="ts">
import { cn } from "@/lib/utils";

const props = defineProps({
  class: {
    type: null,
    required: false,
    skipCheck: true,
  },
});
</script>

<template>
  <thead data-slot="table-header" :class="cn('ui-table-header', props.class)">
    <slot />
  </thead>
</template>
