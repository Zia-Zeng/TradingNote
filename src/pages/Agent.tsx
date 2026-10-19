import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import { 
  BotMessageSquare, Send, User, 
  ChevronLeft, BarChart2, BookOpen,
  History, Sparkles, AlertTriangle, Info, FileText, Activity, MessageSquare, LineChart, Target,
  Settings, Play, ArrowLeft, CheckCircle2, Search, X, Loader2, MessageSquarePlus
} from 'lucide-react';
import { 
  ComposedChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Scatter 
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { readLocalResult, saveLocalResult } from '../lib/saved-results';
import { apiRequest } from '../lib/api';

type ConversationSummary = {
  conversation_id: string;
  title: string;
  updated_at: string;
  message_count: number;
};

type ConversationHistory = {
  conversation_id: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string; created_at: string }>;
};

type AgentTradeContext = {
  id?: string;
  symbol: string;
  type: 'Buy' | 'Sell';
  price: number;
  qty: number;
  amount?: string | number;
  motive?: { posTag?: string; tags?: string[]; desc?: string };
  plan?: { tp?: string | number; sl?: string | number; desc?: string };
};

interface Message {
  id: string;
  role: 'user' | 'agent';
  content: React.ReactNode;
}

const STRATEGIES = [
  { id: 'sma', name: 'SMA Crossover', logic: 'Catch trend change via moving average crossing', buyDesc: 'SMA20 crosses above SMA50', sellDesc: 'SMA20 crosses below SMA50' },
  { id: 'rsi', name: 'RSI Bounce', logic: 'Trade overbought / oversold momentum', buyDesc: 'RSI(14) < 30 then rebounds above 30', sellDesc: 'RSI(14) > 70 then falls below 70' },
  { id: 'macd', name: 'MACD Divergence', logic: 'Spot weakening price momentum', buyDesc: 'Bullish divergence + MACD crosses signal', sellDesc: 'Bearish divergence + MACD crosses signal' },
  { id: 'bollinger', name: 'Bollinger Band Breakout', logic: 'Low volatility squeeze precedes big move', buyDesc: 'Band squeeze + price closes above upper band', sellDesc: 'Price closes below lower band' },
  { id: 'volume', name: 'Volume Confirmed Breakout', logic: 'Volume confirms valid breakout', buyDesc: 'Price breaks resistance, vol ≥ 1.5x avg', sellDesc: 'Price breaks support, volume spikes' }
];

const baseChartData = [
  { date: '06-01', price: 100 }, { date: '06-02', price: 98 }, { date: '06-03', price: 95 },
  { date: '06-04', price: 97 }, { date: '06-05', price: 102 }, { date: '06-06', price: 105 },
  { date: '06-07', price: 108 }, { date: '06-08', price: 112 }, { date: '06-09', price: 115 },
  { date: '06-10', price: 118 }, { date: '06-11', price: 116 }, { date: '06-12', price: 110 },
  { date: '06-13', price: 108 }, { date: '06-14', price: 105 }, { date: '06-15', price: 107 },
  { date: '06-16', price: 111 }, { date: '06-17', price: 114 }, { date: '06-18', price: 113 },
  { date: '06-19', price: 110 }, { date: '06-20', price: 105 }
];

const generateChartData = (strategy: string) => {
  const data = JSON.parse(JSON.stringify(baseChartData));
  if (strategy === 'sma') {
    data[4].buyPrice = 102; data[11].sellPrice = 110;
  } else if (strategy === 'rsi') {
    data[2].buyPrice = 95; data[9].sellPrice = 118;
  } else if (strategy === 'macd') {
    data[14].buyPrice = 107; data[17].sellPrice = 113;
  } else if (strategy === 'bollinger') {
    data[6].buyPrice = 108; data[13].sellPrice = 105;
  } else if (strategy === 'volume') {
    data[5].buyPrice = 105; data[12].sellPrice = 108;
  }
  return data;
};

const STATS = {
  sma: { winRate: '65%', return: '+12.4%', trades: 14, maxDrawdown: '-4.2%' },
  rsi: { winRate: '72%', return: '+18.1%', trades: 21, maxDrawdown: '-3.8%' },
  macd: { winRate: '58%', return: '+9.2%', trades: 11, maxDrawdown: '-6.1%' },
  bollinger: { winRate: '60%', return: '+15.5%', trades: 8, maxDrawdown: '-8.0%' },
  volume: { winRate: '68%', return: '+22.0%', trades: 16, maxDrawdown: '-5.5%' },
};

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

const Thinking = () => (
  <div className="flex items-center gap-1.5 p-1 h-[20px]">
    <div className="w-1.5 h-1.5 rounded-full bg-[#EE6C4D] animate-bounce" style={{ animationDelay: '0ms' }} />
    <div className="w-1.5 h-1.5 rounded-full bg-[#EE6C4D] animate-bounce" style={{ animationDelay: '150ms' }} />
    <div className="w-1.5 h-1.5 rounded-full bg-[#EE6C4D] animate-bounce" style={{ animationDelay: '300ms' }} />
  </div>
);

