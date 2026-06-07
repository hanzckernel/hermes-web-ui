<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NModal, NForm, NFormItem, NInput, NButton, NSelect } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { VOICE_API_PRESETS } from '@/constants/voiceApiPresets'
import type { VoiceApiKind } from '@/types/voice-api'

const props = defineProps<{
  kind: VoiceApiKind
  show: boolean
}>()

const emit = defineEmits<{
  close: []
  saved: [payload: {
    preset: typeof VOICE_API_PRESETS[number]
    settings: Record<string, string>
    secrets: Record<string, string>
  }]
}>()

const { t } = useI18n()

const selectedPresetId = ref<string | null>(null)
const formData = ref({ baseUrl: '', apiKey: '', model: '' })

const presetOptions = computed(() =>
  VOICE_API_PRESETS
    .filter(p => p.kind === props.kind && !p.isBuiltin)
    .map(p => ({ label: p.label, value: p.id })),
)

const selectedPreset = computed(() =>
  VOICE_API_PRESETS.find(p => p.id === selectedPresetId.value) || null,
)

const canSave = computed(() => {
  if (!selectedPreset.value) return false
  if (selectedPreset.value.isSecretRequired && !formData.value.apiKey.trim()) return false
  if (selectedPreset.value.baseUrl !== undefined && !formData.value.baseUrl.trim()) return false
  if (selectedPreset.value.capabilities?.models && !formData.value.model.trim()) return false
  return true
})

watch(() => props.show, (show) => {
  if (show) resetForm()
})

function resetForm() {
  selectedPresetId.value = null
  formData.value = { baseUrl: '', apiKey: '', model: '' }
}

function handlePresetChange(id: string) {
  selectedPresetId.value = id
  const preset = VOICE_API_PRESETS.find(p => p.id === id)
  formData.value = {
    baseUrl: preset?.baseUrl || '',
    apiKey: '',
    model: preset?.defaultModel || '',
  }
}

function save() {
  if (!selectedPreset.value || !canSave.value) return
  emit('saved', {
    preset: selectedPreset.value,
    settings: {
      baseUrl: formData.value.baseUrl.trim(),
      model: formData.value.model.trim(),
    },
    secrets: formData.value.apiKey.trim() ? { apiKey: formData.value.apiKey.trim() } : {},
  })
}
</script>

<template>
  <NModal :show="show" preset="card" class="voice-api-form-modal" :title="t('settings.voice.addApiTitle')" @close="emit('close')">
    <NForm class="voice-api-form" label-placement="top">
      <NFormItem :label="t('settings.voice.provider')">
        <NSelect
          :value="selectedPresetId"
          :options="presetOptions"
          :placeholder="t('settings.voice.chooseProvider')"
          data-testid="voice-provider-select"
          @update:value="handlePresetChange"
        />
      </NFormItem>
      <NFormItem v-if="selectedPreset?.baseUrl !== undefined" :label="t('settings.voice.baseUrl')">
        <NInput v-model:value="formData.baseUrl" data-testid="voice-provider-base-url" />
      </NFormItem>
      <NFormItem v-if="selectedPreset?.isSecretRequired" :label="t('settings.voice.apiKey')">
        <NInput v-model:value="formData.apiKey" type="password" show-password-on="click" data-testid="voice-provider-api-key" />
      </NFormItem>
      <NFormItem v-if="selectedPreset?.capabilities?.models" :label="t('settings.voice.model')">
        <NInput v-model:value="formData.model" data-testid="voice-provider-model" />
      </NFormItem>
    </NForm>
    <template #footer>
      <div class="modal-actions">
        <NButton @click="emit('close')">{{ t('common.cancel') }}</NButton>
        <NButton type="primary" :disabled="!canSave" data-testid="voice-provider-save" @click="save">
          {{ t('common.save') }}
        </NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.voice-api-form { display: grid; gap: 12px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
