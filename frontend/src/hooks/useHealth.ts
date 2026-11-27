import { useEffect, useState } from 'react'
import { getHealth } from '../api/client'
import type { HealthResponse } from '../types/api'

export function useHealth() {
  const [health, setHealth] = useState<HealthResponse | null>(null)

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch(() => setHealth(null))
  }, [])

  return health
}
