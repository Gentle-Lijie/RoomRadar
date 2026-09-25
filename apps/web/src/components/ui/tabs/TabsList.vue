<script setup lang="ts">
import { reactiveOmit } from "@vueuse/core";
import { TabsList } from "reka-ui";
import { cn } from "@/lib/utils";

const props = defineProps({
  loop: { type: Boolean, required: false },
  asChild: { type: Boolean, required: false },
  as: { type: null, required: false },
  class: {
    type: null,
    required: false,
    skipCheck: true,
  },
  variant: { type: null, required: false, default: "default" },
});

const delegatedProps = reactiveOmit(props, "class", "variant");
</script>

<template>
  <TabsList
    data-slot="tabs-list"
    :data-variant="variant"
    v-bind="delegatedProps"
    :class="cn('ui-tabs-list group/tabs-list', props.class)"
  >
    <slot />
  </TabsList>
</template>
