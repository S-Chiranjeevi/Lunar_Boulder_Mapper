import { Layers, SlidersHorizontal } from 'lucide-react';
import type { RiskClass } from '../../app/types/contracts';
import type { MapLayerState } from './types';

interface LayerControlsProps {
  layers: MapLayerState;
  onChange: (next: MapLayerState) => void;
  detectionCount: number;
  cellCount: number;
}

const RISK_CLASS_LABELS: Array<{ key: RiskClass; label: string; dotClass: string }> = [
  { key: 'safe', label: 'Safe', dotClass: 'bg-emerald-400' },
  { key: 'caution', label: 'Caution', dotClass: 'bg-amber-400' },
  { key: 'unsafe', label: 'Unsafe', dotClass: 'bg-red-500' },
  { key: 'uncertain', label: 'Uncertain', dotClass: 'bg-purple-400' },
];

export function LayerControls({
  layers,
  onChange,
  detectionCount,
  cellCount,
}: LayerControlsProps) {
  function toggleRiskClass(cls: RiskClass) {
    onChange({
      ...layers,
      visibleRiskClasses: {
        ...layers.visibleRiskClasses,
        [cls]: !layers.visibleRiskClasses[cls],
      },
    });
  }

  return (
    <section className="ms-panel p-4 flex flex-col gap-3 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-sky-400" />
          <h3 className="text-sm font-semibold text-slate-100">Map Layers</h3>
        </div>
        <span className="font-mono text-[11px] text-slate-400">2D Authoritative</span>
      </div>

      <label className="flex items-center justify-between gap-2 cursor-pointer">
        <span className="text-slate-200">LRO NAC Image Overlay</span>
        <input
          type="checkbox"
          checked={layers.showImage}
          onChange={(e) => onChange({ ...layers, showImage: e.target.checked })}
          className="accent-sky-400"
        />
      </label>

      {layers.showImage && (
        <label className="flex items-center justify-between gap-3 text-[11px] text-slate-400 pl-2">
          <span>Opacity</span>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={layers.imageOpacity}
            onChange={(e) => onChange({ ...layers, imageOpacity: Number(e.target.value) })}
            className="w-28 accent-sky-400"
          />
        </label>
      )}

      <label className="flex items-center justify-between gap-2 cursor-pointer">
        <span className="text-slate-200">Detections ({detectionCount})</span>
        <input
          type="checkbox"
          checked={layers.showDetections}
          onChange={(e) => onChange({ ...layers, showDetections: e.target.checked })}
          className="accent-sky-400"
        />
      </label>

      {layers.showDetections && (
        <label className="flex items-center justify-between gap-3 text-[11px] text-slate-400 pl-2">
          <span>Min conf ({layers.minDetectionConfidence.toFixed(2)})</span>
          <input
            type="range"
            min={0}
            max={0.95}
            step={0.05}
            value={layers.minDetectionConfidence}
            onChange={(e) =>
              onChange({ ...layers, minDetectionConfidence: Number(e.target.value) })
            }
            className="w-28 accent-sky-400"
          />
        </label>
      )}

      <label className="flex items-center justify-between gap-2 cursor-pointer">
        <span className="text-slate-200">RiskGrid Cells ({cellCount})</span>
        <input
          type="checkbox"
          checked={layers.showRiskGrid}
          onChange={(e) => onChange({ ...layers, showRiskGrid: e.target.checked })}
          className="accent-sky-400"
        />
      </label>

      {layers.showRiskGrid && (
        <div className="flex flex-col gap-2 pl-2">
          <label className="flex items-center justify-between gap-3 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1">
              <SlidersHorizontal className="w-3 h-3" />
              Fill Opacity
            </span>
            <input
              type="range"
              min={0.1}
              max={0.9}
              step={0.05}
              value={layers.riskOpacity}
              onChange={(e) => onChange({ ...layers, riskOpacity: Number(e.target.value) })}
              className="w-28 accent-sky-400"
            />
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {RISK_CLASS_LABELS.map(({ key, label, dotClass }) => (
              <button
                key={key}
                type="button"
                onClick={() => toggleRiskClass(key)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] transition ${
                  layers.visibleRiskClasses[key]
                    ? 'bg-slate-800/80 border-slate-600 text-slate-100'
                    : 'bg-slate-950/50 border-slate-800 text-slate-500'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${dotClass}`} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
