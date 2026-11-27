import { useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw, Sliders } from 'lucide-react';
import {
  ILLUSTRATIVE_PROFILES,
  type ThresholdProfile,
} from '../../app/types/contracts';
import type { ThresholdRecalcPayload } from './types';

interface ThresholdControlsPanelProps {
  activeProfile: ThresholdProfile;
  disabled: boolean;
  isUpdating: boolean;
  updateError: string | null;
  updateSuccess?: boolean;
  onApply: (payload: ThresholdRecalcPayload) => void;
}

export function ThresholdControlsPanel({
  activeProfile,
  disabled,
  isUpdating,
  updateError,
  updateSuccess = false,
  onApply,
}: ThresholdControlsPanelProps) {
  const [profile, setProfile] = useState<ThresholdProfile>(activeProfile);
  const [cellSizeM, setCellSizeM] = useState<number>(
    ILLUSTRATIVE_PROFILES[activeProfile].defaults.cell_size_m,
  );
  const [cautionSizeM, setCautionSizeM] = useState<number>(
    ILLUSTRATIVE_PROFILES[activeProfile].defaults.caution_boulder_size_m,
  );
  const [unsafeSizeM, setUnsafeSizeM] = useState<number>(
    ILLUSTRATIVE_PROFILES[activeProfile].defaults.unsafe_boulder_size_m,
  );
  const [cautionCount, setCautionCount] = useState<number>(
    ILLUSTRATIVE_PROFILES[activeProfile].defaults.caution_boulder_count,
  );
  const [unsafeCount, setUnsafeCount] = useState<number>(
    ILLUSTRATIVE_PROFILES[activeProfile].defaults.unsafe_boulder_count,
  );
  const [minCoverage, setMinCoverage] = useState<number>(
    ILLUSTRATIVE_PROFILES[activeProfile].defaults.min_cell_coverage,
  );

  useEffect(() => {
    setProfile(activeProfile);
  }, [activeProfile]);

  function handleProfileSelect(nextProfile: ThresholdProfile) {
    setProfile(nextProfile);
    const defaults = ILLUSTRATIVE_PROFILES[nextProfile].defaults;
    setCellSizeM(defaults.cell_size_m);
    setCautionSizeM(defaults.caution_boulder_size_m);
    setUnsafeSizeM(defaults.unsafe_boulder_size_m);
    setCautionCount(defaults.caution_boulder_count);
    setUnsafeCount(defaults.unsafe_boulder_count);
    setMinCoverage(defaults.min_cell_coverage);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const safeUnsafeSize = Math.max(cautionSizeM, unsafeSizeM);
    const safeUnsafeCount = Math.max(cautionCount, unsafeCount);
    setUnsafeSizeM(safeUnsafeSize);
    setUnsafeCount(safeUnsafeCount);

    onApply({
      threshold_profile: profile,
      thresholds: {
        cell_size_m: cellSizeM,
        caution_boulder_size_m: cautionSizeM,
        unsafe_boulder_size_m: safeUnsafeSize,
        caution_boulder_count: cautionCount,
        unsafe_boulder_count: safeUnsafeCount,
        min_valid_coverage: minCoverage,
      },
    });
  }

  return (
    <form onSubmit={handleSubmit} className="ms-panel p-4 flex flex-col gap-3 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-sky-400" />
          <h3 className="text-sm font-semibold text-slate-100">Screening Thresholds</h3>
        </div>
        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-amber-950/60 border border-amber-500/30 text-amber-200">
          illustrative
        </span>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {(['lander', 'rover', 'custom'] as ThresholdProfile[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => handleProfileSelect(p)}
            className={`px-2 py-1.5 rounded-lg border text-[11px] font-medium capitalize transition cursor-pointer ${
              profile === p
                ? 'bg-sky-950/70 border-sky-400/70 text-sky-200'
                : 'bg-slate-900/70 border-slate-700 text-slate-300 hover:border-slate-500'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-slate-400">Cell size (m)</span>
          <input
            type="number"
            min={0.5}
            step={0.5}
            value={cellSizeM}
            onChange={(e) => {
              setProfile('custom');
              setCellSizeM(Number(e.target.value));
            }}
            className="ms-input py-1 px-2 text-xs font-mono"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-slate-400">Min coverage</span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={minCoverage}
            onChange={(e) => {
              setProfile('custom');
              setMinCoverage(Number(e.target.value));
            }}
            className="ms-input py-1 px-2 text-xs font-mono"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-slate-400">Caution size (m)</span>
          <input
            type="number"
            min={0.05}
            step={0.05}
            value={cautionSizeM}
            onChange={(e) => {
              setProfile('custom');
              setCautionSizeM(Number(e.target.value));
            }}
            className="ms-input py-1 px-2 text-xs font-mono"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-slate-400">Unsafe size (m)</span>
          <input
            type="number"
            min={0.05}
            step={0.05}
            value={unsafeSizeM}
            onChange={(e) => {
              setProfile('custom');
              setUnsafeSizeM(Number(e.target.value));
            }}
            className="ms-input py-1 px-2 text-xs font-mono"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-slate-400">Caution count</span>
          <input
            type="number"
            min={0}
            step={1}
            value={cautionCount}
            onChange={(e) => {
              setProfile('custom');
              setCautionCount(Number(e.target.value));
            }}
            className="ms-input py-1 px-2 text-xs font-mono"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-slate-400">Unsafe count</span>
          <input
            type="number"
            min={0}
            step={1}
            value={unsafeCount}
            onChange={(e) => {
              setProfile('custom');
              setUnsafeCount(Number(e.target.value));
            }}
            className="ms-input py-1 px-2 text-xs font-mono"
          />
        </label>
      </div>

      {updateError && (
        <p role="alert" className="text-[11px] text-red-200 bg-red-950/50 border border-red-500/40 rounded-lg p-2">
          {updateError}
        </p>
      )}

      {updateSuccess && !updateError && (
        <p className="text-[11px] text-emerald-200 bg-emerald-950/40 border border-emerald-500/35 rounded-lg p-2 flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span>RiskGrid recalculated without rerunning YOLO.</span>
        </p>
      )}

      <button
        type="submit"
        disabled={disabled || isUpdating}
        className="ms-btn-primary text-xs w-full"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${isUpdating ? 'animate-spin' : ''}`} />
        <span>{isUpdating ? 'Recalculating RiskGrid…' : 'Recalculate RiskGrid'}</span>
      </button>

      <p className="text-[11px] text-slate-400 leading-relaxed">
        Recalculates RiskGrid from stored detections without rerunning detection. Values are
        unvalidated illustrative screening parameters only.
      </p>
    </form>
  );
}
