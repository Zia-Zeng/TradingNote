import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { PieChart as PieChartIcon, RefreshCw } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { DAILY_REVIEW_INPUTS_CHANGED } from '../lib/daily-review';
import { formatCurrencyAmount, inferMarketCurrency, normalizeMarketCode } from '../lib/instruments';
import { formatTradeTimestamp } from '../lib/trade-time';
import { cn } from '../lib/utils';

type TradeRecord = {
  id: string;
  date?: string;
  time?: string;
  type: 'Buy' | 'Sell';
  symbol: string;
  code?: string;
  market?: string;
  asset_class?: string;
  currency?: string;
  price: number | string;
  qty: number | string;
};

type Position = {
  key: string;
  name: string;
  code: string;
  market: string;
  assetClass: string;
  currency: string;
  quantity: number;
  costBasis: number;
  averageCost: number;
  tradeCount: number;
  lastTradeDate: string;
  tab: string;
};

type DailyBar = { date: string; open?: number; high?: number; low?: number; close: number };
type DailyHistory = { bars: DailyBar[] };

const localDate = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;

const validCandle = (bar: DailyBar): bar is DailyBar & { open: number; high: number; low: number } =>
  [bar.open, bar.high, bar.low, bar.close].every(value => typeof value === 'number' && Number.isFinite(value)) &&
  Number(bar.high) >= Number(bar.low);

function MiniCandles({ bars }: { bars: DailyBar[] }) {
  const candles = bars.filter(validCandle).slice(-5);
  if (!candles.length) return <span className="text-[9px] text-slate-400">No chart</span>;
  const low = Math.min(...candles.map(bar => bar.low));
  const high = Math.max(...candles.map(bar => bar.high));
  const range = high - low || 1;
  const y = (value: number) => 3 + (high - value) / range * 25;

  return (
    <svg viewBox="0 0 66 32" width="66" height="32" role="img" aria-label={`Last ${candles.length} trading day candlesticks`}>
      {candles.map((bar, index) => {
        const x = 9 + index * 12;
        const color = bar.close >= bar.open ? '#10b981' : '#f43f5e';
        const top = y(Math.max(bar.open, bar.close));
        const bottom = y(Math.min(bar.open, bar.close));
        return <g key={bar.date}>
          <title>{`${bar.date}: O ${bar.open}, H ${bar.high}, L ${bar.low}, C ${bar.close}`}</title>
          <line x1={x} y1={y(bar.high)} x2={x} y2={y(bar.low)} stroke={color} strokeWidth="1.4" />
          <rect x={x - 3} y={top} width="6" height={Math.max(1.5, bottom - top)} fill={color} rx="0.5" />
        </g>;
      })}
    </svg>
  );
}

function LatestMarket({ history, loading }: { history?: DailyHistory; loading: boolean }) {
  const bars = Array.isArray(history?.bars) ? history.bars.filter(bar => Number.isFinite(bar.close)) : [];
  const latest = bars[bars.length - 1];
  const previous = bars[bars.length - 2];
  const percent = latest && previous?.close ? (latest.close - previous.close) / previous.close * 100 : null;
  const movement = percent === null ? 'unknown' : percent > 0 ? 'up' : percent < 0 ? 'down' : 'flat';
  const price = latest?.close.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 }) || '--';
  const change = percent === null ? '--' : `${percent > 0 ? '+' : ''}${percent.toFixed(2)}%`;

  return <div className="flex shrink-0 items-center gap-1.5" aria-label={latest ? `Latest close ${price} on ${latest.date}; change ${change}` : 'Daily market data unavailable'}>
    <div className="flex h-8 w-[66px] items-center justify-center">{loading ? <span className="text-[9px] text-slate-400">Loading</span> : <MiniCandles bars={bars} />}</div>
    <div className="flex w-[57px] flex-col items-end gap-0.5">
      <span className="font-mono text-[12px] font-bold leading-none text-[#0B2545]" title={latest ? `Close · ${latest.date}` : 'Close unavailable'}>{loading ? '--' : price}</span>
      <span className={cn('w-full rounded-sm px-1 py-0.5 text-center font-mono text-[9px] font-bold leading-none text-white', movement === 'up' ? 'bg-emerald-500' : movement === 'down' ? 'bg-rose-500' : 'bg-slate-400')} title={latest ? `Daily change · ${latest.date}` : 'Daily change unavailable'}>{loading ? '--' : change}</span>
    </div>
  </div>;
}

