/**
 * Poll GET /jobs/{job_id} until the job reaches a terminal state.
 * Returns the latest JobStatusResponse and a cancel function.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { getJobStatus } from '../api/client'
import type { JobStatusResponse } from '../types/api'

const TERMINAL = new Set(['completed', 'failed'])
const POLL_MS = 1500

export function useJobPoller(jobId: string | null) {
  const [status, setStatus] = useState<JobStatusResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeRef = useRef(true)

  const cancel = useCallback(() => {
    activeRef.current = false
    if (timerRef.current != null) clearTimeout(timerRef.current)
  }, [])

  useEffect(() => {
    if (!jobId) return
    activeRef.current = true

    async function poll() {
      if (!activeRef.current || !jobId) return
      try {
        const s = await getJobStatus(jobId)
        if (!activeRef.current) return
        setStatus(s)
        if (!TERMINAL.has(s.status)) {
          timerRef.current = setTimeout(poll, POLL_MS)
        }
      } catch (err: unknown) {
        if (!activeRef.current) return
        setError(err instanceof Error ? err.message : 'Polling failed')
      }
    }

    poll()

    return () => {
      activeRef.current = false
      if (timerRef.current != null) clearTimeout(timerRef.current)
    }
  }, [jobId])

  return { status, error, cancel }
}
