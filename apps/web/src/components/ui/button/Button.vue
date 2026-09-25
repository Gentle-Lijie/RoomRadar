<script setup lang="ts">
import { Primitive } from "reka-ui";
import { cn } from "@/lib/utils";

const props = defineProps({
  variant: { type: null, required: false, default: "default" },
  size: { type: null, required: false, default: "default" },
  class: {
    type: null,
    required: false,
    skipCheck: true,
  },
  asChild: { type: Boolean, required: false },
  as: { type: null, required: false, default: "button" },
});
</script>

<template>
  <Primitive
    data-slot="button"
    :data-variant="variant"
    :data-size="size"
    :as="as"
    :as-child="asChild"
    :class="cn('ui-button', props.class)"
  >
    <slot />
  </Primitive>
</template>
