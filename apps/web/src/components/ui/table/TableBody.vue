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
  <tbody
    data-slot="table-body"
    :class="cn('ui-table-body', props.class)"
  >
    <slot />
  </tbody>
</template>
