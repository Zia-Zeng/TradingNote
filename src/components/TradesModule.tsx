import React, { useState, useEffect } from 'react';
import { MessageCircle, Edit3, Plus, Target, Tag, Edit2 } from 'lucide-react';
import { cn } from '../lib/utils';
import RecordDrawer from './RecordDrawer';
import { useSearchParams } from 'react-router-dom';

const INITIAL_TRADES = [
  {
    id: '1', time: '10:00', type: 'Sell', symbol: 'ZIJIN MINING', code: '601899', market: 'Stock',
    price: '26.81', qty: '200', amount: '¥ 5,362.00', closeVsFill: '+0.52%', closeVsFillColor: 'text-emerald-500',
    motive: { posTag: 'Close', tags: ['Target Hit', 'Trend'], desc: 'Close to my 27 target. Taking profit before the afternoon fade.' },
    plan: { tp: '27.00', sl: '23.50', desc: 'Taking profit before the afternoon fade.' },
    modifiedAt: ''
  },
  {
    id: '2', time: '11:10', type: 'Sell', symbol: 'ZIJIN INTL', code: '02259', market: 'Stock',
    price: '94.00', qty: '100', amount: '¥ 9,400.00', closeVsFill: '-1.49%', closeVsFillColor: 'text-rose-500',
    motive: { posTag: 'Stop Loss', tags: ['Support Break'], desc: 'Gold dipping with the market. Hit my 94 stop. Out.' },
    plan: { tp: '110.00', sl: '94.00', desc: 'Strict stop loss at 94.' },
    modifiedAt: ''
  },
  {
    id: '3', time: '14:30', type: 'Sell', symbol: 'JEREH', code: '002353', market: 'Stock',
    price: '140.00', qty: '100', amount: '¥ 14,000.00', closeVsFill: '-0.79%', closeVsFillColor: 'text-rose-500',
    motive: { posTag: 'Close', tags: ['Error Fix', 'Stop Loss'], desc: 'Short-term logic broke after a failed intraday bounce. Exiting, no averaging down.' },
    plan: { tp: '170.00', sl: '145.00', desc: 'Short-term logic broke. Exiting, no averaging down.' },
    modifiedAt: ''
  }
];