function PositionPnl({ position, history, loading }: { position: Position; history?: DailyHistory; loading: boolean }) {
  const bars = history?.bars || [];
  const latestClose = bars[bars.length - 1]?.close;
  const pnlValue = typeof latestClose === 'number' && Number.isFinite(latestClose)
    ? (latestClose - position.averageCost) * position.quantity
    : null;
  const pnlPercent = typeof latestClose === 'number' && Number.isFinite(latestClose) && position.averageCost > 0
    ? (latestClose - position.averageCost) / position.averageCost * 100
    : null;
  const color = pnlValue === null ? 'text-slate-400' : pnlValue > 0 ? 'text-emerald-600' : pnlValue < 0 ? 'text-rose-600' : 'text-slate-500';
  const formatPercent = (value: number | null) => value === null
    ? '--'
    : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;

  return <>
    <div className="min-w-0"><p className="truncate text-[9px] text-slate-400">PNL Value</p><p className={cn('truncate font-mono text-[10px] font-bold', color)}>{loading ? '--' : formatCurrencyAmount(pnlValue ?? undefined, position.currency)}</p></div>
    <div className="min-w-0"><p className="truncate text-[9px] text-slate-400">PNL %</p><p className={cn('truncate font-mono text-[10px] font-bold', color)}>{loading ? '--' : formatPercent(pnlPercent)}</p></div>
  </>;
}

const tradeTimestamp = (trade: TradeRecord) => {
  const parsed = formatTradeTimestamp(trade.time);
  return `${parsed.date || trade.date || '0000-00-00'} ${parsed.time || '00:00'}`;
};

const positionKey = (trade: TradeRecord) => trade.code?.trim()
  ? `code:${trade.code.trim().toUpperCase()}`
  : `symbol:${(trade.market || '').trim().toUpperCase()}:${trade.symbol.trim().toUpperCase()}`;

const positionTab = (assetClass: string) => {
  const value = assetClass.toLowerCase();
  if (value.includes('bond') || value.includes('treasury')) return 'Bond';
  if (value.includes('crypto')) return 'Crypto';
  if (value.includes('stock') || value.includes('equity') || value.includes('etf') || value.includes('fund')) return 'Stocks';
  return 'Other';
};

function positionsFromTrades(trades: TradeRecord[]): Position[] {
  const positions = new Map<string, Position>();
  const chronological = [...trades].sort((a, b) => tradeTimestamp(a).localeCompare(tradeTimestamp(b)) || a.id.localeCompare(b.id));

  for (const trade of chronological) {
    const quantity = Number(trade.qty);
    const price = Number(trade.price);
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0) continue;

    const key = positionKey(trade);
    const currency = (trade.currency || inferMarketCurrency(trade.code || trade.symbol).currency || 'CNY').toUpperCase();
    const position = positions.get(key) || {
      key,
      name: trade.symbol,
      code: trade.code?.trim() || '',
      market: normalizeMarketCode(trade.market, trade.code || trade.symbol),
      assetClass: trade.asset_class || 'Stock',
      currency,
      quantity: 0,
      costBasis: 0,
      averageCost: 0,
      tradeCount: 0,
      lastTradeDate: '',
      tab: positionTab(trade.asset_class || 'Stock'),
    };

    if (trade.type === 'Buy') {
      position.costBasis += price * quantity;
      position.quantity += quantity;
    } else {
      // A sale removes cost at the existing average cost, not at the sale price.
      const sold = Math.min(quantity, position.quantity);
      position.costBasis -= position.averageCost * sold;
      position.quantity -= sold;
    }

    if (position.quantity < 1e-8) {
      position.quantity = 0;
      position.costBasis = 0;
    }
    position.averageCost = position.quantity > 0 ? position.costBasis / position.quantity : 0;
    position.name = trade.symbol || position.name;
    position.code = trade.code?.trim() || position.code;
    position.market = normalizeMarketCode(trade.market, trade.code || trade.symbol);
    position.assetClass = trade.asset_class || position.assetClass;
    position.currency = currency;
    position.tab = positionTab(position.assetClass);
    position.tradeCount += 1;
    position.lastTradeDate = tradeTimestamp(trade).slice(0, 10);
    positions.set(key, position);
  }

  return [...positions.values()]
    .filter(position => position.quantity > 0)
    .sort((a, b) => b.lastTradeDate.localeCompare(a.lastTradeDate) || a.name.localeCompare(b.name));
}

const formatQuantity = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 8 });

