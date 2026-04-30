// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const mockGetJob = vi.hoisted(() => vi.fn())
const mockJobsStore = vi.hoisted(() => ({
  createJob: vi.fn(),
  updateJob: vi.fn(),
  pauseJob: vi.fn(),
  resumeJob: vi.fn(),
  runJob: vi.fn(),
  deleteJob: vi.fn(),
}))
const mockMessage = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}))

vi.mock('@/api/hermes/jobs', async () => {
  const actual = await vi.importActual<typeof import('@/api/hermes/jobs')>('@/api/hermes/jobs')
  return {
    ...actual,
    getJob: mockGetJob,
  }
})

vi.mock('@/stores/hermes/jobs', () => ({
  useJobsStore: () => mockJobsStore,
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('naive-ui', () => ({
  NModal: { template: '<div><slot /><slot name="footer" /></div>' },
  NForm: { template: '<form><slot /></form>' },
  NFormItem: { template: '<label><slot /></label>' },
  NInput: { props: ['value'], emits: ['update:value'], template: '<input :value="value" />' },
  NInputNumber: { props: ['value'], emits: ['update:value'], template: '<input :value="value" />' },
  NSelect: { props: ['value', 'options'], emits: ['update:value'], template: '<select />' },
  NButton: { inheritAttrs: false, emits: ['click'], template: '<button @click="$emit(\'click\')"><slot /></button>' },
  useMessage: () => mockMessage,
}))

import {
  scheduleToDisplayText,
  scheduleToEditableInput,
  type JobSchedule,
} from '@/api/hermes/jobs'
import JobFormModal from '@/components/hermes/jobs/JobFormModal.vue'

describe('job schedule helpers', () => {
  it('maps structured schedules to editable strings without inventing invalid shapes', () => {
    const interval: JobSchedule = { kind: 'interval', minutes: 7200, display: 'every 7200m' }
    const cron: JobSchedule = { kind: 'cron', expr: '0 9 * * *', display: '0 9 * * *' }
    const once: JobSchedule = {
      kind: 'once',
      run_at: '2026-02-03T14:00:00+01:00',
      display: 'once at 2026-02-03 14:00',
    }

    expect(scheduleToEditableInput(interval)).toBe('every 7200m')
    expect(scheduleToEditableInput(cron)).toBe('0 9 * * *')
    expect(scheduleToEditableInput(once)).toBe('2026-02-03T14:00:00+01:00')
  })

  it('uses display text for non-cron structured schedules in cards', () => {
    expect(scheduleToDisplayText({ kind: 'interval', minutes: 7200, display: 'every 7200m' })).toBe('every 7200m')
    expect(scheduleToDisplayText({
      kind: 'once',
      run_at: '2026-02-03T14:00:00+01:00',
      display: 'once at 2026-02-03 14:00',
    })).toBe('once at 2026-02-03 14:00')
  })
})

describe('JobFormModal cron edit payload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockJobsStore.updateJob.mockResolvedValue({})
  })

  it('submits edited interval schedules as strings so the backend re-parses them', async () => {
    mockGetJob.mockResolvedValue({
      id: 'job-1',
      job_id: 'job-1',
      name: 'Interval job',
      schedule: { kind: 'interval', minutes: 7200, display: 'every 7200m' },
      schedule_display: 'every 7200m',
      prompt: 'ping',
      deliver: 'origin',
      repeat: { times: null, completed: 0 },
    })

    const wrapper = mount(JobFormModal, { props: { jobId: 'job-1' } })
    await flushPromises()

    const saveButton = wrapper.findAll('button').at(-1)
    expect(saveButton).toBeTruthy()
    await saveButton!.trigger('click')
    await flushPromises()

    expect(mockJobsStore.updateJob).toHaveBeenCalledOnce()
    const [, payload] = mockJobsStore.updateJob.mock.calls[0]
    expect(payload.schedule).toBe('every 7200m')
    expect(typeof payload.schedule).toBe('string')
    expect(payload).not.toEqual(expect.objectContaining({
      schedule: expect.objectContaining({ kind: 'interval', expr: 'every 7200m' }),
    }))
  })
})