export default function TradesModule({ isCard = false }: { isCard?: boolean }) {
  const [trades, setTrades] = useState(INITIAL_TRADES);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingTrade, setEditingTrade] = useState<any>(null);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const action = searchParams.get('trade_action');
    if (action === 'edit') {
      setEditingTrade(trades[2] || trades[0]); // target JEREH for demo
      setDrawerOpen(true);
    } else if (action === 'add' || action === 'add_ocr') {
      setEditingTrade(null);
      setDrawerOpen(true);
    } else {
      setDrawerOpen(false);
    }
  }, [searchParams]);

  const handleEdit = (trade: any) => {
    setEditingTrade(trade);
    setDrawerOpen(true);
    const next = new URLSearchParams(searchParams);
    next.set('trade_action', 'edit');
    setSearchParams(next);
  };

  const handleAdd = () => {
    setEditingTrade(null);
    setDrawerOpen(true);
    const next = new URLSearchParams(searchParams);
    next.set('trade_action', 'add');
    setSearchParams(next);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    const next = new URLSearchParams(searchParams);
    next.delete('trade_action');
    setSearchParams(next);
  };

  const handleSave = (data: any) => {
    if (editingTrade) {
      setTrades(trades.map(t => t.id === editingTrade.id ? {
        ...t,
        symbol: data.symbol, price: data.price, qty: data.qty,
        motive: { posTag: data.posTag, tags: data.tags, desc: data.motiveDesc },
        plan: { tp: data.tp, sl: data.sl, desc: data.planDesc },
        modifiedAt: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
      } : t));
    } else {
      setTrades([{
        id: Date.now().toString(),
        time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
        type: data.direction,
        symbol: data.symbol || 'NEW STOCK', code: '000000', market: 'Stock',
        price: data.price, qty: data.qty, amount: `¥ ${(Number(data.price || 0)*Number(data.qty || 0)).toFixed(2)}`,
        closeVsFill: '0.00%', closeVsFillColor: 'text-slate-500',
        motive: { posTag: data.posTag, tags: data.tags, desc: data.motiveDesc },
        plan: { tp: data.tp, sl: data.sl, desc: data.planDesc },
        modifiedAt: ''
      }, ...trades]);
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

      <div className="relative pl-12 space-y-6 before:absolute before:left-[43px] before:top-2 before:bottom-0 before:w-px before:bg-slate-200">
        {trades.map(trade => (
          <div key={trade.id} className="relative">
            <div className="absolute -left-[43px] top-0 text-[12px] font-bold font-mono text-[#0B2545]">{trade.time}</div>
            <div className="absolute -left-1.5 top-1.5 w-2.5 h-2.5 rounded-full bg-white border-2 border-[#EE6C4D] z-10 shadow-sm"></div>
            
            <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-[0_2px_8px_rgba(11,37,69,0.02)]">
              <div className="flex justify-between items-center mb-3">
                <div className="flex items-center gap-2">
                  <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border", trade.type === 'Buy' ? "bg-blue-50 text-blue-600 border-blue-100" : "bg-rose-50 text-rose-500 border-rose-100")}>{trade.type}</span>
                  <span className="font-bold text-[#0B2545] text-[14px]">{trade.symbol}</span>
                  <span className="text-[10px] text-slate-400 font-mono">{trade.code}</span>
                </div>
                <button onClick={() => handleEdit(trade)} className="text-slate-400 hover:text-[#EE6C4D] active:scale-95 p-1 transition-all">
                  <Edit2 size={12} />
                </button>
              </div>
              
              <div className="grid grid-cols-3 gap-2 mb-3 border-b border-slate-100 pb-3">
                <div>
                  <div className="text-[9px] text-slate-400 uppercase font-bold tracking-wider mb-0.5">Price × Qty</div>
                  <div className="text-[#0B2545] font-bold font-mono text-[12px]">{Number(trade.price).toFixed(2)} × {trade.qty}</div>
                </div>
                <div>
                  <div className="text-[9px] text-slate-400 uppercase font-bold tracking-wider mb-0.5">Amount</div>
                  <div className="text-[#0B2545] font-bold font-mono text-[12px]">{trade.amount}</div>
                </div>
                <div className="text-right">
                  <div className="text-[9px] text-slate-400 uppercase font-bold tracking-wider mb-0.5">Close vs Fill</div>
                  <div className={cn("font-bold font-mono text-[12px]", trade.closeVsFillColor)}>{trade.closeVsFill}</div>
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
                  {trade.motive.tags.map((t: string) => (
                    <span key={t} className="bg-white border border-slate-200 text-slate-600 px-1.5 py-0.5 rounded text-[9px] font-bold shadow-sm">{t}</span>
                  ))}
                </div>
                
                {trade.motive.desc && (
                  <p className="text-[11px] text-slate-600 leading-relaxed font-medium mb-2.5">
                    {trade.motive.desc}
                  </p>
                )}
                
                {((trade.plan.tp && Number(trade.plan.tp) > 0) || (trade.plan.sl && Number(trade.plan.sl) > 0)) && (
                  <div className="flex items-center gap-3 mb-2 text-[9px] text-slate-500 font-medium">
                    {trade.plan.tp && Number(trade.plan.tp) > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="uppercase tracking-wider">TP</span>
                        <span className="font-mono text-slate-600">{Number(trade.plan.tp).toFixed(2)}</span>
                      </div>
                    )}
                    {trade.plan.sl && Number(trade.plan.sl) > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="uppercase tracking-wider">SL</span>
                        <span className="font-mono text-slate-600">{Number(trade.plan.sl).toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                )}
                
                {trade.plan.desc && (
                  <p className="text-[10px] text-slate-500 leading-relaxed italic border-l-2 border-slate-200 pl-2">
                    {trade.plan.desc}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <RecordDrawer 
        isOpen={drawerOpen} 
        onClose={closeDrawer} 
        initialData={editingTrade} 
        onSave={handleSave} 
        defaultTab={searchParams.get('trade_action') === 'add_ocr' ? 'ocr' : 'manual'}
        onUploadSuccess={() => {
          closeDrawer();
          const next = new URLSearchParams(searchParams);
          next.delete('trade_action');
          next.set('upload', 'success');
          setSearchParams(next);
        }}
      />
    </Wrapper>
  );
}