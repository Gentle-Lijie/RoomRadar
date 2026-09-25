<script setup lang="ts">
import { reactiveOmit } from "@vueuse/core";
import { Primitive } from "reka-ui";
import { cn } from "@/lib/utils";

const props = defineProps({
  asChild: { type: Boolean, required: false },
  as: { type: null, required: false },
  variant: { type: null, required: false, default: "default" },
  class: {
    type: null,
    required: false,
    skipCheck: true,
  },
});

const delegatedProps = reactiveOmit(props, "class");
</script>

<template>
  <Primitive
    data-slot="badge"
    :data-variant="variant"
    :class="cn('ui-badge', props.class)"
    v-bind="delegatedProps"
  >
    <slot />
  </Primitive>
</template>
