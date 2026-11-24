<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { AdminTopup } from '@flowxis/contracts';
import { formatNumberVi, formatVndVi } from '~/utils/catalog';

export type AdminTopupActionType =
  | 'approve'
  | 'approve-expired'
  | 'reject'
  | 'needs-review';

const props = withDefaults(
  defineProps<{
    open: boolean;
    topup: AdminTopup | null;
    actionType: AdminTopupActionType | null;
    isSubmitting?: boolean;
    errorMessageVi?: string | null;
  }>(),
  {
    isSubmitting: false,
    errorMessageVi: null,
  },
);

const emit = defineEmits<{
  (e: 'close'): void;
  (
    e: 'confirm',
    payload: {
      actionType: AdminTopupActionType;
      topupId: string;
      bankRef?: string;
      rejectReason?: string;
      note?: string;
    },
  ): void;
}>();

const bankRef = ref<string>('');
const rejectReason = ref<string>('');
const note = ref<string>('');
const localErrorVi = ref<string | null>(null);

const inputFieldRef = ref<{ focus?: () => void; $el?: unknown } | null>(null);

function focusInputField(): void {
  const target = inputFieldRef.value;
  if (!target) return;
  if (typeof target.focus === 'function') {
    target.focus();
    return;
  }
  const el = target.$el as { focus?: () => void } | undefined;
  if (typeof el?.focus === 'function') {
    el.focus();
  }
}

function onOpenChange(next: boolean): void {
  if (!next) handleClose();
}

watch(
  () => [props.open, props.actionType, props.topup?.id],
  () => {
    bankRef.value = '';
    rejectReason.value = '';
    note.value = '';
    localErrorVi.value = null;
  },
);

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      await nextTick();
      focusInputField();
    }
  },
  { flush: 'post' },
);

const modalTitle = computed<string>(() => {
  switch (props.actionType) {
    case 'approve':
      return 'Duyệt đơn nạp VietQR';
    case 'approve-expired':
      return 'Duyệt đơn nạp đã hết hạn';
    case 'reject':
      return 'Từ chối đơn nạp';
    case 'needs-review':
      return 'Đánh dấu đơn cần xem xét';
    default:
      return 'Xử lý đơn nạp';
  }
});

const submitButtonLabel = computed<string>(() => {
  switch (props.actionType) {
    case 'approve':
      return 'Xác nhận duyệt đơn';
    case 'approve-expired':
      return 'Xác nhận duyệt đơn quá hạn';
    case 'reject':
      return 'Xác nhận từ chối';
    case 'needs-review':
      return 'Lưu ghi chú xem xét';
    default:
      return 'Xác nhận';
  }
});

const submitButtonClass = computed<string>(() => {
  switch (props.actionType) {
    case 'approve-expired':
      return 'bg-amber-500 text-black hover:bg-amber-400';
    case 'reject':
      return 'bg-rose-500 text-white hover:bg-rose-400';
    case 'needs-review':
      return 'bg-orange-500 text-white hover:bg-orange-400';
    default:
      return '';
  }
});

const displayErrorVi = computed<string | null>(() => {
  return localErrorVi.value || props.errorMessageVi || null;
});

function handleClose(): void {
  if (props.isSubmitting) {
    return;
  }
  emit('close');
}

