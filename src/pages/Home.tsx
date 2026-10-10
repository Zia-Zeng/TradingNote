import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ChevronRight, ArrowUpRight, ShieldAlert, Plus, X, Tag, Sparkles, Target
} from 'lucide-react';
import { cn } from '../lib/utils';
import TradingCalendar from '../components/TradingCalendar';
import Attention from '../components/Attention';

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

export default function Home() {
  const [searchParams, setSearchParams] = useSearchParams();
  const isRecordOpen = searchParams.get('record') === 'open';
  const onboardParam = searchParams.get('onboard');
  const navigate = useNavigate();

  const [assetTab, setAssetTab] = useState(searchParams.get('asset') || 'All');
  const [onboardingStep, setOnboardingStep] = useState(0);

  useEffect(() => {
    setAssetTab(searchParams.get('asset') || 'All');
  }, [searchParams]);

  useEffect(() => {
    if (onboardParam === '1') setOnboardingStep(1);
    else if (onboardParam === '2') setOnboardingStep(2);
    else if (onboardParam === 'done') {
      setOnboardingStep(0);
      localStorage.setItem('m-tradingnote-onboarded', 'true');
    }
    else {
      const hasCompleted = localStorage.getItem('m-tradingnote-onboarded');
      if (!hasCompleted) {
        setOnboardingStep(1);
      } else {
        setOnboardingStep(0);
      }
    }
  }, [onboardParam]);

  const goToStep2 = () => {
    setOnboardingStep(2);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('onboard', '2');
      return next;
    });
  };

  const handleFinishOnboarding = () => {
    setOnboardingStep(0);
    localStorage.setItem('m-tradingnote-onboarded', 'true');
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('onboard', 'done');
      return next;
    });
  };

  const handleAssetTabChange = (tab: string) => {
    setAssetTab(tab);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (tab === 'All') next.delete('asset');
      else next.set('asset', tab);
      return next;
    });
  };

  const closeRecordDrawer = () => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('record');
      return next;
    });
  };

  const [selectedPosTag, setSelectedPosTag] = useState('Close');
  const [selectedTags, setSelectedTags] = useState<string[]>(['Stop Loss', 'Tech Break', 'No Logic']);

  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(selectedTags.filter(t => t !== tag));
    } else {
      setSelectedTags([...selectedTags, tag]);
    }
  };

  const allPositions = [
    { id: '1', name: 'ZIJIN MINING', code: '601899', tag: 'Metals', tagColor: 'text-[#EE6C4D] border-[#EE6C4D]/30 bg-[#EE6C4D]/5', price: '26.81', change: '+3.2%', changeColor: 'text-emerald-500', value: '5,362.00', ratio: '8% / 10%', pnl: '+462.00', pnlPct: '+9.4%', type: 'Stocks', chartData: [20, 22, 21, 24, 23, 26, 26.81] },
    { id: '4', name: 'BIG DATA ETF', code: '159739', tag: 'Computing', tagColor: 'text-[#0B2545] border-[#0B2545]/30 bg-[#0B2545]/5', price: '1.050', change: '+1.5%', changeColor: 'text-emerald-500', value: '4,200.00', ratio: '5% / 5%', pnl: '+400.00', pnlPct: '+10.5%', type: 'ETFs', chartData: [0.9, 0.95, 0.94, 0.98, 1.0, 1.02, 1.050] },
    { id: '5', name: '10Y CGB', code: '019547', tag: 'Safe Haven', tagColor: 'text-emerald-600 border-emerald-200 bg-emerald-50', price: '104.320', change: '+0.1%', changeColor: 'text-emerald-500', value: '10,432.00', ratio: '15% / 20%', pnl: '+12.00', pnlPct: '+0.1%', type: 'Bonds', chartData: [104.1, 104.2, 104.15, 104.25, 104.3, 104.31, 104.32] },
    { id: '6', name: 'BITCOIN', code: 'BTC/USDT', tag: 'High Vol', tagColor: 'text-purple-600 border-purple-200 bg-purple-50', price: '64,200.00', change: '-2.4%', changeColor: 'text-rose-500', value: '25,680.00', ratio: '10% / 10%', pnl: '-630.00', pnlPct: '-2.4%', type: 'Crypto', chartData: [68000, 67500, 66000, 66500, 65000, 64500, 64200] }
  ];

  const filteredPositions = assetTab === 'All' ? allPositions : allPositions.filter(p => p.type === assetTab);

  const isExpanded = searchParams.get('expand') === 'true';
  const toggleExpand = () => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (isExpanded) next.delete('expand');
      else next.set('expand', 'true');
      return next;
    });
  };
  
  const hasMorePositions = filteredPositions.length > 3;
  const displayedPositions = isExpanded ? filteredPositions : filteredPositions.slice(0, 3);

  const recentTrades = [
    { id: '2', date: 'Jul 14', name: 'JEREH', tags: 'Oil & Gas', action: 'Sell', actionColor: 'bg-[#EE6C4D]/10 text-[#EE6C4D] border-[#EE6C4D]/20', price: '140.00', vol: '100', pos: 'Close', motive: 'Stop Loss / Support Break' },
    { id: '3', date: 'Jul 14', name: 'ZIJIN INTL', tags: 'Gold', action: 'Sell', actionColor: 'bg-[#EE6C4D]/10 text-[#EE6C4D] border-[#EE6C4D]/20', price: '94.00', vol: '100', pos: 'Close', motive: 'Stop Loss / Market Dip' },
    { id: '1', date: 'Jul 14', name: 'ZIJIN MINING', tags: 'Metals', action: 'Sell', actionColor: 'bg-[#EE6C4D]/10 text-[#EE6C4D] border-[#EE6C4D]/20', price: '26.81', vol: '200', pos: 'Close', motive: 'Take Profit / Tech Break' },
    { id: '4', date: 'Jul 13', name: 'BIG DATA ETF', tags: 'Computing', action: 'Buy', actionColor: 'bg-[#0B2545]/10 text-[#0B2545] border-[#0B2545]/20', price: '0.950', vol: '4000', pos: 'Open', motive: 'Trend / Dip Buy' },
  ];

  return (
    <div className="w-full min-h-full pb-[80px] bg-[#F8F9FA]">
      {/* Top Header */}
      <div className="bg-white px-3 pt-[54px] pb-2 shadow-[0_2px_10px_rgba(0,0,0,0.02)] relative z-20 sticky top-0 border-b border-slate-100">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-[#0B2545] flex items-center justify-center text-white font-bold text-[12px] shadow-sm">
              M
            </div>
            <span className="font-bold text-[16px] text-[#0B2545] tracking-wide">M-TradingNote</span>
          </div>
          <button 
            onClick={() => {
              setSearchParams(prev => {
                const next = new URLSearchParams(prev);
                next.set('record', 'open');
                return next;
              });
            }}
            className="bg-[#EE6C4D] hover:bg-[#F57C00] active:scale-95 px-2.5 py-1.5 rounded-lg text-white text-[11px] font-bold flex items-center gap-1 transition-all shadow-sm"
          >
            <Plus size={12} /> Record
          </button>
        </div>
      </div>

      {/* Conditionally remove z-0 to allow Asset Summary Card's z-[101] to break out during Step 1 */}
      <div className={cn("px-2.5 py-2.5 space-y-2.5 relative", onboardingStep === 1 ? "" : "z-0")}>
        
        {/* Asset Summary Card */}
        <div className={cn(
          "bg-white/90 backdrop-blur-md rounded-xl p-3 border border-white relative transition-all duration-300",
          onboardingStep === 1 ? "z-[101] ring-4 ring-white/60 shadow-2xl scale-[1.02]" : "z-10 shadow-[0_4px_12px_rgba(11,37,69,0.03)]"
        )}>
          <div className="text-slate-500 text-[9px] font-medium mb-0.5 uppercase tracking-wider">Total Assets (CNY)</div>
          <div className="text-[26px] font-bold text-[#0B2545] font-mono tracking-tight flex items-baseline gap-1 mb-2">
            <span className="text-[16px] font-sans font-medium text-slate-400">¥</span>258,210.50
          </div>
          
          <div className="grid grid-cols-3 gap-2 border-t border-slate-100 pt-2.5">
            <div>
              <div className="text-slate-400 text-[9px] mb-0.5 uppercase tracking-wider">Positions</div>
              <div className="text-[#0B2545] font-bold text-[11px] flex items-center gap-0.5 font-mono">
                152,300 <span className="text-slate-400 font-normal ml-0.5 font-sans text-[9px]">(59%)</span>
              </div>
            </div>
            <div>
              <div className="text-slate-400 text-[9px] mb-0.5 uppercase tracking-wider">Total PnL</div>
              <div className="text-emerald-500 font-bold text-[11px] flex items-center gap-0.5 font-mono">
                <ArrowUpRight size={10} strokeWidth={2.5} /> 46,200 <span className="text-emerald-500/70 font-normal ml-0.5 font-sans text-[9px]">(26%)</span>
              </div>
            </div>
            <div>
              <div className="text-slate-400 text-[9px] mb-0.5 uppercase tracking-wider">Today PnL</div>
              <div className="text-emerald-500 font-bold text-[11px] flex items-center gap-0.5 font-mono">
                <ArrowUpRight size={10} strokeWidth={2.5} /> 3,330 <span className="text-emerald-500/70 font-normal ml-0.5 font-sans text-[9px]">(1.2%)</span>
              </div>
            </div>
          </div>

          {/* Onboarding Step 1 Tooltip */}
          {onboardingStep === 1 && (
            <div className="absolute top-full left-0 right-0 mt-4 bg-white rounded-xl p-3.5 shadow-xl animate-in fade-in slide-in-from-top-2 z-[102] pointer-events-auto text-left">
              <div className="absolute -top-2 left-8 w-4 h-4 bg-white rotate-45 rounded-sm"></div>
              <div className="relative z-10 text-[#0B2545] text-[12px] font-medium leading-relaxed mb-3">
                Your asset details and trade logs have been <span className="text-[#EE6C4D] font-bold">automatically imported</span> from your Future Assets brokerage account. Updates <span className="text-[#EE6C4D] font-bold">sync daily</span> after market close.
              </div>
              <div className="flex justify-end">
                <button 
                  onClick={(e) => { e.stopPropagation(); goToStep2(); }} 
                  className="bg-[#EE6C4D] text-white px-4 py-1.5 rounded-lg text-[11px] font-bold active:bg-[#F57C00] transition-colors shadow-sm"
                >
                  Got it!
                </button>
              </div>
            </div>
          )}
        </div>

        <TradingCalendar />

        <Attention />

        {/* Portfolio Performance */}
        <div className="pt-1">
          <div className="flex justify-between items-center mb-2 px-1">
            <h2 className="text-[14px] font-bold text-[#0B2545] tracking-tight shrink-0">Portfolio</h2>
            
            <div className="flex bg-white/50 backdrop-blur-md p-0.5 rounded border border-white shadow-[0_2px_8px_rgba(11,37,69,0.02)] overflow-x-auto no-scrollbar max-w-[65%] shrink-0">
              {['All', 'Stocks', 'ETFs', 'Bonds', 'Crypto'].map(tab => (
                <button 
                  key={tab}
                  onClick={() => handleAssetTabChange(tab)}
                  className={cn(
                    "px-2 py-0.5 text-[10px] font-bold rounded-sm transition-all whitespace-nowrap", 
                    assetTab === tab ? "bg-[#0B2545] text-white shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>
          
          <div className="flex flex-col gap-2 relative min-h-[100px]">
            <div className="absolute -left-4 top-10 w-32 h-32 bg-[#EE6C4D]/5 rounded-full blur-2xl pointer-events-none"></div>
            <div className="absolute -right-4 bottom-0 w-32 h-32 bg-[#0B2545]/5 rounded-full blur-2xl pointer-events-none"></div>
            
            <AnimatePresence mode="popLayout">
              {displayedPositions.map(pos => (
                <motion.div
                  key={pos.id}
                  layout
                  initial={{ opacity: 0, scale: 0.98, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98, y: -10 }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  className="bg-white/70 backdrop-blur-xl rounded-xl p-2 border border-white shadow-[0_4px_12px_rgba(11,37,69,0.04)] active:scale-[0.99] transition-transform relative z-10"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex flex-col flex-1 min-w-0 pr-1">
                      <div className="flex items-baseline gap-1.5 truncate mb-0.5">
                        <span className="font-bold text-[#0B2545] text-[12px] truncate leading-none">{pos.name}</span>
                        <span className="text-[9px] text-slate-500 font-medium font-mono shrink-0 leading-none">{pos.code}</span>
                      </div>
                      <div className="flex items-center">
                        <span className={cn("text-[8px] font-bold px-1 py-0.5 rounded border inline-block whitespace-nowrap leading-none", pos.tagColor)}>{pos.tag}</span>
                      </div>
                    </div>
                    
                    <div className="w-[50px] h-[20px] shrink-0 mx-2 flex items-center justify-center">
                      <Sparkline data={pos.chartData} isPositive={!pos.change.startsWith('-')} />
                    </div>

                    <div className="flex flex-col items-end shrink-0 w-[56px]">
                      <div className="font-mono font-bold text-[#0B2545] text-[13px] leading-none mb-1">{pos.price}</div>
                      <div className={cn(
                        "text-[9px] font-bold font-mono px-1 py-0.5 rounded-sm text-white flex items-center justify-center min-w-[42px] w-full leading-none", 
                        pos.change.startsWith('-') ? "bg-rose-500" : "bg-emerald-500"
                      )}>
                        {pos.change}
                      </div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-4 gap-x-1 pt-1.5 border-t border-white/60">
                    <div className="min-w-0">
                      <div className="text-[7px] text-slate-400 mb-0.5 uppercase tracking-wide truncate leading-none">Value</div>
                      <div className="text-[10px] font-bold text-[#0B2545] font-mono truncate leading-none">{pos.value}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[7px] text-slate-400 mb-0.5 uppercase tracking-wide truncate leading-none">Ratio</div>
                      <div className="text-[10px] font-bold text-[#0B2545] font-mono truncate leading-none">{pos.ratio}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[7px] text-slate-400 mb-0.5 uppercase tracking-wide truncate leading-none">PnL Val</div>
                      <div className={cn("text-[10px] font-bold font-mono truncate leading-none", pos.pnl.startsWith('+') ? 'text-emerald-500' : 'text-rose-500')}>{pos.pnl}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[7px] text-slate-400 mb-0.5 uppercase tracking-wide truncate leading-none">PnL %</div>
                      <div className={cn("text-[10px] font-bold font-mono truncate leading-none", pos.pnlPct.startsWith('+') ? 'text-emerald-500' : 'text-rose-500')}>{pos.pnlPct}</div>
                    </div>
                  </div>
                </motion.div>
              ))}
              {filteredPositions.length === 0 && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="w-full flex items-center justify-center h-[80px] text-slate-400 text-[11px] font-medium bg-white/70 backdrop-blur-xl border border-dashed border-white rounded-xl relative z-10"
                >
                  No positions match your filter
                </motion.div>
              )}
            </AnimatePresence>

            {hasMorePositions && (
              <button 
                onClick={toggleExpand}
                className="w-full py-1.5 flex items-center justify-center gap-1 text-[10px] font-bold text-slate-500 bg-white/50 backdrop-blur-md hover:bg-white/80 rounded-xl transition-colors border border-white shadow-[0_2px_8px_rgba(11,37,69,0.02)] relative z-10"
              >
                {isExpanded ? 'Show Less' : `Show All (${filteredPositions.length})`} 
              </button>
            )}
          </div>
        </div>
        
        {/* Recent Trades Timeline */}
        <div className="pt-1.5">
          <div className="flex justify-between items-end mb-2 px-1">
            <h2 className="text-[14px] font-bold text-[#0B2545] tracking-tight">Recent Trades</h2>
            <button className="text-[#EE6C4D] text-[10px] font-bold flex items-center hover:text-[#F57C00]">
              View All <ChevronRight size={12} />
            </button>
          </div>
          
          <div className="bg-white/90 backdrop-blur-md rounded-xl shadow-[0_4px_12px_rgba(11,37,69,0.03)] border border-white overflow-hidden relative z-10">
            {recentTrades.map((trade, idx) => (
              <div 
                key={idx}
                className="p-2.5 border-b border-slate-100/60 last:border-0 active:bg-slate-50 transition-colors cursor-pointer"
                onClick={() => navigate(`/detail/${trade.id}`)}
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={cn("px-1 py-0.5 rounded text-[9px] font-bold border", trade.actionColor)}>{trade.action}</span>
                    <span className="font-bold text-[#0B2545] text-[13px]">{trade.name}</span>
                    <span className="text-[9px] text-slate-500 bg-slate-50 border border-slate-200 px-1 py-0.5 rounded truncate max-w-[70px]">{trade.tags}</span>
                  </div>
                  <span className="text-[9px] text-slate-400 font-medium whitespace-nowrap ml-1">{trade.date}</span>
                </div>
                <div className="grid grid-cols-4 gap-1.5 text-[10px]">
                  <div className="min-w-0">
                    <div className="text-slate-400 mb-0.5 uppercase text-[8px] tracking-wide truncate">Price</div>
                    <div className="font-mono text-[#0B2545] font-bold truncate">{trade.price}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-slate-400 mb-0.5 uppercase text-[8px] tracking-wide truncate">Qty</div>
                    <div className="font-mono text-[#0B2545] font-bold truncate">{trade.vol}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-slate-400 mb-0.5 uppercase text-[8px] tracking-wide truncate">Action</div>
                    <div className="text-[#0B2545] font-bold truncate">{trade.pos}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-slate-400 mb-0.5 uppercase text-[8px] tracking-wide truncate">Motive</div>
                    <div className="text-[#0B2545] font-bold truncate">{trade.motive}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Global Onboarding Overlay */}
      {onboardingStep > 0 && (
        <div className="fixed inset-0 z-[100]">
          <div 
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] transition-opacity"
            onClick={() => {
              if (onboardingStep === 1) goToStep2();
              else if (onboardingStep === 2) handleFinishOnboarding();
            }}
          />
          
          {/* Step 2 Record Button Clone & Tooltip */}
          {onboardingStep === 2 && (
            <div className="absolute top-[54px] right-3 animate-in fade-in zoom-in-95 duration-200 pointer-events-auto">
              <button 
                onClick={(e) => { e.stopPropagation(); handleFinishOnboarding(); }}
                className="bg-[#EE6C4D] px-2.5 py-1.5 rounded-lg text-white text-[11px] font-bold flex items-center gap-1 shadow-xl ring-4 ring-white/50 relative z-10 scale-[1.05]"
              >
                <Plus size={12} /> Record
              </button>
              
              <div className="absolute top-full right-0 mt-3 w-[220px] bg-white rounded-xl p-3.5 shadow-xl">
                <div className="absolute -top-1.5 right-4 w-3 h-3 bg-white rotate-45 rounded-sm"></div>
                <div className="relative z-10 text-[#0B2545] text-[12px] font-medium leading-relaxed mb-3">
                  You can also tap here to log your trades manually.
                </div>
                <div className="flex justify-end">
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleFinishOnboarding(); }} 
                    className="bg-[#EE6C4D] text-white px-4 py-1.5 rounded-lg text-[11px] font-bold active:bg-[#F57C00] transition-colors shadow-sm"
                  >
                    Got it!
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* A1 Post-trade Record Entry Drawer */}
      <AnimatePresence>
        {isRecordOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeRecordDrawer}
              className="fixed inset-0 bg-[#0B2545]/40 z-[60] backdrop-blur-sm"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 220 }}
              className="fixed bottom-0 left-0 right-0 h-[85%] bg-[#F8F9FA] rounded-t-2xl z-[70] flex flex-col shadow-[0_-10px_40px_rgba(0,0,0,0.1)] overflow-hidden"
            >
              {/* Drawer Header */}
              <div className="px-3 py-3 flex justify-between items-center bg-white z-10 shadow-sm border-b border-slate-100">
                <div className="font-bold text-[15px] text-[#0B2545] flex items-center gap-2">
                  <div className="w-1.5 h-3.5 bg-[#EE6C4D] rounded-full"></div>
                  Add Trade Record
                </div>
                <button onClick={closeRecordDrawer} className="p-1.5 text-slate-500 bg-slate-100 rounded-full hover:bg-slate-200 transition-colors">
                  <X size={16} />
                </button>
              </div>
              
              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto p-3 pb-8 no-scrollbar space-y-4">
                {/* Base Info Card */}
                <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-200 relative overflow-hidden">
                   <div className="absolute top-0 left-0 w-1 h-full bg-[#EE6C4D]"></div>
                   <div className="flex items-center justify-between mb-2.5">
                     <div className="flex items-center gap-2">
                       <span className="bg-[#EE6C4D]/10 border border-[#EE6C4D]/20 text-[#EE6C4D] px-1.5 py-0.5 rounded text-[10px] font-bold uppercase">Sell</span>
                       <span className="font-bold text-[#0B2545] text-[14px]">JEREH</span>
                     </div>
                     <span className="text-slate-400 text-[11px] font-medium">Just now</span>
                   </div>
                   <div className="flex gap-3 text-[12px] bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                     <div className="flex flex-col"><span className="text-slate-400 text-[9px] uppercase mb-0.5 tracking-wider">Price</span> <span className="font-bold text-[#0B2545] font-mono text-[14px]">140.00</span></div>
                     <div className="w-px bg-slate-200 self-stretch my-1"></div>
                     <div className="flex flex-col"><span className="text-slate-400 text-[9px] uppercase mb-0.5 tracking-wider">Qty</span> <span className="font-bold text-[#0B2545] font-mono text-[14px]">100</span></div>
                   </div>
                </div>
                
                {/* Motive Section */}
                <div>
                  <div className="text-[14px] font-bold text-[#0B2545] mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-1.5"><Tag size={14} className="text-[#EE6C4D]" /> Motive</div>
                  </div>
                  
                  <div className="text-[10px] text-slate-500 mb-1.5 font-bold uppercase tracking-wider">Position Mgmt</div>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {['Open', 'Add', 'Reduce', 'Close', 'Watch'].map(tag => {
                      const isSelected = selectedPosTag === tag;
                      return (
                        <button 
                          key={tag}
                          onClick={() => setSelectedPosTag(tag)}
                          className={cn(
                            "px-2.5 py-1 rounded-md text-[11px] transition-all font-bold border",
                            isSelected ? "bg-[#0B2545] text-white border-[#0B2545] shadow-sm" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                          )}
                        >
                          {tag}
                        </button>
                      );
                    })}
                  </div>

                  <div className="text-[10px] text-slate-500 mb-1.5 font-bold uppercase tracking-wider">Tags (Multi)</div>
                  <div className="flex flex-wrap gap-1.5 mb-2.5">
                    {['Stop Loss', 'Take Profit', 'Trend', 'Support Break', 'No Logic', 'Error Fix', 'Market Dip', 'Sector Rot'].map(tag => {
                      const isSelected = selectedTags.includes(tag);
                      return (
                        <button 
                          key={tag}
                          onClick={() => toggleTag(tag)}
                          className={cn(
                            "px-2.5 py-1 rounded-md text-[11px] transition-all font-bold border",
                            isSelected ? "bg-[#EE6C4D]/10 text-[#EE6C4D] border-[#EE6C4D]/30" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                          )}
                        >
                          {tag}
                        </button>
                      );
                    })}
                    <button className="px-2.5 py-1 rounded-md text-[11px] font-bold border border-dashed border-slate-300 text-slate-500 bg-slate-50 flex items-center gap-1 hover:bg-slate-100">
                      <Plus size={12} /> Custom
                    </button>
                  </div>
                  <textarea 
                    placeholder="Personal logic (e.g. short-term logic invalidated after...)"
                    className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-[12px] min-h-[60px] focus:outline-none focus:border-[#EE6C4D] focus:ring-1 focus:ring-[#EE6C4D]/50 resize-none shadow-sm placeholder:text-slate-400 text-[#0B2545]"
                  />
                </div>
                
                {/* Plan Section */}
                <div>
                  <div className="text-[14px] font-bold text-[#0B2545] mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-1.5"><Target size={14} className="text-[#EE6C4D]" /> Trade Plan</div>
                    <button className="text-[10px] text-[#EE6C4D] bg-[#EE6C4D]/10 px-2 py-1 rounded-full font-bold flex items-center gap-1 active:bg-[#EE6C4D]/20 transition-colors">
                      <Sparkles size={10} /> Master's Setup
                    </button>
                  </div>
                  <div className="flex gap-2.5 mb-2.5">
                    <div className="flex-1 bg-white border border-slate-200 rounded-lg p-2.5 flex flex-col justify-center shadow-sm relative overflow-hidden min-w-0">
                      <span className="text-[9px] font-bold text-slate-500 mb-0.5 uppercase tracking-wide">Take Profit</span>
                      <input type="number" placeholder="0.00" className="w-full text-left bg-transparent text-[14px] font-bold font-mono focus:outline-none text-[#0B2545] placeholder:text-slate-300" />
                    </div>
                    <div className="flex-1 bg-white border border-slate-200 rounded-lg p-2.5 flex flex-col justify-center shadow-sm relative overflow-hidden min-w-0">
                      <span className="text-[9px] font-bold text-slate-500 mb-0.5 uppercase tracking-wide">Stop Loss</span>
                      <input type="number" placeholder="0.00" className="w-full text-left bg-transparent text-[14px] font-bold font-mono focus:outline-none text-[#0B2545] placeholder:text-slate-300" />
                    </div>
                  </div>
                  <textarea 
                    placeholder="Plan details (e.g. strict exit on 5-day MA break)..."
                    className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-[12px] min-h-[60px] focus:outline-none focus:border-[#EE6C4D] focus:ring-1 focus:ring-[#EE6C4D]/50 resize-none shadow-sm placeholder:text-slate-400 text-[#0B2545]"
                  />
                </div>
              </div>
              
              {/* Footer */}
              <div className="px-3 pt-3 pb-6 border-t border-slate-200 bg-white z-10 shadow-[0_-4px_20px_rgba(0,0,0,0.03)]">
                 <button 
                   onClick={closeRecordDrawer} 
                   className="w-full bg-[#0B2545] text-white rounded-lg py-3 font-bold text-[14px] shadow-sm active:bg-[#134074] transition-colors"
                 >
                   Save Record
                 </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
