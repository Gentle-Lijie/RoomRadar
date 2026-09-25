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
  <div
    data-slot="popover-title"
    :class="cn('ui-popover-title', props.class)"
  >
    <slot />
  </div>
</template>
