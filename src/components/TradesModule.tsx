import React, { useState, useEffect } from 'react';
import { MessageCircle, Edit3, Plus, Target, Tag, Edit2, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { cn } from '../lib/utils';
import RecordDrawer from './RecordDrawer';
import { useSearchParams } from 'react-router-dom';
import { readLocalResult, SAVED_RESULTS_EVENT } from '../lib/saved-results';
import { apiRequest } from '../lib/api';

type SavedReview = { date: string; asset: string; summary: string };

type TradeRecord = {
  id: string;
  time?: string;
  type: 'Buy' | 'Sell';
  symbol: string;
  code?: string;
  market?: string;
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

const formatAmount = (amount: number | string | undefined) => {
  const value = Number(amount);
  return Number.isFinite(value) ? `¥ ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--';
};

export default function TradesModule({ isCard = false }: { isCard?: boolean }) {
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingTrade, setEditingTrade] = useState<any>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [savedReviews, setSavedReviews] = useState<Record<string, SavedReview | null>>({});

  const loadTrades = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const records = await apiRequest<TradeRecord[]>('/api/trades');
      setTrades(records.map(normalizeTrade));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '交易记录加载失败。');
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
      time: editingTrade?.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: data.direction,
      symbol: data.symbol,
      code: data.code || undefined,
      market: editingTrade?.market || 'Stock',
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
      if (!editingTrade) closeDrawer();
    } catch (error) {
      const message = error instanceof Error ? error.message : '交易记录保存失败。';
      setMutationError(message);
      throw error;
    }
  };

  const handleDelete = async (trade: TradeRecord) => {
    if (!window.confirm(`删除 ${trade.symbol} 这条交易记录？`)) return;
    setMutationError(null);
    try {
      await apiRequest<void>(`/api/trades/${encodeURIComponent(trade.id)}`, { method: 'DELETE' });
      setTrades(current => current.filter(item => item.id !== trade.id));
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : '交易记录删除失败。');
    }
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
          <button onClick={() => void loadTrades()} className="mt-2 font-bold underline">重试加载</button>
        </div>
      )}
      {mutationError && <p role="alert" className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700">{mutationError}</p>}
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-slate-400"><Loader2 size={15} className="animate-spin" />正在加载交易记录…</div>
      ) : loadError ? null : trades.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
          <p className="text-[13px] font-bold text-[#0B2545]">还没有交易记录</p>
          <p className="mt-1 text-[11px] text-slate-500">添加第一笔记录后，它会保存在后端账本中。</p>
          <button onClick={handleAdd} className="mt-3 rounded-lg bg-[#EE6C4D] px-3 py-2 text-[11px] font-bold text-white"><Plus size={12} className="mr-1 inline" />新增交易</button>
        </div>
      ) : <div className="relative pl-12 space-y-6 before:absolute before:left-[43px] before:top-2 before:bottom-0 before:w-px before:bg-slate-200">
        {trades.map(trade => (
          <div key={trade.id} className="relative">
            <div className="absolute -left-[43px] top-0 text-[12px] font-bold font-mono text-[#0B2545]">{trade.time}</div>
            <div className="absolute -left-1.5 top-1.5 w-2.5 h-2.5 rounded-full bg-white border-2 border-[#EE6C4D] z-10 shadow-sm"></div>
            
            <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-[0_2px_8px_rgba(11,37,69,0.02)]">
              <div className="flex justify-between items-center mb-3">
                <div className="flex items-center gap-2">
                  <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border", trade.type === 'Buy' ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-600 border-rose-200")}>{trade.type}</span>
                  <span className="font-bold text-[#0B2545] text-[14px]">{trade.symbol}</span>
                  {trade.code && <span className="text-[10px] text-slate-400 font-mono">{trade.code}</span>}
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => handleEdit(trade)} aria-label="编辑交易记录" className="text-slate-400 hover:text-[#EE6C4D] active:scale-95 p-1 transition-all"><Edit2 size={12} /></button>
                  <button onClick={() => void handleDelete(trade)} aria-label="删除交易记录" className="text-slate-400 hover:text-rose-600 active:scale-95 p-1 transition-all"><Trash2 size={12} /></button>
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-2 mb-3 border-b border-slate-100 pb-3">
                <div>
                  <div className="text-[9px] text-slate-400 uppercase font-bold tracking-wider mb-0.5">Price × Qty</div>
                  <div className="text-[#0B2545] font-bold font-mono text-[12px]">{Number(trade.price).toFixed(2)} × {trade.qty}</div>
                </div>
                <div>
                  <div className="text-[9px] text-slate-400 uppercase font-bold tracking-wider mb-0.5">Amount</div>
                  <div className="text-[#0B2545] font-bold font-mono text-[12px]">{formatAmount(trade.amount)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[9px] text-slate-400 uppercase font-bold tracking-wider mb-0.5">Close vs Fill</div>
                  <div className={cn("font-bold font-mono text-[12px]", trade.closeVsFillColor || 'text-slate-400')}>{trade.closeVsFill || '--'}</div>
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
                
                <div className="flex flex-wrap gap-1.5 mb-2.5">
                  {trade.motive?.tags?.map((t: string) => (
                    <span key={t} className="bg-white border border-slate-200 text-slate-600 px-1.5 py-0.5 rounded text-[9px] font-bold shadow-sm">{t}</span>
                  ))}
                </div>
                
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
        defaultTab={searchParams.get('trade_action') === 'add_ocr' ? 'ocr' : 'manual'}
      />
    </Wrapper>
  );
}
