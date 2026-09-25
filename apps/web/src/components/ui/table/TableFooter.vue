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
  <tfoot
    data-slot="table-footer"
    :class="cn('ui-table-footer', props.class)"
  >
    <slot />
  </tfoot>
</template>
