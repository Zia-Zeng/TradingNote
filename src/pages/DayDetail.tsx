import React from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Clock, MessageCircle, Sparkles, ArrowRight } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  AssetClass, VERDICT_META, formatPrice, formatSigned, getDayStats, getTradingDay,
} from '../lib/tradingCalendar';

const ASSET_TAG: Record<AssetClass, string> = {
  Stock: 'text-[#0B2545] border-[#0B2545]/20 bg-[#0B2545]/5',
  ETF: 'text-[#0B2545] border-[#0B2545]/20 bg-[#0B2545]/5',
  Bond: 'text-emerald-600 border-emerald-200 bg-emerald-50',
  Crypto: 'text-purple-600 border-purple-200 bg-purple-50',
};

const formatAmount = (asset: AssetClass, value: number) => {
  const n = value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return asset === 'Crypto' ? `${n} USDT` : `¥ ${n}`;
};

export default function DayDetail() {
  const { date = '' } = useParams();
  const navigate = useNavigate();
  const day = getTradingDay(date);
  const stats = getDayStats(date);

  if (!day || !stats) return <Navigate to="/" replace />;

  const [y, m, d] = date.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const title = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const weekday = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
  const isProfit = stats.pnl >= 0;
  const trades = [...day.trades].sort((a, b) => a.time.localeCompare(b.time));

  return (
    <div className="w-full min-h-full pb-[40px] bg-[#F4F5F7] font-sans text-slate-900">
      <div className="flex items-center justify-between px-3 pt-[54px] pb-2 bg-white sticky top-0 z-30 shadow-sm border-b border-slate-100">
        <button onClick={() => navigate('/')} aria-label="Back to Home" className="p-2 -ml-2 text-slate-700 active:bg-slate-100 rounded-full transition-colors">
          <ChevronLeft size={20} />
        </button>
        <div className="flex flex-col items-center">
          <h1 className="text-[14px] font-bold text-[#0B2545] tracking-tight">{title}</h1>
          <span className="text-[9px] text-slate-400 font-medium mt-0.5">{weekday} • {trades.length} trades</span>
        </div>
        <div className="w-9" />
      </div>

      {/* Day summary */}
      <div className="bg-white px-3 py-3 mb-1 shadow-sm">
        <div className="text-slate-500 text-[9px] font-medium mb-0.5 uppercase tracking-wider">Day PnL (CNY)</div>
        <div className="flex justify-between items-end mb-3">
          <div className={cn('text-[26px] font-bold font-mono tracking-tight leading-none', isProfit ? 'text-emerald-500' : 'text-rose-500')}>
            {formatSigned(stats.pnl, 2)}
          </div>
          <div className={cn(
            'text-[11px] font-bold font-mono px-1.5 py-1 rounded text-white leading-none',
            isProfit ? 'bg-emerald-500' : 'bg-rose-500'
          )}>
            {formatSigned(stats.returnPct, 2)}%
          </div>
        </div>
        <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-2 rounded-lg border border-slate-100 text-[10px]">
          <div className="flex-1 min-w-0">
            <div className="text-slate-400 text-[8px] uppercase tracking-wider mb-0.5">Start of day</div>
            <div className="font-bold font-mono text-[#134074] truncate">¥ {stats.start.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
          </div>
          <ArrowRight size={12} className="text-slate-300 shrink-0" />
          <div className="flex-1 min-w-0 text-right">
            <div className="text-slate-400 text-[8px] uppercase tracking-wider mb-0.5">End of day</div>
            <div className="font-bold font-mono text-[#134074] truncate">¥ {stats.end.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
          </div>
        </div>
      </div>

      {/* Trade timeline */}
      <div className="bg-white px-3 py-3 mb-1 shadow-sm">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-[12px] font-bold text-[#0B2545] flex items-center gap-1">
            <Clock size={12} className="text-[#EE6C4D]" />
            Trades
          </h2>
          <span className="text-[8px] text-slate-400 font-medium bg-slate-50 px-1 py-0.5 rounded border border-slate-100 uppercase">By time</span>
        </div>

        <ol className="relative">
          {trades.map((t, idx) => {
            const change = ((t.close - t.price) / t.price) * 100;
            return (
              <li key={`${t.time}-${t.symbol}`} className="relative flex gap-2 pb-3 last:pb-0">
                <div className="w-[34px] shrink-0 pt-[7px] text-[10px] font-bold font-mono text-[#0B2545] leading-none">{t.time}</div>
                <div className="relative w-2 shrink-0 flex justify-center">
                  {idx < trades.length - 1 && <div className="absolute top-[12px] bottom-[-12px] w-px bg-slate-200" />}
                  <div className={cn(
                    'relative mt-[5px] w-2 h-2 rounded-full bg-white border-2',
                    t.side === 'Buy' ? 'border-[#0B2545]' : 'border-[#EE6C4D]'
                  )} />
                </div>

                <div className="flex-1 min-w-0 bg-slate-50/60 border border-slate-100 rounded-lg p-2">
                  <div className="flex items-center justify-between gap-1 mb-1.5">
                    <div className="flex items-center gap-1 min-w-0">
                      <span className={cn(
                        'px-1 py-0.5 rounded text-[9px] font-bold border shrink-0',
                        t.side === 'Buy' ? 'bg-[#0B2545]/10 text-[#0B2545] border-[#0B2545]/20' : 'bg-[#EE6C4D]/10 text-[#EE6C4D] border-[#EE6C4D]/20'
                      )}>{t.side}</span>
                      <span className="font-bold text-[#0B2545] text-[12px] truncate">{t.symbol}</span>
                      <span className="text-[9px] text-slate-400 font-mono shrink-0">{t.code}</span>
                    </div>
                    <span className={cn('text-[8px] font-bold px-1 py-0.5 rounded border shrink-0', ASSET_TAG[t.asset])}>{t.asset}</span>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5 mb-2">
                    <div className="min-w-0">
                      <div className="text-slate-400 uppercase text-[7px] tracking-wide mb-0.5">Price × Qty</div>
                      <div className="font-mono text-[10px] text-[#0B2545] font-bold truncate">{formatPrice(t.asset, t.price)} × {t.qty.toLocaleString('en-US')}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-slate-400 uppercase text-[7px] tracking-wide mb-0.5">Amount</div>
                      <div className="font-mono text-[10px] text-[#0B2545] font-bold truncate">{formatAmount(t.asset, t.price * t.qty)}</div>
                    </div>
                    <div className="min-w-0 text-right">
                      <div className="text-slate-400 uppercase text-[7px] tracking-wide mb-0.5">Close vs fill</div>
                      <div className={cn('font-mono text-[10px] font-bold truncate', change >= 0 ? 'text-emerald-500' : 'text-rose-500')}>
                        {formatSigned(change, 2)}%
                      </div>
                    </div>
                  </div>

                  <div className="bg-white border border-slate-100 rounded-md px-2 py-1.5 flex gap-1.5">
                    <MessageCircle size={10} className="text-[#EE6C4D] shrink-0 mt-[2px]" />
                    <p className="text-[10px] text-slate-600 leading-relaxed">{t.note}</p>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* AI TradingNote */}
      <div className="bg-white px-3 py-3 mb-6 shadow-sm">
        <div className="flex justify-between items-center mb-1">
          <h2 className="text-[12px] font-bold text-[#0B2545] flex items-center gap-1">
            <Sparkles size={12} className="text-[#EE6C4D]" />
            AI TradingNote
          </h2>
          <span className="text-[8px] text-slate-400 font-medium bg-slate-50 px-1 py-0.5 rounded border border-slate-100 uppercase">
            Post-trade review
          </span>
        </div>
        <p className="text-[9px] text-slate-400 mb-3">Compares each note with what the price did after the trade.</p>

        <p className="text-[11px] text-[#134074] leading-relaxed font-medium mb-3">{day.aiSummary}</p>

        <div className="space-y-2.5 mb-3">
          {trades.map(t => {
            const v = VERDICT_META[t.verdict];
            return (
              <div key={`ai-${t.time}-${t.symbol}`} className="border-l-2 border-slate-100 pl-2">
                <div className="flex items-center justify-between gap-1 mb-0.5">
                  <span className="text-[11px] font-bold text-[#0B2545] truncate">
                    {t.symbol} <span className="text-slate-400 font-mono font-medium text-[9px]">{t.time}</span>
                  </span>
                  <span className={cn('text-[8px] font-bold px-1 py-0.5 rounded border shrink-0', v.className)}>{v.label}</span>
                </div>
                <p className="text-[10px] text-slate-600 leading-relaxed">{t.aiRead}</p>
              </div>
            );
          })}
        </div>

        <div className="bg-[#EE6C4D]/5 border border-[#EE6C4D]/20 rounded-xl p-2.5">
          <div className="flex items-center gap-1 text-[11px] font-bold mb-1 text-[#EE6C4D]">
            <Sparkles size={11} /> Next session
          </div>
          <p className="text-[10px] text-[#134074] leading-relaxed">{day.aiNext}</p>
        </div>
      </div>
    </div>
  );
}