export default function Report() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = searchParams.get('asset') || 'All';
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [marketByKey, setMarketByKey] = useState<Record<string, DailyHistory>>({});
  const [marketLoadingByKey, setMarketLoadingByKey] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let current = true;
    let requestNumber = 0;
    const loadTrades = () => {
      const request = ++requestNumber;
      setLoading(true);
      setError(null);
      apiRequest<TradeRecord[]>('/api/trades')
        .then(records => { if (current && request === requestNumber) setTrades(records); })
        .catch(cause => { if (current && request === requestNumber) setError(cause instanceof Error ? cause.message : 'Failed to load trades.'); })
        .finally(() => { if (current && request === requestNumber) setLoading(false); });
    };
    loadTrades();
    window.addEventListener(DAILY_REVIEW_INPUTS_CHANGED, loadTrades);
    return () => { current = false; window.removeEventListener(DAILY_REVIEW_INPUTS_CHANGED, loadTrades); };
  }, [reloadToken]);

  const positions = useMemo(() => positionsFromTrades(trades), [trades]);
  useEffect(() => {
    if (!positions.length) {
      setMarketByKey({});
      setMarketLoadingByKey({});
      return;
    }
    let cancelled = false;
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 35);
    const dates = { start_date: localDate(start), end_date: localDate(end) };
    setMarketLoadingByKey(Object.fromEntries(positions.map(position => [position.key, true])));
    for (const position of positions) {
      const query = new URLSearchParams({ ...dates, code: position.code || position.name, market: position.market });
      void apiRequest<DailyHistory>(`/api/market/daily?${query}`)
        .then(history => { if (!cancelled) setMarketByKey(current => ({ ...current, [position.key]: history })); })
        .catch(() => { if (!cancelled) setMarketByKey(current => { const next = { ...current }; delete next[position.key]; return next; }); })
        .finally(() => { if (!cancelled) setMarketLoadingByKey(current => ({ ...current, [position.key]: false })); });
    }
    return () => { cancelled = true; };
  }, [positions]);
  const tabs = [
    { id: 'All', label: 'All' },
    { id: 'Stocks', label: 'Stocks' },
    { id: 'Bond', label: 'Bond' },
    { id: 'Crypto', label: 'Crypto' },
    ...(positions.some(position => position.tab === 'Other') ? [{ id: 'Other', label: 'Other' }] : []),
  ];
  const filteredPositions = activeTab === 'All' ? positions : positions.filter(position => position.tab === activeTab);

  return (
    <div className="w-full min-h-full pb-[100px] bg-[#F8F9FA] font-sans text-slate-900 relative">
      <div className="bg-white px-3 pt-[54px] pb-2.5 shadow-[0_2px_10px_rgba(0,0,0,0.02)] relative z-20 sticky top-0 border-b border-slate-100">
        <h1 className="text-[16px] font-bold text-[#0B2545] mb-3 tracking-wide flex items-center gap-1.5">
          <PieChartIcon size={18} className="text-[#EE6C4D]" /> Portfolio Tracking
        </h1>
        <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 overflow-x-auto no-scrollbar">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setSearchParams(tab.id === 'All' ? {} : { asset: tab.id })}
              className={cn(
                'flex-1 min-w-[60px] py-1.5 text-[11px] font-bold rounded-md transition-all text-center',
                activeTab === tab.id ? 'bg-[#0B2545] text-white shadow-sm' : 'bg-transparent text-slate-500 hover:text-slate-700 shadow-none',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-2.5 py-3 space-y-2 min-h-[100px]">
        {!loading && !error && <p className="px-1 pb-1 text-[11px] text-slate-500">{positions.length} open positions from saved trades</p>}
        {loading && <div className="rounded-xl bg-white p-5 text-center text-[12px] text-slate-500">Loading positions...</div>}
        {error && (
          <div className="rounded-xl border border-rose-100 bg-white p-4 text-[12px] text-rose-600">
            <p>Could not load positions: {error}</p>
            <button onClick={() => setReloadToken(value => value + 1)} className="mt-2 inline-flex items-center gap-1 font-semibold text-[#0B2545]"><RefreshCw size={13} /> Retry</button>
          </div>
        )}
        {!loading && !error && filteredPositions.map(position => (
          <button
            key={position.key}
            type="button"
            onClick={() => navigate(`/detail/${encodeURIComponent(position.code || position.name)}`, { state: { from: `${location.pathname}${location.search}` } })}
            className="w-full rounded-xl border border-slate-100 bg-white p-3 text-left shadow-[0_4px_12px_rgba(11,37,69,0.04)] transition-transform active:scale-[0.99]"
          >
            <div className="flex items-start justify-between gap-1.5">
              <div className="min-w-0">
                <div className="flex items-baseline gap-1.5">
                  <span className="truncate text-[14px] font-bold text-[#0B2545]">{position.name}</span>
                  {position.code && <span className="shrink-0 font-mono text-[10px] text-slate-500">{position.code}</span>}
                </div>
                <span className="mt-1 inline-block rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600">{position.assetClass}</span>
              </div>
              <LatestMarket history={marketByKey[position.key]} loading={Boolean(marketLoadingByKey[position.key])} />
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 border-t border-slate-100 pt-2">
              <div><p className="text-[9px] text-slate-400">Held quantity</p><p className="font-mono text-[12px] font-bold text-[#0B2545]">{formatQuantity(position.quantity)}</p></div>
              <div><p className="text-[9px] text-slate-400">Average cost</p><p className="font-mono text-[11px] font-bold text-[#0B2545]">{formatCurrencyAmount(position.averageCost, position.currency)}</p></div>
              <PositionPnl position={position} history={marketByKey[position.key]} loading={Boolean(marketLoadingByKey[position.key])} />
            </div>
            <p className="mt-2 text-[10px] text-slate-400">{position.tradeCount} trade{position.tradeCount === 1 ? '' : 's'} · Last trade {position.lastTradeDate}</p>
          </button>
        ))}
        {!loading && !error && filteredPositions.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-center text-[12px] text-slate-500">
            {positions.length ? 'No positions match this filter.' : 'No open positions yet. Add or import trades on Today to start tracking.'}
          </div>
        )}
      </div>
    </div>
  );
}
