<script setup lang="ts">
import { DialogClose } from "reka-ui";
import { cn } from "@/lib/utils";
import { Button } from '@/components/ui/button';

const props = defineProps({
  class: {
    type: null,
    required: false,
    skipCheck: true,
  },
  showCloseButton: { type: Boolean, required: false, default: false },
});
</script>

<template>
  <div
    data-slot="dialog-footer"
    :class="cn('ui-dialog-footer', props.class)"
  >
    <slot />
    <DialogClose v-if="showCloseButton" as-child>
      <Button variant="outline"> Close </Button>
    </DialogClose>
  </div>
</template>
