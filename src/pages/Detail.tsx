import React, { useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { 
  ChevronLeft, MoreHorizontal,
  BotMessageSquare, Target, Zap, Clock,
  CheckCircle2, XCircle, Info, Sparkles, MessageCircle, Tag, Edit2
} from 'lucide-react';
import { ComposedChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, ReferenceLine, Scatter, Brush } from 'recharts';
import { cn } from '../lib/utils';

const BuyMarker = (props: any) => {
  const { cx, cy, payload } = props;
  if (!payload || payload.buyPrice === undefined) return null;
  return (
    <g transform={`translate(${cx},${cy})`}>
      <rect x={-8} y={-20} width={16} height={12} fill="#3b82f6" rx={2} />
      <text x={0} y={-14} fill="white" fontSize={8} textAnchor="middle" dominantBaseline="central" fontWeight="bold">B</text>
      <path d="M -3 -8 L 0 -5 L 3 -8 Z" fill="#3b82f6" />
    </g>
  )
}

const SellMarker = (props: any) => {
  const { cx, cy, payload } = props;
  if (!payload || payload.sellPrice === undefined) return null;
  return (
    <g transform={`translate(${cx},${cy})`}>
      <rect x={-8} y={8} width={16} height={12} fill="#f97316" rx={2} />
      <text x={0} y={14} fill="white" fontSize={8} textAnchor="middle" dominantBaseline="central" fontWeight="bold">S</text>
      <path d="M -3 8 L 0 5 L 3 8 Z" fill="#f97316" />
    </g>
  )
}

type TimelineItem = {
  id: string;
  type: string;
  action?: string;
  date: string;
  price?: number;
  qty?: number;
  amount?: string;
  fees?: string;
  text?: string;
  closeVsFill?: string;
  closeVsFillColor?: string;
  motive?: { posTag: string; tags: string[]; desc: string };
  plan?: { tp: string; sl: string; desc: string };
};

type TradeDetail = {
  timeline: TimelineItem[];
  [key: string]: any;
};

const tradeData: Record<string, TradeDetail> = {
  '1': {
    id: '1', symbol: 'ZIJIN MINING', code: '601899', market: 'A-Share', direction: 'Sell', status: 'Closed',
    statusColor: 'text-slate-500', statusBadgeColor: 'bg-slate-100 text-slate-600',
    time: '2026-07-14 10:00:00', timeStr: 'Jul 14', shares: 200, buyPrice: 24.50, currentPrice: 26.81, 
    profitPct: '+9.4%', profitPctColor: 'text-emerald-500', profitVal: '¥ 462', positionPct: '0%',
    chartColor: '#10b981',
    chartData: [
      { time: '07-01', price: 22.1 }, { time: '07-02', price: 22.4 }, { time: '07-03', price: 23.0 },
      { time: '07-04', price: 23.5 }, { time: '07-05', price: 23.8 }, { time: '07-08', price: 24.0 }, 
      { time: '07-09', price: 24.5, buyPrice: 24.5 }, { time: '07-10', price: 25.2 },
      { time: '07-11', price: 26.0 }, { time: '07-12', price: 25.8 }, 
      { time: '07-13', price: 27.1 }, { time: '07-14', price: 26.81, sellPrice: 26.81 }, { time: '07-15', price: 26.5 }
    ],
    plan: { target: 27.00, stopLoss: 23.50, desc: 'Take profit in tranches at target, strict stop loss below 23.50' },
    timeline: [
      { id: '1', type: 'Trade', action: 'Buy', date: '2026-07-09 10:30', price: 24.50, qty: 200, amount: '¥ 4,900.00', fees: '¥ 1.50', motive: { posTag: 'Open', tags: ['Conviction', 'Trend Follow'], desc: 'High volume breakout confirmed the entry logic. Holding.' }, plan: { tp: '27.00', sl: '23.50', desc: 'Take profit in tranches at target, strict stop loss below 23.50' } },
      { id: 'n1', type: 'Note', date: '2026-07-11 14:20', text: 'Consolidating nicely above the 5-day MA. Metals sector still seeing strong inflows. Maintaining conviction.' },
      { id: '2', type: 'Trade', action: 'Sell', date: '2026-07-14 10:00', price: 26.81, qty: 200, amount: '¥ 5,362.00', fees: '¥ 1.50', closeVsFill: '+9.43%', closeVsFillColor: 'text-emerald-500', motive: { posTag: 'Close', tags: ['Relieved', 'Target Hit'], desc: 'Felt a bit regretful after selling. Could have gone higher. Will wait another day next time.' }, plan: { tp: '', sl: '', desc: '' } }
    ],
    analysis: {
      pnl: 'Bought on right-side breakout, rode the uptrend, and secured profits early due to market volatility.',
      execution: 'Followed plan',
      deviation: 'Actual exit at 26.81 was slightly below 27.00 target, a reasonable early exit to mitigate risk.',
      comprehensive: 'Market sentiment recovered, sustained inflows into the metals sector pushed the stock higher.',
      suggestion: 'Maintain the strict exit discipline. Consider wider take-profit bands for similar setups next time.'
    }
  },
  '2': {
    id: '2', symbol: 'JEREH', code: '002353', market: 'A-Share', direction: 'Sell', status: 'Closed',
    statusColor: 'text-slate-500', statusBadgeColor: 'bg-slate-100 text-slate-600',
    time: '2026-07-14 14:30:00', timeStr: 'Jul 14', shares: 100, buyPrice: 155.0, currentPrice: 140.0,
    profitPct: '-9.6%', profitPctColor: 'text-rose-500', profitVal: '- ¥ 1,500', positionPct: '0%',
    chartColor: '#f43f5e',
    chartData: [
      { time: '07-01', price: 142.0 }, { time: '07-02', price: 145.0 }, { time: '07-03', price: 146.5 },
      { time: '07-04', price: 147.0 }, { time: '07-05', price: 148.0 }, { time: '07-08', price: 150.0 }, 
      { time: '07-09', price: 155.0, buyPrice: 155.0 }, { time: '07-10', price: 152.0 },
      { time: '07-11', price: 148.0 }, { time: '07-12', price: 145.0 }, 
      { time: '07-13', price: 142.0 }, { time: '07-14', price: 140.0, sellPrice: 140.0 }, { time: '07-15', price: 138.0 }
    ],
    plan: { target: 170.00, stopLoss: 145.00, desc: 'Short-term bounce play, strict hold if above 145' },
    timeline: [
      { id: '1', type: 'Trade', action: 'Buy', date: '2026-07-09 14:00', price: 155.00, qty: 100, amount: '¥ 15,500.00', fees: '¥ 5.00', motive: { posTag: 'Open', tags: ['FOMO', 'Impulsive'], desc: 'Saw it pumping, jumped in without waiting for pullback.' }, plan: { tp: '170.00', sl: '145.00', desc: 'Short-term bounce play, strict hold if above 145' } },
      { id: 'n1', type: 'Note', date: '2026-07-12 09:15', text: 'Price broke below 145 temporarily but recovered. Worried about the overall sector trend. Need to stick to the stop loss strictly.' },
      { id: '2', type: 'Trade', action: 'Sell', date: '2026-07-14 14:30', price: 140.00, qty: 100, amount: '¥ 14,000.00', fees: '¥ 5.00', closeVsFill: '-9.68%', closeVsFillColor: 'text-rose-500', motive: { posTag: 'Close', tags: ['Regret', 'Loss Cut'], desc: 'Short-term logic invalidated after failed intraday trade. Exited to correct the error, no averaging down.' }, plan: { tp: '', sl: '', desc: '' } }
    ],
    analysis: {
      pnl: 'Emotional FOMO entry without fundamental support, failed to cut losses early.',
      execution: 'Failed to follow plan',
      deviation: 'Planned stop at 145.00, actual exit at 140.00. Incurred 3.4% unnecessary loss.',
      comprehensive: 'Oil & gas sector is in a downtrend without independent momentum.',
      suggestion: 'Execute stops unconditionally without delay. Avoid pure emotional trades lacking fundamental catalysts.'
    }
  },
  '4': {
    id: '4', symbol: 'BIG DATA ETF', code: '159739', market: 'A-Share', direction: 'Buy', status: 'Open',
    statusColor: 'text-blue-500', statusBadgeColor: 'bg-blue-50 text-blue-600',
    time: '2026-07-13 10:15:00', timeStr: 'Jul 13', shares: 4000, buyPrice: 0.950, currentPrice: 1.050, 
    profitPct: '+10.5%', profitPctColor: 'text-emerald-500', profitVal: '¥ 400', positionPct: '1.6%',
    chartColor: '#10b981',
    chartData: [
      { time: '07-01', price: 0.85 }, { time: '07-02', price: 0.86 }, { time: '07-03', price: 0.87 },
      { time: '07-04', price: 0.88 }, { time: '07-05', price: 0.90 }, { time: '07-08', price: 0.92 },
      { time: '07-09', price: 0.91 }, { time: '07-10', price: 0.93 }, { time: '07-11', price: 0.94 }, 
      { time: '07-12', price: 0.94 }, { time: '07-13', price: 1.05, buyPrice: 0.95 }, { time: '07-14', price: 1.06 }, { time: '07-15', price: 1.04 }
    ],
    plan: { target: 1.15, stopLoss: 0.90, desc: 'Entering in tranches, strict stop loss below 0.90' },
    timeline: [
      { id: '1', type: 'Trade', action: 'Buy', date: '2026-07-13 10:15', price: 0.950, qty: 4000, amount: '¥ 3,800.00', fees: '¥ 1.50', motive: { posTag: 'Open', tags: ['Calm', 'Planned'], desc: 'Capital shifting from high valuation tech to low valuation data computing. Starting with a partial position.' }, plan: { tp: '1.15', sl: '0.90', desc: 'Entering in tranches, strict stop loss below 0.90' } },
      { id: 'n1', type: 'Note', date: '2026-07-14 11:30', text: 'Volume is expanding. Will consider adding the second tranche if it breaks above 1.10.' }
    ],
    analysis: {
      pnl: 'Accurate judgment and excellent entry timing, riding the sector rotation trend.',
      execution: 'Followed plan',
      deviation: 'First tranche execution completed as planned.',
      comprehensive: 'Significant capital inflows detected in the computing and big data sectors.',
      suggestion: 'Sufficient profit cushion established. Consider adding to the position if it breaks 1.10 to maximize gains.'
    }
  }
};

export default function Detail() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const scrollTo = searchParams.get('scroll');
  const navigate = useNavigate();
  const data = tradeData[id as keyof typeof tradeData] || tradeData['1'];

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
  }, [id, scrollTo]);

  return (
    <div id="detail-root" className="w-full min-h-full pb-[40px] bg-[#F4F5F7] font-sans text-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-[54px] pb-2 bg-white sticky top-0 z-30 shadow-sm border-b border-slate-100">
        <button onClick={() => navigate('/')} className="p-2 -ml-2 text-slate-700 active:bg-slate-100 rounded-full transition-colors">
          <ChevronLeft size={20} />
        </button>
        <div className="flex flex-col items-center">
          <h1 className="text-[14px] font-bold text-[#0B2545] tracking-tight">{data.symbol}</h1>
          <span className="text-[9px] text-slate-400 font-medium mt-0.5">{data.market} • {data.code}</span>
        </div>
        <button className="p-2 -mr-2 text-slate-700 active:bg-slate-100 rounded-full transition-colors">
          <MoreHorizontal size={20} />
        </button>
      </div>

      {/* Top Summary */}
      <div className="bg-white px-3 py-3 mb-1 shadow-sm">
        <div className="flex justify-between items-end mb-3">
          <div>
            <div className="flex items-center gap-1 mb-1">
              <span className={cn("border px-1 py-0.5 rounded text-[9px] font-bold", 
                data.direction === 'Buy' ? "bg-blue-50 text-blue-600 border-blue-100" : "bg-[#EE6C4D]/10 text-[#EE6C4D] border-[#EE6C4D]/20"
              )}>{data.direction}</span>
              <span className="text-[10px] text-slate-500 font-medium">{data.timeStr} • {data.shares} shares</span>
            </div>
            <div className="text-[20px] font-bold font-mono text-[#0B2545] flex items-baseline gap-1 tracking-tight">
              {data.currentPrice.toFixed(3)}
            </div>
          </div>
          <div className="text-right">
            <div className={cn("font-bold text-[14px] flex items-center justify-end gap-1 mb-0.5", data.profitPctColor)}>
              {data.profitPct}
            </div>
            <div className="text-[9px] text-slate-500 font-medium">
              PnL <span className="font-bold text-[#134074] ml-1 font-mono">{data.profitVal}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-1.5">
          <div className="bg-slate-50 px-2 py-1.5 rounded-lg text-[9px] font-medium text-slate-500 flex-1 text-center border border-slate-100 uppercase">
            Status <span className={cn("font-bold ml-1 normal-case text-[10px]", data.statusColor)}>{data.status}</span>
          </div>
          <div className="bg-slate-50 px-2 py-1.5 rounded-lg text-[9px] font-medium text-slate-500 flex-1 text-center border border-slate-100 uppercase">
            Entry <span className="text-[#134074] font-bold font-mono ml-1 text-[10px]">{data.buyPrice.toFixed(3)}</span>
          </div>
        </div>
      </div>

      {/* Chart Section */}
      <div className="bg-white pt-4 pb-3 mb-1 shadow-sm overflow-hidden">
        <div className="h-[220px] w-full pb-2 px-2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data.chartData} margin={{ top: 25, right: 15, left: 15, bottom: 5 }}>
              <defs>
                <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={data.chartColor} stopOpacity={0.25}/>
                  <stop offset="95%" stopColor={data.chartColor} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{fontSize: 9, fill: '#94a3b8', fontWeight: 500}} dy={10} minTickGap={15} />
              <YAxis mirror={true} domain={['dataMin - (dataMax-dataMin)*0.1', 'dataMax + (dataMax-dataMin)*0.1']} axisLine={false} tickLine={false} tick={{fontSize: 9, fill: '#94a3b8', fontWeight: 500, fontFamily: 'monospace'}} dx={-5} orientation="right" />
              <ReferenceLine y={data.plan.target} stroke="#EE6C4D" strokeDasharray="4 4" label={{ position: 'insideTopLeft', value: `TP ${data.plan.target.toFixed(2)}`, fill: '#EE6C4D', fontSize: 9, fontWeight: 'bold' }} />
              <ReferenceLine y={data.plan.stopLoss} stroke="#EE6C4D" strokeDasharray="4 4" label={{ position: 'insideBottomLeft', value: `SL ${data.plan.stopLoss.toFixed(2)}`, fill: '#EE6C4D', fontSize: 9, fontWeight: 'bold' }} />
              <Area type="monotone" dataKey="price" stroke={data.chartColor} strokeWidth={2} fillOpacity={1} fill="url(#colorPrice)" />
              <Scatter dataKey="buyPrice" shape={<BuyMarker />} />
              <Scatter dataKey="sellPrice" shape={<SellMarker />} />
              <Brush dataKey="time" height={24} stroke="#cbd5e1" fill="#f8fafc" travellerWidth={10} tickFormatter={() => ''} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* User Tracking */}
      <div id="notes-section" className="bg-white px-3 py-4 mb-1 shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-[14px] font-bold text-[#0B2545] flex items-center gap-1.5">
            <MessageCircle size={14} className="text-[#EE6C4D]" />
            User Tracking
          </h2>
        </div>

        {/* Trade History Timeline */}
        <div className="mb-2.5">
          <div className="relative before:absolute before:inset-0 before:ml-[3px] before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-[1px] before:bg-gradient-to-b before:from-transparent before:via-slate-200 before:to-transparent space-y-6">
            {data.timeline?.map(item => (
              <div key={item.id} className="relative flex items-start gap-2">
                <div className={cn("absolute left-0 w-2 h-2 rounded-full border-2 mt-1.5 z-10 shadow-sm", item.type === 'Note' ? "bg-white border-slate-300" : "bg-white border-[#EE6C4D]")}></div>
                <div className="pl-4 flex-1 w-full">
                  <div className="flex justify-between items-center mb-2">
                    <div className="text-[10px] text-slate-400 font-mono font-bold tracking-wider">{item.date}</div>
                    {item.type === 'Trade' && (
                      <span className={cn("px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider border", item.action === 'Buy' ? "bg-blue-50 text-blue-600 border-blue-100" : "bg-rose-50 text-rose-500 border-rose-100")}>{item.action}</span>
                    )}
                  </div>
                  
                  {item.type === 'Trade' ? (
                    <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-[0_2px_8px_rgba(11,37,69,0.02)]">
                      <div className="flex justify-between items-center mb-3">
                        <div className="flex items-center gap-2">
                          <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border", item.action === 'Buy' ? "bg-blue-50 text-blue-600 border-blue-100" : "bg-rose-50 text-rose-500 border-rose-100")}>{item.action}</span>
                          <span className="font-bold text-[#0B2545] text-[14px]">{data.symbol}</span>
                          <span className="text-[10px] text-slate-400 font-mono">{data.code}</span>
                        </div>
                        <button className="text-slate-400 hover:text-[#EE6C4D] active:scale-95 p-1 transition-all">
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
                          <div className="text-[#0B2545] font-bold font-mono text-[12px]">{item.amount}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[9px] text-slate-400 uppercase font-bold tracking-wider mb-0.5">Close vs Fill</div>
                          <div className={cn("font-bold font-mono text-[12px]", item.closeVsFillColor || "text-slate-400")}>{item.closeVsFill || '--'}</div>
                        </div>
                      </div>
                      
                      <div className="bg-slate-50 border border-slate-100 rounded-lg p-2.5">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5">
                            <Tag size={12} className="text-[#EE6C4D]" />
                            <span className="text-[11px] font-bold text-[#0B2545]">Motive & Plan</span>
                          </div>
                        </div>
                        
                        <div className="flex flex-wrap gap-1.5 mb-2.5">
                          {item.motive?.tags?.map((t: string) => (
                            <span key={t} className="bg-white border border-slate-200 text-slate-600 px-1.5 py-0.5 rounded text-[9px] font-bold shadow-sm">{t}</span>
                          ))}
                        </div>
                        
                        {item.motive?.desc && (
                          <p className="text-[11px] text-slate-600 leading-relaxed font-medium mb-2.5">
                            {item.motive.desc}
                          </p>
                        )}
                        
                        {((item.plan?.tp && Number(item.plan.tp) > 0) || (item.plan?.sl && Number(item.plan.sl) > 0)) && (
                          <div className="flex items-center gap-3 mb-2 text-[9px] text-slate-500 font-medium">
                            {item.plan.tp && Number(item.plan.tp) > 0 && (
                              <div className="flex items-center gap-1">
                                <span className="uppercase tracking-wider">TP</span>
                                <span className="font-mono text-slate-600">{Number(item.plan.tp).toFixed(2)}</span>
                              </div>
                            )}
                            {item.plan.sl && Number(item.plan.sl) > 0 && (
                              <div className="flex items-center gap-1">
                                <span className="uppercase tracking-wider">SL</span>
                                <span className="font-mono text-slate-600">{Number(item.plan.sl).toFixed(2)}</span>
                              </div>
                            )}
                          </div>
                        )}
                        
                        {item.plan?.desc && (
                          <p className="text-[10px] text-slate-500 leading-relaxed italic border-l-2 border-slate-200 pl-2">
                            {item.plan.desc}
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-[0_2px_8px_rgba(11,37,69,0.02)] relative group">
                      <div className="flex items-start gap-1.5">
                        <MessageCircle size={12} className="text-[#EE6C4D] shrink-0 mt-0.5" />
                        <p className="text-[12px] text-[#0B2545] leading-relaxed font-medium">
                          {item.text}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
            
            {/* Add a new note */}
            <div className="relative flex items-start gap-2 pt-2">
              <div className="absolute left-0 w-2 h-2 rounded-full bg-slate-200 border-2 border-white mt-2 z-10"></div>
              <div className="pl-4 flex-1">
                <textarea 
                  placeholder="Add a quick note..."
                  className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-[12px] h-14 focus:outline-none focus:border-[#EE6C4D] resize-none transition-all placeholder:text-slate-400 shadow-sm text-[#0B2545]"
                />
                <div className="flex justify-end mt-2">
                  <button className="bg-[#0B2545] text-white px-3.5 py-1.5 rounded-lg text-[10px] font-bold shadow-sm active:bg-[#134074] transition-colors">Save Note</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* AI Tracking Analysis Section */}
      <div id="ai-section" className="bg-white px-3 py-3 mb-6 shadow-sm">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-[12px] font-bold text-[#0B2545] flex items-center gap-1">
            <Zap size={12} className="text-[#EE6C4D]" />
            AI Tracking
          </h2>
          <span className="bg-[#EE6C4D]/10 border border-[#EE6C4D]/20 text-[#EE6C4D] px-1.5 py-0.5 rounded text-[8px] font-bold flex items-center gap-0.5 shadow-sm uppercase">
            <Clock size={8} /> Post-trade Update
          </span>
        </div>

        <div className="space-y-2.5">
          {/* PnL Attribution */}
          <div className="flex gap-2">
            <div className="w-1 h-1 rounded-full bg-blue-500 mt-1.5 shrink-0 shadow-[0_0_4px_rgba(59,130,246,0.6)]"></div>
            <div>
              <div className="text-[11px] font-bold text-[#0B2545] mb-0.5">PnL Attribution</div>
              <p className="text-[10px] text-slate-600 leading-relaxed">{data.analysis.pnl}</p>
            </div>
          </div>

          {/* Execution & Deviation */}
          <div className="flex gap-2">
            <div className="w-1 h-1 rounded-full bg-emerald-500 mt-1.5 shrink-0 shadow-[0_0_4px_rgba(16,185,129,0.6)]"></div>
            <div>
              <div className="text-[11px] font-bold text-[#0B2545] mb-0.5">Execution</div>
              <div className="bg-slate-50 border border-slate-100/60 rounded-lg p-2 mt-1 mb-1">
                <div className="flex items-center gap-1 mb-1">
                  {data.analysis.execution === 'Followed plan' ? <CheckCircle2 size={10} className="text-emerald-500" /> : <XCircle size={10} className="text-rose-500" />}
                  <span className="text-[10px] font-bold text-[#134074]">{data.analysis.execution}</span>
                </div>
                <div className="text-[10px] text-slate-500 flex items-start gap-1">
                  <Info size={10} className="shrink-0 mt-0.5" />
                  <span className="leading-relaxed">Deviation: {data.analysis.deviation}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Market Context */}
          <div className="flex gap-2">
            <div className="w-1 h-1 rounded-full bg-purple-500 mt-1.5 shrink-0 shadow-[0_0_4px_rgba(168,85,247,0.6)]"></div>
            <div>
              <div className="text-[11px] font-bold text-[#0B2545] mb-0.5">Market Context</div>
              <p className="text-[10px] text-slate-600 leading-relaxed">{data.analysis.comprehensive}</p>
            </div>
          </div>

          {/* AI Suggestion */}
          <div className={cn("border rounded-xl p-2.5 shadow-sm mt-2", 
            id === '2' ? "bg-emerald-50/50 border-emerald-100" : "bg-[#EE6C4D]/5 border-[#EE6C4D]/20"
          )}>
            <div className={cn("flex items-center gap-1 text-[11px] font-bold mb-1", id === '2' ? "text-emerald-700" : "text-[#EE6C4D]")}>
              <Sparkles size={11} /> AI Suggestion
            </div>
            <p className="text-[10px] text-[#134074] leading-relaxed">{data.analysis.suggestion}</p>
          </div>
        </div>
      </div>

      {/* Floating Agent Entry */}
      <div className="fixed bottom-6 right-4 z-40">
        <button 
          onClick={() => navigate(`/agent?trade=${data.id}`)} 
          className="bg-[#0B2545] text-white p-2.5 rounded-full shadow-lg hover:scale-105 active:scale-95 transition-transform flex items-center justify-center relative"
        >
          <BotMessageSquare size={18} />
          <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#EE6C4D] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#F57C00]"></span>
          </span>
        </button>
      </div>
    </div>
  );
}
