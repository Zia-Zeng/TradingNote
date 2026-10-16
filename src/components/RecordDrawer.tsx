import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Tag, Target, Loader2, Image as ImageIcon, CheckCircle2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { useNavigate } from 'react-router-dom';

interface RecordDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  initialData?: any;
  onSave?: (data: any) => void;
  onUploadSuccess?: () => void;
  defaultTab?: 'manual' | 'ocr';
}

export default function RecordDrawer({ isOpen, onClose, initialData, onSave, onUploadSuccess, defaultTab = 'manual' }: RecordDrawerProps) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'manual' | 'ocr'>(defaultTab);
  const [isUploading, setIsUploading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // Form state
  const [symbol, setSymbol] = useState('');
  const [direction, setDirection] = useState('Buy');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('');
  const [posTag, setPosTag] = useState('Close');
  const [tags, setTags] = useState<string[]>(['Stop Loss', 'Take Profit', 'Trend']);
  const [planDesc, setPlanDesc] = useState('');
  const [motiveDesc, setMotiveDesc] = useState('');
  const [tp, setTp] = useState('');
  const [sl, setSl] = useState('');

  useEffect(() => {
    if (initialData) {
      setSymbol(initialData.symbol || '');
      setDirection(initialData.type || 'Buy');
      setPrice(initialData.price || '');
      setQty(initialData.qty || '');
      setPosTag(initialData.motive?.posTag || 'Close');
      setTags(initialData.motive?.tags || []);
      setTp(initialData.plan?.tp || '');
      setSl(initialData.plan?.sl || '');
      setPlanDesc(initialData.plan?.desc || '');
      setMotiveDesc(initialData.motive?.desc || '');
      setActiveTab('manual');
    } else {
      setSymbol(''); setPrice(''); setQty(''); setTags(['Stop Loss', 'Take Profit', 'Trend']); 
      setTp(''); setSl(''); setPlanDesc(''); setMotiveDesc(''); setPosTag('Close'); setDirection('Buy');
      setActiveTab(defaultTab);
    }
  }, [initialData, isOpen, defaultTab]);

  const toggleTag = (tag: string) => {
    if (tags.includes(tag)) setTags(tags.filter(t => t !== tag));
    else setTags([...tags, tag]);
  };

  const handleSave = () => {
    const data = {
      symbol, direction, price, qty, posTag, tags, tp, sl, planDesc, motiveDesc
    };
    if (onSave) onSave(data);
    
    if (initialData) {
      onClose();
    } else {
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 2000);
      setSymbol(''); setPrice(''); setQty(''); setTp(''); setSl(''); setPlanDesc(''); setMotiveDesc('');
    }
  };

  const handleUpload = () => {
    setIsUploading(true);
    setTimeout(() => {
      setIsUploading(false);
      if (onUploadSuccess) {
        onUploadSuccess();
      } else {
        onClose();
      }
    }, 1500);
  };

  const drawerContent = (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div 
            key="backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-[#0B2545]/40 z-[9998] backdrop-blur-sm"
          />
          <motion.div
            key="drawer"
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 220 }}
            className="fixed bottom-0 left-0 right-0 h-[85vh] bg-[#F8F9FA] rounded-t-2xl z-[9999] flex flex-col shadow-[0_-10px_40px_rgba(0,0,0,0.1)] overflow-hidden"
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
                    <div className="flex items-center gap-2 mb-3">
                      <button onClick={() => setDirection('Buy')} className={cn("flex-1 py-1.5 rounded-lg text-[11px] font-bold border transition-colors", direction === 'Buy' ? "bg-blue-50 text-blue-600 border-blue-200" : "bg-white text-slate-400 border-slate-200")}>Buy</button>
                      <button onClick={() => setDirection('Sell')} className={cn("flex-1 py-1.5 rounded-lg text-[11px] font-bold border transition-colors", direction === 'Sell' ? "bg-rose-50 text-rose-500 border-rose-200" : "bg-white text-slate-400 border-slate-200")}>Sell</button>
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
                    <div className="text-[10px] text-slate-500 mb-1.5 font-bold uppercase tracking-wider">Tags (Multi)</div>
                    <div className="flex flex-wrap gap-1.5 mb-2.5">
                      {['Stop Loss', 'Take Profit', 'Trend', 'Support Break', 'No Logic', 'Error Fix', 'Market Dip'].map(tag => (
                        <button 
                          key={tag} onClick={() => toggleTag(tag)}
                          className={cn("px-2.5 py-1 rounded-md text-[11px] transition-all font-bold border", tags.includes(tag) ? "bg-[#EE6C4D]/10 text-[#EE6C4D] border-[#EE6C4D]/30" : "bg-white text-slate-600 border-slate-200")}
                        >
                          {tag}
                        </button>
                      ))}
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
                  <div
                    onClick={handleUpload}
                    className="w-full border-2 border-dashed border-[#EE6C4D]/40 bg-[#EE6C4D]/5 rounded-2xl flex flex-col items-center justify-center py-12 cursor-pointer hover:bg-[#EE6C4D]/10 transition-colors"
                  >
                    {isUploading ? (
                      <Loader2 size={32} className="text-[#EE6C4D] animate-spin mb-3" />
                    ) : (
                      <ImageIcon size={32} className="text-[#EE6C4D] mb-3" />
                    )}
                    <div className="text-[14px] font-bold text-[#0B2545] mb-1">
                      {isUploading ? "Extracting Trades..." : "Tap to Upload Screenshot"}
                    </div>
                    <div className="text-[11px] text-slate-500 text-center max-w-[80%]">
                      Supports brokerage app screenshots (Future Assets, EastMoney, etc.)
                    </div>
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
                <button 
                  onClick={handleSave} 
                  disabled={!symbol}
                  className="w-full bg-[#0B2545] disabled:bg-slate-300 text-white rounded-lg py-3 font-bold text-[14px] shadow-sm active:bg-[#134074] transition-colors"
                >
                  {initialData ? 'Update Record' : 'Save & Continue'}
                </button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  return createPortal(drawerContent, document.body);
}
