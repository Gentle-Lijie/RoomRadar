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
  <p
    data-slot="popover-description"
    :class="cn('ui-popover-description', props.class)"
  >
    <slot />
  </p>
</template>
