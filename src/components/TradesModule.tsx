import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, Edit3, Plus, Target, Tag, Edit2, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { cn } from '../lib/utils';
import RecordDrawer from './RecordDrawer';
import { useSearchParams } from 'react-router-dom';
import { readLocalResult, SAVED_RESULTS_EVENT } from '../lib/saved-results';
import { apiRequest } from '../lib/api';
import { formatTradeTimestamp, toStoredTradeTime } from '../lib/trade-time';
import { notifyDailyReviewInputsChanged } from '../lib/daily-review';
import { formatCurrencyAmount } from '../lib/instruments';

type SavedReview = { date: string; asset: string; summary: string };

type TradeRecord = {
  id: string;
  time?: string;
  type: 'Buy' | 'Sell';
  symbol: string;
  code?: string;
  market?: string;
  asset_class?: string;
  currency?: string;
  price: number | string;
  qty: number | string;
  amount?: number | string;
  closeVsFill?: string;
  closeVsFillColor?: string;
  motive?: { posTag?: string; tags?: string[]; desc?: string };
  plan?: { tp?: number | string; sl?: number | string; desc?: string };
  modifiedAt?: string;
};

const normalizeTrade = (trade: TradeRecord): TradeRecord => ({
  ...trade,
  code: trade.code || '',
  amount: trade.amount ?? Number(trade.price) * Number(trade.qty),
  motive: { ...trade.motive, tags: trade.motive?.tags || [] },
  plan: trade.plan || {},
});

const formatAmount = (amount: number | string | undefined, currency?: string) => formatCurrencyAmount(amount, currency || 'CNY');

