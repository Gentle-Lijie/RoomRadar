<script setup lang="ts">
import { reactiveOmit } from "@vueuse/core";
import { cn } from "@/lib/utils";
import TableCell from "./TableCell.vue";
import TableRow from "./TableRow.vue";

const props = defineProps({
  class: {
    type: null,
    required: false,
    skipCheck: true,
  },
  colspan: { type: Number, required: false, default: 1 },
});

const delegatedProps = reactiveOmit(props, "class");
</script>

<template>
  <TableRow>
    <TableCell
      :class="cn('ui-table-empty', props.class)"
      v-bind="delegatedProps"
    >
      <div class="ui-table-empty-body">
        <slot />
      </div>
    </TableCell>
  </TableRow>
</template>
