import React, { useMemo, useState } from 'react';
import { BriefcaseBusiness, FileUp } from 'lucide-react';
import { formatCurrencyAmount } from '../lib/instruments';
import { localDate } from '../lib/daily-notes';
import type { DailyPnlDay, DailyPnlResult } from '../lib/daily-pnl';
import AssetHistoryImportDrawer from './AssetHistoryImportDrawer';

function formatAmounts(amounts: Record<string, number> | undefined, signed = false): string {
  const entries = Object.entries(amounts || {}).filter(([, value]) => Number.isFinite(value));
  if (!entries.length) return '—';
  return entries.map(([currency, value]) => `${signed && value > 0 ? '+' : ''}${formatCurrencyAmount(value, currency)}`).join(' · ');
}

function AmountList({ amounts, signed = false, title, singleClassName, multipleClassName }: {
  amounts: Record<string, number> | undefined;
  signed?: boolean;
  title: string;
  singleClassName: string;
  multipleClassName: string;
}) {
  const entries = Object.entries(amounts || {}).filter(([, value]) => Number.isFinite(value));
  if (!entries.length) return <span className={singleClassName}>—</span>;
  const multiple = entries.length > 1;
  return <span title={title} aria-label={title} className={multiple ? 'flex min-w-0 flex-col gap-px leading-[1.05]' : 'block min-w-0 truncate'}>
    {entries.map(([currency, value]) => <span key={currency} className={`${multiple ? multipleClassName : singleClassName} ${multiple ? 'block truncate' : 'truncate'} ${signed ? value > 0 ? 'text-emerald-600' : value < 0 ? 'text-rose-600' : 'text-[#0B2545]' : ''}`}>
      {multiple && <span className="mr-1 font-sans text-[0.85em] opacity-75">{currency.toUpperCase()}</span>}
      {signed && value > 0 ? '+' : ''}{formatCurrencyAmount(value, currency)}
    </span>)}
  </span>;
}

function pnlTone(amounts: Record<string, number> | undefined): string {
  const signs = Object.values(amounts || {}).filter(Number.isFinite).map(value => Math.sign(value)).filter(Boolean);
  if (!signs.length || (signs.some(value => value > 0) && signs.some(value => value < 0))) return 'text-[#0B2545]';
  return signs[0] > 0 ? 'text-emerald-600' : 'text-rose-600';
}

function mostRecentSession(days: DailyPnlDay[], asOf: string): DailyPnlDay | undefined {
  return [...days].reverse().find(day => day.date <= asOf && day.complete && day.daily_state?.complete);
}

function sumMonth(days: DailyPnlDay[], month: string, asOf: string): { amounts: Record<string, number>; complete: boolean } {
  const monthDays = days.filter(day => day.date.startsWith(`${month}-`) && day.date <= asOf);
  const completeDays = monthDays.filter(day => day.complete);
  const amounts: Record<string, number> = {};
  for (const day of completeDays) {
    for (const [currency, value] of Object.entries(day.pnl_by_currency || {})) {
      amounts[currency] = (amounts[currency] || 0) + value;
    }
  }
  return { amounts, complete: monthDays.length > 0 && completeDays.length === monthDays.length };
}

export default function HoldingsSnapshotModule({ pnl, loading, error }: {
  pnl: DailyPnlResult | null;
  loading: boolean;
  error: string;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const asOf = localDate();
  const latestDay = useMemo(() => mostRecentSession(pnl?.days || [], asOf), [pnl, asOf]);
  const state = latestDay?.daily_state;
  const monthPnl = useMemo(() => sumMonth(pnl?.days || [], asOf.slice(0, 7), asOf), [pnl, asOf]);
  const positionValue = formatAmounts(state?.holdings_market_value_by_currency);
  const dailyValue = latestDay?.complete ? formatAmounts(latestDay.pnl_by_currency, true) : '—';
  const monthValue = monthPnl.complete ? formatAmounts(monthPnl.amounts, true) : '—';
  const holdingValue = state?.complete ? formatAmounts(state.holding_pnl_by_currency, true) : '—';
  const hasPortfolioHistory = Boolean(pnl?.baseline_date);

  return <>
    <section className="rounded-xl border border-slate-100 bg-white p-3 shadow-[0_4px_16px_rgba(11,37,69,0.05)]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[13px] font-bold text-[#0B2545]"><BriefcaseBusiness size={14} className="text-[#EE6C4D]" /> Portfolio Overview</div>
        <button onClick={() => setImportOpen(true)} className="flex shrink-0 items-center gap-1 rounded-md bg-[#0B2545] px-2 py-1.5 text-[9px] font-bold text-white"><FileUp size={11} /> Import asset history</button>
      </div>

      {loading ? <p className="py-3 text-[10px] text-slate-400">Calculating portfolio…</p> : error ? <p role="alert" className="py-2 text-[10px] text-rose-600">{error}</p> : !hasPortfolioHistory ? <p className="rounded-lg bg-slate-50 p-3 text-[10px] leading-relaxed text-slate-500">Choose a security and import its complete trade history. The ledger will be saved and used to calculate open positions and P&amp;L.</p> : <>
        <div className="flex items-end justify-between gap-2 border-b border-slate-100 pb-1">
          <div className="min-w-0">
            <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Position Market Value</div>
            <div className="mt-0.5 min-w-0 font-mono font-bold leading-tight text-[#0B2545]">
              <AmountList amounts={state?.holdings_market_value_by_currency} title={positionValue} singleClassName="block truncate text-[22px]" multipleClassName="text-[15px]" />
            </div>
          </div>
          <span className="shrink-0 pb-0.5 text-[8px] font-mono text-slate-400">{latestDay?.date || asOf}</span>
        </div>
        <div className="grid grid-cols-3 gap-2 pt-1">
          <div className="min-w-0">
            <div className="text-[8px] font-bold uppercase tracking-wide text-slate-400">Daily P&amp;L · {latestDay?.date.slice(5) || '—'}</div>
            <div className={`mt-0.5 min-w-0 font-mono font-bold ${latestDay?.complete ? pnlTone(latestDay.pnl_by_currency) : 'text-slate-400'}`}>
              <AmountList amounts={latestDay?.complete ? latestDay.pnl_by_currency : undefined} signed title={dailyValue} singleClassName="block truncate text-[10px]" multipleClassName="text-[8px]" />
            </div>
          </div>
          <div className="min-w-0 border-l border-slate-100 pl-2">
            <div className="text-[8px] font-bold uppercase tracking-wide text-slate-400">Month P&amp;L</div>
            <div className={`mt-0.5 min-w-0 font-mono font-bold ${monthPnl.complete ? pnlTone(monthPnl.amounts) : 'text-slate-400'}`}>
              <AmountList amounts={monthPnl.complete ? monthPnl.amounts : undefined} signed title={monthValue} singleClassName="block truncate text-[10px]" multipleClassName="text-[8px]" />
            </div>
          </div>
          <div className="min-w-0 border-l border-slate-100 pl-2">
            <div className="text-[8px] font-bold uppercase tracking-wide text-slate-400">Holding P&amp;L</div>
            <div className={`mt-0.5 min-w-0 font-mono font-bold ${state?.complete ? pnlTone(state.holding_pnl_by_currency) : 'text-slate-400'}`}>
              <AmountList amounts={state?.complete ? state.holding_pnl_by_currency : undefined} signed title={holdingValue} singleClassName="block truncate text-[10px]" multipleClassName="text-[8px]" />
            </div>
          </div>
        </div>
      </>}
    </section>
    <AssetHistoryImportDrawer open={importOpen} onClose={() => setImportOpen(false)} />
  </>;
}
