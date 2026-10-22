import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams, useMatch, useLocation } from 'react-router-dom';
import { 
  ChevronLeft, ChevronRight, MoreHorizontal,
  BotMessageSquare, Zap, Sparkles, MessageCircle, Tag, Edit2, Edit3, Plus, Trash2, Loader2, AlertTriangle
} from 'lucide-react';
import { ComposedChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Scatter, Brush } from 'recharts';
import { cn } from '../lib/utils';
import { readLocalResult, saveLocalResult, SAVED_RESULTS_EVENT } from '../lib/saved-results';
import RecordDrawer from '../components/RecordDrawer';
import { apiRequest } from '../lib/api';

type TrackingMarketData = { available: boolean; as_of: string | null; latest_close: number | null };
type SavedAssetTracking = {
  asset: string; overallSummary: string; pnlResult: string; processResult: string; lessonsLearned: string; savedAt: string;
  generatedBy?: 'ai-tracking';
  promptVersion?: string;
  marketData?: TrackingMarketData;
};

const API_BASE_URL = ((import.meta.env.VITE_API_BASE_URL as string | undefined) || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const ANALYSIS_FIELDS = ['overall_summary', 'pnl_analysis', 'process_evaluation', 'lessons_learned'] as const;

const toPositiveNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const num = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  return Number.isFinite(num) && num > 0 ? num : undefined;
};

const optionalText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const BuyMarker = (props: any) => {
  const { cx, cy, payload } = props;
  if (!payload || payload.buyPrice === undefined) return null;
  return (
    <g transform={`translate(${cx},${cy})`}>
      <rect x={-8} y={-20} width={16} height={12} fill="#10b981" rx={2} />
      <text x={0} y={-14} fill="white" fontSize={8} textAnchor="middle" dominantBaseline="central" fontWeight="bold">B</text>
      <path d="M -3 -8 L 0 -5 L 3 -8 Z" fill="#10b981" />
    </g>
  )
}

const SellMarker = (props: any) => {
  const { cx, cy, payload } = props;
  if (!payload || payload.sellPrice === undefined) return null;
  return (
    <g transform={`translate(${cx},${cy})`}>
      <rect x={-8} y={8} width={16} height={12} fill="#ef4444" rx={2} />
      <text x={0} y={14} fill="white" fontSize={8} textAnchor="middle" dominantBaseline="central" fontWeight="bold">S</text>
      <path d="M -3 8 L 0 5 L 3 8 Z" fill="#ef4444" />
    </g>
  )
}

type TradeRecord = {
  id: string;
  date?: string;
  time?: string;
  type: 'Buy' | 'Sell';
  symbol: string;
  code?: string;
  market?: string;
  price: number | string;
  qty: number | string;
  amount?: number | string;
  fee?: number | string;
  closeVsFill?: string;
  closeVsFillColor?: string;
  note?: string;
  note_tags?: string[];
  modifiedAt?: string;
};

type TimelineItem = Omit<TradeRecord, 'type'> & { action: 'Buy' | 'Sell'; type: 'Trade'; displayDate: string };
type AssetNote = { id: string; asset_key: string; content: string; created_at: string };
type NoteTimelineItem = AssetNote & { type: 'Note'; displayDate: string };
type UserTimelineItem = TimelineItem | NoteTimelineItem;
type MarketBar = { date: string; open?: number; high?: number; low?: number; close: number; volume?: number; amount?: number };
type MarketHistory = { as_of: string | null; latest_close: number | null; bars: MarketBar[] };
type CachedMarketHistory = { cachedAt: number; endDate: string; data: MarketHistory };
const MARKET_CACHE_FRESH_MS = 10 * 60 * 1000;
const MARKET_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const marketCacheKey = (code: string, startDate: string) => `tradingnote:market-history:${code}:${startDate}`;

const readMarketCache = (key: string): CachedMarketHistory | null => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedMarketHistory;
    const age = Date.now() - cached.cachedAt;
    return age >= 0 && age <= MARKET_CACHE_MAX_AGE_MS && Array.isArray(cached.data?.bars) ? cached : null;
  } catch {
    return null;
  }
};

const saveMarketCache = (key: string, endDate: string, data: MarketHistory) => {
  try {
    localStorage.setItem(key, JSON.stringify({ cachedAt: Date.now(), endDate, data }));
  } catch {
    // Market data still displays when browser storage is unavailable.
  }
};

const transactionDate = (trade: Pick<TradeRecord, 'date' | 'time'>) => {
  const explicitDate = optionalText(trade.date);
  if (explicitDate && /^\d{4}-\d{2}-\d{2}$/.test(explicitDate)) return explicitDate;
  const legacyDate = optionalText(trade.time)?.match(/^(\d{4}-\d{2}-\d{2})/);
  return legacyDate?.[1] || null;
};

const transactionTime = (trade: Pick<TradeRecord, 'time'>) => {
  const raw = optionalText(trade.time) || '';
  const fullDateTime = raw.match(/^\d{4}-\d{2}-\d{2}[ T](.+)$/);
  return fullDateTime?.[1] || raw;
};

const transactionTimestamp = (trade: TradeRecord) => `${transactionDate(trade) || '0000-00-00'} ${transactionTime(trade)}`;

const assetGroupKey = (trade: TradeRecord) => trade.code?.trim()
  ? `code:${trade.code.trim()}`
  : `symbol:${(trade.market || '').trim().toUpperCase()}:${trade.symbol.trim().toUpperCase()}`;

