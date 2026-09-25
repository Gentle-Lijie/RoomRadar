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
  <div data-slot="table-container" class="ui-table-container">
    <table
      data-slot="table"
      :class="cn('ui-table', props.class)"
    >
      <slot />
    </table>
  </div>
</template>