function handleSubmit(): void {
  if (props.isSubmitting || !props.topup || !props.actionType) {
    return;
  }
  localErrorVi.value = null;

  if (props.actionType === 'approve' || props.actionType === 'approve-expired') {
    const trimmed = bankRef.value.trim();
    if (!trimmed) {
      localErrorVi.value =
        'Vui lòng nhập mã giao dịch ngân hàng (bank_ref).';
      return;
    }
    if (trimmed.length > 128) {
      localErrorVi.value = 'Mã giao dịch ngân hàng tối đa 128 ký tự.';
      return;
    }
    emit('confirm', {
      actionType: props.actionType,
      topupId: props.topup.id,
      bankRef: trimmed,
    });
    return;
  }

  if (props.actionType === 'reject') {
    const trimmed = rejectReason.value.trim();
    if (!trimmed) {
      localErrorVi.value = 'Vui lòng nhập lý do từ chối.';
      return;
    }
    if (trimmed.length > 500) {
      localErrorVi.value = 'Lý do từ chối tối đa 500 ký tự.';
      return;
    }
    emit('confirm', {
      actionType: props.actionType,
      topupId: props.topup.id,
      rejectReason: trimmed,
    });
    return;
  }

  if (props.actionType === 'needs-review') {
    const trimmed = note.value.trim();
    if (!trimmed) {
      localErrorVi.value = 'Vui lòng nhập ghi chú.';
      return;
    }
    if (trimmed.length > 500) {
      localErrorVi.value = 'Ghi chú tối đa 500 ký tự.';
      return;
    }
    emit('confirm', {
      actionType: props.actionType,
      topupId: props.topup.id,
      note: trimmed,
    });
  }
}
</script>