export default function TradesModule({ isCard = false, tradeDate }: { isCard?: boolean; tradeDate?: string }) {
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingTrade, setEditingTrade] = useState<any>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [savedReviews, setSavedReviews] = useState<Record<string, SavedReview | null>>({});
  const [tradeToDelete, setTradeToDelete] = useState<TradeRecord | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const visibleTrades = tradeDate
    ? trades.filter(trade => formatTradeTimestamp(trade.time).date === tradeDate)
    : trades;

  const loadTrades = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const records = await apiRequest<TradeRecord[]>('/api/trades');
      setTrades(records.map(normalizeTrade));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to load trade records.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { void loadTrades(); }, []);

  useEffect(() => {
    const sync = () => setSavedReviews({
      JEREH: readLocalResult<SavedReview>('tradingnote:review:2026-07-14:JEREH'),
    });
    sync();
    window.addEventListener(SAVED_RESULTS_EVENT, sync);
    return () => window.removeEventListener(SAVED_RESULTS_EVENT, sync);
  }, []);

  useEffect(() => {
    const action = searchParams.get('trade_action');
    if (action === 'edit') {
      if (isLoading) return;
      const requestedTrade = searchParams.get('trade_id');
      const selectedTrade = trades.find(trade => trade.id === requestedTrade) || (!requestedTrade ? trades[0] : null);
      if (!selectedTrade) {
        setEditingTrade(null);
        setDrawerOpen(false);
        return;
      }
      setEditingTrade(selectedTrade);
      setDrawerOpen(true);
    } else if (action === 'add' || action === 'add_ocr') {
      setEditingTrade(null);
      setDrawerOpen(true);
    } else {
      setDrawerOpen(false);
    }
  }, [searchParams, trades, isLoading]);

  const handleEdit = (trade: any) => {
    setEditingTrade(trade);
    setDrawerOpen(true);
    const next = new URLSearchParams(searchParams);
    next.set('trade_action', 'edit');
    next.set('trade_id', trade.id);
    setSearchParams(next);
  };

  const handleAdd = () => {
    setEditingTrade(null);
    setDrawerOpen(true);
    const next = new URLSearchParams(searchParams);
    next.set('trade_action', 'add');
    next.delete('trade_id');
    setSearchParams(next);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    const next = new URLSearchParams(searchParams);
    next.delete('trade_action');
    next.delete('trade_id');
    setSearchParams(next);
  };

  const handleSave = async (data: any) => {
    setMutationError(null);
    const amount = Number(data.price) * Number(data.qty);
    const payload: Omit<TradeRecord, 'id'> = {
      ...(editingTrade || {}),
      time: toStoredTradeTime(data.tradeDate, data.tradeClock),
      type: data.direction,
      symbol: data.symbol,
      code: data.code || undefined,
      market: data.market || editingTrade?.market || 'CN',
      asset_class: data.assetClass || editingTrade?.asset_class || 'Stock',
      currency: data.currency || editingTrade?.currency || 'CNY',
      price: Number(data.price),
      qty: Number(data.qty),
      amount,
      closeVsFill: editingTrade?.closeVsFill || '--',
      closeVsFillColor: editingTrade?.closeVsFillColor || 'text-slate-400',
      motive: { posTag: data.posTag, tags: data.tags, desc: data.motiveDesc },
      plan: { tp: data.tp || undefined, sl: data.sl || undefined, desc: data.planDesc },
      modifiedAt: editingTrade ? new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
    };

    try {
      const saved = editingTrade
        ? await apiRequest<TradeRecord>(`/api/trades/${encodeURIComponent(editingTrade.id)}`, { method: 'PUT', body: JSON.stringify(payload) })
        : await apiRequest<TradeRecord>('/api/trades', { method: 'POST', body: JSON.stringify(payload) });
      const normalized = normalizeTrade(saved);
      setTrades(current => editingTrade
        ? current.map(trade => trade.id === editingTrade.id ? normalized : trade)
        : [normalized, ...current]);
      notifyDailyReviewInputsChanged(data.tradeDate);
      if (editingTrade) {
        const previousDate = formatTradeTimestamp(editingTrade.time).date;
        if (previousDate && previousDate !== data.tradeDate) notifyDailyReviewInputsChanged(previousDate);
      }
      if (!editingTrade) closeDrawer();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save the trade record.';
      setMutationError(message);
      throw error;
    }
  };

  const handleDelete = async (trade: TradeRecord) => {
    setDeleteError(null);
    setTradeToDelete(trade);
  };

  const confirmDelete = async () => {
    if (!tradeToDelete) return;
    setIsDeleting(true);
    setDeleteError(null);
    setMutationError(null);
    try {
      await apiRequest<void>(`/api/trades/${encodeURIComponent(tradeToDelete.id)}`, { method: 'DELETE' });
      setTrades(current => current.filter(item => item.id !== tradeToDelete.id));
      const deletedDate = formatTradeTimestamp(tradeToDelete.time).date;
      if (deletedDate) notifyDailyReviewInputsChanged(deletedDate);
      setTradeToDelete(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Failed to delete the trade record.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleImported = (items: TradeRecord[]) => {
    const imported = items.map(normalizeTrade);
    const importedIds = new Set(imported.map(item => item.id));
    setTrades(current => [...imported, ...current.filter(item => !importedIds.has(item.id))]);
    items.forEach(item => {
      const importedDate = formatTradeTimestamp(item.time).date;
      if (importedDate) notifyDailyReviewInputsChanged(importedDate);
    });
  };

  const Wrapper = isCard ? 'div' : 'div';
  const wrapperClass = isCard 
    ? "bg-white/90 backdrop-blur-md rounded-xl p-3 border border-white shadow-[0_4px_12px_rgba(11,37,69,0.03)] relative overflow-hidden mb-2" 
    : "bg-white px-4 py-4 mb-2 shadow-sm relative z-10";

  return (
    <Wrapper className={wrapperClass}>
      <div className="flex justify-between items-center mb-5 relative z-10">
        <h2 className="text-[14px] font-bold text-[#0B2545] flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-full border-2 border-slate-300 flex items-center justify-center text-[10px] text-slate-400">
            L
          </span> Trades
        </h2>
        <div className="flex items-center gap-2">
          {!isCard && <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded uppercase mr-1">By Time</span>}
          <button onClick={handleAdd} className="bg-[#EE6C4D] hover:bg-[#F57C00] active:scale-95 px-2 py-1 rounded-md text-white text-[10px] font-bold flex items-center gap-1 transition-all shadow-sm">
            <Plus size={10} /> Record
          </button>
        </div>
      </div>

      {loadError && (
        <div role="alert" className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-[11px] text-rose-700">
          <div className="flex items-start gap-2"><AlertTriangle size={14} className="mt-0.5 shrink-0" /><span className="flex-1">{loadError}</span></div>
          <button onClick={() => void loadTrades()} className="mt-2 font-bold underline">Retry</button>
        </div>
      )}
      {mutationError && <p role="alert" className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700">{mutationError}</p>}
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-slate-400"><Loader2 size={15} className="animate-spin" />Loading trades…</div>
      ) : loadError ? null : visibleTrades.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
          <p className="text-[13px] font-bold text-[#0B2545]">{tradeDate ? 'No trades recorded for this date' : 'No trades yet'}</p>
          <p className="mt-1 text-[11px] text-slate-500">{tradeDate ? 'Use Record above to add a trade for this day.' : 'Add your first trade to save it to your ledger.'}</p>
          {!tradeDate && <button onClick={handleAdd} className="mt-3 rounded-lg bg-[#EE6C4D] px-3 py-2 text-[11px] font-bold text-white"><Plus size={12} className="mr-1 inline" />Add trade</button>}
        </div>
      ) : <div className="relative pl-16 space-y-6 before:absolute before:left-[55px] before:top-2 before:bottom-0 before:w-px before:bg-slate-200">
        {visibleTrades.map(trade => (
          <div key={trade.id} className="relative">
            {formatTradeTimestamp(trade.time).time && <div className="absolute right-full mr-4 top-0 w-11 whitespace-nowrap text-right text-[10px] font-bold font-mono text-[#0B2545]">{formatTradeTimestamp(trade.time).time}</div>}
            <div className="absolute -left-[14px] top-1.5 w-2.5 h-2.5 rounded-full bg-white border-2 border-[#EE6C4D] z-10 shadow-sm"></div>
            
            <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-[0_2px_8px_rgba(11,37,69,0.02)]">
              <div className="flex items-start justify-between gap-1.5 mb-3">
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  <span className={cn("mt-0.5 shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border", trade.type === 'Buy' ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-600 border-rose-200")}>{trade.type}</span>
                  <div className="flex min-w-0 flex-col items-start">
                    <span title={trade.symbol} className="max-w-full break-all text-[13px] font-bold leading-5 text-[#0B2545]">{trade.symbol}</span>
                    {trade.code && <span className="mt-0.5 shrink-0 text-[9px] text-slate-400 font-mono">{trade.code}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button onClick={() => handleEdit(trade)} aria-label="Edit trade record" className="text-slate-400 hover:text-[#EE6C4D] active:scale-95 p-1 transition-all"><Edit2 size={12} /></button>
                  <button onClick={() => void handleDelete(trade)} aria-label="Delete trade record" className="text-slate-400 hover:text-rose-600 active:scale-95 p-1 transition-all"><Trash2 size={12} /></button>
                </div>
              </div>
              {formatTradeTimestamp(trade.time).date
                ? <div className="-mt-2 mb-2.5 text-[9px] font-mono text-slate-400">{formatTradeTimestamp(trade.time).time ? 'Trade time' : 'Trade date'} {formatTradeTimestamp(trade.time).date}{formatTradeTimestamp(trade.time).time ? ` ${formatTradeTimestamp(trade.time).time}` : ''}</div>
                : <div className="-mt-2 mb-2.5 text-[9px] text-amber-600">Trade date not recorded</div>}
              
              <div className="grid grid-cols-3 gap-2 mb-3 border-b border-slate-100 pb-3">
                <div>
                  <div className="text-[9px] text-slate-400 uppercase font-bold tracking-wider mb-0.5">Price ({trade.currency || 'CNY'})</div>
                  <div className="text-[#0B2545] font-bold font-mono text-[12px]">{Number(trade.price).toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-slate-400 uppercase font-bold tracking-wider mb-0.5">Qty</div>
                  <div className="text-[#0B2545] font-bold font-mono text-[12px]">{trade.qty}</div>
                </div>
                <div>
                  <div className="text-[9px] text-slate-400 uppercase font-bold tracking-wider mb-0.5">Amount</div>
                  <div className="text-[#0B2545] font-bold font-mono text-[12px]">{formatAmount(trade.amount, trade.currency)}</div>
                </div>
              </div>
              
              {/* Motive & Plan Inline */}
              <div className="bg-slate-50 border border-slate-100 rounded-lg p-2.5">
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-1.5">
                    <Tag size={12} className="text-[#EE6C4D]" />
                    <span className="text-[11px] font-bold text-[#0B2545]">Motive & Plan</span>
                  </div>
                  {trade.modifiedAt && (
                    <span className="text-[9px] text-slate-400 font-mono italic">Modified {trade.modifiedAt}</span>
                  )}
                </div>
                
                {(trade.motive?.tags?.length ?? 0) > 0 && <div className="flex flex-wrap gap-1.5 mb-2.5">
                  {trade.motive?.tags?.map((t: string) => (
                    <span key={t} className="bg-white border border-slate-200 text-slate-600 px-1.5 py-0.5 rounded text-[9px] font-bold shadow-sm">{t}</span>
                  ))}
                </div>}
                
                {trade.motive?.desc && (
                  <p className="text-[11px] text-slate-600 leading-relaxed font-medium mb-2.5">
                    {trade.motive.desc}
                  </p>
                )}
                
                {((trade.plan?.tp && Number(trade.plan.tp) > 0) || (trade.plan?.sl && Number(trade.plan.sl) > 0)) && (
                  <div className="flex items-center gap-3 mb-2 text-[9px] text-slate-500 font-medium">
                    {trade.plan?.tp && Number(trade.plan.tp) > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="uppercase tracking-wider">TP</span>
                        <span className="font-mono text-slate-600">{Number(trade.plan.tp).toFixed(2)}</span>
                      </div>
                    )}
                    {trade.plan?.sl && Number(trade.plan.sl) > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="uppercase tracking-wider">SL</span>
                        <span className="font-mono text-slate-600">{Number(trade.plan.sl).toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                )}
                
                {trade.plan?.desc && (
                  <p className="text-[10px] text-slate-500 leading-relaxed italic border-l-2 border-slate-200 pl-2">
                    {trade.plan.desc}
                  </p>
                )}
                {!(trade.motive?.tags?.length || trade.motive?.desc || (trade.plan?.tp && Number(trade.plan.tp) > 0) || (trade.plan?.sl && Number(trade.plan.sl) > 0) || trade.plan?.desc) && (
                  <button onClick={() => handleEdit(trade)} className="text-left text-[10px] text-slate-400 hover:text-[#EE6C4D]">Not added yet. Use Edit to add a motive and plan.</button>
                )}
              </div>
              {savedReviews[trade.symbol] && (
                <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/70 p-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-emerald-800">Saved AI Review</span>
                    <span className="text-[8px] font-bold uppercase text-emerald-700">{savedReviews[trade.symbol]?.date}</span>
                  </div>
                  <p className="text-[10px] text-slate-700 leading-relaxed">{savedReviews[trade.symbol]?.summary}</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>}

      <RecordDrawer 
        isOpen={drawerOpen} 
        onClose={closeDrawer} 
        initialData={editingTrade} 
        onSave={handleSave} 
        onImported={handleImported}
        defaultTab={searchParams.get('trade_action') === 'add_ocr' ? 'ocr' : 'manual'}
        defaultTradeDate={tradeDate}
      />
      {tradeToDelete && (() => {
        const dialog = (
          <div className="absolute inset-0 z-[110] flex items-center justify-center bg-[#0B2545]/45 p-6 pointer-events-auto" onMouseDown={event => { if (event.target === event.currentTarget && !isDeleting) setTradeToDelete(null); }}>
            <div role="alertdialog" aria-modal="true" aria-labelledby="delete-trade-title" className="w-full max-w-[320px] rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
              <h3 id="delete-trade-title" className="text-[14px] font-bold text-[#0B2545]">Delete this trade?</h3>
              <p className="mt-2 text-[12px] text-slate-600">Delete the record for “{tradeToDelete.symbol}”? This action cannot be undone.</p>
              {deleteError && <p role="alert" className="mt-2 rounded-lg bg-rose-50 p-2 text-[10px] text-rose-700">{deleteError}</p>}
              <div className="mt-4 flex justify-end gap-2">
                <button disabled={isDeleting} onClick={() => setTradeToDelete(null)} className="rounded-lg border border-slate-200 px-3 py-2 text-[11px] font-bold text-slate-600 disabled:opacity-50">Cancel</button>
                <button disabled={isDeleting} onClick={() => void confirmDelete()} className="rounded-lg bg-rose-600 px-3 py-2 text-[11px] font-bold text-white disabled:opacity-50">{isDeleting ? 'Deleting…' : 'Delete trade'}</button>
              </div>
            </div>
          </div>
        );
        const modalRoot = document.getElementById('app-modal-root');
        return modalRoot ? createPortal(dialog, modalRoot) : dialog;
      })()}
    </Wrapper>
  );
}
