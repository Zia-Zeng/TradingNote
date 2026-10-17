import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Tag, Target, Image as ImageIcon, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';

interface RecordDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  initialData?: any;
  onSave?: (data: any) => void | Promise<void>;
  defaultTab?: 'manual' | 'ocr';
}

export default function RecordDrawer({ isOpen, onClose, initialData, onSave, defaultTab = 'manual' }: RecordDrawerProps) {
  const buyMotiveOptions = ['Breakout Confirmation', 'Pullback Entry', 'Support Bounce', 'Trend Continuation', 'Catalyst', 'Re-entry'];
  const sellMotiveOptions = ['Take Profit', 'Stop Loss', 'Resistance Rejection', 'Trend Reversal', 'Risk Reduction', 'Thesis Invalidated'];
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [isDeletingTags, setIsDeletingTags] = useState(false);
  const [deletedMotiveOptions, setDeletedMotiveOptions] = useState<Record<'Buy' | 'Sell', string[]>>(() => {
    try { return JSON.parse(localStorage.getItem('tradingnote:deleted-motive-options') || '{"Buy":[],"Sell":[]}'); }
    catch { return { Buy: [], Sell: [] }; }
  });
  const [activeTab, setActiveTab] = useState<'manual' | 'ocr'>(defaultTab);
  const [showSuccess, setShowSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Form state
  const [symbol, setSymbol] = useState('');
  const [code, setCode] = useState('');
  const [direction, setDirection] = useState<'Buy' | 'Sell'>('Buy');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('');
  const [posTag, setPosTag] = useState('Close');
  const [tags, setTags] = useState<string[]>(['Stop Loss', 'Take Profit', 'Trend']);
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [planDesc, setPlanDesc] = useState('');
  const [motiveDesc, setMotiveDesc] = useState('');
  const [tp, setTp] = useState('');
  const [sl, setSl] = useState('');

  useEffect(() => {
    if (initialData) {
      setSymbol(initialData.symbol || '');
      setCode(initialData.code || '');
      setDirection(initialData.type === 'Sell' ? 'Sell' : 'Buy');
      setPrice(initialData.price || '');
      setQty(initialData.qty || '');
      setPosTag(initialData.motive?.posTag || 'Close');
      setTags(initialData.motive?.tags || []);
      const standardOptions = initialData.type === 'Buy' ? buyMotiveOptions : sellMotiveOptions;
      setCustomTags((initialData.motive?.tags || []).filter((tag: string) => !standardOptions.includes(tag)));
      setNewTag('');
      setTp(initialData.plan?.tp || '');
      setSl(initialData.plan?.sl || '');
      setPlanDesc(initialData.plan?.desc || '');
      setMotiveDesc(initialData.motive?.desc || '');
      setActiveTab('manual');
    } else {
      setSymbol(''); setCode(''); setPrice(''); setQty(''); setTags([]); setCustomTags([]); setNewTag('');
      setTp(''); setSl(''); setPlanDesc(''); setMotiveDesc(''); setPosTag('Close'); setDirection('Buy');
      setActiveTab(defaultTab);
    }
  }, [initialData, isOpen, defaultTab]);

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
    if (code && !/^\d{6}$/.test(code)) {
      setSaveError('A 股代码请填写 6 位数字；不确定时可以留空。');
      return;
    }
    const data = {
      symbol, code: code || undefined, direction, price, qty, posTag, tags, tp, sl, planDesc, motiveDesc
    };
    setIsSaving(true);
    try {
      if (onSave) await onSave(data);
      if (initialData) {
        onClose();
      } else {
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 2000);
        setSymbol(''); setCode(''); setPrice(''); setQty(''); setTp(''); setSl(''); setPlanDesc(''); setMotiveDesc('');
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存失败，请重试。');
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
                    Batch Import (OCR)
                  </button>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto no-scrollbar relative">
              {activeTab === 'manual' ? (
                <div className="p-3 pb-8 space-y-4">
                  {/* Basic Info */}
                  <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-200 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-[#EE6C4D]"></div>
                    <div className="flex items-center gap-2 mb-3">
                      <Search size={14} className="text-slate-400" />
                      <input 
                        value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                        placeholder="Search stock code / name"
                        className="flex-1 bg-transparent text-[14px] font-bold text-[#0B2545] focus:outline-none placeholder:text-slate-300 font-mono"
                      />
                    </div>
                    <div className="mb-3">
                      <label className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-slate-400">A 股代码（可选）</label>
                      <input
                        value={code}
                        onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="6 位代码；不确定时留空"
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono text-[12px] text-[#0B2545] placeholder:text-slate-300 focus:border-[#EE6C4D] focus:outline-none"
                      />
                    </div>
                    <div className="flex items-center gap-2 mb-3">
                      <button onClick={() => changeDirection('Buy')} className={cn("flex-1 py-1.5 rounded-lg text-[11px] font-bold border-2 transition-colors", direction === 'Buy' ? "bg-emerald-50 text-emerald-700 border-emerald-400" : "bg-white text-slate-400 border-slate-200")}>Buy</button>
                      <button onClick={() => changeDirection('Sell')} className={cn("flex-1 py-1.5 rounded-lg text-[11px] font-bold border-2 transition-colors", direction === 'Sell' ? "bg-rose-50 text-rose-600 border-rose-400" : "bg-white text-slate-400 border-slate-200")}>Sell</button>
                    </div>
                    <div className="flex gap-3 text-[12px] bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                      <div className="flex flex-col flex-1">
                        <span className="text-slate-400 text-[9px] uppercase mb-0.5 tracking-wider">Price</span>
                        <input value={price} onChange={e => setPrice(e.target.value)} type="number" placeholder="0.00" className="bg-transparent font-bold text-[#0B2545] font-mono text-[14px] focus:outline-none placeholder:text-slate-300 w-full" />
                      </div>
                      <div className="w-px bg-slate-200 self-stretch my-1"></div>
                      <div className="flex flex-col flex-1 pl-2">
                        <span className="text-slate-400 text-[9px] uppercase mb-0.5 tracking-wider">Qty</span>
                        <input value={qty} onChange={e => setQty(e.target.value)} type="number" placeholder="100" className="bg-transparent font-bold text-[#0B2545] font-mono text-[14px] focus:outline-none placeholder:text-slate-300 w-full" />
                      </div>
                    </div>
                  </div>

                  {/* Motive */}
                  <div>
                    <div className="text-[14px] font-bold text-[#0B2545] mb-2 flex items-center gap-1.5"><Tag size={14} className="text-[#EE6C4D]" /> Motive</div>
                    <div className="text-[10px] text-slate-500 mb-1.5 font-bold uppercase tracking-wider">{direction} motives (select multiple)</div>
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
                        aria-label="Add motive tag"
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
                          placeholder="New motive tag"
                          className="w-36 bg-white border border-[#EE6C4D]/50 rounded-full px-3 py-1.5 text-[11px] focus:outline-none focus:border-[#EE6C4D]"
                        />
                      )}
                      <button
                        onClick={() => { setIsDeletingTags(value => !value); setIsAddingTag(false); }}
                        aria-label={isDeletingTags ? 'Finish deleting tags' : 'Delete motive tags'}
                        className={cn("w-7 h-7 inline-flex items-center justify-center rounded-full border transition-colors", isDeletingTags ? "border-rose-300 bg-rose-50 text-rose-600" : "border-slate-300 bg-white text-slate-500 hover:border-rose-300 hover:text-rose-600")}
                      ><Trash2 size={13} /></button>
                    </div>
                    <textarea 
                      value={motiveDesc} onChange={e => setMotiveDesc(e.target.value)}
                      placeholder="Personal logic (e.g. short-term logic invalidated after...)"
                      className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-[12px] min-h-[60px] focus:outline-none focus:border-[#EE6C4D] resize-none shadow-sm placeholder:text-slate-400 text-[#0B2545]"
                    />
                  </div>

                  {/* Plan */}
                  <div>
                    <div className="text-[14px] font-bold text-[#0B2545] mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-1.5"><Target size={14} className="text-[#EE6C4D]" /> Trade Plan</div>
                    </div>
                    <div className="flex gap-2.5 mb-2.5">
                      <div className="flex-1 bg-white border border-slate-200 rounded-lg p-2.5 flex flex-col justify-center shadow-sm relative overflow-hidden">
                        <span className="text-[9px] font-bold text-slate-500 mb-0.5 uppercase tracking-wide">Take Profit</span>
                        <input value={tp} onChange={e => setTp(e.target.value)} type="number" placeholder="0.00" className="w-full text-left bg-transparent text-[14px] font-bold font-mono focus:outline-none text-[#0B2545] placeholder:text-slate-300" />
                      </div>
                      <div className="flex-1 bg-white border border-slate-200 rounded-lg p-2.5 flex flex-col justify-center shadow-sm relative overflow-hidden">
                        <span className="text-[9px] font-bold text-slate-500 mb-0.5 uppercase tracking-wide">Stop Loss</span>
                        <input value={sl} onChange={e => setSl(e.target.value)} type="number" placeholder="0.00" className="w-full text-left bg-transparent text-[14px] font-bold font-mono focus:outline-none text-[#0B2545] placeholder:text-slate-300" />
                      </div>
                    </div>
                    <textarea 
                      value={planDesc} onChange={e => setPlanDesc(e.target.value)}
                      placeholder="Plan details (e.g. strict exit on 5-day MA break)..."
                      className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-[12px] min-h-[60px] focus:outline-none focus:border-[#EE6C4D] resize-none shadow-sm placeholder:text-slate-400 text-[#0B2545]"
                    />
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-6 h-full mt-10">
                  <div className="w-full rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 py-12 text-center">
                    <ImageIcon size={32} className="mx-auto mb-3 text-slate-300" />
                    <div className="mb-1 text-[14px] font-bold text-slate-500">OCR 导入暂未接入</div>
                    <div className="mx-auto max-w-[80%] text-[11px] text-slate-400">请先使用手动录入，避免上传后没有真实识别结果。</div>
                  </div>
                </div>
              )}
            </div>

            {activeTab === 'manual' && (
              <div className="px-3 pt-3 pb-6 border-t border-slate-200 bg-white z-10 shadow-[0_-4px_20px_rgba(0,0,0,0.03)] relative shrink-0">
                <AnimatePresence>
                  {showSuccess && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="absolute -top-10 left-1/2 -translate-x-1/2 bg-[#0B2545] text-white px-3 py-1.5 rounded-full text-[11px] font-bold flex items-center gap-1.5 shadow-lg whitespace-nowrap"
                    >
                      <CheckCircle2 size={12} className="text-[#EE6C4D]" /> Record Saved! Keep going.
                    </motion.div>
                  )}
                </AnimatePresence>
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