const formatPrice = (value: number | null | undefined) => value === null || value === undefined || !Number.isFinite(value)
  ? '--'
  : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatMoney = (value: number | null) => value === null || !Number.isFinite(value)
  ? '--'
  : `${value < 0 ? '- ' : ''}¥ ${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const parseAmount = (value: unknown) => {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return NaN;
  return Number(value.replace(/[^\d.-]/g, ''));
};

const formatPercent = (value: number | null) => value === null || !Number.isFinite(value)
  ? '--'
  : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;

const firstRecordedDate = (records: TradeRecord[]) =>
  records.map(transactionDate).filter((value): value is string => Boolean(value)).sort()[0] || null;

const marketStartDate = (records: TradeRecord[]) => {
  const firstDate = firstRecordedDate(records);
  if (firstDate) {
    // Fetch a wider calendar window, then use the returned bars to count ten trading days.
    const start = new Date(`${firstDate}T12:00:00`);
    start.setDate(start.getDate() - 60);
    return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
  }
  const fallback = new Date();
  fallback.setDate(fallback.getDate() - 90);
  return `${fallback.getFullYear()}-${String(fallback.getMonth() + 1).padStart(2, '0')}-${String(fallback.getDate()).padStart(2, '0')}`;
};

const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const legacyAssetRoutes: Record<string, string> = {
  '1': '601899', '2': '002353', '4': '159739', '5': '019547', '6': 'BTC/USDT', '7': 'TLT', '8': 'ETH/USDT',
};

const toTrackingTimeline = (items: UserTimelineItem[]) => items.map(item => {
  if (item.type === 'Note') {
    return { id: item.id, type: 'Note', date: item.created_at, text: item.content };
  }
  return {
    id: item.id,
    type: item.type,
    action: item.action,
    date: transactionDate(item) ? `${transactionDate(item)} ${transactionTime(item)}`.trim() : undefined,
    price: toPositiveNumber(item.price),
    qty: toPositiveNumber(item.qty),
    amount: Number(item.price) * Number(item.qty),
    closeVsFill: optionalText(item.closeVsFill),
    note: item.note,
    note_tags: item.note_tags,
  };
});

const describeMarketData = (market: TrackingMarketData) => {
  if (!market.available) {
    return 'Market data unavailable.';
  }
  return [
    market.as_of ? `as of ${market.as_of}` : null,
    market.latest_close !== null ? `close ${market.latest_close}` : null
  ].filter(Boolean).join(' · ');
};

export default function Detail() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const scrollTo = searchParams.get('scroll');
  const navigate = useNavigate();
  const location = useLocation();
  const backTo = typeof location.state?.from === 'string' && location.state.from.startsWith('/report') ? location.state.from : '/';
  const routeKey = decodeURIComponent(id || '');
  const requestedAsset = legacyAssetRoutes[routeKey] || routeKey;
  const isHistoryPage = Boolean(useMatch('/detail/:id/history'));
  const [tradeRecords, setTradeRecords] = useState<TradeRecord[]>([]);
  const [tradeLoading, setTradeLoading] = useState(true);
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [marketData, setMarketData] = useState<MarketHistory | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [editingTimelineItem, setEditingTimelineItem] = useState<TimelineItem | null>(null);
  const [assetNotes, setAssetNotes] = useState<AssetNote[]>([]);
  const [notesForAssetKey, setNotesForAssetKey] = useState<string | null>(null);
  const [newAssetNote, setNewAssetNote] = useState('');
  const [noteLoading, setNoteLoading] = useState(true);
  const [noteSaving, setNoteSaving] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteContent, setEditingNoteContent] = useState('');
  const [noteMutationId, setNoteMutationId] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [savedAssetTracking, setSavedAssetTracking] = useState<SavedAssetTracking | null>(null);
  const [trackingPromptVersion, setTrackingPromptVersion] = useState<string | null>(null);
  const [isGeneratingTracking, setIsGeneratingTracking] = useState(false);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const trackingRequestRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setTradeLoading(true);
    setTradeError(null);
    apiRequest<TradeRecord[]>('/api/trades')
      .then(records => { if (!cancelled) setTradeRecords(records); })
      .catch(error => { if (!cancelled) setTradeError(error instanceof Error ? error.message : 'Unable to load trade history.'); })
      .finally(() => { if (!cancelled) setTradeLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const assetTrades = useMemo(() => {
    const selected = tradeRecords.find(record => record.id === routeKey);
    const selectedKey = selected ? assetGroupKey(selected) : null;
    const normalizedRouteKey = requestedAsset.trim().toUpperCase();
    return tradeRecords
      .filter(record => selectedKey
        ? assetGroupKey(record) === selectedKey
        : record.code?.trim().toUpperCase() === normalizedRouteKey || record.symbol.trim().toUpperCase() === normalizedRouteKey)
      .sort((left, right) => transactionTimestamp(left).localeCompare(transactionTimestamp(right)));
  }, [requestedAsset, routeKey, tradeRecords]);

  const data = useMemo(() => {
    const first = assetTrades[0];
    const latest = assetTrades[assetTrades.length - 1];
    const buyTrades = assetTrades.filter(record => record.type === 'Buy');
    const sellTrades = assetTrades.filter(record => record.type === 'Sell');
    const buyQuantity = buyTrades.reduce((sum, trade) => sum + Number(trade.qty || 0), 0);
    const soldQuantity = sellTrades.reduce((sum, trade) => sum + Number(trade.qty || 0), 0);
    const netQuantity = buyQuantity - soldQuantity;
    const buyAmount = buyTrades.reduce((sum, trade) => sum + Number(trade.price || 0) * Number(trade.qty || 0) + Number(trade.fee || 0), 0);
    const sellAmount = sellTrades.reduce((sum, trade) => sum + Number(trade.price || 0) * Number(trade.qty || 0) - Number(trade.fee || 0), 0);
    const close = marketData?.latest_close ?? (marketData && marketData.bars.length
      ? marketData.bars[marketData.bars.length - 1].close
      : null);
    const validPosition = netQuantity >= 0;
    const totalPnl = validPosition && (netQuantity === 0 || close !== null)
      ? sellAmount + netQuantity * (close || 0) - buyAmount
      : null;
    const pnlPercent = totalPnl !== null && buyAmount > 0 ? totalPnl / buyAmount * 100 : null;
    const sortedTimeline: TimelineItem[] = assetTrades.map(trade => {
      const date = transactionDate(trade);
      const time = transactionTime(trade);
      return {
        ...trade,
        type: 'Trade',
        action: trade.type,
        displayDate: date ? `${date}${time ? ` ${time}` : ''}` : `Date not recorded${time ? ` · ${time}` : ''}`,
        amount: trade.amount ?? Number(trade.price) * Number(trade.qty),
      };
    });
    const tradesByDate = new Map<string, TradeRecord[]>();
    for (const trade of assetTrades) {
      const date = transactionDate(trade);
      if (date) tradesByDate.set(date, [...(tradesByDate.get(date) || []), trade]);
    }
    const bars = marketData?.bars || [];
    const firstDate = firstRecordedDate(assetTrades);
    const firstTradeBar = firstDate ? bars.findIndex(bar => bar.date >= firstDate) : -1;
    const visibleBars = firstTradeBar >= 0 ? bars.slice(Math.max(0, firstTradeBar - 10)) : bars;
    const chartData = visibleBars.map(bar => {
      const onDate = tradesByDate.get(bar.date) || [];
      const averagePrice = (type: 'Buy' | 'Sell') => {
        const matches = onDate.filter(trade => trade.type === type);
        const quantity = matches.reduce((sum, trade) => sum + Number(trade.qty || 0), 0);
        return quantity > 0 ? matches.reduce((sum, trade) => sum + Number(trade.price) * Number(trade.qty), 0) / quantity : undefined;
      };
      return {
        time: bar.date.slice(5),
        date: bar.date,
        price: bar.close,
        buyPrice: averagePrice('Buy'),
        sellPrice: averagePrice('Sell'),
      };
    });
    const dateForLastTrade = latest ? transactionDate(latest) : null;
    const latestTime = latest ? transactionTime(latest) : '';
    return {
      id: first?.code || requestedAsset,
      symbol: first?.symbol || requestedAsset,
      code: first?.code || (/^\d{6}$/.test(requestedAsset) ? requestedAsset : ''),
      market: first?.market || 'Asset',
      direction: latest?.type || 'Buy',
      status: netQuantity > 0 ? 'Open' : sellTrades.length ? 'Closed' : 'No position',
      statusColor: netQuantity > 0 ? 'text-blue-600' : 'text-slate-500',
      timeStr: dateForLastTrade ? `${dateForLastTrade}${latestTime ? ` ${latestTime}` : ''}` : latestTime || 'Date not recorded',
      time: latest ? `${transactionDate(latest) || ''} ${latestTime}`.trim() : undefined,
      shares: latest?.qty ? Number(latest.qty) : 0,
      buyPrice: buyQuantity > 0 ? buyAmount / buyQuantity : null,
      currentPrice: close,
      profitPct: formatPercent(pnlPercent),
      profitPctColor: (pnlPercent ?? 0) >= 0 ? 'text-emerald-500' : 'text-rose-500',
      profitVal: formatMoney(totalPnl),
      netQuantity,
      chartColor: (pnlPercent ?? 0) >= 0 ? '#10b981' : '#f43f5e',
      chartData,
      timeline: sortedTimeline,
      analysis: {
        overall_summary: 'No AI Tracking result yet. Generate an analysis for this asset.',
        pnl_analysis: 'No AI Tracking result yet. Generate an analysis for this asset.',
        process_evaluation: 'No AI Tracking result yet. Generate an analysis for this asset.',
        lessons_learned: 'No AI Tracking result yet. Generate an analysis for this asset.',
      },
    };
  }, [assetTrades, marketData, requestedAsset]);
  const noteAssetKey = data.code ? `code:${data.code}` : `symbol:${data.symbol.trim().toUpperCase()}`;
  const noteAssetKeyRef = useRef(noteAssetKey);
  noteAssetKeyRef.current = noteAssetKey;
  const tradeTimeline = data.timeline;
  const timeline = useMemo<UserTimelineItem[]>(() => [
    ...tradeTimeline,
    ...(notesForAssetKey === noteAssetKey ? assetNotes : []).map(note => ({ ...note, type: 'Note' as const, displayDate: new Date(note.created_at).toLocaleString('en-US', { hour12: false }) })),
  ].sort((left, right) => {
    const timestamp = (item: UserTimelineItem) => item.type === 'Note'
      ? Date.parse(item.created_at)
      : Date.parse(`${transactionDate(item) || '1970-01-01'}T${transactionTime(item) || '00:00'}`);
    return (timestamp(right) || 0) - (timestamp(left) || 0);
  }), [tradeTimeline, assetNotes, notesForAssetKey, noteAssetKey]);
  const visibleTimeline = timeline.slice(0, isHistoryPage ? timeline.length : 3);
  const latestTrade = tradeTimeline[tradeTimeline.length - 1];
  const startDate = useMemo(() => marketStartDate(assetTrades), [assetTrades]);
  const marketCode = /^\d{6}$/.test(data.code) ? data.code : '';

  useEffect(() => {
    if (tradeLoading) return;
    let cancelled = false;
    setAssetNotes([]);
    setNotesForAssetKey(noteAssetKey);
    setNewAssetNote('');
    setEditingNoteId(null);
    setNoteError(null);
    setNoteLoading(true);
    const query = new URLSearchParams({ asset_key: noteAssetKey });
    apiRequest<AssetNote[]>(`/api/asset-notes?${query}`)
      .then(notes => { if (!cancelled) setAssetNotes(notes); })
      .catch(error => { if (!cancelled) setNoteError(error instanceof Error ? error.message : 'Unable to load notes.'); })
      .finally(() => { if (!cancelled) setNoteLoading(false); });
    return () => { cancelled = true; };
  }, [noteAssetKey, tradeLoading]);

  useEffect(() => {
    let cancelled = false;
    if (isHistoryPage || !marketCode || assetTrades.length === 0) {
      setMarketData(null);
      setMarketError(null);
      setMarketLoading(false);
      return;
    }
    const endDate = localToday();
    const cacheKey = marketCacheKey(marketCode, startDate);
    const cached = readMarketCache(cacheKey);
    setMarketData(cached?.data || null);
    setMarketError(null);
    if (cached && cached.endDate === endDate && Date.now() - cached.cachedAt < MARKET_CACHE_FRESH_MS) {
      setMarketLoading(false);
      return;
    }
    setMarketLoading(true);
    const query = new URLSearchParams({ start_date: startDate, end_date: endDate });
    apiRequest<MarketHistory>(`/api/market/history/${encodeURIComponent(marketCode)}?${query.toString()}`)
      .then(result => { saveMarketCache(cacheKey, endDate, result); if (!cancelled) setMarketData(result); })
      .catch(error => { if (!cancelled) setMarketError(error instanceof Error ? error.message : 'Unable to load daily market data.'); })
      .finally(() => { if (!cancelled) setMarketLoading(false); });
    return () => { cancelled = true; };
  }, [assetTrades.length, isHistoryPage, marketCode, startDate]);

  useEffect(() => {
    trackingRequestRef.current += 1;
    setIsGeneratingTracking(false);
    setTrackingError(null);
  }, [routeKey]);

  useEffect(() => {
    const sync = () => {
      setSavedAssetTracking(readLocalResult<SavedAssetTracking>(`tradingnote:asset-tracking:${data.id}`));
    };
    sync();
    window.addEventListener(SAVED_RESULTS_EVENT, sync);
    return () => window.removeEventListener(SAVED_RESULTS_EVENT, sync);
  }, [data.id]);

  useEffect(() => {
    let cancelled = false;
    apiRequest<{ version: string }>('/api/tracking/prompt')
      .then(result => { if (!cancelled) setTrackingPromptVersion(result.version); })
      .catch(() => { if (!cancelled) setTrackingPromptVersion(null); });
    return () => { cancelled = true; };
  }, []);

  const handleTimelineSave = async (formData: any) => {
    if (!editingTimelineItem) return;
    const original = tradeRecords.find(item => item.id === editingTimelineItem.id);
    if (!original) return;
    const updatedRecord: TradeRecord = {
      ...original,
      symbol: formData.symbol,
      code: formData.code || undefined,
      type: formData.direction,
      price: Number(formData.price),
      qty: Number(formData.qty),
      amount: Number(formData.price || 0) * Number(formData.qty || 0),
      note: formData.note,
      note_tags: formData.note_tags,
    };
    const saved = await apiRequest<TradeRecord>(`/api/trades/${encodeURIComponent(original.id)}`, {
      method: 'PUT', body: JSON.stringify(updatedRecord),
    });
    setTradeRecords(current => current.map(item => item.id === saved.id ? saved : item));
    setEditingTimelineItem(null);
  };

  const handleAddAssetNote = async () => {
    const content = newAssetNote.trim();
    if (!content || noteSaving || noteLoading || notesForAssetKey !== noteAssetKey) return;
    const assetKey = noteAssetKey;
    setNoteSaving(true);
    setNoteError(null);
    try {
      const note = await apiRequest<AssetNote>('/api/asset-notes', {
        method: 'POST',
        body: JSON.stringify({ asset_key: assetKey, content }),
      });
      if (noteAssetKeyRef.current !== assetKey) return;
      setAssetNotes(current => [note, ...current]);
      setNewAssetNote('');
    } catch (error) {
      if (noteAssetKeyRef.current === assetKey) setNoteError(error instanceof Error ? error.message : 'Unable to save note.');
    } finally {
      setNoteSaving(false);
    }
  };

  const handleUpdateAssetNote = async (noteId: string) => {
    const content = editingNoteContent.trim();
    if (!content || noteMutationId || notesForAssetKey !== noteAssetKey) return;
    const assetKey = noteAssetKey;
    setNoteMutationId(noteId);
    setNoteError(null);
    try {
      const saved = await apiRequest<AssetNote>(`/api/asset-notes/${encodeURIComponent(noteId)}`, {
        method: 'PUT',
        body: JSON.stringify({ asset_key: assetKey, content }),
      });
      if (noteAssetKeyRef.current !== assetKey) return;
      setAssetNotes(current => current.map(note => note.id === noteId ? saved : note));
      setEditingNoteId(null);
    } catch (error) {
      if (noteAssetKeyRef.current === assetKey) setNoteError(error instanceof Error ? error.message : 'Could not update your note.');
    } finally {
      setNoteMutationId(null);
    }
  };

  const handleDeleteAssetNote = async (noteId: string) => {
    if (noteMutationId || notesForAssetKey !== noteAssetKey) return;
    const assetKey = noteAssetKey;
    setNoteMutationId(noteId);
    setNoteError(null);
    try {
      const query = new URLSearchParams({ asset_key: assetKey });
      await apiRequest<void>(`/api/asset-notes/${encodeURIComponent(noteId)}?${query}`, { method: 'DELETE' });
      if (noteAssetKeyRef.current !== assetKey) return;
      setAssetNotes(current => current.filter(note => note.id !== noteId));
      if (editingNoteId === noteId) setEditingNoteId(null);
    } catch (error) {
      if (noteAssetKeyRef.current === assetKey) setNoteError(error instanceof Error ? error.message : 'Could not delete your note.');
    } finally {
      setNoteMutationId(null);
    }
  };

  const generateTracking = async () => {
    if (isGeneratingTracking) return;
    const requestId = ++trackingRequestRef.current;
    const tradeId = String(data.id);
    setIsGeneratingTracking(true);
    setTrackingError(null);

    const code = String(data.code ?? '').trim();
    const tradeContext = {
      id: tradeId,
      symbol: data.symbol,
      code: /^\d{6}$/.test(code) ? code : undefined,
      market: optionalText(data.market),
      direction: data.direction,
      status: optionalText(data.status),
      time: optionalText(data.time),
      shares: toPositiveNumber(data.shares),
      buyPrice: toPositiveNumber(data.buyPrice),
      currentPrice: toPositiveNumber(data.currentPrice),
      timeline: toTrackingTimeline(timeline)
    };

    try {
      let res: Response;
      try {
        res = await fetch(`${API_BASE_URL}/api/tracking/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trade_context: tradeContext })
        });
      } catch {
        throw new Error(`Can't reach the backend at ${API_BASE_URL}. Make sure it is running, then retry.`);
      }

      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = typeof body?.detail === 'string' ? body.detail : `HTTP ${res.status}`;
        throw new Error(`AI Tracking failed: ${detail}`);
      }
      const analysis = body?.analysis;
      if (!analysis || ANALYSIS_FIELDS.some(field => typeof analysis[field] !== 'string')) {
        throw new Error('AI Tracking returned an unexpected response. Please retry.');
      }
      if (requestId !== trackingRequestRef.current) return;

      const market = body.market_data ?? {};
      const record: SavedAssetTracking = {
        asset: optionalText(body.tracking?.asset) || data.symbol,
        promptVersion: optionalText(body.prompt_version),
        overallSummary: analysis.overall_summary,
        pnlResult: analysis.pnl_analysis,
        processResult: analysis.process_evaluation,
        lessonsLearned: analysis.lessons_learned,
        savedAt: optionalText(body.tracking?.savedAt) || new Date().toISOString(),
        generatedBy: 'ai-tracking',
        marketData: {
          available: market.available === true,
          as_of: optionalText(market.as_of) ?? null,
          latest_close: typeof market.latest_close === 'number' ? market.latest_close : null
        }
      };
      setSavedAssetTracking(record);
      saveLocalResult(`tradingnote:asset-tracking:${tradeId}`, record);
    } catch (err) {
      if (requestId !== trackingRequestRef.current) return;
      setTrackingError(err instanceof Error ? err.message : 'AI Tracking failed. Please retry.');
    } finally {
      if (requestId === trackingRequestRef.current) setIsGeneratingTracking(false);
    }
  };

  const aiTracking = savedAssetTracking?.generatedBy === 'ai-tracking' ? savedAssetTracking : null;
  const trackingIsOutdated = Boolean(aiTracking && trackingPromptVersion && aiTracking.promptVersion !== trackingPromptVersion);

  useEffect(() => {
    if (scrollTo) {
      setTimeout(() => {
        const el = document.getElementById(scrollTo);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 300);
    } else {
      setTimeout(() => {
        const el = document.getElementById('detail-root');
        if (el && el.parentElement) {
          el.parentElement.scrollTop = 0;
        }
      }, 50);
    }
  }, [id, isHistoryPage, scrollTo]);

  return (
    <div id="detail-root" className="w-full min-h-full pb-[40px] bg-[#F4F5F7] font-sans text-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-[54px] pb-2 bg-white sticky top-0 z-30 shadow-sm border-b border-slate-100">
        <button onClick={() => navigate(isHistoryPage ? `/detail/${encodeURIComponent(routeKey)}?scroll=notes-section` : backTo)} aria-label="Back" className="p-2 -ml-2 text-slate-700 active:bg-slate-100 rounded-full transition-colors">
          <ChevronLeft size={20} />
        </button>
        <div className="flex flex-col items-center">
          <h1 className="text-[14px] font-bold text-[#0B2545] tracking-tight">{isHistoryPage ? 'User Tracking' : data.symbol}</h1>
          <span className="text-[9px] text-slate-400 font-medium mt-0.5">{isHistoryPage ? `${data.symbol} • ${data.code}` : `${data.market} • ${data.code}`}</span>
        </div>
        {isHistoryPage ? <span className="w-9" /> : (
          <button className="p-2 -mr-2 text-slate-700 active:bg-slate-100 rounded-full transition-colors">
            <MoreHorizontal size={20} />
          </button>
        )}
      </div>

      {!isHistoryPage && (
      <>
      {/* Top Summary */}
      <div className="bg-white px-3 py-3 mb-1 shadow-sm">
        <div className="flex justify-between items-end mb-3">
          <div>
            <div className="flex items-center gap-1 mb-1">
              {latestTrade ? <span className={cn("border px-1 py-0.5 rounded text-[9px] font-bold",
              data.direction === 'Buy' ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-600 border-rose-200"
              )}>{data.direction}</span> : <span className="border px-1 py-0.5 rounded text-[9px] font-bold bg-slate-50 text-slate-500 border-slate-200">Asset</span>}
              <span className="text-[10px] text-slate-500 font-medium">{latestTrade ? `${data.timeStr} • ${data.shares} shares` : 'No transaction records'}</span>
            </div>
            <div className="text-[20px] font-bold font-mono text-[#0B2545] flex items-baseline gap-1 tracking-tight">
              {formatPrice(data.currentPrice)}
            </div>
            <div className="text-[9px] text-slate-400 mt-0.5">
              {marketData?.as_of ? `Daily close · ${marketData.as_of}${marketLoading ? ' · updating…' : ''}` : marketLoading ? 'Loading daily close…' : 'Daily close unavailable'}
            </div>
          </div>
          <div className="text-right">
            <div className={cn("font-bold text-[14px] flex items-center justify-end gap-1 mb-0.5", data.profitPctColor)}>
              {data.profitPct}
            </div>
            <div className="text-[9px] text-slate-500 font-medium">
              PnL (including recorded fees) <span className="font-bold text-[#134074] ml-1 font-mono">{data.profitVal}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-1.5">
          <div className="bg-slate-50 px-2 py-1.5 rounded-lg text-[9px] font-medium text-slate-500 flex-1 text-center border border-slate-100 uppercase">
            Status <span className={cn("font-bold ml-1 normal-case text-[10px]", data.statusColor)}>{data.status}</span>
          </div>
          <div className="bg-slate-50 px-2 py-1.5 rounded-lg text-[9px] font-medium text-slate-500 flex-1 text-center border border-slate-100 uppercase">
            Entry <span className="text-[#134074] font-bold font-mono ml-1 text-[10px]">{formatPrice(data.buyPrice)}</span>
          </div>
        </div>
      </div>

      {(tradeError || marketError || (!tradeLoading && assetTrades.length === 0)) && (
        <div role="status" className="bg-white px-3 py-2 mb-1 text-[10px] text-amber-700">
          {tradeLoading ? 'Loading asset trades…' : tradeError
            ? `Unable to load trade history: ${tradeError}`
            : assetTrades.length === 0
              ? `No trade history is available for ${data.code || data.symbol}. Record a trade for this asset on Today first.`
              : `${marketData ? 'Daily market data could not be refreshed; showing the last cached data' : 'Daily market data is unavailable'}: ${marketError}`}
        </div>
      )}

      {/* Chart Section */}
      <div className="bg-white pt-4 pb-3 mb-1 shadow-sm overflow-hidden">
        <div className="h-[220px] w-full pb-2 px-2">
          {marketLoading && data.chartData.length === 0 ? <div className="h-full flex items-center justify-center text-[11px] text-slate-400">Loading daily market data…</div>
            : data.chartData.length === 0 ? <div className="h-full flex items-center justify-center text-[11px] text-slate-400">Daily market data is unavailable for this asset.</div>
            : <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data.chartData} margin={{ top: 25, right: 15, left: 15, bottom: 5 }}>
              <defs>
                <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={data.chartColor} stopOpacity={0.25}/>
                  <stop offset="95%" stopColor={data.chartColor} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{fontSize: 9, fill: '#94a3b8', fontWeight: 500}} dy={10} minTickGap={15} />
              <YAxis mirror={true} domain={['dataMin - (dataMax-dataMin)*0.1', 'dataMax + (dataMax-dataMin)*0.1']} tickFormatter={formatPrice} axisLine={false} tickLine={false} tick={{fontSize: 9, fill: '#94a3b8', fontWeight: 500, fontFamily: 'monospace'}} dx={-5} orientation="right" />
              <Area type="monotone" dataKey="price" stroke={data.chartColor} strokeWidth={2} fillOpacity={1} fill="url(#colorPrice)" />
              <Scatter dataKey="buyPrice" shape={<BuyMarker />} />
              <Scatter dataKey="sellPrice" shape={<SellMarker />} />
              <Brush dataKey="time" height={24} stroke="#cbd5e1" fill="#f8fafc" travellerWidth={10} tickFormatter={() => ''} />
            </ComposedChart>
          </ResponsiveContainer>}
        </div>
      </div>
      </>
      )}

      {/* User Tracking */}
      <div id="notes-section" className="bg-white px-3 py-4 mb-1 shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-[14px] font-bold text-[#0B2545] flex items-center gap-1.5">
            <MessageCircle size={14} className="text-[#EE6C4D]" />
            {isHistoryPage ? 'All records' : 'User Tracking'}
          </h2>
        </div>

        {/* Trade History Timeline */}
        <div className="mb-2.5">
          <div className="relative before:absolute before:inset-0 before:ml-[3px] before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-[1px] before:bg-gradient-to-b before:from-transparent before:via-slate-200 before:to-transparent space-y-6">
            {visibleTimeline.map(item => item.type === 'Note' ? (
              <div key={`note:${item.id}`} className="relative flex items-start gap-2">
                <div className="absolute left-0 w-2 h-2 rounded-full border-2 mt-1.5 z-10 shadow-sm bg-white border-[#EE6C4D]"></div>
                <div className="pl-4 flex-1 min-w-0">
                  <div className="text-[10px] text-slate-400 font-mono font-bold tracking-wider mb-2">{item.displayDate}</div>
                  <div className="bg-[#EE6C4D]/5 border border-[#EE6C4D]/20 rounded-xl p-2.5">
                    <div className="flex justify-end gap-1 mb-1">
                      <button
                        onClick={() => { setEditingNoteId(item.id); setEditingNoteContent(item.content); setNoteError(null); }}
                        disabled={noteMutationId !== null}
                        aria-label="Edit note"
                        className="text-slate-400 hover:text-[#EE6C4D] p-1 disabled:opacity-50"
                      ><Edit2 size={12} /></button>
                      <button
                        onClick={() => void handleDeleteAssetNote(item.id)}
                        disabled={noteMutationId !== null}
                        aria-label="Delete note"
                        className="text-slate-400 hover:text-rose-600 p-1 disabled:opacity-50"
                      ><Trash2 size={12} /></button>
                    </div>
                    {editingNoteId === item.id ? (
                      <div>
                        <textarea
                          value={editingNoteContent}
                          maxLength={140}
                          rows={3}
                          onChange={event => setEditingNoteContent(event.target.value)}
                          onKeyDown={event => {
                            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void handleUpdateAssetNote(item.id);
                            if (event.key === 'Escape') setEditingNoteId(null);
                          }}
                          aria-label="Edit note text"
                          className="w-full resize-y bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12px] text-[#0B2545] focus:outline-none focus:border-[#EE6C4D]"
                        />
                        <div className="flex justify-end gap-2 mt-2">
                          <button onClick={() => setEditingNoteId(null)} disabled={noteMutationId !== null} className="text-[11px] font-bold text-slate-500 disabled:opacity-50">Cancel</button>
                          <button onClick={() => void handleUpdateAssetNote(item.id)} disabled={!editingNoteContent.trim() || noteMutationId !== null} className="text-[11px] font-bold text-[#0B2545] disabled:opacity-50">Save</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#EE6C4D] shrink-0 mt-1.5"></div>
                        <p className="text-[12px] text-[#0B2545] leading-relaxed font-medium whitespace-pre-wrap break-words">{item.content}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div key={item.id} className="relative flex items-start gap-2">
                <div className="absolute left-0 w-2 h-2 rounded-full border-2 mt-1.5 z-10 shadow-sm bg-white border-[#EE6C4D]"></div>
                <div className="pl-4 flex-1 w-full">
                  <div className="flex justify-between items-center mb-2">
                    <div className="text-[10px] text-slate-400 font-mono font-bold tracking-wider">{item.displayDate}</div>
                    {item.type === 'Trade' && (
                      <span className={cn("px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider border", item.action === 'Buy' ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-600 border-rose-200")}>{item.action}</span>
                    )}
                  </div>
                  
                  <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-[0_2px_8px_rgba(11,37,69,0.02)]">
                      <div className="flex justify-between items-center mb-3">
                        <div className="flex items-center gap-2">
                          <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border", item.action === 'Buy' ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-600 border-rose-200")}>{item.action}</span>
                          <span className="font-bold text-[#0B2545] text-[14px]">{data.symbol}</span>
                          <span className="text-[10px] text-slate-400 font-mono">{data.code}</span>
                        </div>
                        <button onClick={() => setEditingTimelineItem(item)} aria-label="Edit trade record" className="text-slate-400 hover:text-[#EE6C4D] active:scale-95 p-1 transition-all">
                          <Edit2 size={12} />
                        </button>
                      </div>
                      
                      <div className="grid grid-cols-3 gap-2 mb-3 border-b border-slate-100 pb-3">
                        <div>
                          <div className="text-[9px] text-slate-400 uppercase font-bold tracking-wider mb-0.5">Price × Qty</div>
                          <div className="text-[#0B2545] font-bold font-mono text-[12px]">{Number(item.price).toFixed(2)} × {item.qty}</div>
                        </div>
                        <div>
                          <div className="text-[9px] text-slate-400 uppercase font-bold tracking-wider mb-0.5">Amount</div>
                          <div className="text-[#0B2545] font-bold font-mono text-[12px]">{formatMoney(parseAmount(item.amount))}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[9px] text-slate-400 uppercase font-bold tracking-wider mb-0.5">Close vs Fill</div>
                          <div className={cn("font-bold font-mono text-[12px]", ('closeVsFillColor' in item && item.closeVsFillColor) || "text-slate-400")}>{('closeVsFill' in item && item.closeVsFill) || '--'}</div>
                        </div>
                      </div>
                      
                      <div className="bg-slate-50 border border-slate-100 rounded-lg p-2.5">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5">
                            <Tag size={12} className="text-[#EE6C4D]" />
                            <span className="text-[11px] font-bold text-[#0B2545]">Note</span>
                          </div>
                        </div>
                        
                        <div className="flex flex-wrap gap-1.5 mb-2.5">
                          {item.note_tags?.map((t: string) => (
                            <span key={t} className="bg-white border border-slate-200 text-slate-600 px-1.5 py-0.5 rounded text-[9px] font-bold shadow-sm">{t}</span>
                          ))}
                        </div>
                        
                        {item.note && (
                          <p className="whitespace-pre-wrap text-[11px] text-slate-600 leading-relaxed font-medium">
                            {item.note}
                          </p>
                        )}
                      </div>
                  </div>
                </div>
              </div>
            ))}
            
          </div>
        </div>
        {!isHistoryPage && (
          <div className="mt-4 mb-3">
            <div className="flex justify-between items-center mb-2.5">
              <div className="text-[13px] font-bold text-[#0B2545] flex items-center gap-1.5">
                <Edit3 size={14} className="text-[#EE6C4D]" /> My notes
              </div>
              <div className="text-[10px] text-slate-400 font-mono font-medium">{newAssetNote.length}/140</div>
            </div>
            <div className="flex items-start gap-2">
              <textarea
                value={newAssetNote}
                maxLength={140}
                rows={2}
                onChange={event => setNewAssetNote(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void handleAddAssetNote(); }}
                placeholder={`What are your thoughts on ${data.symbol}?`}
                aria-label={`My notes for ${data.symbol}`}
                className="flex-1 resize-y bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-[#EE6C4D] placeholder:text-slate-400 text-[#0B2545] shadow-sm transition-colors min-w-0"
              />
              <button
                onClick={() => void handleAddAssetNote()}
                disabled={!newAssetNote.trim() || noteSaving || noteLoading || notesForAssetKey !== noteAssetKey}
                className={cn(
                  "px-3 py-1.5 font-bold text-[12px] rounded-lg transition-colors flex items-center gap-1 shrink-0 shadow-sm",
                  newAssetNote.trim() && !noteSaving && !noteLoading && notesForAssetKey === noteAssetKey ? "bg-[#0B2545] text-white active:bg-[#134074]" : "bg-[#E2E8F0] text-[#64748B]"
                )}
              >
                {noteSaving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add
              </button>
            </div>
          </div>
        )}
        {noteError && <p role="alert" className="text-[11px] text-rose-600 mb-2">{noteError}</p>}
        {!isHistoryPage && timeline.length > 0 && (
          <button
            onClick={() => navigate(`/detail/${encodeURIComponent(routeKey)}/history`)}
            className="w-full py-2 mt-1 text-[11px] font-bold text-slate-500 hover:text-[#0B2545] transition-colors flex items-center justify-center gap-1 border-t border-slate-100/60"
          >
            View All Details <ChevronRight size={12} />
          </button>
        )}
      </div>

      {!isHistoryPage && (
      <>
      {/* AI Tracking Analysis Section */}
      <div id="ai-section" className="bg-white px-3 py-3 mb-6 shadow-sm">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-[12px] font-bold text-[#0B2545] flex items-center gap-1">
            <Zap size={12} className="text-[#EE6C4D]" />
            AI Tracking
          </h2>
          <button
            onClick={() => void generateTracking()}
            disabled={isGeneratingTracking || assetTrades.length === 0}
            aria-busy={isGeneratingTracking}
            className="bg-[#0B2545] text-white px-2.5 py-1.5 rounded-lg text-[10px] font-bold flex items-center gap-1 active:scale-95 transition-transform disabled:opacity-60 disabled:active:scale-100"
          >
            {isGeneratingTracking
              ? <><Loader2 size={10} className="animate-spin" /> Generating…</>
              : <><Sparkles size={10} /> {aiTracking ? 'Regenerate' : 'Generate'}</>}
          </button>
        </div>

        {trackingError && (
          <div role="alert" className="flex items-start gap-1.5 mb-3 px-2.5 py-2 bg-rose-50 border border-rose-200 rounded-lg text-[10px] font-medium text-rose-700 leading-snug">
            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
            <span className="flex-1">{trackingError}{savedAssetTracking ? ' Showing the last saved result.' : ''}</span>
            <button onClick={() => void generateTracking()} disabled={isGeneratingTracking || assetTrades.length === 0} className="shrink-0 font-bold underline disabled:opacity-60">Retry</button>
          </div>
        )}

        {trackingIsOutdated && (
          <div role="status" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] font-medium text-amber-800">
            This saved analysis uses an older Tracking prompt. Select Regenerate to refresh its market news.
          </div>
        )}

        <div className={cn("space-y-3 transition-opacity", isGeneratingTracking && "opacity-60")}>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-[#EE6C4D] mb-1">Overall Summary</div>
            <p className="text-[10px] text-slate-700 leading-relaxed">{trackingIsOutdated ? 'Saved summary is outdated. Regenerate to fetch current market news.' : savedAssetTracking?.overallSummary || data.analysis.overall_summary}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] font-bold text-[#0B2545] mb-1">P&amp;L Result</div>
              <p className="text-[10px] text-slate-700 leading-relaxed">{savedAssetTracking?.pnlResult || data.analysis.pnl_analysis}</p>
            </div>
            <div>
              <div className="text-[10px] font-bold text-[#0B2545] mb-1">Process Result</div>
              <p className="text-[10px] text-slate-700 leading-relaxed">{savedAssetTracking?.processResult || data.analysis.process_evaluation}</p>
            </div>
          </div>
          <div className="border-t border-slate-100 pt-2">
            <div className="text-[10px] font-bold text-[#0B2545] mb-1">Lessons Learned</div>
            <p className="text-[10px] text-slate-700 leading-relaxed">{savedAssetTracking?.lessonsLearned || data.analysis.lessons_learned}</p>
          </div>
          {aiTracking?.marketData && (
            <p className={cn("text-[9px] leading-relaxed", aiTracking.marketData.available ? "text-slate-500" : "text-amber-700")}>
              {describeMarketData(aiTracking.marketData)}
            </p>
          )}
          {aiTracking ? (
            <div className="text-right text-[8px] text-emerald-700 font-bold uppercase">
              Generated by AI Tracking · {new Date(aiTracking.savedAt).toLocaleString('en-US')}
            </div>
          ) : savedAssetTracking ? (
            <div className="text-right text-[8px] text-emerald-700 font-bold uppercase">Updated from M-Agent</div>
          ) : (
            <div className="text-right text-[8px] text-slate-400 font-bold uppercase">Generate AI Tracking to review this asset</div>
          )}
        </div>
      </div>
      </>
      )}

      <RecordDrawer
        isOpen={Boolean(editingTimelineItem)}
        onClose={() => setEditingTimelineItem(null)}
        initialData={editingTimelineItem ? {
          ...editingTimelineItem,
          symbol: data.symbol,
          type: editingTimelineItem.action || data.direction,
          note: editingTimelineItem.note || '',
          note_tags: editingTimelineItem.note_tags || []
        } : null}
        onSave={handleTimelineSave}
      />

      {!isHistoryPage && (
      <>
      {/* Floating Agent Entry */}
      <div className="fixed bottom-6 right-4 z-40">
        <button 
          onClick={() => navigate(`/agent?trade=${data.id}&ref=detail-${data.id}&symbol=${encodeURIComponent(data.symbol)}&pnl=${encodeURIComponent(data.profitVal)}&prompt=How%20did%20I%20execute%20these%20trades%3F`)}
          className="bg-[#0B2545] text-white p-2.5 rounded-full shadow-lg hover:scale-105 active:scale-95 transition-transform flex items-center justify-center relative"
        >
          <BotMessageSquare size={18} />
          <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#EE6C4D] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#F57C00]"></span>
          </span>
        </button>
      </div>
      </>
      )}
    </div>
  );
}
