import React from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import {
  CALENDAR_MONTH, CALENDAR_YEAR, MOCK_TODAY, formatSigned, getTradingDay, toDateKey, tradingDays,
} from '../lib/tradingCalendar';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const PROFIT_LEVELS = ['bg-emerald-50 text-emerald-700', 'bg-emerald-100 text-emerald-700', 'bg-emerald-200 text-emerald-800', 'bg-emerald-500 text-white'];
const LOSS_LEVELS = ['bg-rose-50 text-rose-700', 'bg-rose-100 text-rose-700', 'bg-rose-200 text-rose-800', 'bg-rose-500 text-white'];

const compact = (v: number) => {
  if (Math.abs(v) < 1000) return formatSigned(v);
  return `${v >= 0 ? '+' : '-'}${(Math.abs(v) / 1000).toFixed(1)}k`;
};

export default function TradingCalendar() {
  const navigate = useNavigate();
  const monthDate = new Date(CALENDAR_YEAR, CALENDAR_MONTH, 1);
  const leadingBlanks = (monthDate.getDay() + 6) % 7;
  const daysInMonth = new Date(CALENDAR_YEAR, CALENDAR_MONTH + 1, 0).getDate();
  const monthLabel = monthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const monthShort = monthDate.toLocaleDateString('en-US', { month: 'short' });

  const maxAbs = Math.max(...tradingDays.map(d => Math.abs(d.pnl)));
  const monthPnl = tradingDays.reduce((sum, d) => sum + d.pnl, 0);
  const winDays = tradingDays.filter(d => d.pnl > 0).length;
  const lossDays = tradingDays.length - winDays;
  const best = tradingDays.reduce((a, b) => (b.pnl > a.pnl ? b : a));

  const cells: (number | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="pt-1">
      <div className="flex justify-between items-center mb-2 px-1">
        <h2 className="text-[14px] font-bold text-[#0B2545] tracking-tight">Trading Calendar</h2>
        <span className="text-[10px] font-bold text-slate-500 font-mono">{monthLabel}</span>
      </div>

      <div className="bg-white/90 backdrop-blur-md rounded-xl p-2.5 border border-white shadow-[0_4px_12px_rgba(11,37,69,0.03)] relative z-10">
        <div className="grid grid-cols-3 gap-2 pb-2.5 mb-2 border-b border-slate-100">
          <div>
            <div className="text-slate-400 text-[9px] mb-0.5 uppercase tracking-wider">Month PnL</div>
            <div className={cn('font-bold text-[11px] font-mono', monthPnl >= 0 ? 'text-emerald-500' : 'text-rose-500')}>
              {formatSigned(monthPnl)}
            </div>
          </div>
          <div>
            <div className="text-slate-400 text-[9px] mb-0.5 uppercase tracking-wider">Win / Loss days</div>
            <div className="font-bold text-[11px] font-mono text-[#0B2545]">
              <span className="text-emerald-500">{winDays}</span>
              <span className="text-slate-300 mx-0.5">/</span>
              <span className="text-rose-500">{lossDays}</span>
            </div>
          </div>
          <div>
            <div className="text-slate-400 text-[9px] mb-0.5 uppercase tracking-wider">Best day</div>
            <div className="font-bold text-[11px] font-mono text-[#0B2545]">
              {monthShort} {Number(best.date.slice(-2))}
              <span className="text-emerald-500 font-normal ml-1 text-[9px]">{compact(best.pnl)}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-[3px] mb-1">
          {WEEKDAYS.map(d => (
            <div key={d} className={cn('text-center text-[8px] font-bold uppercase tracking-wide', d === 'Sat' || d === 'Sun' ? 'text-slate-300' : 'text-slate-400')}>
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-[3px]">
          {cells.map((day, idx) => {
            if (day === null) return <div key={`blank-${idx}`} />;

            const key = toDateKey(day);
            const data = getTradingDay(key);
            const isToday = day === MOCK_TODAY;
            const isFuture = day > MOCK_TODAY;

            if (!data) {
              return (
                <div
                  key={key}
                  className={cn(
                    'h-[38px] rounded-md p-1 flex flex-col justify-between',
                    isFuture ? 'bg-slate-50/60' : 'bg-slate-50'
                  )}
                >
                  <span className={cn('text-[9px] font-medium leading-none font-mono', isFuture ? 'text-slate-300' : 'text-slate-400')}>{day}</span>
                  {!isFuture && <span className="text-[8px] text-slate-300 leading-none text-center">Closed</span>}
                </div>
              );
            }

            const level = Math.min(3, Math.ceil((Math.abs(data.pnl) / maxAbs) * 4) - 1);
            const tone = data.pnl >= 0 ? PROFIT_LEVELS[level] : LOSS_LEVELS[level];

            return (
              <button
                key={key}
                onClick={() => navigate(`/day/${key}`)}
                aria-label={`${monthShort} ${day}: ${data.pnl >= 0 ? 'profit' : 'loss'} ${Math.abs(data.pnl).toLocaleString('en-US')} CNY. Open daily trades.`}
                className={cn(
                  'h-[38px] rounded-md p-1 flex flex-col justify-between text-left transition-transform active:scale-95 hover:brightness-[0.97]',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#0B2545]',
                  tone,
                  isToday && 'ring-2 ring-[#EE6C4D] ring-offset-1'
                )}
              >
                <span className="text-[9px] font-medium leading-none font-mono opacity-70">{day}</span>
                <span className="text-[10px] font-bold leading-none font-mono text-center w-full tracking-tight">{compact(data.pnl)}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-slate-100">
          <div className="flex items-center gap-1 text-[8px] text-slate-400 font-medium">
            <span>Loss</span>
            {[...LOSS_LEVELS].reverse().map(c => <span key={c} className={cn('w-2.5 h-2.5 rounded-[3px]', c.split(' ')[0])} />)}
            {PROFIT_LEVELS.map(c => <span key={c} className={cn('w-2.5 h-2.5 rounded-[3px]', c.split(' ')[0])} />)}
            <span>Profit</span>
          </div>
          <span className="text-[8px] text-slate-400 font-medium">Tap a day to review trades</span>
        </div>
      </div>
    </div>
  );
}
