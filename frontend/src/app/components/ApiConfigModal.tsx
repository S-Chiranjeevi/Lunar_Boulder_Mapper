import { useState } from 'react';
import { Check, CheckCircle2, Copy, Globe, Loader2, PlugZap, RotateCcw, Server, X, XCircle } from 'lucide-react';
import {
  getConfiguredApiOrigin,
  getEnvApiOrigin,
  hasCustomApiOriginOverride,
  setConfiguredApiOrigin,
  testApiConnection,
  type ApiHealthStatus,
} from '../api/client';

interface ApiConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnected: () => void;
}

const API_ROUTES = [
  'POST /api/v1/images',
  'GET  /api/v1/images',
  'GET  /api/v1/images/{image_id}/preview',
  'POST /api/v1/jobs',
  'GET  /api/v1/jobs/{job_id}',
  'GET  /api/v1/jobs/{job_id}/results',
  'PATCH /api/v1/jobs/{job_id}/thresholds',
];

export function ApiConfigModal({ isOpen, onClose, onConnected }: ApiConfigModalProps) {
  const [originInput, setOriginInput] = useState<string>(() => getConfiguredApiOrigin());
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<ApiHealthStatus | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!isOpen) return null;

  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://lunar-zeta-seven.vercel.app';
  const corsValue = `${currentOrigin},http://localhost:5173`;

  async function handleTestAndSave(e: React.FormEvent) {
    e.preventDefault();
    setConfiguredApiOrigin(originInput);
    setTesting(true);
    setStatus(null);
    const result = await testApiConnection();
    setStatus(result);
    setTesting(false);
    if (result.ok) {
      onConnected();
    }
  }

  function handleReset() {
    const fallback = setConfiguredApiOrigin('');
    setOriginInput(fallback);
    setStatus(null);
    onConnected();
  }

  function copyText(key: string, value: string) {
    void navigator.clipboard?.writeText(value);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(null), 1600);
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="api-modal-title"
    >
      <div className="ms-panel w-full max-w-xl p-5 sm:p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto border-slate-700/80">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-sky-300">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h2 id="api-modal-title" className="text-base font-semibold text-slate-100">
                Connect FastAPI Backend
              </h2>
              <p className="text-xs text-slate-400">
                This Vercel deployment serves the website. Deploy the FastAPI service separately,
                then paste its base URL here (no trailing slash).
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800"
            aria-label="Close API setup"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleTestAndSave} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-xs">
            <span className="text-slate-300 font-medium">Backend API Origin URL</span>
            <div className="flex gap-2">
              <input
                type="url"
                value={originInput}
                onChange={(e) => setOriginInput(e.target.value)}
                placeholder="https://your-moonsafe-api.onrender.com (or http://127.0.0.1:8000)"
                className="ms-input font-mono text-xs flex-1"
              />
            </div>
            <span className="text-[11px] text-slate-400">
              Build-time default (<code>VITE_API_BASE_URL</code>):{' '}
              <code className="text-slate-300">{getEnvApiOrigin() || 'not set (same-origin)'}</code>
            </span>
            <span className="text-[11px] text-amber-200/90">
              The Vercel website host does not provide uploads or processing by itself. Use the
              separately hosted FastAPI origin below.
            </span>
          </label>

          {status && (
            <div
              className={`rounded-xl p-3 text-xs flex items-start gap-2 border ${
                status.ok
                  ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-200'
                  : 'bg-red-950/50 border-red-500/40 text-red-200'
              }`}
            >
              {status.ok ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              )}
              <div>
                <div className="font-medium">{status.message}</div>
                <div className="font-mono text-[11px] opacity-80 mt-0.5">{status.origin}</div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={testing} className="ms-btn-primary text-xs">
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlugZap className="w-3.5 h-3.5" />}
              <span>{testing ? 'Testing connection…' : 'Save & Test Connection'}</span>
            </button>
            {hasCustomApiOriginOverride() && (
              <button type="button" onClick={handleReset} className="ms-btn-secondary text-xs">
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset to Default</span>
              </button>
            )}
          </div>
        </form>

        <div className="border-t border-slate-800 pt-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
            <Globe className="w-4 h-4 text-sky-400" />
            <span>Environment Variables for Permanent Vercel Deployment</span>
          </div>

          <div className="ms-panel-elevated p-3 flex flex-col gap-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] text-slate-400">1. Vercel → Settings → Environment Variables</div>
                <code className="text-sky-300 font-mono text-[11px]">
                  VITE_API_BASE_URL = {originInput.trim() || 'https://your-fastapi-backend-host'}
                </code>
              </div>
              <button
                type="button"
                onClick={() => copyText('vercel', originInput.trim() || 'https://your-fastapi-backend-host')}
                className="ms-btn-secondary px-2.5 py-1 text-[11px]"
              >
                {copiedKey === 'vercel' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copiedKey === 'vercel' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-slate-800 pt-2">
              <div className="min-w-0">
                <div className="text-[11px] text-slate-400">2. FastAPI Backend → Environment Variable</div>
                <code className="text-emerald-300 font-mono text-[11px] break-all">
                  MOONSAFE_CORS_ORIGINS={corsValue}
                </code>
              </div>
              <button
                type="button"
                onClick={() => copyText('cors', corsValue)}
                className="ms-btn-secondary px-2.5 py-1 text-[11px] shrink-0"
              >
                {copiedKey === 'cors' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copiedKey === 'cors' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          <div>
            <div className="text-[11px] text-slate-400 mb-1.5">Supported MoonSafe REST API Routes</div>
            <div className="bg-[#06090f] border border-slate-800 rounded-lg p-2.5 font-mono text-[11px] text-slate-300 grid grid-cols-1 sm:grid-cols-2 gap-1">
              {API_ROUTES.map((route) => (
                <div key={route} className="truncate">
                  {route}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