export default function Agent() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tradeId = searchParams.get('trade');
  const action = searchParams.get('action');
  const step = searchParams.get('step');
  const tab = searchParams.get('tab') || 'chat';
  const reference = searchParams.get('ref');
  const isAssetReference = Boolean(reference?.startsWith('detail-'));
  const isDailyReference = Boolean(reference && /^daily-\d{4}-\d{2}-\d{2}$/.test(reference));
  const draftAsset = searchParams.get('asset') || 'ZIJIN MINING';
  
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [savedTracking, setSavedTracking] = useState(false);
  const [savedPlan, setSavedPlan] = useState(false);
  const [savedReview, setSavedReview] = useState(false);
  const [savedTask, setSavedTask] = useState(false);
  const [savedTasks, setSavedTasks] = useState<any[]>(() => readLocalResult<any[]>('tradingnote:backtest-tasks') || []);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<ConversationSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadingConversation, setLoadingConversation] = useState<string | null>(null);
  const chatSessionRef = useRef(0);
  const skipNextRouteSyncRef = useRef(false);
  
  const navigate = useNavigate();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (skipNextRouteSyncRef.current) {
      skipNextRouteSyncRef.current = false;
      return;
    }
    if (tab === 'backtest') {
      const btStep = searchParams.get('bt_step');
      const strat = searchParams.get('strategy');
      const tick = searchParams.get('ticker');
      const showDetail = searchParams.get('task_detail');

      const msgs: Message[] = [];
      
      const presetMsg = (
        <div className="w-[260px] max-w-full">
          <p className="mb-2 text-[12px] leading-relaxed">What strategy would you like to backtest? Describe your idea or select a preset below:</p>
          <div className="space-y-2">
            {STRATEGIES.map(s => (
              <div 
                key={s.id}
                onClick={() => setSearchParams({ tab: 'backtest', bt_step: '1', strategy: s.id })}
                className="p-2.5 rounded-xl border border-slate-200 bg-white active:bg-slate-50 cursor-pointer shadow-sm relative overflow-hidden"
              >
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#EE6C4D] opacity-0 transition-opacity" />
                <div className="font-bold text-[12px] text-[#0B2545]">{s.name}</div>
                <div className="text-[10px] text-slate-500 mt-1">{s.logic}</div>
              </div>
            ))}
          </div>
        </div>
      );

      msgs.push({ id: 'bt_0', role: 'agent', content: presetMsg });

      if (btStep || showDetail) {
        const selectedStrat = STRATEGIES.find(s => s.id === strat);
        msgs.push({ id: 'bt_u1', role: 'user', content: `Let's test ${selectedStrat?.name || 'the strategy'}` });
        msgs.push({ id: 'bt_a1', role: 'agent', content: "Great! Please provide the target ticker symbol (e.g., AAPL, BTC, 601899)." });
      }

      if (btStep === '2' || btStep === '3' || showDetail) {
        msgs.push({ id: 'bt_u2', role: 'user', content: tick || 'AAPL' });
        
        const configMsg = (
          <div className="w-[240px] max-w-full">
            <p className="mb-2 text-[12px] leading-relaxed">I've formulated your backtest configuration:</p>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-2 shadow-inner">
              <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Strategy</div>
              <div className="text-[12px] font-bold text-[#0B2545] mb-2.5">{STRATEGIES.find(s => s.id === strat)?.name}</div>
              <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Target Ticker</div>
              <div className="text-[12px] font-bold text-[#0B2545] uppercase">{tick}</div>
            </div>
            {btStep === '2' && (
              <button 
                onClick={() => setSearchParams({ tab: 'backtest', bt_step: '3', strategy: strat || 'sma', ticker: tick || 'AAPL' })}
                className="w-full bg-[#0B2545] text-white py-2 rounded-lg text-[12px] font-bold active:bg-[#134074] shadow-sm flex items-center justify-center gap-1.5"
              >
                <Play size={12} fill="currentColor" /> Run Test
              </button>
            )}
          </div>
        );
        msgs.push({ id: 'bt_a2', role: 'agent', content: configMsg });
      }

      if (btStep === '3' || showDetail) {
        const stats = STATS[strat as keyof typeof STATS] || STATS.sma;
        const taskKey = `${strat || 'sma'}-${tick || 'AAPL'}`;
        const existingTasks = readLocalResult<any[]>('tradingnote:backtest-tasks') || [];
        setSavedTask(existingTasks.some(task => task.id === taskKey));
        const resultMsg = (
          <div className="w-[240px] max-w-full">
            <p className="mb-2 text-[12px] leading-relaxed">Backtest completed successfully. Save it to your tasks to keep the result.</p>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className="bg-emerald-50 border border-emerald-100 p-2.5 rounded-lg shadow-sm">
                <div className="text-[9px] text-emerald-600 font-bold uppercase tracking-wider mb-0.5">Win Rate</div>
                <div className="text-[14px] font-bold font-mono text-emerald-700">{stats.winRate}</div>
              </div>
              <div className="bg-emerald-50 border border-emerald-100 p-2.5 rounded-lg shadow-sm">
                <div className="text-[9px] text-emerald-600 font-bold uppercase tracking-wider mb-0.5">Return</div>
                <div className="text-[14px] font-bold font-mono text-emerald-700">{stats.return}</div>
              </div>
            </div>
            <button
              onClick={() => {
                const tasks = readLocalResult<any[]>('tradingnote:backtest-tasks') || [];
                const nextTasks = [{ id: taskKey, strategy: STRATEGIES.find(s => s.id === strat)?.name || 'SMA Crossover', ticker: tick || 'AAPL', stats, savedAt: new Date().toISOString() }, ...tasks.filter(task => task.id !== taskKey)];
                saveLocalResult('tradingnote:backtest-tasks', nextTasks);
                setSavedTasks(nextTasks);
                setSavedTask(true);
              }}
              className="w-full mb-2 bg-emerald-50 border border-emerald-200 text-emerald-800 py-2 rounded-lg text-[11px] font-bold active:bg-emerald-100"
            >{savedTask ? 'Saved to Tasks' : 'Save to Tasks'}</button>
            {!showDetail && (
              <button 
                onClick={() => {
                  const next = new URLSearchParams({ tab: 'backtest', bt_step: '3', task_detail: '1' });
                  if (strat) next.set('strategy', strat);
                  if (tick) next.set('ticker', tick);
                  setSearchParams(next);
                }}
                className="w-full bg-white border border-slate-200 text-[#0B2545] py-2 rounded-lg text-[11px] font-bold active:bg-slate-50 shadow-sm"
              >
                View Full Chart
              </button>
            )}
          </div>
        );
        msgs.push({ id: 'bt_a3', role: 'agent', content: resultMsg });
      }

      if (showDetail) {
        msgs.push({ id: 'bt_u3', role: 'user', content: "Show me the full chart" });
        
        const chartMsg = (
          <div className="w-[270px] max-w-full">
            <div className="flex items-center gap-1.5 mb-2">
              <LineChart size={14} className="text-[#EE6C4D]" />
              <span className="text-[12px] font-bold text-[#0B2545]">Simulated Signals</span>
            </div>
            <div className="h-[180px] w-full -ml-3 mt-2 bg-white rounded-lg pt-2 pb-1 pr-1 border border-slate-100 shadow-sm">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={generateChartData(strat || 'sma')} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorPriceBacktest" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0B2545" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#0B2545" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fontSize: 9, fill: '#94a3b8', fontWeight: 500}} dy={10} minTickGap={15} />
                  <YAxis domain={['dataMin - 5', 'dataMax + 5']} axisLine={false} tickLine={false} tick={{fontSize: 9, fill: '#94a3b8', fontWeight: 500, fontFamily: 'monospace'}} dx={-5} orientation="right" />
                  <Area type="monotone" dataKey="price" stroke="#0B2545" strokeWidth={2} fillOpacity={1} fill="url(#colorPriceBacktest)" />
                  <Scatter dataKey="buyPrice" shape={<BuyMarker />} />
                  <Scatter dataKey="sellPrice" shape={<SellMarker />} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[10px] text-slate-500 mt-2.5 bg-slate-50 p-2 rounded-md border border-slate-100 font-medium leading-relaxed">
              Green <strong className="text-[#10b981]">B</strong> marks Buy, red <strong className="text-[#ef4444]">S</strong> marks Sell. You can ask me to adjust the parameters or test another ticker.
            </p>
          </div>
        );
        msgs.push({ id: 'bt_a4', role: 'agent', content: chartMsg });
      }

      setMessages(msgs);
    } else {
      // Chat Tab logic
      if (tradeId === '1') {
        setMessages([
          { id: '1', role: 'agent', content: <p>Hi! I am M-Agent. What would you like to know?</p> },
          { id: '2', role: 'user', content: 'How did I execute the ZIJIN MINING trade?' },
          {
            id: '3',
            role: 'agent',
            content: (
              <div>
                <p className="mb-2 leading-relaxed">Deep dive into <span className="font-bold text-[#0B2545]">ZIJIN MINING (Sold Jul 14)</span>:</p>
                
                <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 mb-2.5 space-y-2">
                  <div className="text-[11px] text-slate-600 leading-relaxed">
                    <span className="font-bold text-[#0B2545] block mb-0.5">📌 Your Plan & Motive:</span>
                    You set the plan to <span className="text-[#EE6C4D] font-bold">'Take profit in tranches at target'</span>. Motive: <span className="text-[#EE6C4D] font-bold">'Right-side breakout'</span>.
                  </div>
                  <div className="text-[11px] text-slate-600 leading-relaxed border-t border-slate-200 pt-2">
                    <span className="font-bold text-[#0B2545] block mb-0.5">📊 Market & Execution:</span>
                    Metals saw inflows. Exiting early during market volatility was <span className="text-emerald-600 font-bold">decisive and logical!</span>
                  </div>
                </div>

                <div className="bg-[#EE6C4D]/5 p-2.5 rounded-xl border border-[#EE6C4D]/20 mb-2.5">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <BookOpen size={12} className="text-[#EE6C4D]" />
                    <span className="text-[11px] font-bold text-[#0B2545]">Based on your notes</span>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed font-medium">
                    You felt regretful after selling. <strong className="text-[#0B2545]">Consider re-entering with a tiny tracking position (5%) on a 5-day MA bounce to prevent FOMO.</strong>
                  </p>
                </div>

                <button 
                  onClick={() => navigate('/detail/1')}
                  className="w-full bg-white border border-slate-200 text-[#0B2545] py-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 active:bg-slate-50 shadow-sm transition-colors"
                >
                  Back to Details <ChevronLeft className="rotate-180" size={12} />
                </button>
              </div>
            )
          }
        ]);
      } else if (tradeId === '2') {
        setMessages([
          { id: '1', role: 'agent', content: <p>Hi! I am M-Agent. What would you like to know?</p> },
          { id: '2', role: 'user', content: 'Help me review the JEREH trade.' },
          {
            id: '3',
            role: 'agent',
            content: (
              <div>
                <p className="mb-2 leading-relaxed">Deep dive into <span className="font-bold text-[#0B2545]">JEREH (Sold Jul 14)</span>:</p>
                
                <div className="bg-rose-50 p-2.5 rounded-xl border border-rose-200 mb-2.5 space-y-2">
                  <div className="text-[11px] text-slate-700 leading-relaxed">
                    <span className="font-bold text-rose-700 block mb-0.5">📌 Plan vs Execution:</span>
                    Planned <span className="text-rose-600 font-bold">'Strict hold if above 145'</span>, exited at 140. Classic case of <strong className="text-rose-600">'holding a losing position'</strong>, causing 3.4% extra loss.
                  </div>
                </div>

                <div className="bg-emerald-50 p-2.5 rounded-xl border border-emerald-200 mb-2.5">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <BarChart2 size={12} className="text-emerald-600" />
                    <span className="text-[11px] font-bold text-[#0B2545]">Improvement</span>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed font-medium">
                    Win rate on "emotional following" is &lt;20%. <strong className="text-[#0B2545]">Next time, set a strict conditional stop-loss order in your broker app.</strong>
                  </p>
                </div>

                <button 
                  onClick={() => navigate('/detail/2')}
                  className="w-full bg-white border border-slate-200 text-[#0B2545] py-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 active:bg-slate-50 shadow-sm transition-colors"
                >
                  Back to Details <ChevronLeft className="rotate-180" size={12} />
                </button>
              </div>
            )
          }
        ]);
      } else if (action === 'draft') {
        const msgs: Message[] = [];
        msgs.push({ id: 'd1_u', role: 'user', content: 'Help me draft a solid investment plan based on my recent holdings.' });

        if (!step) {
          msgs.push({ id: 'd1_a', role: 'agent', content: <Thinking /> });
          setMessages(msgs);
          const t = setTimeout(() => setSearchParams({ action: 'draft', step: '1', tab: 'chat', asset: draftAsset }, { replace: true }), 1500);
          return () => clearTimeout(t);
        }

        const step1AgentActive = (
          <div>
            <p className="mb-2 text-[12px] leading-relaxed">I can help you build a solid trading plan. <strong>Which asset</strong> would you like to focus on?</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setSearchParams({ action: 'draft', step: '2_think', tab: 'chat', asset: 'ZIJIN MINING' })} className="px-2.5 py-1.5 bg-[#EE6C4D]/10 text-[#EE6C4D] border border-[#EE6C4D]/20 rounded-lg text-[11px] font-bold active:bg-[#EE6C4D]/20 transition-colors shadow-sm">ZIJIN MINING</button>
              <button onClick={() => setSearchParams({ action: 'draft', step: '2_think', tab: 'chat', asset: 'BIG DATA ETF' })} className="px-2.5 py-1.5 bg-white text-slate-600 border border-slate-200 rounded-lg text-[11px] font-bold active:bg-slate-50 transition-colors shadow-sm">BIG DATA ETF</button>
            </div>
          </div>
        );

        const step1AgentDisabled = (
          <div>
            <p className="mb-2 text-[12px] leading-relaxed">I can help you build a solid trading plan. <strong>Which asset</strong> would you like to focus on?</p>
            <div className="flex flex-wrap gap-2 opacity-60 pointer-events-none">
              <button className="px-2.5 py-1.5 bg-[#EE6C4D] text-white border border-[#EE6C4D] rounded-lg text-[11px] font-bold shadow-sm">ZIJIN MINING</button>
            </div>
          </div>
        );

        if (step === '1') {
          msgs.push({ id: 'd1_a', role: 'agent', content: step1AgentActive });
          setMessages(msgs);
          return;
        }

        msgs.push({ id: 'd1_a', role: 'agent', content: step1AgentDisabled });
        msgs.push({ id: 'd2_u', role: 'user', content: draftAsset });

        if (step === '2_think') {
          msgs.push({ id: 'd2_a', role: 'agent', content: <Thinking /> });
          setMessages(msgs);
          const t = setTimeout(() => setSearchParams({ action: 'draft', step: '2', tab: 'chat', asset: draftAsset }, { replace: true }), 1500);
          return () => clearTimeout(t);
        }

        const step2AgentActive = (
          <div>
            <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 shadow-sm mb-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Sparkles size={12} className="text-[#0B2545]" />
                <span className="text-[10px] font-bold text-[#0B2545] uppercase tracking-wider">Analysis</span>
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed font-medium">{draftAsset} is consolidating near support, with sector flows remaining steady.</p>
            </div>
            <p className="mb-2 text-[12px] leading-relaxed">To tailor the plan, what is your <strong>preferred holding period</strong>?</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setSearchParams({ action: 'draft', step: '3_think', tab: 'chat', asset: draftAsset })} className="px-2.5 py-1.5 bg-[#EE6C4D]/10 text-[#EE6C4D] border border-[#EE6C4D]/20 rounded-lg text-[11px] font-bold active:bg-[#EE6C4D]/20 transition-colors shadow-sm">Short-term Swing</button>
              <button onClick={() => setSearchParams({ action: 'draft', step: '3_think', tab: 'chat', asset: draftAsset })} className="px-2.5 py-1.5 bg-white text-slate-600 border border-slate-200 rounded-lg text-[11px] font-bold active:bg-slate-50 transition-colors shadow-sm">Medium-term Trend</button>
            </div>
          </div>
        );

        const step2AgentDisabled = (
          <div>
            <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 shadow-sm mb-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Sparkles size={12} className="text-[#0B2545]" />
                <span className="text-[10px] font-bold text-[#0B2545] uppercase tracking-wider">Analysis</span>
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed font-medium">ZIJIN MINING is currently in a consolidation phase near the 20-day MA. Metals sector shows steady inflow.</p>
            </div>
            <p className="mb-2 text-[12px] leading-relaxed">To tailor the plan, what is your <strong>preferred holding period</strong>?</p>
            <div className="flex flex-wrap gap-2 opacity-60 pointer-events-none">
              <button className="px-2.5 py-1.5 bg-[#EE6C4D] text-white border border-[#EE6C4D] rounded-lg text-[11px] font-bold shadow-sm">Short-term Swing</button>
            </div>
          </div>
        );

        if (step === '2') {
          msgs.push({ id: 'd2_a', role: 'agent', content: step2AgentActive });
          setMessages(msgs);
          return;
        }

        msgs.push({ id: 'd2_a', role: 'agent', content: step2AgentDisabled });
        msgs.push({ id: 'd3_u', role: 'user', content: 'Short-term Swing' });

        if (step === '3_think') {
          msgs.push({ id: 'd3_a', role: 'agent', content: <Thinking /> });
          setMessages(msgs);
          const t = setTimeout(() => setSearchParams({ action: 'draft', step: '3', tab: 'chat', asset: draftAsset }, { replace: true }), 2000);
          return () => clearTimeout(t);
        }

        const planTarget = draftAsset === 'BIG DATA ETF' ? { detailId: '4', tradeId: '1' } : { detailId: '1', tradeId: '2' };
        const timelineStorageKey = `tradingnote:timeline:${planTarget.detailId}`;
        const storedPlanRecord = (readLocalResult<any[]>(timelineStorageKey) || []).find(record => record.id === planTarget.tradeId);
        setSavedPlan(Boolean(storedPlanRecord?.aiPlan) || Boolean(readLocalResult(`tradingnote:plan:${draftAsset}`)));
        const step3AgentActive = (
          <div className="w-[240px] max-w-full">
            <p className="mb-3 text-[12px] leading-relaxed">Here is your customized <strong>Trading Discipline Plan</strong> for <span className="text-[#0B2545] font-bold">{draftAsset}</span>:</p>
            
            <div className="space-y-2.5">
              <div className="bg-white/80 backdrop-blur-md p-3 rounded-xl border border-white shadow-[0_4px_12px_rgba(11,37,69,0.04)]">
                <div className="text-[9px] text-slate-500 font-bold mb-1 uppercase tracking-wider">Entry Zone</div>
                <div className="text-[14px] font-bold text-[#0B2545] font-mono mb-1">{draftAsset === 'ZIJIN MINING' ? '25.80 - 26.00' : '0.98 - 1.00'}</div>
                <p className="text-[11px] text-slate-600 font-medium leading-relaxed">Wait for a pullback to the 5-day MA. Do not chase if it opens above 26.50.</p>
              </div>
              
              <div className="flex gap-2.5">
                <div className="flex-1 bg-rose-50/80 backdrop-blur-md p-3 rounded-xl border border-rose-100 shadow-[0_4px_12px_rgba(244,63,94,0.06)]">
                  <div className="text-[9px] text-rose-500 font-bold mb-1 uppercase tracking-wider">Hard Stop</div>
                  <div className="text-[14px] font-bold text-rose-700 font-mono mb-1">{draftAsset === 'ZIJIN MINING' ? '24.80' : '0.92'}</div>
                  <p className="text-[10px] text-rose-700/80 font-medium leading-tight">Close immediately on daily close below 24.80.</p>
                </div>
                <div className="flex-1 bg-emerald-50/80 backdrop-blur-md p-3 rounded-xl border border-emerald-100 shadow-[0_4px_12px_rgba(16,185,129,0.06)]">
                  <div className="text-[9px] text-emerald-600 font-bold mb-1 uppercase tracking-wider">Target</div>
                  <div className="text-[14px] font-bold text-emerald-700 font-mono mb-1">{draftAsset === 'ZIJIN MINING' ? '27.50' : '1.15'}</div>
                  <p className="text-[10px] text-emerald-700/80 font-medium leading-tight">Take 50% profit at target, trail the rest.</p>
                </div>
              </div>

              <div className="bg-[#0B2545] p-3 rounded-xl border border-[#0B2545] shadow-lg relative overflow-hidden mt-2">
                <div className="absolute -right-6 -top-6 w-24 h-24 bg-white/5 rounded-full blur-2xl pointer-events-none"></div>
                <div className="flex items-center gap-1.5 mb-2 relative z-10">
                  <AlertTriangle size={14} className="text-[#EE6C4D]" />
                  <span className="text-[11px] font-bold text-white uppercase tracking-wider">Behavioral Rule</span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed font-medium relative z-10">
                  Based on your history, you tend to exit short-term trades early. <strong className="text-white">Set a conditional stop-loss and do not watch intraday ticks.</strong> Let the plan execute.
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                const plan = { asset: draftAsset, entryZone: draftAsset === 'ZIJIN MINING' ? '25.80 - 26.00' : '0.98 - 1.00', stopLoss: draftAsset === 'ZIJIN MINING' ? '24.80' : '0.92', target: draftAsset === 'ZIJIN MINING' ? '27.50' : '1.15', rule: 'Set a conditional stop-loss at entry and avoid reacting to intraday noise.', savedAt: new Date().toISOString() };
                const key = `tradingnote:timeline:${planTarget.detailId}`;
                const records = readLocalResult<any[]>(key) || [];
                const currentRecord = records.find(record => record.id === planTarget.tradeId) || { id: planTarget.tradeId, type: 'Trade' };
                const updatedRecord = { ...currentRecord, aiPlan: plan, plan: { ...(currentRecord.plan || {}), tp: plan.target, sl: plan.stopLoss, desc: plan.rule } };
                saveLocalResult(key, [...records.filter(record => record.id !== planTarget.tradeId), updatedRecord]);
                setSavedPlan(true);
              }}
              className="w-full mt-3 bg-[#0B2545] text-white py-2 rounded-lg text-[11px] font-bold active:bg-[#134074]"
            >{savedPlan ? 'Plan Saved to Trade' : 'Save Plan to Latest Trade'}</button>
          </div>
        );

        if (step === '3') {
          msgs.push({ id: 'd3_a', role: 'agent', content: step3AgentActive });
          setMessages(msgs);
        }
      } else if (action === 'review') {
        const msgs: Message[] = [];
        msgs.push({ id: 'r1_u', role: 'user', content: 'Can you review my recent trades and point out any mistakes?' });

        if (!step) {
          msgs.push({ id: 'r1_a', role: 'agent', content: <Thinking /> });
          setMessages(msgs);
          const t = setTimeout(() => setSearchParams({ action: 'review', step: '1', tab: 'chat' }, { replace: true }), 1500);
          return () => clearTimeout(t);
        }

        const step1AgentActive = (
          <div>
            <p className="mb-2 text-[12px] leading-relaxed">Let's review your recent trades. <strong>Which asset</strong> would you like to analyze?</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setSearchParams({ action: 'review', step: '2_think', tab: 'chat' })} className="px-2.5 py-1.5 bg-[#EE6C4D]/10 text-[#EE6C4D] border border-[#EE6C4D]/20 rounded-lg text-[11px] font-bold active:bg-[#EE6C4D]/20 transition-colors shadow-sm">JEREH</button>
              <button onClick={() => setSearchParams({ action: 'review', step: '2_think', tab: 'chat' })} className="px-2.5 py-1.5 bg-white text-slate-600 border border-slate-200 rounded-lg text-[11px] font-bold active:bg-slate-50 transition-colors shadow-sm">ZIJIN MINING</button>
            </div>
          </div>
        );

        const step1AgentDisabled = (
          <div>
            <p className="mb-2 text-[12px] leading-relaxed">Let's review your recent trades. <strong>Which asset</strong> would you like to analyze?</p>
            <div className="flex flex-wrap gap-2 opacity-60 pointer-events-none">
              <button className="px-2.5 py-1.5 bg-[#EE6C4D] text-white border border-[#EE6C4D] rounded-lg text-[11px] font-bold shadow-sm">JEREH</button>
            </div>
          </div>
        );

        if (step === '1') {
          msgs.push({ id: 'r1_a', role: 'agent', content: step1AgentActive });
          setMessages(msgs);
          return;
        }

        msgs.push({ id: 'r1_a', role: 'agent', content: step1AgentDisabled });
        msgs.push({ id: 'r2_u', role: 'user', content: 'JEREH' });

        if (step === '2_think') {
          msgs.push({ id: 'r2_a', role: 'agent', content: <Thinking /> });
          setMessages(msgs);
          const t = setTimeout(() => setSearchParams({ action: 'review', step: '2', tab: 'chat' }, { replace: true }), 2000);
          return () => clearTimeout(t);
        }

        setSavedReview(Boolean(readLocalResult('tradingnote:review:2026-07-14:JEREH')));
        const step2AgentActive = (
          <div className="w-[250px] max-w-full">
            <p className="mb-3 text-[12px] leading-relaxed">Here is the detailed review for <span className="text-[#0B2545] font-bold">JEREH</span>:</p>
            
            <div className="space-y-2.5">
              <div className="bg-white/80 backdrop-blur-md p-3 rounded-xl border border-white shadow-[0_4px_12px_rgba(11,37,69,0.04)]">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Target size={12} className="text-[#0B2545]" />
                  <span className="text-[10px] font-bold text-[#0B2545] uppercase tracking-wider">Evaluation</span>
                </div>
                <p className="text-[11px] text-slate-600 font-medium leading-relaxed">Failed to cut losses early. A classic case of holding onto a losing position due to emotional attachment.</p>
              </div>
              
              <div className="bg-slate-50/80 backdrop-blur-md p-3 rounded-xl border border-slate-100 shadow-[0_4px_12px_rgba(11,37,69,0.02)]">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <FileText size={12} className="text-[#0B2545]" />
                  <span className="text-[10px] font-bold text-[#0B2545] uppercase tracking-wider">Summary</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div><span className="text-slate-400">Entry:</span> <span className="font-mono font-bold text-[#0B2545] ml-1">155.0</span></div>
                  <div><span className="text-slate-400">Exit:</span> <span className="font-mono font-bold text-[#0B2545] ml-1">140.0</span></div>
                  <div><span className="text-slate-400">Plan SL:</span> <span className="font-mono font-bold text-rose-500 ml-1">145.0</span></div>
                  <div><span className="text-slate-400">Loss:</span> <span className="font-mono font-bold text-rose-500 ml-1">-9.6%</span></div>
                </div>
              </div>

              <div className="bg-rose-50/80 backdrop-blur-md p-3 rounded-xl border border-rose-100 shadow-[0_4px_12px_rgba(244,63,94,0.04)]">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <AlertTriangle size={12} className="text-rose-500" />
                  <span className="text-[10px] font-bold text-rose-700 uppercase tracking-wider">Psychology</span>
                </div>
                <p className="text-[11px] text-rose-700/80 font-medium leading-relaxed">FOMO entry without fundamental support. You hesitated when it broke the 145 level, hoping for a bounce.</p>
              </div>

              <div className="bg-[#0B2545] p-3 rounded-xl border border-[#0B2545] shadow-lg relative overflow-hidden mt-2">
                <div className="absolute -right-6 -top-6 w-24 h-24 bg-white/5 rounded-full blur-2xl pointer-events-none"></div>
                <div className="flex items-center gap-1.5 mb-2 relative z-10">
                  <Sparkles size={12} className="text-[#EE6C4D]" />
                  <span className="text-[10px] font-bold text-white uppercase tracking-wider">Suggestions</span>
                </div>
                <ul className="text-[11px] text-slate-300 leading-relaxed font-medium relative z-10 space-y-1.5 list-disc pl-3">
                  <li><strong className="text-white">Price Zone:</strong> Avoid re-entry until it establishes a solid base above 142.</li>
                  <li><strong className="text-white">Market State:</strong> Oil & gas sector is currently in a downtrend.</li>
                  <li><strong className="text-white">Action:</strong> Focus on capital preservation. Use conditional orders to automate your stop-loss next time.</li>
                </ul>
              </div>
            </div>
            <button
              onClick={() => {
                saveLocalResult('tradingnote:review:2026-07-14:JEREH', { date: '2026-07-14', asset: 'JEREH', summary: 'The exit was right, but waiting below the ¥145 stop added about ¥500 in losses. Use conditional orders to preserve capital.', savedAt: new Date().toISOString() });
                setSavedReview(true);
              }}
              className="w-full mt-3 bg-[#0B2545] text-white py-2 rounded-lg text-[11px] font-bold active:bg-[#134074]"
            >{savedReview ? 'Review Saved to Trade' : 'Save Review to Trade'}</button>
          </div>
        );

        if (step === '2') {
          msgs.push({ id: 'r2_a', role: 'agent', content: step2AgentActive });
          setMessages(msgs);
        }
      } else if (action === 'insights') {
        const msgs: Message[] = [];
        msgs.push({ id: 'i1_u', role: 'user', content: 'Tag me and analyze my recent trading style' });

        if (!step) {
          msgs.push({ id: 'i1_a', role: 'agent', content: <Thinking /> });
          setMessages(msgs);
          const t = setTimeout(() => setSearchParams({ action: 'insights', step: 'result', tab: 'chat' }, { replace: true }), 2500);
          return () => clearTimeout(t);
        }

        const insightsResult = (
          <div className="w-[280px] max-w-full space-y-3">
            <p className="text-[12px] leading-relaxed text-[#0B2545]">
              Based on your ledger records over the past 6 months, here is your behavior analysis:
            </p>

            {/* Summary */}
            <div className="bg-white/90 backdrop-blur-md p-3 rounded-xl border border-white shadow-[0_4px_12px_rgba(11,37,69,0.04)] relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-[#EE6C4D]"></div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Sparkles size={12} className="text-[#EE6C4D]" />
                <span className="text-[10px] font-bold text-[#EE6C4D] uppercase tracking-wider">Summary</span>
              </div>
              <p className="text-[11px] text-slate-700 font-medium leading-relaxed">
                You are a classic right-side trend follower with a tendency to secure profits early, though occasional emotional trades drag down your overall P/L ratio.
              </p>
            </div>

            {/* Key Evidence Table */}
            <div className="bg-slate-50/80 backdrop-blur-md rounded-xl border border-slate-100 shadow-[0_4px_12px_rgba(11,37,69,0.02)] overflow-hidden">
              <div className="p-2.5 border-b border-slate-100 bg-white/50">
                <div className="flex items-center gap-1.5">
                  <BookOpen size={12} className="text-[#0B2545]" />
                  <span className="text-[10px] font-bold text-[#0B2545] uppercase tracking-wider">Key Evidence</span>
                </div>
              </div>
              <div className="p-2.5">
                <table className="w-full text-left text-[10px]">
                  <thead>
                    <tr className="text-slate-400">
                      <th className="font-medium pb-2 uppercase tracking-wide">Dimension</th>
                      <th className="font-medium pb-2 uppercase tracking-wide">Ledger Perf.</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-600 align-top">
                    <tr className="border-t border-slate-100/60">
                      <td className="py-1.5 font-bold text-[#0B2545] w-[45%] pr-2">Holding Period</td>
                      <td className="py-1.5">Avg 4.5 days (Short-Swing)</td>
                    </tr>
                    <tr className="border-t border-slate-100/60">
                      <td className="py-1.5 font-bold text-[#0B2545] pr-2">Profit Realization</td>
                      <td className="py-1.5">Exits 50% at target, trails rest</td>
                    </tr>
                    <tr className="border-t border-slate-100/60">
                      <td className="py-1.5 font-bold text-[#0B2545] pr-2">Overall Result</td>
                      <td className="py-1.5 text-emerald-600 font-bold">+12.4% (Outperforming)</td>
                    </tr>
                    <tr className="border-t border-slate-100/60">
                      <td className="py-1.5 font-bold text-[#0B2545] pr-2 leading-tight">Position Reduction Method</td>
                      <td className="py-1.5 leading-tight">Fast on profits, slow on stops</td>
                    </tr>
                    <tr className="border-t border-slate-100/60">
                      <td className="py-1.5 font-bold text-[#0B2545] pr-2 leading-tight">Allocation Preference</td>
                      <td className="py-1.5 leading-tight">Heavy in Metals & Tech</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Profit Structure */}
            <div className="bg-white/80 backdrop-blur-md p-3 rounded-xl border border-white shadow-[0_4px_12px_rgba(11,37,69,0.04)]">
              <div className="flex items-center gap-1.5 mb-3">
                <BarChart2 size={12} className="text-[#0B2545]" />
                <span className="text-[10px] font-bold text-[#0B2545] uppercase tracking-wider">Profit Structure</span>
              </div>
              
              <div className="space-y-2.5 mb-3">
                <div>
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="font-bold text-[#0B2545]">1. ZIJIN MINING</span>
                    <div>
                      <span className="text-emerald-500 font-mono font-bold">+¥46,200</span>
                      <span className="text-emerald-500/70 font-medium ml-1 font-sans text-[9px]">(+9.4%)</span>
                    </div>
                  </div>
                  <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 w-[75%] rounded-full"></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="font-bold text-[#0B2545]">2. BIG DATA ETF</span>
                    <div>
                      <span className="text-emerald-500 font-mono font-bold">+¥12,450</span>
                      <span className="text-emerald-500/70 font-medium ml-1 font-sans text-[9px]">(+10.5%)</span>
                    </div>
                  </div>
                  <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-400 w-[20%] rounded-full"></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="font-bold text-[#0B2545]">3. COAL IND</span>
                    <div>
                      <span className="text-emerald-500 font-mono font-bold">+¥8,300</span>
                      <span className="text-emerald-500/70 font-medium ml-1 font-sans text-[9px]">(+8.2%)</span>
                    </div>
                  </div>
                  <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-300 w-[12%] rounded-full"></div>
                  </div>
                </div>
              </div>

              <div className="bg-[#0B2545]/5 p-2 rounded-lg border border-[#0B2545]/10">
                <span className="text-[10px] font-bold text-[#0B2545] block mb-0.5">Profit Summary:</span>
                <p className="text-[10px] text-slate-600 leading-relaxed font-medium">
                  Over <strong className="text-[#0B2545]">75%</strong> of your net profits originate from <strong className="text-[#0B2545]">Long-term Holding</strong> in cyclical sectors, whereas <strong className="text-[#0B2545]">Frequent Trading</strong> accounts for 80% of your drawdowns.
                </p>
              </div>
            </div>

            {/* Portrait */}
            <div className="bg-[#0B2545] p-3 rounded-xl border border-[#0B2545] shadow-lg relative overflow-hidden">
              <div className="absolute -right-6 -top-6 w-24 h-24 bg-white/5 rounded-full blur-2xl pointer-events-none"></div>
              <div className="flex items-center gap-1.5 mb-1.5 relative z-10">
                <User size={12} className="text-[#EE6C4D]" />
                <span className="text-[10px] font-bold text-white uppercase tracking-wider">Trader Portrait</span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed font-medium relative z-10">
                A sharp momentum catcher who excels at picking sector leaders, needing just a bit more discipline on hard stops to unlock full potential.
              </p>
            </div>
          </div>
        );

        if (step === 'result') {
          msgs.push({ id: 'i1_a', role: 'agent', content: insightsResult });
          setMessages(msgs);
        }
      } else if (isDailyReference || isAssetReference) {
        setMessages([]);
        setInput(searchParams.get('prompt') || (isAssetReference ? 'How did I execute these trades?' : 'Review this day with my saved trades and notes.'));
      } else {
        setMessages([]); // default state / landing for chat
      }
    }
  }, [tradeId, action, step, tab, reference, searchParams, setSearchParams]);

  useEffect(() => {
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }, [messages]);

  const sendChatMessage = async (currentInput: string) => {
    const userMsgId = `u_${Date.now()}`;
    const pendingId = `${userMsgId}_pending`;
    const session = chatSessionRef.current;

    setSendError(null);
    setIsSending(true);
    setMessages(prev => [
      ...prev,
      { id: userMsgId, role: 'user', content: currentInput },
      { id: pendingId, role: 'agent', content: <Thinking /> }
    ]);

    try {
      let trade_context: AgentTradeContext | null = null;
      if (tradeId) {
        try {
          const storedTrade = await apiRequest<AgentTradeContext>(`/api/trades/${encodeURIComponent(tradeId)}`);
          if (storedTrade && (storedTrade.type === 'Buy' || storedTrade.type === 'Sell')) {
            trade_context = {
              id: storedTrade.id,
              symbol: storedTrade.symbol,
              type: storedTrade.type,
              price: Number(storedTrade.price),
              qty: Number(storedTrade.qty),
              amount: storedTrade.amount,
              motive: storedTrade.motive,
              plan: storedTrade.plan,
            };
          }
        } catch {
          // A detail-page reference may not correspond to a persisted trade card.
        }
      }

      const data = await apiRequest<{ conversation_id: string; reply: string }>('/api/agent/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: currentInput,
          conversation_id: conversationId,
          action: action ?? null,
          trade_id: tradeId ?? null,
          step: step ?? null,
          reference: reference ?? null,
          asset: action === 'draft' || isAssetReference ? draftAsset : null,
          symbol: searchParams.get('symbol'),
          pnl: searchParams.get('pnl'),
          trade_context,
        }),
      }).catch(error => {
        if (error instanceof Error && error.message.startsWith('无法连接后端')) {
          throw new Error("无法连接 Agent 后端，请确认后端已启动后重试。");
        }
        throw error;
      });
      if (!data || typeof data.reply !== 'string') {
        throw new Error('Agent backend returned an unexpected response. Please try again.');
      }
      if (session !== chatSessionRef.current) return;

      if (typeof data.conversation_id === 'string') {
        setConversationId(data.conversation_id);
      }
      setMessages(prev => prev.map(m =>
        m.id === pendingId
          ? { id: `a_${Date.now()}`, role: 'agent', content: <p className="text-[12px] leading-relaxed whitespace-pre-wrap">{data.reply}</p> }
          : m
      ));
    } catch (err) {
      if (session !== chatSessionRef.current) return;
      setMessages(prev => prev.filter(m => m.id !== userMsgId && m.id !== pendingId));
      setInput(prev => prev || currentInput);
      setSendError(err instanceof Error ? err.message : 'Failed to send message. Please try again.');
    } finally {
      if (session === chatSessionRef.current) setIsSending(false);
    }
  };

  const handleNewChat = () => {
    chatSessionRef.current += 1;
    setMessages([]);
    setInput('');
    setConversationId(null);
    setSendError(null);
    setIsSending(false);
    setSearchParams({ tab: 'chat' });
  };

  const openHistory = async () => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const items = await apiRequest<ConversationSummary[]>('/api/agent/conversations?limit=50');
      setHistoryItems(items);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : '历史对话加载失败。');
    } finally {
      setHistoryLoading(false);
    }
  };

  const restoreConversation = async (id: string) => {
    setLoadingConversation(id);
    setHistoryError(null);
    try {
      const history = await apiRequest<ConversationHistory>(`/api/agent/conversations/${encodeURIComponent(id)}`);
      chatSessionRef.current += 1;
      setIsSending(false);
      setInput('');
      setConversationId(history.conversation_id);
      setMessages(history.messages.map((message, index) => ({
        id: `${history.conversation_id}_${index}`,
        role: message.role === 'assistant' ? 'agent' : 'user',
        content: message.role === 'assistant'
          ? <p className="text-[12px] leading-relaxed whitespace-pre-wrap">{message.content}</p>
          : message.content,
      })));
      setSendError(null);
      setHistoryOpen(false);
      const cleanChatParams = new URLSearchParams({ tab: 'chat' });
      if (searchParams.toString() !== cleanChatParams.toString()) {
        skipNextRouteSyncRef.current = true;
        setSearchParams(cleanChatParams);
      }
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : '无法恢复这段对话，请重试。');
    } finally {
      setLoadingConversation(null);
    }
  };

  const handleSend = () => {
    if (!input.trim() || isSending) return;
    
    const currentInput = input.trim();
    setInput('');
    const isDailyReview = reference === 'daily-2026-07-14' && currentInput.toLowerCase().includes('review');
    const isAssetTracking = isAssetReference && currentInput.length > 0;
    if (isDailyReview) setSavedTracking(Boolean(readLocalResult('tradingnote:tracking:2026-07-14')));
    if (isAssetTracking) setSavedTracking(Boolean(readLocalResult(`tradingnote:asset-tracking:${tradeId}`)));

    if (tab === 'chat') {
      void sendChatMessage(currentInput);
      return;
    }

    if (tab === 'backtest') {
      const btStep = searchParams.get('bt_step');
      if (btStep === '1') {
        setSearchParams({ tab: 'backtest', bt_step: '2', strategy: searchParams.get('strategy') || 'sma', ticker: currentInput.toUpperCase() });
        return;
      } else if (!btStep) {
        setSearchParams({ tab: 'backtest', bt_step: '1', strategy: 'sma' });
        return;
      }
    }
    
    // Normal Chat response
    setMessages(prev => [
      ...prev,
      { id: Date.now().toString(), role: 'user', content: currentInput }
    ]);
    
    setTimeout(() => {
      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'agent',
          content: (
            <div>
              <p className="text-[12px] leading-relaxed">
                {isAssetTracking ? (
                  <>
                    <p className="font-bold text-[#0B2545] mb-1.5">{searchParams.get('symbol') || 'Trade'} Execution Review</p>
                    <p>P&amp;L: {searchParams.get('pnl') || 'The position result is reflected in the trade record.'} The key question is whether the exit matched the planned risk and target.</p>
                    <p className="mt-1.5">Process: Review the entry thesis, stop placement, and exit timing together. Lesson: define the invalidation level before entry and use a conditional order to reduce hesitation.</p>
                  </>
                ) : isDailyReview ? (
                  <>
                    <p className="font-bold text-[#0B2545] mb-1.5">Jul 14 Trade Review</p>
                    <p>Realized P&amp;L was ¥3,330 (+1.31%). Two of three exits broadly followed the plan. JEREH was sold below its ¥145 stop, adding about ¥500 in avoidable loss.</p>
                    <p className="mt-1.5">ZIJIN MINING was sold near its ¥27 target, while ZIJIN INTL exited at its ¥94 stop. Next time, place stop orders at entry to reduce hesitation.</p>
                  </>
                ) : (
                  <>Got your question: "<span className="italic">{currentInput}</span>". Based on your data, you tend to "exit too early" when in profit. Suggestion: For the next "breakout" trade, try splitting your take-profit into two tranches (50% / 50%) to let profits run.</>
                )}
              </p>
              {isDailyReview && (
                <button
                  onClick={() => {
                    saveLocalResult('tradingnote:tracking:2026-07-14', {
                      date: '2026-07-14', title: 'M-Agent Daily Review',
                      body: 'Realized P&L was ¥3,330 (+1.31%). Two of three exits broadly followed the plan. JEREH was sold below its ¥145 stop, adding about ¥500 in avoidable loss. ZIJIN MINING was sold near its ¥27 target, while ZIJIN INTL exited at its ¥94 stop. Next time, place stop orders at entry to reduce hesitation.',
                      savedAt: new Date().toISOString()
                    });
                    setSavedTracking(true);
                  }}
                  className="mt-3 w-full bg-[#0B2545] text-white py-2 rounded-lg text-[11px] font-bold active:bg-[#134074]"
                >{savedTracking ? 'Tracking Saved' : 'Save Tracking'}</button>
              )}
              {isAssetTracking && (
                <button
                  onClick={() => {
                    saveLocalResult(`tradingnote:asset-tracking:${tradeId}`, {
                      asset: searchParams.get('symbol') || 'Trade',
                      overallSummary: 'The trade outcome should be judged by both its P&L and the quality of execution against the original plan.',
                      pnlResult: searchParams.get('pnl') || 'See the trade record for realized P&L.',
                      processResult: 'Review the entry thesis, stop placement, and exit timing together.',
                      lessonsLearned: 'Define the invalidation level before entry and use a conditional order to reduce hesitation.',
                      savedAt: new Date().toISOString()
                    });
                    setSavedTracking(true);
                  }}
                  className="mt-3 w-full bg-[#0B2545] text-white py-2 rounded-lg text-[11px] font-bold active:bg-[#134074]"
                >{savedTracking ? 'Tracking Saved' : 'Save Tracking'}</button>
              )}
            </div>
          )
        }
      ]);
    }, 1000);
  };

  const handleAction = (act: string) => {
    setSearchParams({ action: act, tab: 'chat' });
  };

  const setTab = (newTab: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('tab', newTab);
      return next;
    });
  };

  const isLanding = messages.length === 0 && !tradeId && !action;

  return (
    <div className="w-full h-full bg-[#F8F9FA] font-sans text-slate-900 flex flex-col relative overflow-hidden">
      {/* Header */}
      <div className="bg-white px-3 pt-[54px] pb-3 shadow-sm shrink-0 z-20 relative border-b border-slate-100 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {!isLanding && tab === 'chat' && (
              <button onClick={() => { setSearchParams({ tab: 'chat' }); }} className="p-1 -ml-1 text-slate-700 active:bg-slate-100 rounded-full transition-colors shrink-0">
                <ChevronLeft size={20} />
              </button>
            )}
            <div className="w-7 h-7 rounded-full bg-[#0B2545] flex items-center justify-center shadow-sm shrink-0">
              <BotMessageSquare size={14} className="text-white" />
            </div>
            <div>
              <h1 className="text-[14px] font-bold tracking-tight text-[#0B2545]">M-Agent Coach</h1>
              <div className="text-[9px] text-emerald-500 font-bold flex items-center gap-1 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Online
              </div>
            </div>
          </div>
          
          {tab === 'backtest' ? (
            <button 
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                next.set('show_tasks', '1');
                setSearchParams(next);
              }}
              className="flex items-center gap-1 text-[#0B2545] text-[10px] font-bold px-2 py-1.5 bg-slate-100 rounded-lg active:bg-slate-200 transition-colors relative"
            >
              <Target size={12} /> Tasks
              {searchParams.get('bt_step') === '3' && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-rose-500 rounded-full border border-white"></span>}
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleNewChat}
                className="flex items-center gap-1 text-[#0B2545] text-[10px] font-bold px-2 py-1.5 bg-slate-100 rounded-lg active:bg-slate-200 transition-colors"
              >
                <MessageSquarePlus size={12} /> New Chat
              </button>
              <button onClick={() => void openHistory()} className="flex items-center gap-1 text-[#0B2545] text-[10px] font-bold px-2 py-1.5 bg-slate-100 rounded-lg active:bg-slate-200 transition-colors">
                <History size={12} /> History
              </button>
            </div>
          )}
        </div>

        <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 w-full">
          <button
            onClick={() => setTab('chat')}
            className={cn(
              "flex-1 py-1.5 text-[11px] font-bold rounded-md transition-all flex items-center justify-center gap-1",
              tab === 'chat' 
                ? "bg-[#0B2545] text-white shadow-sm" 
                : "text-slate-500 hover:text-slate-700"
            )}
          >
            <MessageSquare size={14} /> Chat
          </button>
          <button
            onClick={() => setTab('backtest')}
            className={cn(
              "flex-1 py-1.5 text-[11px] font-bold rounded-md transition-all flex items-center justify-center gap-1",
              tab === 'backtest' 
                ? "bg-[#0B2545] text-white shadow-sm" 
                : "text-slate-500 hover:text-slate-700"
            )}
          >
            <LineChart size={14} /> Backtest
          </button>
        </div>
      </div>

      {isLanding && tab === 'chat' ? (
        <div className="flex-1 overflow-y-auto flex flex-col px-4 pt-8 pb-8 no-scrollbar items-center relative">
          
          <div className="text-center mb-8 w-full">
            <h2 className="text-[20px] font-bold text-[#0B2545] leading-snug tracking-tight mb-2">
              Being smart is important,<br/>but discipline matters more.
            </h2>
            <p className="text-[11px] text-slate-500 font-medium">I remember everything you didn't notice.</p>
          </div>

          <div className="w-full mb-8">
            <div className="text-[11px] font-bold text-slate-500 mb-3 ml-1 uppercase tracking-wider">Everyone is asking</div>
            <div className="space-y-2.5">
              {[
                { text: "Review today's trade motivations?", icon: <Sparkles size={12} className="text-[#EE6C4D]"/> },
                { text: "Analyze Zijin Mining history", icon: <Sparkles size={12} className="text-[#EE6C4D]"/> },
                { text: "Any recent trading errors?", icon: <Sparkles size={12} className="text-[#EE6C4D]"/> }
              ].map((item, idx) => (
                <button 
                  key={idx}
                  onClick={() => {
                    setInput(item.text);
                    handleSend();
                  }}
                  className="w-full bg-white p-3.5 rounded-xl shadow-sm border border-slate-100 text-left flex items-center gap-2.5 active:bg-slate-50 transition-transform active:scale-[0.99]"
                >
                  <div className="bg-[#EE6C4D]/10 p-1.5 rounded-full">{item.icon}</div>
                  <span className="text-[12px] font-bold text-[#0B2545]">{item.text}</span>
                </button>
              ))}
            </div>
          </div>

        </div>
      ) : (
        /* Chat Area (Used by both Chat and Backtest flows) */
        <div className="flex-1 overflow-y-auto p-3 pb-6 space-y-5 no-scrollbar">
          {messages.map((msg) => (
            <div key={msg.id} className={cn("flex w-full", msg.role === 'user' ? "justify-end" : "justify-start")}>
              <div className={cn("flex gap-2 max-w-[85%]", msg.role === 'user' ? "flex-row-reverse" : "flex-row")}>
                
                <div className="shrink-0 mt-0.5">
                  {msg.role === 'agent' ? (
                    <div className="w-6 h-6 rounded-full bg-[#0B2545] flex items-center justify-center shadow-sm">
                      <BotMessageSquare size={12} className="text-white" />
                    </div>
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center border border-white">
                      <User size={12} className="text-slate-600" />
                    </div>
                  )}
                </div>
                
                <div className={cn(
                  "p-2.5 text-[12px] shadow-sm font-medium",
                  msg.role === 'user' 
                    ? "bg-[#0B2545] text-white rounded-[16px] rounded-tr-[4px]" 
                    : "bg-white border border-slate-200 text-slate-800 rounded-[16px] rounded-tl-[4px]"
                )}>
                  {msg.content}
                </div>
              </div>
            </div>
          ))}
          <div ref={bottomRef} className="h-4" />
        </div>
      )}

      {historyOpen && (
        <div className="absolute inset-0 z-40 flex items-end bg-[#0B2545]/35 backdrop-blur-[1px]">
          <section className="mx-auto flex h-[82%] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <h2 className="text-[14px] font-bold text-[#0B2545]">对话历史</h2>
                <p className="mt-0.5 text-[10px] text-slate-400">选择一条记录即可查看并继续对话</p>
              </div>
              <button onClick={() => setHistoryOpen(false)} aria-label="关闭对话历史" className="rounded-full bg-slate-100 p-2 text-slate-500"><X size={14} /></button>
            </div>
            {historyError && <div role="alert" className="mx-3 mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-[11px] text-rose-700">{historyError}<button onClick={() => void openHistory()} className="ml-2 font-bold underline">重试</button></div>}
            <div className="flex-1 overflow-y-auto p-3">
              {historyLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-[11px] text-slate-400"><Loader2 size={14} className="animate-spin" />正在加载历史对话…</div>
              ) : historyItems.length === 0 && !historyError ? (
                <div className="py-10 text-center text-[11px] text-slate-400">还没有保存的对话</div>
              ) : historyItems.map(item => (
                <button key={item.conversation_id} onClick={() => void restoreConversation(item.conversation_id)} disabled={Boolean(loadingConversation)} className="mb-2 w-full rounded-xl border border-slate-200 p-3 text-left transition-colors hover:border-[#EE6C4D]/50 disabled:opacity-60">
                  <div className="flex items-start justify-between gap-3">
                    <span className="line-clamp-2 text-[12px] font-bold text-[#0B2545]">{item.title || '新对话'}</span>
                    {loadingConversation === item.conversation_id && <Loader2 size={13} className="shrink-0 animate-spin text-[#EE6C4D]" />}
                  </div>
                  <div className="mt-1.5 flex justify-between text-[9px] text-slate-400"><span>{item.message_count} 条消息</span><span>{new Date(item.updated_at).toLocaleString()}</span></div>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* Fixed Bottom Area (Chat Input for both flows) */}
      {(tab === 'chat' || tab === 'backtest') && (
        <div className="shrink-0 w-full bg-white/95 backdrop-blur-xl border-t border-slate-100 z-10 px-3 pt-2 pb-[100px] shadow-[0_-4px_20px_rgba(0,0,0,0.02)]">

          {/* Quick Actions (Chat only) */}
          {tab === 'chat' && (
            <div className="flex overflow-x-auto no-scrollbar gap-2 mb-2 w-full snap-x">
              <button 
                onClick={() => handleAction('draft')}
                className="flex-shrink-0 snap-center bg-white border border-slate-200 text-[#0B2545] px-3 py-1.5 rounded-full text-[11px] font-bold flex items-center gap-1.5 active:bg-slate-50 transition-colors shadow-sm"
              >
                <FileText size={14} className="text-[#EE6C4D] shrink-0" /> 
                <span>Draft Plan</span>
              </button>
              <button 
                onClick={() => handleAction('review')}
                className="flex-shrink-0 snap-center bg-white border border-slate-200 text-[#0B2545] px-3 py-1.5 rounded-full text-[11px] font-bold flex items-center gap-1.5 active:bg-slate-50 transition-colors shadow-sm"
              >
                <History size={14} className="text-[#EE6C4D] shrink-0" /> 
                <span>Review Trades</span>
              </button>
              <button 
                onClick={() => handleAction('insights')}
                className="flex-shrink-0 snap-center bg-white border border-slate-200 text-[#0B2545] px-3 py-1.5 rounded-full text-[11px] font-bold flex items-center gap-1.5 active:bg-slate-50 transition-colors shadow-sm"
              >
                <Activity size={14} className="text-[#EE6C4D] shrink-0" /> 
                <span>Behavior Insights</span>
              </button>
            </div>
          )}

          {tab === 'chat' && sendError && (
            <div role="alert" className="flex items-start gap-1.5 mb-2 px-2.5 py-2 bg-rose-50 border border-rose-200 rounded-lg text-[11px] font-medium text-rose-700 leading-snug">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span className="flex-1">{sendError}</span>
              <button onClick={() => setSendError(null)} aria-label="Dismiss error" className="shrink-0 text-rose-400 active:text-rose-600">
                <X size={12} />
              </button>
            </div>
          )}

          <div className="flex items-end gap-2 bg-slate-50 rounded-xl p-1.5 border border-slate-200 focus-within:border-[#0B2545] transition-colors shadow-inner">
            <div className="p-2 text-slate-400 shrink-0 mb-0.5">
              <Sparkles size={16} />
            </div>
            <div className="flex-1 min-w-0 flex items-center gap-1.5">
              {tab === 'chat' && (isDailyReference || isAssetReference) && (
                <div className="inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#EE6C4D]/10 border border-[#EE6C4D]/20 text-[9px] font-bold text-[#0B2545]">
                  <BookOpen size={10} className="text-[#EE6C4D]" /> {isAssetReference ? `${searchParams.get('symbol') || 'Asset'} · P&L ${searchParams.get('pnl') || '--'}` : `Today · ${reference?.slice(6)}`}
                </div>
              )}
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={tab === 'backtest' && searchParams.get('bt_step') === '1' ? "Type a ticker (e.g. AAPL)..." : "Ask a master what they are buying..."}
                className="flex-1 min-w-0 w-full max-h-[72px] min-h-[36px] bg-transparent resize-none text-[13px] font-medium text-[#0B2545] p-2 pl-0 focus:outline-none placeholder:text-slate-400"
                rows={1}
              />
            </div>
            <button 
              onClick={handleSend}
              disabled={!input.trim() || isSending}
              aria-label={isSending ? 'Sending' : 'Send'}
              className="p-2.5 bg-[#EE6C4D] text-white rounded-lg disabled:bg-slate-300 disabled:text-white transition-colors shrink-0 shadow-sm active:scale-95 mb-0.5 mr-0.5"
            >
              {isSending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      )}

      {/* Tasks Overlay */}
      <AnimatePresence>
        {searchParams.get('show_tasks') === '1' && (
          <motion.div 
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="absolute inset-0 bg-[#F8F9FA] z-50 flex flex-col"
          >
            <div className="bg-white px-3 pt-[54px] pb-3 shadow-sm border-b border-slate-100 flex items-center gap-2 relative">
              <button 
                onClick={() => {
                  const p = new URLSearchParams(searchParams);
                  p.delete('show_tasks');
                  setSearchParams(p);
                }} 
                className="p-1.5 -ml-1.5 text-slate-700 active:bg-slate-100 rounded-full"
              >
                <X size={20} />
              </button>
              <h2 className="text-[16px] font-bold text-[#0B2545]">Backtest Tasks</h2>
            </div>
            <div className="p-3 space-y-3 flex-1 overflow-y-auto">
              {savedTasks.map(task => (
                <div key={task.id} className="bg-white p-3 rounded-xl border border-emerald-200 shadow-sm">
                  <div className="flex justify-between items-center mb-2">
                    <div className="text-[13px] font-bold text-[#0B2545]">{task.strategy}</div>
                    <div className="text-[9px] bg-emerald-50 border border-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold uppercase">Saved</div>
                  </div>
                  <div className="text-[11px] text-slate-500">Target: <span className="font-bold text-[#0B2545] uppercase">{task.ticker}</span></div>
                  <div className="grid grid-cols-2 gap-2 mt-2 text-[10px] text-slate-500">
                    <span>Win rate <b className="text-emerald-700">{task.stats.winRate}</b></span>
                    <span>Return <b className="text-emerald-700">{task.stats.return}</b></span>
                  </div>
                </div>
              ))}
              {searchParams.get('bt_step') === '3' && (
                <div 
                  onClick={() => setSearchParams({ tab: 'backtest', bt_step: '3', strategy: searchParams.get('strategy') || 'sma', ticker: searchParams.get('ticker') || 'AAPL', task_detail: '1' })}
                  className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm active:scale-[0.99] transition-transform cursor-pointer relative overflow-hidden"
                >
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500"></div>
                  <div className="flex justify-between items-center mb-2">
                    <div className="text-[14px] font-bold text-[#0B2545]">{STRATEGIES.find(s => s.id === searchParams.get('strategy'))?.name}</div>
                    <div className="text-[10px] bg-emerald-50 border border-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Completed</div>
                  </div>
                  <div className="text-[12px] text-slate-500 font-medium mb-1">Target: <span className="font-bold text-[#0B2545] uppercase">{searchParams.get('ticker')}</span></div>
                  <div className="text-[10px] text-slate-400 font-mono">Run at {new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                </div>
              )}
              {/* Dummy old tasks */}
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm opacity-60">
                <div className="flex justify-between items-center mb-2">
                  <div className="text-[14px] font-bold text-[#0B2545]">RSI Bounce</div>
                  <div className="text-[10px] bg-slate-100 text-slate-500 border border-slate-200 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Completed</div>
                </div>
                <div className="text-[12px] text-slate-500 font-medium mb-1">Target: <span className="font-bold text-[#0B2545] uppercase">BTC</span></div>
                <div className="text-[10px] text-slate-400 font-mono">Yesterday</div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
