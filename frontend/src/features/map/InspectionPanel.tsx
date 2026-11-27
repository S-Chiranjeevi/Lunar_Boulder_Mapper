import { Crosshair, ShieldAlert, X } from 'lucide-react';
import type { SelectedMapFeature } from './types';

interface InspectionPanelProps {
  selected: SelectedMapFeature;
  onClear: () => void;
}

function fmtNum(val: number | null | undefined, unit: string, digits = 2): string {
  if (val === null || val === undefined || !Number.isFinite(val)) {
    return 'N/A (null)';
  }
  return `${val.toFixed(digits)} ${unit}`;
}

export function InspectionPanel({ selected, onClear }: InspectionPanelProps) {
  if (!selected) {
    return (
      <section className="ms-panel-elevated p-3.5 flex flex-col gap-1.5 text-xs text-slate-400">
        <div className="flex items-center gap-2 text-slate-200">
          <Crosshair className="w-3.5 h-3.5 text-sky-400" />
          <h3 className="text-xs font-semibold uppercase tracking-wider">
            Target Telemetry Inspector
          </h3>
        </div>
        <p className="text-[11px] leading-relaxed">
          Click any detected boulder box or RiskGrid cell on the Leaflet map to inspect telemetry,
          confidence, uncertainty, and hazard verdict.
        </p>
      </section>
    );
  }

  if (selected.kind === 'detection') {
    const d = selected.detection;
    const pos = d.position;
    const unit = pos.frame === 'lunar_local_m' ? 'm' : 'px';
    const breakdown = pos.uncertainty_breakdown;
    const confPct = Math.max(0, Math.min(100, d.confidence * 100));

    const verdict = pos.uncertain
      ? { label: 'UNCERTAIN LOC', cls: 'bg-violet-500/20 border-violet-400/50 text-violet-200' }
      : d.estimated_size_m !== null && d.estimated_size_m >= 1.0
        ? { label: 'HIGH HAZARD', cls: 'bg-red-500/20 border-red-400/50 text-red-200' }
        : d.estimated_size_m !== null && d.estimated_size_m >= 0.5
          ? { label: 'CAUTION', cls: 'bg-amber-500/20 border-amber-400/50 text-amber-200' }
          : { label: 'NOMINAL', cls: 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200' };

    return (
      <section className="ms-panel-elevated p-3.5 flex flex-col gap-3 text-xs hud-animate-in hud-reticle">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Crosshair className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <h3 className="text-xs font-mono font-semibold text-slate-100 truncate">
              {d.detection_id}
            </h3>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`px-2 py-0.5 rounded border font-mono text-[10px] ${verdict.cls}`}>
              {verdict.label}
            </span>
            <button
              type="button"
              onClick={onClear}
              aria-label="Clear selected feature"
              className="text-slate-400 hover:text-slate-100 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Confidence Meter */}
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-400">Detection Confidence</span>
            <span className="font-mono text-sky-300 font-semibold">{confPct.toFixed(1)}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-500 to-cyan-300 transition-all duration-300"
              style={{ width: `${confPct}%` }}
            />
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-y-1.5 gap-x-2 text-[11px]">
          <dt className="text-slate-400">Projected Diameter</dt>
          <dd className="font-mono text-right text-slate-100">
            {fmtNum(d.estimated_size_m, 'm')}
            {d.size_uncertainty_m !== null ? ` ±${d.size_uncertainty_m.toFixed(2)}` : ''}
          </dd>

          <dt className="text-slate-400">Est. Shadow Height</dt>
          <dd className="font-mono text-right text-slate-400" title="3D height is never invented from 2D imagery">
            N/A (2D image only)
          </dd>

          <dt className="text-slate-400">Coordinate Frame</dt>
          <dd className="font-mono text-right text-sky-300">{pos.frame}</dd>

          <dt className="text-slate-400">Position (X, Y)</dt>
          <dd className="font-mono text-right text-slate-100">
            {pos.x.toFixed(2)}, {pos.y.toFixed(2)} {unit}
          </dd>

          <dt className="text-slate-400">Total Pos. Error</dt>
          <dd className="font-mono text-right text-slate-100">
            {pos.uncertainty_m !== null ? `±${pos.uncertainty_m.toFixed(2)} m` : 'uncertain'}
          </dd>

          {breakdown && (
            <>
              <dt className="text-slate-400">Model Loc. Error</dt>
              <dd className="font-mono text-right text-slate-200">
                {fmtNum(breakdown.model_localization_m, 'm')}
              </dd>
              <dt className="text-slate-400">Georef. Uncertainty</dt>
              <dd className="font-mono text-right text-slate-200">
                {fmtNum(breakdown.georeferencing_m, 'm')}
              </dd>
            </>
          )}
        </dl>

        {pos.reason_codes && pos.reason_codes.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-2 border-t border-slate-800/80">
            {pos.reason_codes.map((code) => (
              <span
                key={code}
                className="px-1.5 py-0.5 rounded bg-violet-950/60 border border-violet-500/35 font-mono text-[10px] text-violet-200"
              >
                {code}
              </span>
            ))}
          </div>
        )}
      </section>
    );
  }

  const c = selected.cell;
  const badgeCls =
    c.class === 'unsafe'
      ? 'bg-red-500/20 border-red-400/50 text-red-200'
      : c.class === 'caution'
        ? 'bg-amber-500/20 border-amber-400/50 text-amber-200'
        : c.class === 'uncertain'
          ? 'bg-violet-500/20 border-violet-400/50 text-violet-200'
          : 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200';

  return (
    <section className="ms-panel-elevated p-3.5 flex flex-col gap-3 text-xs hud-animate-in hud-reticle">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <ShieldAlert className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <h3 className="text-xs font-mono font-semibold text-slate-100 truncate">{c.cell_id}</h3>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`px-2 py-0.5 rounded border font-mono text-[10px] uppercase ${badgeCls}`}>
            {c.class}
          </span>
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear selected cell"
            className="text-slate-400 hover:text-slate-100 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-y-1.5 gap-x-2 text-[11px]">
        <dt className="text-slate-400">Boulder Count</dt>
        <dd className="font-mono text-right text-slate-100">{c.boulder_count}</dd>

        <dt className="text-slate-400">Max Projected Size</dt>
        <dd className="font-mono text-right text-slate-100">{fmtNum(c.max_size_m, 'm')}</dd>

        <dt className="text-slate-400">Est. Shadow Height</dt>
        <dd className="font-mono text-right text-slate-400">N/A (2D image only)</dd>

        <dt className="text-slate-400">Cell Coverage</dt>
        <dd className="font-mono text-right text-slate-100">{(c.coverage * 100).toFixed(1)}%</dd>

        <dt className="text-slate-400">Cell Center</dt>
        <dd className="font-mono text-right text-slate-100">
          {c.x.toFixed(1)}, {c.y.toFixed(1)}
        </dd>
      </dl>

      <div className="flex flex-col gap-1 pt-2 border-t border-slate-800/80">
        <span className="text-[10px] uppercase tracking-wider text-slate-400">Reason Codes</span>
        {c.reason_codes.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {c.reason_codes.map((code) => (
              <span
                key={code}
                className="px-1.5 py-0.5 rounded bg-slate-800/90 border border-slate-600/80 font-mono text-[10px] text-slate-200"
              >
                {code}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-[11px] text-slate-500">All nominal thresholds satisfied</span>
        )}
      </div>
    </section>
  );
}
