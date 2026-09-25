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
  <caption
    data-slot="table-caption"
    :class="cn('ui-table-caption', props.class)"
  >
    <slot />
  </caption>
</template>
