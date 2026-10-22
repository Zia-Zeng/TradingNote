import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Tag, Image as ImageIcon, Plus, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { apiRequest } from '../lib/api';
import { currentLocalDate, hasTradeDate, tradeDateTimeFields } from '../lib/trade-time';
import { defaultCurrencyForMarket, inferMarketCurrency, type InstrumentSearchResult } from '../lib/instruments';
import TradeImportDrawer from './TradeImportDrawer';

interface RecordDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  initialData?: any;
  onSave?: (data: any) => void | Promise<void>;
  onSaved?: (tradeDate: string) => void;
  onImported?: (items: any[]) => void;
  defaultTab?: 'manual' | 'ocr';
  defaultTradeDate?: string;
}

export default function RecordDrawer({ isOpen, onClose, initialData, onSave, onSaved, onImported, defaultTab = 'manual', defaultTradeDate }: RecordDrawerProps) {
  const buyMotiveOptions = ['Breakout Confirmation', 'Pullback Entry', 'Support Bounce', 'Trend Continuation', 'Catalyst', 'Re-entry'];
  const sellMotiveOptions = ['Take Profit', 'Stop Loss', 'Resistance Rejection', 'Trend Reversal', 'Risk Reduction', 'Thesis Invalidated'];
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [isDeletingTags, setIsDeletingTags] = useState(false);
  const [deletedMotiveOptions, setDeletedMotiveOptions] = useState<Record<'Buy' | 'Sell', string[]>>(() => {
    try { return JSON.parse(localStorage.getItem('tradingnote:deleted-motive-options') || '{"Buy":[],"Sell":[]}'); }
    catch { return { Buy: [], Sell: [] }; }
  });
  const [activeTab, setActiveTab] = useState<'manual' | 'ocr'>(defaultTab);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [stockOptions, setStockOptions] = useState<InstrumentSearchResult[]>([]);
  const [stockSearchOpen, setStockSearchOpen] = useState(false);
  const [stockSearchUnavailable, setStockSearchUnavailable] = useState(false);
  const [isSearchingStocks, setIsSearchingStocks] = useState(false);

  // Form state
  const [symbol, setSymbol] = useState('');
  const [code, setCode] = useState('');
  const [market, setMarket] = useState('CN');
  const [currency, setCurrency] = useState('CNY');
  const [assetClass, setAssetClass] = useState('Stock');
  const [tradeDate, setTradeDate] = useState(currentLocalDate);
  const [tradeClock, setTradeClock] = useState('');
  const [direction, setDirection] = useState<'Buy' | 'Sell'>('Buy');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [noteText, setNoteText] = useState('');

  useEffect(() => {
    const query = symbol.trim();
    if (!isOpen || activeTab !== 'manual' || !stockSearchOpen || !query) {
      setStockOptions([]);
      setIsSearchingStocks(false);
      setStockSearchUnavailable(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setIsSearchingStocks(true);
      try {
        const result = await apiRequest<{ items: InstrumentSearchResult[]; available?: boolean }>(`/api/stocks/search?q=${encodeURIComponent(query)}`);
        if (!cancelled) {
          setStockOptions(result.items || []);
          setStockSearchUnavailable(result.available === false);
        }
      } catch {
        if (!cancelled) {
          setStockOptions([]);
          setStockSearchUnavailable(true);
        }
      } finally {
        if (!cancelled) setIsSearchingStocks(false);
      }
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [symbol, isOpen, activeTab, stockSearchOpen]);

  useEffect(() => {
    if (initialData) {
      setSymbol(initialData.symbol || '');
      setCode(initialData.code || '');
      const inferred = inferMarketCurrency(initialData.code || initialData.symbol || '');
      const knownMarkets = ['CN', 'HK', 'US', 'CRYPTO', 'GLOBAL'];
      setMarket(knownMarkets.includes(initialData.market) ? initialData.market : (inferred.market === 'GLOBAL' ? 'CN' : inferred.market));
      setCurrency(initialData.currency || inferred.currency);
      setAssetClass(initialData.asset_class || 'Stock');
      const tradeDateTime = tradeDateTimeFields(initialData.time);
      setTradeDate(hasTradeDate(initialData.time) ? tradeDateTime.date : '');
      setTradeClock(tradeDateTime.time);
      setDirection(initialData.type === 'Sell' ? 'Sell' : 'Buy');
      setPrice(initialData.price || '');
      setQty(initialData.qty || '');
      setTags(initialData.note_tags || []);
      const standardOptions = initialData.type === 'Buy' ? buyMotiveOptions : sellMotiveOptions;
      setCustomTags((initialData.note_tags || []).filter((tag: string) => !standardOptions.includes(tag)));
      setNewTag('');
      setNoteText(initialData.note || '');
      setActiveTab('manual');
    } else {
      setSymbol(''); setCode(''); setMarket('CN'); setCurrency('CNY'); setAssetClass('Stock'); setTradeDate(defaultTradeDate || currentLocalDate()); setTradeClock(''); setPrice(''); setQty(''); setTags([]); setCustomTags([]); setNewTag('');
      setNoteText(''); setDirection('Buy');
      setActiveTab(defaultTab);
    }
  }, [initialData, isOpen, defaultTab, defaultTradeDate]);

  const toggleTag = (tag: string) => {
    if (tags.includes(tag)) setTags(tags.filter(t => t !== tag));
    else setTags([...tags, tag]);
  };

  const addCustomTag = () => {
    const tag = newTag.trim();
    if (!tag) return;
    if (!tags.includes(tag)) setTags(current => [...current, tag]);
    if (!(direction === 'Buy' ? buyMotiveOptions : sellMotiveOptions).includes(tag) && !customTags.includes(tag)) {
      setCustomTags(current => [...current, tag]);
    }
    setNewTag('');
    setIsAddingTag(false);
  };

  const removeTag = (tag: string) => {
    setTags(current => current.filter(item => item !== tag));
    if (customTags.includes(tag)) {
      setCustomTags(current => current.filter(item => item !== tag));
      return;
    }
    const next = { ...deletedMotiveOptions, [direction]: [...deletedMotiveOptions[direction], tag] };
    setDeletedMotiveOptions(next);
    localStorage.setItem('tradingnote:deleted-motive-options', JSON.stringify(next));
  };

  const changeDirection = (nextDirection: 'Buy' | 'Sell') => {
    if (direction === nextDirection) return;
    setDirection(nextDirection);
    setTags([]);
  };

  const handleSave = async () => {
    setSaveError(null);
    if (!tradeDate) {
      setSaveError('Enter a trade date.');
      return;
    }
    const inferred = inferMarketCurrency(code || symbol);
    const originalCurrency = (currency || defaultCurrencyForMarket(market) || inferred.currency).trim().toUpperCase();
    if (!/^[A-Z]{3,8}$/.test(originalCurrency)) {
      setSaveError('Enter a 3–8 letter trading currency (for example, CNY, USD or HKD).');
      return;
    }
    const data = {
      symbol, code: code || undefined, market, currency: originalCurrency, assetClass, tradeDate, tradeClock, direction, price, qty, note: noteText.trim(), note_tags: tags
    };
    setIsSaving(true);
    try {
      if (onSave) await onSave(data);
      if (onSaved) onSaved(tradeDate);
      else onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unable to save the trade. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const drawerContent = (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div 
            key="backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-[#0B2545]/40 z-[1] backdrop-blur-sm pointer-events-auto"
          />
          <motion.div
            key="drawer"
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 220 }}
            className="absolute bottom-0 left-0 right-0 h-[85%] bg-[#F8F9FA] rounded-t-2xl z-[2] flex flex-col shadow-[0_-10px_40px_rgba(0,0,0,0.1)] overflow-hidden pointer-events-auto"
          >
            <div className="px-3 py-3 flex justify-between items-center bg-white z-10 shadow-sm border-b border-slate-100">
              <div className="font-bold text-[15px] text-[#0B2545] flex items-center gap-2">
                <div className="w-1.5 h-3.5 bg-[#EE6C4D] rounded-full"></div>
                {initialData ? 'Edit Trade Record' : 'Add Trade Record'}
              </div>
              <button onClick={onClose} className="p-1.5 text-slate-500 bg-slate-100 rounded-full hover:bg-slate-200 transition-colors">
                <X size={16} />
              </button>
            </div>

            {!initialData && (
              <div className="bg-white px-3 pt-2 pb-1 border-b border-slate-100 shrink-0">
                <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                  <button
                    onClick={() => setActiveTab('manual')}
                    className={cn("flex-1 py-1.5 text-[11px] font-bold rounded-md transition-all", activeTab === 'manual' ? "bg-[#0B2545] text-white shadow-sm" : "text-slate-500 hover:text-slate-700")}
                  >
                    Manual Entry
                  </button>
                  <button
                    onClick={() => setActiveTab('ocr')}
                    className={cn("flex-1 py-1.5 text-[11px] font-bold rounded-md transition-all", activeTab === 'ocr' ? "bg-[#0B2545] text-white shadow-sm" : "text-slate-500 hover:text-slate-700")}
                  >
                    Batch Import
                  </button>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto no-scrollbar relative">
              {activeTab === 'manual' ? (
                <div className="p-3 pb-8 space-y-4">
                  {/* Basic Info */}
                  <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-200 relative">
                    <div className="absolute top-0 left-0 w-1 h-full bg-[#EE6C4D]"></div>
                    <div className="relative mb-3">
                      <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2 focus-within:border-[#EE6C4D]">
                        <Search size={14} className="shrink-0 text-slate-400" />
                      <input 
                          value={symbol}
                          onFocus={() => setStockSearchOpen(true)}
                          onBlur={() => setStockSearchOpen(false)}
                          onChange={(e) => { const value = e.target.value; setSymbol(value); setCode(/^[A-Za-z0-9.^=_:-]+$/.test(value.trim()) ? value.trim() : ''); const inferred = inferMarketCurrency(value); setMarket(inferred.market); setCurrency(inferred.currency); setAssetClass(inferred.market === 'CRYPTO' ? 'Crypto' : 'Stock'); setStockSearchOpen(true); }}
                          onKeyDown={(e) => { if (e.key === 'Escape') setStockSearchOpen(false); }}
                          placeholder="Search global stocks, ETFs, funds, crypto…"
                          autoComplete="off"
                          className="min-w-0 flex-1 bg-transparent text-[14px] font-bold text-[#0B2545] focus:outline-none placeholder:text-slate-300"
                      />
                      </div>
                      {stockSearchOpen && (stockOptions.length > 0 || isSearchingStocks || stockSearchUnavailable) && (
                        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl">
                          {stockOptions.map(option => (
                            <button key={`${option.market}:${option.code}`} type="button" onMouseDown={event => event.preventDefault()} onClick={() => { setSymbol(option.name); setCode(option.code); setMarket(option.market); setCurrency(option.currency); setAssetClass(option.asset_class); setStockSearchOpen(false); }} className="flex w-full items-center justify-between border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-slate-50">
                              <span className="truncate text-[12px] font-semibold text-[#0B2545]">{option.name}<span className="ml-1.5 font-mono text-[9px] text-slate-400">{option.market} · {option.asset_class}</span></span><span className="ml-3 shrink-0 font-mono text-[11px] text-slate-500">{option.code}</span>
                            </button>
                          ))}
                          {isSearchingStocks && <div className="px-3 py-2 text-[10px] text-slate-400">Searching…</div>}
                          {!isSearchingStocks && stockSearchUnavailable && stockOptions.length === 0 && <div className="px-3 py-2 text-[10px] text-slate-500">Stock search is unavailable. You can still enter a name or 6-digit code.</div>}
                          {!isSearchingStocks && !stockSearchUnavailable && stockOptions.length === 0 && <div className="px-3 py-2 text-[10px] text-slate-500">No matches. You can use the text you entered.</div>}
                        </div>
                      )}
                    </div>
                    <div className="mb-3 grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-slate-400">Market</span>
                        <select value={market} onChange={event => { const nextMarket = event.target.value; setMarket(nextMarket); setCurrency(defaultCurrencyForMarket(nextMarket)); }} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-[11px] text-[#0B2545] focus:border-[#EE6C4D] focus:outline-none">
                          <option value="CN">China</option>
                          <option value="HK">Hong Kong</option>
                          <option value="US">United States</option>
                          <option value="GLOBAL">Other market</option>
                          <option value="CRYPTO">Crypto</option>
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-slate-400">Currency</span>
                        <input value={currency} onChange={event => setCurrency(event.target.value.toUpperCase())} maxLength={8} placeholder="CNY / USD / HKD" className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-[11px] text-[#0B2545] focus:border-[#EE6C4D] focus:outline-none" />
                      </label>
                    </div>
                    <div className="mb-3 grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-slate-400">Trade date (required)</span>
                        <input lang="en-US" type="date" required value={tradeDate} onChange={event => setTradeDate(event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 font-mono text-[11px] text-[#0B2545] focus:border-[#EE6C4D] focus:outline-none" />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-slate-400">Trade time (optional)</span>
                        <input lang="en-US" type="time" value={tradeClock} onChange={event => setTradeClock(event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 font-mono text-[11px] text-[#0B2545] focus:border-[#EE6C4D] focus:outline-none" />
                      </label>
                    </div>
                    {initialData && !hasTradeDate(initialData.time) && <p className="-mt-2 mb-3 text-[9px] leading-4 text-amber-700">This older record has no saved date. Select the actual trade date; it cannot be recovered from the original record.</p>}
                    <div className="flex items-center gap-2 mb-3">
                      <button onClick={() => changeDirection('Buy')} className={cn("flex-1 py-1.5 rounded-lg text-[11px] font-bold border-2 transition-colors", direction === 'Buy' ? "bg-emerald-50 text-emerald-700 border-emerald-400" : "bg-white text-slate-400 border-slate-200")}>Buy</button>
                      <button onClick={() => changeDirection('Sell')} className={cn("flex-1 py-1.5 rounded-lg text-[11px] font-bold border-2 transition-colors", direction === 'Sell' ? "bg-rose-50 text-rose-600 border-rose-400" : "bg-white text-slate-400 border-slate-200")}>Sell</button>
                    </div>
                    <div className="flex gap-3 text-[12px] bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                      <div className="flex flex-col flex-1">
                        <span className="text-slate-400 text-[9px] uppercase mb-0.5 tracking-wider">Price ({currency || '—'})</span>
                        <input value={price} onChange={e => setPrice(e.target.value)} type="number" placeholder="0.00" className="bg-transparent font-bold text-[#0B2545] font-mono text-[14px] focus:outline-none placeholder:text-slate-300 w-full" />
                      </div>
                      <div className="w-px bg-slate-200 self-stretch my-1"></div>
                      <div className="flex flex-col flex-1 pl-2">
                        <span className="text-slate-400 text-[9px] uppercase mb-0.5 tracking-wider">Qty</span>
                        <input value={qty} onChange={e => setQty(e.target.value)} type="number" placeholder="100" className="bg-transparent font-bold text-[#0B2545] font-mono text-[14px] focus:outline-none placeholder:text-slate-300 w-full" />
                      </div>
                    </div>
                  </div>

                  {/* Trade note */}
                  <div>
                    <div className="text-[14px] font-bold text-[#0B2545] mb-2 flex items-center gap-1.5"><Tag size={14} className="text-[#EE6C4D]" /> Note</div>
                    <div className="text-[10px] text-slate-500 mb-1.5 font-bold uppercase tracking-wider">{direction} tags (optional)</div>
                    <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
                      {[...(direction === 'Buy' ? buyMotiveOptions : sellMotiveOptions).filter(tag => !deletedMotiveOptions[direction].includes(tag)), ...customTags].map(tag => (
                        <button
                          key={tag}
                          onClick={() => isDeletingTags ? removeTag(tag) : toggleTag(tag)}
                          className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] transition-all font-bold border", isDeletingTags ? "bg-rose-50 text-rose-700 border-rose-300" : tags.includes(tag) ? (direction === 'Buy' ? "bg-emerald-50 text-emerald-700 border-emerald-400" : "bg-rose-50 text-rose-600 border-rose-400") : "bg-white text-slate-600 border-slate-200")}
                        >
                          {tag}{isDeletingTags && <Trash2 size={10} />}
                        </button>
                      ))}
                      <button
                        onClick={() => { setIsAddingTag(value => !value); setIsDeletingTags(false); }}
                        aria-label="Add note tag"
                        className="w-7 h-7 inline-flex items-center justify-center rounded-full border border-slate-300 bg-white text-slate-600 hover:border-[#EE6C4D] hover:text-[#EE6C4D]"
                      ><Plus size={14} /></button>
                      {isAddingTag && (
                        <input
                          autoFocus
                          value={newTag}
                          onChange={event => setNewTag(event.target.value)}
                          onKeyDown={event => {
                            if (event.key === 'Enter') { event.preventDefault(); addCustomTag(); }
                            if (event.key === 'Escape') { setIsAddingTag(false); setNewTag(''); }
                          }}
                          placeholder="New note tag"
                          className="w-36 bg-white border border-[#EE6C4D]/50 rounded-full px-3 py-1.5 text-[11px] focus:outline-none focus:border-[#EE6C4D]"
                        />
                      )}
                      <button
                        onClick={() => { setIsDeletingTags(value => !value); setIsAddingTag(false); }}
                        aria-label={isDeletingTags ? 'Finish deleting tags' : 'Delete note tags'}
                        className={cn("w-7 h-7 inline-flex items-center justify-center rounded-full border transition-colors", isDeletingTags ? "border-rose-300 bg-rose-50 text-rose-600" : "border-slate-300 bg-white text-slate-500 hover:border-rose-300 hover:text-rose-600")}
                      ><Trash2 size={13} /></button>
                    </div>
                    <textarea 
                      value={noteText} onChange={e => setNoteText(e.target.value)}
                      placeholder={'What was your rationale for this trade?\nWhat will you do next?'}
                      aria-label="Trade note"
                      maxLength={10000}
                      className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-[12px] min-h-[76px] focus:outline-none focus:border-[#EE6C4D] resize-y shadow-sm placeholder:text-slate-400 text-[#0B2545]"
                    />
                  </div>
                </div>
              ) : <TradeImportDrawer isOpen embedded defaultTradeDate={defaultTradeDate} onClose={onClose} onImported={items => { onImported?.(items); onClose(); }} />}
            </div>

            {activeTab === 'manual' && (
              <div className="px-3 pt-3 pb-6 border-t border-slate-200 bg-white z-10 shadow-[0_-4px_20px_rgba(0,0,0,0.03)] relative shrink-0">
                {saveError && <p role="alert" className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-[10px] text-rose-700">{saveError}</p>}
                <button 
                  onClick={handleSave} 
                  disabled={!symbol.trim() || !price || Number(price) <= 0 || !qty || Number(qty) <= 0 || isSaving}
                  className="w-full bg-[#0B2545] disabled:bg-slate-300 text-white rounded-lg py-3 font-bold text-[14px] shadow-sm active:bg-[#134074] transition-colors"
                >
                  {isSaving ? 'Saving…' : initialData ? 'Update Record' : 'Save Record'}
                </button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  // Avoid card-level backdrop filters while keeping overlays inside the phone shell.
  const modalRoot = document.getElementById('app-modal-root');
  return modalRoot ? createPortal(drawerContent, modalRoot) : drawerContent;
}
