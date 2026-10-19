import React, { useEffect, useState } from 'react';
import { BriefcaseBusiness, FileUp } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { formatCurrencyAmount } from '../lib/instruments';
import { getDailyPnl, notifyPortfolioSnapshotChanged, PORTFOLIO_SNAPSHOT_CHANGED, type DailyPnlDay } from '../lib/daily-pnl';
import { DAILY_REVIEW_INPUTS_CHANGED } from '../lib/daily-review';
import { localDate } from '../lib/daily-notes';
import HoldingsImportDrawer from './HoldingsImportDrawer';

type MarketValuation = {
  category: string;
  value_by_currency: Record<string, number>;
  complete: boolean;
};

type PortfolioOverview = {
  snapshot_date: string | null;
  as_of: string;
  total_assets: { amount: number; currency: string; as_of?: string; stale?: boolean; estimated?: boolean } | null;
  holdings_market_value_by_currency: Record<string, number>;
  holdings_market_value_complete: boolean;
  holdings_market_value_estimated?: boolean;
  holding_pnl_by_currency: Record<string, number>;
  holding_pnl_complete: boolean;
  categories: MarketValuation[];
  positions_count: number;
  warnings: string[];
};

const MARKET_CARDS = [
  { category: 'CN', label: 'A-Shares' },
  { category: 'HK', label: 'HK' },
  { category: 'US', label: 'US' },
  { category: 'BITCOIN', label: 'BTC' },
];

function formatAmounts(amounts: Record<string, number>, signed = false): string {
  const entries = Object.entries(amounts);
  if (!entries.length) return '—';
  return entries.map(([currency, value]) => `${signed && value > 0 ? '+' : ''}${formatCurrencyAmount(value, currency)}`).join(' · ');
}

function daysBefore(dateText: string, count: number): string {
  const value = new Date(`${dateText}T00:00:00`);
  value.setDate(value.getDate() - count);
  return localDate(value);
}