<template>
  <Dialog v-if="topup" :open="open" @update:open="onOpenChange">
    <DialogContent
      data-testid="admin-topup-action-modal"
      class="max-h-[90dvh] max-w-lg overflow-y-auto overscroll-contain"
      @interact-outside="(e) => isSubmitting && e.preventDefault()"
    >
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Icon v-if="actionType === 'approve'" name="lucide:check-circle-2" class="h-5 w-5 text-emerald-400" />
          <Icon v-else-if="actionType === 'approve-expired'" name="lucide:alert-triangle" class="h-5 w-5 text-amber-400" />
          <Icon v-else-if="actionType === 'reject'" name="lucide:x-circle" class="h-5 w-5 text-rose-400" />
          <Icon v-else name="lucide:help-circle" class="h-5 w-5 text-orange-400" />
          <span>{{ modalTitle }}</span>
        </DialogTitle>
        <DialogDescription class="sr-only">Xác nhận thao tác với đơn nạp {{ topup.code }}</DialogDescription>
      </DialogHeader>

      <!-- Tóm tắt thông tin đơn nạp -->
      <div class="rounded-lg border bg-muted p-3.5 text-sm">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
          <div class="flex items-center gap-2">
            <span class="text-muted-foreground">Mã đơn:</span>
            <span class="font-bold">{{ topup.code }}</span>
          </div>
          <Badge variant="secondary">Gói {{ topup.pack }}</Badge>
        </div>
        <div class="mt-2.5 grid grid-cols-2 gap-2">
          <div>
            <span class="text-muted-foreground">Số tiền đối chiếu:</span>
            <p class="font-bold text-[#52A8FF]">{{ formatVndVi(topup.amountVnd) }}</p>
          </div>
          <div>
            <span class="text-muted-foreground">Credit cộng:</span>
            <p class="font-bold text-emerald-400">+{{ formatNumberVi(topup.credits) }} CR</p>
          </div>
        </div>
        <div class="mt-2 text-muted-foreground">
          <span>Nội dung chuyển khoản: </span>
          <span class="font-semibold text-foreground">{{ topup.transferContent }}</span>
        </div>
      </div>

      <Alert
        v-if="actionType === 'approve-expired'"
        data-testid="expired-warning-banner"
        class="border-amber-500/40 bg-amber-500/10 text-amber-200"
      >
        <Icon name="lucide:alert-triangle" class="h-4 w-4 text-amber-400" />
        <AlertDescription class="space-y-1">
          <p class="font-bold">CẢNH BÁO: Đơn nạp này đã hết hạn hiệu lực chuyển khoản!</p>
          <p class="text-amber-300/90">
            Chỉ thực hiện duyệt đơn quá hạn khi bạn đã đối chiếu sao kê và chắc chắn tài khoản ngân hàng đã nhận được số tiền trên.
          </p>
        </AlertDescription>
      </Alert>

      <Alert v-if="actionType === 'approve'" class="border-cyan-500/30 bg-cyan-500/10 text-cyan-200">
        <Icon name="lucide:shield-check" class="h-4 w-4 text-cyan-400" />
        <AlertDescription class="leading-relaxed">
          Đảm bảo đã đối chiếu khớp số tiền <strong>{{ formatVndVi(topup.amountVnd) }}</strong> trên sao kê ngân hàng trước khi xác nhận. Thao tác này sẽ cộng <strong>{{ formatNumberVi(topup.credits) }} credit</strong> cho người dùng ngay lập tức và không thể hoàn tác.
        </AlertDescription>
      </Alert>

      <form class="space-y-4" @submit.prevent="handleSubmit">
        <div v-if="actionType === 'approve' || actionType === 'approve-expired'" class="space-y-1.5">
          <Label for="admin-bank-ref-input">Mã giao dịch ngân hàng (bank_ref) <span class="text-rose-400">*</span></Label>
          <p class="text-sm text-muted-foreground">Mã tham chiếu duy nhất từ thông báo biến động số dư hoặc sao kê.</p>
          <Input
            id="admin-bank-ref-input"
            ref="inputFieldRef"
            v-model="bankRef"
            data-testid="modal-bank-ref-input"
            type="text"
            maxlength="128"
            autofocus
            placeholder="Ví dụ: FT26305991820 hoặc VCB123456"
            :disabled="isSubmitting"
            @input="localErrorVi = null"
          />
        </div>

        <div v-else-if="actionType === 'reject'" class="space-y-1.5">
          <div class="flex items-center justify-between">
            <Label for="admin-reject-reason-input">Lý do từ chối <span class="text-rose-400">*</span></Label>
            <span class="text-sm text-muted-foreground">{{ rejectReason.length }} / 500</span>
          </div>
          <p class="text-sm text-muted-foreground">Lý do sẽ được hiển thị cho người dùng khi xem chi tiết đơn nạp.</p>
          <Textarea
            id="admin-reject-reason-input"
            ref="inputFieldRef"
            v-model="rejectReason"
            data-testid="modal-reject-reason-input"
            rows="3"
            maxlength="500"
            autofocus
            placeholder="Ví dụ: Không tìm thấy giao dịch chuyển khoản trên sao kê tài khoản ngân hàng."
            :disabled="isSubmitting"
            @input="localErrorVi = null"
          />
        </div>

        <div v-else-if="actionType === 'needs-review'" class="space-y-1.5">
          <div class="flex items-center justify-between">
            <Label for="admin-note-input">Ghi chú xem xét <span class="text-orange-400">*</span></Label>
            <span class="text-sm text-muted-foreground">{{ note.length }} / 500</span>
          </div>
          <p class="text-sm text-muted-foreground">Ghi chú nội bộ để các Admin khác nắm tình hình hoặc đối chiếu bổ sung.</p>
          <Textarea
            id="admin-note-input"
            ref="inputFieldRef"
            v-model="note"
            data-testid="modal-note-input"
            rows="3"
            maxlength="500"
            autofocus
            placeholder="Ví dụ: Số tiền chuyển bị thiếu hoặc nội dung chuyển sai mã đơn, đang liên hệ hỗ trợ."
            :disabled="isSubmitting"
            @input="localErrorVi = null"
          />
        </div>

        <Alert v-if="displayErrorVi" variant="destructive" role="alert" aria-live="polite" data-testid="modal-error-message">
          <Icon name="lucide:alert-circle" class="h-4 w-4" />
          <AlertDescription>{{ displayErrorVi }}</AlertDescription>
        </Alert>

        <div class="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" data-testid="modal-cancel-button" :disabled="isSubmitting" @click="handleClose">
            Hủy bỏ
          </Button>
          <Button type="submit" data-testid="modal-submit-button" :disabled="isSubmitting" :class="submitButtonClass">
            <Icon v-if="isSubmitting" name="lucide:loader-2" class="h-4 w-4 animate-spin" />
            <span>{{ isSubmitting ? 'Đang xử lý...' : submitButtonLabel }}</span>
          </Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>
</template>
