import { Crosshair, ShieldAlert } from 'lucide-react';
import type { SelectedMapFeature } from './types';

interface InspectionPanelProps {
  selected: SelectedMapFeature;
  onClear: () => void;
}

function fmtNum(val: number | null | undefined, unit: string, digits = 2): string {
  if (val === null || val === undefined || !Number.isFinite(val)) {
    return 'unavailable (null)';
  }
  return `${val.toFixed(digits)} ${unit}`;
}

export function InspectionPanel({ selected, onClear }: InspectionPanelProps) {
  if (!selected) {
    return (
      <section className="ms-panel p-4 flex flex-col gap-2 text-xs text-slate-400">
        <div className="flex items-center gap-2 text-slate-200">
          <Crosshair className="w-4 h-4 text-sky-400" />
          <h3 className="text-sm font-semibold">Feature Inspector</h3>
        </div>
        <p>Click any boulder detection box or RiskGrid cell on the 2D map to inspect details.</p>
      </section>
    );
  }

  if (selected.kind === 'detection') {
    const d = selected.detection;
    const pos = d.position;
    const unit = pos.frame === 'lunar_local_m' ? 'm' : 'px';
    const breakdown = pos.uncertainty_breakdown;

    return (
      <section className="ms-panel p-4 flex flex-col gap-3 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Crosshair className="w-4 h-4 text-sky-400" />
            <h3 className="text-sm font-semibold text-slate-100">Detection {d.detection_id}</h3>
          </div>
          <button type="button" onClick={onClear} className="text-[11px] text-slate-400 hover:text-slate-200">
            Clear
          </button>
        </div>

        <dl className="grid grid-cols-2 gap-y-1.5 gap-x-2">
          <dt className="text-slate-400">Confidence</dt>
          <dd className="font-mono text-right text-slate-100">{(d.confidence * 100).toFixed(1)}%</dd>

          <dt className="text-slate-400">Projected Size</dt>
          <dd className="font-mono text-right text-slate-100">{fmtNum(d.estimated_size_m, 'm')}</dd>

          <dt className="text-slate-400">Size Uncertainty</dt>
          <dd className="font-mono text-right text-slate-100">
            {d.size_uncertainty_m !== null ? `±${d.size_uncertainty_m.toFixed(2)} m` : 'unavailable (null)'}
          </dd>

          <dt className="text-slate-400">Coordinate Frame</dt>
          <dd className="font-mono text-right text-slate-100">{pos.frame}</dd>

          <dt className="text-slate-400">Position (X, Y)</dt>
          <dd className="font-mono text-right text-slate-100">
            {pos.x.toFixed(2)}, {pos.y.toFixed(2)} {unit}
          </dd>

          <dt className="text-slate-400">Position Uncertainty</dt>
          <dd className="font-mono text-right text-slate-100">
            {pos.uncertainty_m !== null ? `±${pos.uncertainty_m.toFixed(2)} m` : 'uncertain / null'}
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

          <dt className="text-slate-400">Model Version</dt>
          <dd className="font-mono text-right text-slate-300 truncate">{d.model_version}</dd>
        </dl>

        {pos.reason_codes && pos.reason_codes.length > 0 && (
          <div className="flex flex-col gap-1 pt-2 border-t border-slate-800">
            <span className="text-[11px] text-slate-400">Position Reason Codes</span>
            <div className="flex flex-wrap gap-1">
              {pos.reason_codes.map((code) => (
                <span
                  key={code}
                  className="px-1.5 py-0.5 rounded bg-purple-950/60 border border-purple-500/30 font-mono text-[10px] text-purple-200"
                >
                  {code}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  }

  const c = selected.cell;
  return (
    <section className="ms-panel p-4 flex flex-col gap-3 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-sky-400" />
          <h3 className="text-sm font-semibold text-slate-100">Cell {c.cell_id}</h3>
        </div>
        <button type="button" onClick={onClear} className="text-[11px] text-slate-400 hover:text-slate-200">
          Clear
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-y-1.5 gap-x-2">
        <dt className="text-slate-400">Risk Class</dt>
        <dd className="font-mono text-right uppercase font-semibold text-slate-100">{c.class}</dd>

        <dt className="text-slate-400">Boulder Count</dt>
        <dd className="font-mono text-right text-slate-100">{c.boulder_count}</dd>

        <dt className="text-slate-400">Max Projected Size</dt>
        <dd className="font-mono text-right text-slate-100">{fmtNum(c.max_size_m, 'm')}</dd>

        <dt className="text-slate-400">Coverage</dt>
        <dd className="font-mono text-right text-slate-100">{(c.coverage * 100).toFixed(1)}%</dd>

        <dt className="text-slate-400">Center (X, Y)</dt>
        <dd className="font-mono text-right text-slate-100">
          {c.x.toFixed(2)}, {c.y.toFixed(2)}
        </dd>

        {c.size_risk && c.density_risk && (
          <>
            <dt className="text-slate-400">Size / Density Risk</dt>
            <dd className="font-mono text-right text-slate-200">
              {c.size_risk} / {c.density_risk}
            </dd>
          </>
        )}
      </dl>

      <div className="flex flex-col gap-1 pt-2 border-t border-slate-800">
        <span className="text-[11px] text-slate-400">Risk Reason Codes</span>
        {c.reason_codes.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {c.reason_codes.map((code) => (
              <span
                key={code}
                className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-600 font-mono text-[10px] text-slate-200"
              >
                {code}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-[11px] text-slate-500">None</span>
        )}
      </div>
    </section>
  );
}
