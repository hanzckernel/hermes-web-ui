import { request } from '../client'

export type JobSchedule =
  | string
  | { kind: 'interval'; minutes: number; display: string }
  | { kind: 'cron'; expr: string; display: string }
  | { kind: 'once'; run_at: string; display: string }

export function scheduleToEditableInput(schedule: JobSchedule, fallback = ''): string {
  if (typeof schedule === 'string') return schedule
  if (schedule.kind === 'cron') return schedule.expr
  if (schedule.kind === 'once') return schedule.run_at
  return schedule.display || fallback
}

export function scheduleToDisplayText(schedule: JobSchedule, fallback = '—'): string {
  if (typeof schedule === 'string') return schedule
  if (schedule.kind === 'cron') return schedule.expr || schedule.display || fallback
  return schedule.display || fallback
}

export interface Job {
  job_id: string
  id: string
  name: string
  prompt: string
  prompt_preview?: string
  skills: string[]
  skill: string | null
  model: string | null
  provider: string | null
  base_url: string | null
  script: string | null
  schedule: JobSchedule
  schedule_display: string
  repeat: string | { times: number | null; completed: number }
  enabled: boolean
  state: string
  paused_at: string | null
  paused_reason: string | null
  created_at: string
  next_run_at: string | null
  last_run_at: string | null
  last_status: string | null
  last_error: string | null
  deliver: string
  origin: {
    platform: string
    chat_id: string
    chat_name: string
    thread_id: string | null
  } | null
  last_delivery_error: string | null
}

export interface CreateJobRequest {
  name: string
  schedule: string
  prompt?: string
  deliver?: string
  skills?: string[]
  repeat?: number
}

export interface UpdateJobRequest {
  name?: string
  schedule?: string
  prompt?: string
  deliver?: string
  skills?: string[]
  skill?: string
  repeat?: number
  enabled?: boolean
  model?: string
  provider?: string
}

function unwrap(res: { job: Job }): Job {
  return res.job
}

export async function listJobs(): Promise<Job[]> {
  const res = await request<{ jobs: Job[] }>('/api/hermes/jobs?include_disabled=true')
  return res.jobs
}

export async function getJob(jobId: string): Promise<Job> {
  return unwrap(await request<{ job: Job }>(`/api/hermes/jobs/${jobId}`))
}

export async function createJob(data: CreateJobRequest): Promise<Job> {
  return unwrap(await request<{ job: Job }>('/api/hermes/jobs', {
    method: 'POST',
    body: JSON.stringify(data),
  }))
}

export async function updateJob(jobId: string, data: UpdateJobRequest): Promise<Job> {
  return unwrap(await request<{ job: Job }>(`/api/hermes/jobs/${jobId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }))
}

export async function deleteJob(jobId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/hermes/jobs/${jobId}`, {
    method: 'DELETE',
  })
}

export async function pauseJob(jobId: string): Promise<Job> {
  return unwrap(await request<{ job: Job }>(`/api/hermes/jobs/${jobId}/pause`, { method: 'POST' }))
}

export async function resumeJob(jobId: string): Promise<Job> {
  return unwrap(await request<{ job: Job }>(`/api/hermes/jobs/${jobId}/resume`, { method: 'POST' }))
}

export async function runJob(jobId: string): Promise<Job> {
  return unwrap(await request<{ job: Job }>(`/api/hermes/jobs/${jobId}/run`, { method: 'POST' }))
}
