/**
 * Persistent disclaimer shown at all times — this is a screening aid only.
 */
export function ScreeningBanner() {
  return (
    <div className="bg-amber-950/70 border-b border-amber-800 px-4 py-2 text-xs text-amber-300 text-center">
      ⚠ Screening aid only — results are illustrative and unvalidated. Do not
      use as a safety guarantee for mission planning.
    </div>
  )
}
