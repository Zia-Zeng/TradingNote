import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { PieChart as PieChartIcon } from 'lucide-react';
import { cn } from '../lib/utils';

const Sparkline = ({ data, isPositive }: { data: number[], isPositive: boolean }) => {
  const color = isPositive ? '#10b981' : '#f43f5e';
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const width = 60;
  const height = 30;
  const step = width / (data.length - 1);
  
  const points = data.map((val, i) => {
    const x = i * step;
    const y = height - ((val - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');

  const areaPoints = `${points} ${width},${height} 0,${height}`;

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="overflow-visible">
      <defs>
        <linearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polyline points={areaPoints} fill={`url(#grad-${color.replace('#', '')})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

export default function Report() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const currentAsset = searchParams.get('asset') || 'All';
  const [activeTab, setActiveTab] = useState(currentAsset);

  useEffect(() => {
    setActiveTab(currentAsset);
  }, [currentAsset]);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setSearchParams(tab === 'All' ? {} : { asset: tab });
  };

  const tabs = [
    { id: 'All', label: 'All' },
    { id: 'Stocks', label: 'Stocks' },
    { id: 'Bond', label: 'Bond' },
    { id: 'Crypto', label: 'Crypto' },
  ];

  const allPositions = [
    { id: '1', name: 'ZIJIN MINING', code: '601899', tag: 'Metals', tagColor: 'text-[#EE6C4D] border-[#EE6C4D]/30 bg-[#EE6C4D]/5', price: '26.81', change: '+3.2%', changeColor: 'text-emerald-500', value: '5,362.00', ratio: '8% / 10%', pnl: '+462.00', pnlPct: '+9.4%', type: 'Stocks', chartData: [20, 22, 21, 24, 23, 26, 26.81] },
    { id: '2', name: 'JEREH', code: '002353', tag: 'Oil & Gas', tagColor: 'text-[#0B2545] border-[#0B2545]/30 bg-[#0B2545]/5', price: '140.00', change: '-4.1%', changeColor: 'text-rose-500', value: '14,000.00', ratio: '12% / 15%', pnl: '-1,500.00', pnlPct: '-9.6%', type: 'Stocks', chartData: [155, 152, 148, 150, 145, 142, 140] },
    { id: '4', name: 'BIG DATA ETF', code: '159739', tag: 'Computing', tagColor: 'text-[#0B2545] border-[#0B2545]/30 bg-[#0B2545]/5', price: '1.050', change: '+1.5%', changeColor: 'text-emerald-500', value: '4,200.00', ratio: '5% / 5%', pnl: '+400.00', pnlPct: '+10.5%', type: 'Stocks', chartData: [0.9, 0.95, 0.94, 0.98, 1.0, 1.02, 1.050] },
    { id: '5', name: '10Y CGB', code: '019547', tag: 'Safe Haven', tagColor: 'text-emerald-600 border-emerald-200 bg-emerald-50', price: '104.320', change: '+0.1%', changeColor: 'text-emerald-500', value: '10,432.00', ratio: '15% / 20%', pnl: '+12.00', pnlPct: '+0.1%', type: 'Bond', chartData: [104.1, 104.2, 104.15, 104.25, 104.3, 104.31, 104.32] },
    { id: '7', name: 'US TLT', code: 'TLT', tag: 'Treasury', tagColor: 'text-emerald-600 border-emerald-200 bg-emerald-50', price: '92.15', change: '-0.5%', changeColor: 'text-rose-500', value: '18,430.00', ratio: '10% / 10%', pnl: '-125.00', pnlPct: '-0.7%', type: 'Bond', chartData: [95, 94.5, 93, 93.5, 92.8, 92.5, 92.15] },
    { id: '6', name: 'BITCOIN', code: 'BTC/USDT', tag: 'High Vol', tagColor: 'text-purple-600 border-purple-200 bg-purple-50', price: '64,200.00', change: '-2.4%', changeColor: 'text-rose-500', value: '25,680.00', ratio: '10% / 10%', pnl: '-630.00', pnlPct: '-2.4%', type: 'Crypto', chartData: [68000, 67500, 66000, 66500, 65000, 64500, 64200] },
    { id: '8', name: 'ETHEREUM', code: 'ETH/USDT', tag: 'High Vol', tagColor: 'text-purple-600 border-purple-200 bg-purple-50', price: '3,450.00', change: '+1.2%', changeColor: 'text-emerald-500', value: '17,250.00', ratio: '5% / 5%', pnl: '+420.00', pnlPct: '+2.5%', type: 'Crypto', chartData: [3200, 3100, 3150, 3300, 3350, 3400, 3450] }
  ];

  const filteredPositions = activeTab === 'All' ? allPositions : allPositions.filter(p => p.type === activeTab);

  return (
    <div className="w-full min-h-full pb-[100px] bg-[#F8F9FA] font-sans text-slate-900 relative">
      {/* Header & Tabs */}
      <div className="bg-white px-3 pt-[54px] pb-2.5 shadow-[0_2px_10px_rgba(0,0,0,0.02)] relative z-20 sticky top-0 border-b border-slate-100">
        <h1 className="text-[16px] font-bold text-[#0B2545] mb-3 tracking-wide flex items-center gap-1.5">
          <PieChartIcon size={18} className="text-[#EE6C4D]" /> Portfolio Tracking
        </h1>
        
        <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 overflow-x-auto no-scrollbar">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={cn(
                "flex-1 min-w-[60px] py-1.5 text-[11px] font-bold rounded-md transition-all text-center",
                activeTab === tab.id 
                  ? "bg-[#0B2545] text-white shadow-sm" 
                  : "bg-transparent text-slate-500 hover:text-slate-700 shadow-none"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-2.5 py-3 space-y-2 relative z-0 min-h-[100px]">
        {/* Background glow effects */}
        <div className="absolute -left-4 top-10 w-32 h-32 bg-[#EE6C4D]/5 rounded-full blur-2xl pointer-events-none"></div>
        <div className="absolute -right-4 top-40 w-32 h-32 bg-[#0B2545]/5 rounded-full blur-2xl pointer-events-none"></div>

        <AnimatePresence mode="popLayout">
          {filteredPositions.map(pos => (
            <motion.div
              key={pos.id}
              layout
              initial={{ opacity: 0, scale: 0.98, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: -10 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              onClick={() => navigate(`/detail/${encodeURIComponent(pos.code)}`)}
              className="bg-white/70 backdrop-blur-xl rounded-xl p-3 border border-white shadow-[0_4px_12px_rgba(11,37,69,0.04)] active:scale-[0.99] transition-transform relative z-10 cursor-pointer"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex flex-col flex-1 min-w-0 pr-1">
                  <div className="flex items-baseline gap-1.5 truncate mb-1">
                    <span className="font-bold text-[#0B2545] text-[14px] truncate leading-none">{pos.name}</span>
                    <span className="text-[10px] text-slate-500 font-medium font-mono shrink-0 leading-none">{pos.code}</span>
                  </div>
                  <div className="flex items-center">
                    <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded border inline-block whitespace-nowrap leading-none", pos.tagColor)}>{pos.tag}</span>
                  </div>
                </div>
                
                <div className="w-[60px] h-[24px] shrink-0 mx-2 flex items-center justify-center">
                  <Sparkline data={pos.chartData} isPositive={!pos.change.startsWith('-')} />
                </div>

                <div className="flex flex-col items-end shrink-0 w-[64px]">
                  <div className="font-mono font-bold text-[#0B2545] text-[14px] leading-none mb-1.5">{pos.price}</div>
                  <div className={cn(
                    "text-[10px] font-bold font-mono px-1 py-0.5 rounded-sm text-white flex items-center justify-center min-w-[46px] w-full leading-none shadow-sm", 
                    pos.change.startsWith('-') ? "bg-rose-500" : "bg-emerald-500"
                  )}>
                    {pos.change}
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-4 gap-x-1 pt-2 border-t border-slate-100/60">
                <div className="min-w-0">
                  <div className="text-[8px] text-slate-400 mb-0.5 uppercase tracking-wide truncate leading-none">Value</div>
                  <div className="text-[11px] font-bold text-[#0B2545] font-mono truncate leading-none">{pos.value}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-[8px] text-slate-400 mb-0.5 uppercase tracking-wide truncate leading-none">Ratio</div>
                  <div className="text-[11px] font-bold text-[#0B2545] font-mono truncate leading-none">{pos.ratio}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-[8px] text-slate-400 mb-0.5 uppercase tracking-wide truncate leading-none">PnL Val</div>
                  <div className={cn("text-[11px] font-bold font-mono truncate leading-none", pos.pnl.startsWith('+') ? 'text-emerald-500' : 'text-rose-500')}>{pos.pnl}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-[8px] text-slate-400 mb-0.5 uppercase tracking-wide truncate leading-none">PnL %</div>
                  <div className={cn("text-[11px] font-bold font-mono truncate leading-none", pos.pnlPct.startsWith('+') ? 'text-emerald-500' : 'text-rose-500')}>{pos.pnlPct}</div>
                </div>
              </div>
            </motion.div>
          ))}
          {filteredPositions.length === 0 && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full flex items-center justify-center h-[100px] text-slate-400 text-[12px] font-medium bg-white/70 backdrop-blur-xl border border-dashed border-slate-300 rounded-xl relative z-10"
            >
              No positions match your filter
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