export default function HoldingsSnapshotModule() {
  const asOf = localDate();
  const [overview, setOverview] = useState<PortfolioOverview | null>(null);
  const [dayPnl, setDayPnl] = useState<DailyPnlDay | undefined>();
  const [pnlLoading, setPnlLoading] = useState(true);
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
    const handleSnapshotChanged = () => setReloadToken(value => value + 1);
    window.addEventListener(DAILY_REVIEW_INPUTS_CHANGED, handleTradesChanged);
    window.addEventListener(PORTFOLIO_SNAPSHOT_CHANGED, handleSnapshotChanged);
    return () => {
      window.removeEventListener(DAILY_REVIEW_INPUTS_CHANGED, handleTradesChanged);
      window.removeEventListener(PORTFOLIO_SNAPSHOT_CHANGED, handleSnapshotChanged);
    };
  }, [asOf]);

  useEffect(() => {
    let active = true;
    setLoading(true); setPnlLoading(true); setError(''); setOverview(null);
    void apiRequest<PortfolioOverview>(`/api/today/portfolio/overview?as_of=${encodeURIComponent(asOf)}`)
      .then(overviewResult => { if (active) setOverview(overviewResult); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load portfolio overview.'); })
      .finally(() => { if (active) setLoading(false); });
    void getDailyPnl(daysBefore(asOf, 14), asOf)
      .then(pnlResult => { if (active) setDayPnl(pnlResult.days[pnlResult.days.length - 1]); })
      .catch(() => { if (active) setDayPnl(undefined); })
      .finally(() => { if (active) setPnlLoading(false); });
    return () => { active = false; };
  }, [asOf, reloadToken]);

  const dayPnlText = pnlLoading ? 'Calculating…' : dayPnl?.complete ? formatAmounts(dayPnl.pnl_by_currency, true) : '—';
  const holdingPnlAmounts = overview ? formatAmounts(overview.holding_pnl_by_currency, true) : '—';
  const holdingPnlText = holdingPnlAmounts === '—' ? '—' : `${holdingPnlAmounts}${overview?.holding_pnl_complete ? '' : ' · partial'}`;
  const portfolioValueText = overview?.total_assets
    ? formatCurrencyAmount(overview.total_assets.amount, overview.total_assets.currency)
    : overview && Object.keys(overview.holdings_market_value_by_currency).length
      ? `${overview.holdings_market_value_complete ? '' : 'Partial '}${formatAmounts(overview.holdings_market_value_by_currency)}`
      : '—';
  const categoryMap = new Map((overview?.categories || []).map(item => [item.category, item]));

  return <>
    <section className="rounded-xl border border-white bg-white/95 p-2.5 shadow-[0_4px_12px_rgba(11,37,69,0.03)]">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[13px] font-bold text-[#0B2545]"><BriefcaseBusiness size={14} className="text-[#EE6C4D]" /> Portfolio Overview</div>
        <button onClick={() => setImportOpen(true)} className="flex items-center gap-1 rounded-md bg-[#0B2545] px-2 py-1.5 text-[9px] font-bold text-white"><FileUp size={11} /> Import snapshot</button>
      </div>
      {loading ? <p className="py-3 text-[10px] text-slate-400">Loading portfolio…</p> : error ? <p role="alert" className="py-2 text-[10px] text-rose-600">{error}</p> : !overview?.snapshot_date ? <p className="rounded-lg bg-slate-50 p-3 text-[10px] leading-relaxed text-slate-500">Import a dated holdings snapshot to see your assets and daily P&amp;L here.</p> : <>
        <div className="rounded-xl bg-[#0B2545] px-2.5 py-2 text-white">
          <div className="flex items-center justify-between text-[9px] font-semibold text-white/65"><span>{overview.total_assets ? `TOTAL ASSETS${overview.total_assets.stale ? ' · LAST REPORTED' : overview.total_assets.estimated ? ' · EST.' : ''}` : 'HOLDINGS MARKET VALUE'}</span><span>{overview.total_assets?.as_of || overview.as_of}</span></div>
          <div className="mt-0.5 truncate font-mono text-[18px] font-bold leading-tight">{portfolioValueText}</div>
          <div className="mt-0.5 truncate text-[8px] text-white/55">Latest uploaded snapshot: {overview.snapshot_date}{overview.total_assets?.stale ? ' · Current valuation incomplete; showing the reported snapshot value.' : !overview.total_assets ? ' · Excludes unreported cash.' : ''}</div>
          <div className="mt-1.5 grid grid-cols-2 divide-x divide-white/10 border-t border-white/10 pt-1.5">
            <div className="min-w-0 pr-2">
              <div className="text-[8px] font-bold uppercase tracking-wide text-white/50">Daily P&amp;L{dayPnl?.date ? ` · ${dayPnl.date.slice(5)}` : ''}</div>
              <div className="mt-0.5 truncate font-mono text-[11px] font-bold">{dayPnlText}</div>
            </div>
            <div className="min-w-0 pl-2">
              <div className="text-[8px] font-bold uppercase tracking-wide text-white/50">Holding P&amp;L</div>
              <div className="mt-0.5 truncate font-mono text-[11px] font-bold">{holdingPnlText}</div>
            </div>
          </div>
          <div className="mt-1.5 border-t border-white/10 pt-1.5">
            <div className="mb-1 text-[7px] font-bold uppercase tracking-wider text-white/45">Latest market value</div>
            <div className="grid grid-cols-4 divide-x divide-white/10">
              {MARKET_CARDS.map(({ category, label }) => {
                const valuation = categoryMap.get(category);
                const amounts = formatAmounts(valuation?.value_by_currency || {});
                const value = amounts === '—' ? '—' : `${valuation?.complete ? '' : 'Partial '}${amounts}`;
                return <div key={category} className="min-w-0 px-1.5 first:pl-0 last:pr-0">
                  <div className="truncate text-[7px] font-semibold text-white/45">{label}</div>
                  <div title={value} className="mt-0.5 truncate font-mono text-[9px] font-bold text-white/90">{value}</div>
                </div>;
              })}
            </div>
          </div>
        </div>
        {importWarnings.slice(0, 3).map((warning, index) => <p key={`${index}-${warning}`} className="mt-1 rounded bg-amber-50 p-1.5 text-[9px] leading-relaxed text-amber-700">{warning}</p>)}
      </>}
    </section>
    <HoldingsImportDrawer open={importOpen} onClose={() => setImportOpen(false)} defaultDate={asOf} onImported={result => {
      setImportWarnings(result.warnings || []);
      notifyPortfolioSnapshotChanged(result.as_of);
    }} />
  </>;
}
