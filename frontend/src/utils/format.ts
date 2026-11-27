export function fmtSize(m: number | null): string {
  if (m == null) return 'unknown'
  return `${m.toFixed(2)} m`
}

export function fmtConf(c: number): string {
  return `${(c * 100).toFixed(1)}%`
}

export function fmtCoord(v: number, frame: string): string {
  return frame === 'lunar_local_m' ? `${v.toFixed(2)} m` : `${v.toFixed(0)} px`
}

export function countByClass(cells: { class: string }[]): Record<string, number> {
  return cells.reduce<Record<string, number>>((acc, c) => {
    acc[c.class] = (acc[c.class] ?? 0) + 1
    return acc
  }, {})
}
