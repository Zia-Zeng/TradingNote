import React, { useEffect, useState } from 'react';
import { BriefcaseBusiness, FileUp } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { formatCurrencyAmount } from '../lib/instruments';
import { notifyPortfolioSnapshotChanged, type DailyPnlDay } from '../lib/daily-pnl';
import { DAILY_REVIEW_INPUTS_CHANGED } from '../lib/daily-review';
import HoldingsImportDrawer from './HoldingsImportDrawer';

type MarketValuation = {
  category: string;
  value_by_currency: Record<string, number>;
  complete: boolean;
};

type PortfolioOverview = {
  snapshot_date: string | null;
  as_of: string;
  total_assets: { amount: number; currency: string } | null;
  holding_pnl_by_currency: Record<string, number>;
  holding_pnl_complete: boolean;
  categories: MarketValuation[];
  positions_count: number;
  warnings: string[];
};

function formatAmounts(amounts: Record<string, number>, signed = false): string {
  const entries = Object.entries(amounts);
  if (!entries.length) return '—';
  return entries.map(([currency, value]) => `${signed && value > 0 ? '+' : ''}${formatCurrencyAmount(value, currency)}`).join(' · ');
}

export default function HoldingsSnapshotModule({ asOf, dayPnl, pnlLoading }: { asOf: string; dayPnl?: DailyPnlDay; pnlLoading: boolean }) {
  const [overview, setOverview] = useState<PortfolioOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const handleTradesChanged = (event: Event) => {
      const changedDate = (event as CustomEvent<{ date?: string }>).detail?.date;
      if (!changedDate || changedDate <= asOf) setReloadToken(value => value + 1);
    };
    window.addEventListener(DAILY_REVIEW_INPUTS_CHANGED, handleTradesChanged);
    return () => window.removeEventListener(DAILY_REVIEW_INPUTS_CHANGED, handleTradesChanged);
  }, [asOf]);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setOverview(null);
    apiRequest<PortfolioOverview>(`/api/today/portfolio/overview?as_of=${encodeURIComponent(asOf)}`)
      .then(result => { if (active) setOverview(result); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load portfolio overview.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [asOf, reloadToken]);

  const dayPnlText = pnlLoading ? 'Calculating…' : dayPnl?.complete ? formatAmounts(dayPnl.pnl_by_currency, true) : '—';
  const holdingPnlText = overview?.holding_pnl_complete ? formatAmounts(overview.holding_pnl_by_currency, true) : '—';

  return <>
    <section className="rounded-xl border border-white bg-white/95 p-3 shadow-[0_4px_12px_rgba(11,37,69,0.03)]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[13px] font-bold text-[#0B2545]"><BriefcaseBusiness size={14} className="text-[#EE6C4D]" /> Portfolio Overview</div>
        <button onClick={() => setImportOpen(true)} className="flex items-center gap-1 rounded-md bg-[#0B2545] px-2 py-1.5 text-[9px] font-bold text-white"><FileUp size={11} /> Import snapshot</button>
      </div>
      {loading ? <p className="py-3 text-[10px] text-slate-400">Loading portfolio…</p> : error ? <p role="alert" className="py-2 text-[10px] text-rose-600">{error}</p> : !overview?.snapshot_date ? <p className="rounded-lg bg-slate-50 p-3 text-[10px] leading-relaxed text-slate-500">Import a dated holdings snapshot to see your assets and daily P&amp;L here.</p> : <>
        <div className="rounded-xl bg-[#0B2545] px-3 py-2.5 text-white">
          <div className="flex items-center justify-between text-[9px] font-semibold text-white/65"><span>TOTAL ASSETS</span><span>{asOf}</span></div>
          <div className="mt-0.5 font-mono text-[20px] font-bold leading-tight">{overview.total_assets ? formatCurrencyAmount(overview.total_assets.amount, overview.total_assets.currency) : '—'}</div>
          <div className="mt-0.5 truncate text-[8px] text-white/55">Snapshot baseline: {overview.snapshot_date}{!overview.total_assets ? ' · Add total assets in the snapshot to show this figure.' : ''}</div>
          <div className="mt-2 grid grid-cols-2 divide-x divide-white/10 border-t border-white/10 pt-2">
            <div className="min-w-0 pr-2">
              <div className="text-[8px] font-bold uppercase tracking-wide text-white/50">Daily P&amp;L</div>
              <div className="mt-0.5 truncate font-mono text-[11px] font-bold">{dayPnlText}</div>
            </div>
            <div className="min-w-0 pl-2">
              <div className="text-[8px] font-bold uppercase tracking-wide text-white/50">Holding P&amp;L</div>
              <div className="mt-0.5 truncate font-mono text-[11px] font-bold">{holdingPnlText}</div>
            </div>
          </div>
        </div>
        {[...importWarnings, ...overview.warnings].slice(0, 3).map((warning, index) => <p key={`${index}-${warning}`} className="mt-1 rounded bg-amber-50 p-1.5 text-[9px] leading-relaxed text-amber-700">{warning}</p>)}
      </>}
    </section>
    <HoldingsImportDrawer open={importOpen} onClose={() => setImportOpen(false)} defaultDate={asOf} onImported={result => {
      setImportWarnings(result.warnings || []);
      setReloadToken(value => value + 1);
      notifyPortfolioSnapshotChanged();
    }} />
  </>;
}
