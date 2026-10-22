import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight, Loader2, Search, Upload, X } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { defaultCurrencyForMarket, inferMarketCurrency, normalizeMarketCode, type InstrumentSearchResult } from '../lib/instruments';
import { formatTradeTimestamp } from '../lib/trade-time';
import { notifyDailyReviewInputsChanged } from '../lib/daily-review';
import TradeImportDrawer from './TradeImportDrawer';

export default function AssetHistoryImportDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<InstrumentSearchResult[]>([]);
  const [selected, setSelected] = useState<InstrumentSearchResult | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchUnavailable, setSearchUnavailable] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    if (!open || !searchOpen || query.trim().length < 1) {
      setOptions([]);
      setSearching(false);
      setSearchUnavailable(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const result = await apiRequest<{ items: InstrumentSearchResult[]; available?: boolean }>(`/api/stocks/search?q=${encodeURIComponent(query.trim())}`);
        if (!cancelled) {
          setOptions(result.items || []);
          setSearchUnavailable(result.available === false);
        }
      } catch {
        if (!cancelled) {
          setOptions([]);
          setSearchUnavailable(true);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [open, query, searchOpen]);

  useEffect(() => {
    if (open) return;
    setQuery('');
    setSelected(null);
    setSearchOpen(false);
    setImportOpen(false);
  }, [open]);

  if (!open) return null;

  const useTypedInstrument = () => {
    const name = query.trim();
    if (!name) return;
    const inferred = inferMarketCurrency(name);
    const code = /^[A-Za-z0-9.^=_:-]+$/.test(name) ? name : '';
    const market = inferred.market;
    setSelected({
      name,
      code,
      market,
      currency: defaultCurrencyForMarket(market) || inferred.currency || 'CNY',
      asset_class: market === 'CRYPTO' ? 'Crypto' : 'Stock',
    });
    setSearchOpen(false);
  };

  const handleImported = (items: Array<{ time?: string }>) => {
    const dates = new Set(items.map(item => formatTradeTimestamp(item.time).date).filter((value): value is string => Boolean(value)));
    dates.forEach(date => notifyDailyReviewInputsChanged(date));
    onClose();
  };

  const modal = <>
    <div className="pointer-events-auto fixed inset-0 z-[119] flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4">
      <section className="max-h-[calc(100dvh-1rem)] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl sm:rounded-2xl">
        <header className="mb-4 flex items-start justify-between gap-3">
          <div><h2 className="text-[16px] font-bold text-[#0B2545]">Import asset history</h2><p className="mt-1 text-[11px] leading-relaxed text-slate-500">Select one security, then upload or manually enter its transaction history. Confirmed trades are saved to your ledger and used to rebuild positions and P&amp;L.</p></div>
          <button onClick={onClose} aria-label="Close" className="shrink-0 rounded-full bg-slate-100 p-1.5 text-slate-500"><X size={15} /></button>
        </header>

        {!selected ? <div>
          <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-slate-400">Security</label>
          <div>
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2 focus-within:border-[#EE6C4D]">
              <Search size={14} className="shrink-0 text-slate-400" />
              <input value={query} onFocus={() => setSearchOpen(true)} onChange={event => { setQuery(event.target.value); setSearchOpen(true); }} onKeyDown={event => { if (event.key === 'Enter') useTypedInstrument(); if (event.key === 'Escape') setSearchOpen(false); }} placeholder="Search name or ticker, e.g. Coca-Cola" autoComplete="off" className="min-w-0 flex-1 bg-transparent text-[13px] font-semibold text-[#0B2545] outline-none placeholder:font-normal placeholder:text-slate-300" />
            </div>
            {searchOpen && query.trim() && <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-sm">
              {options.map(option => <button key={`${option.market}:${option.code}`} type="button" onMouseDown={event => event.preventDefault()} onClick={() => {
                const inferred = inferMarketCurrency(option.code || option.name);
                const market = normalizeMarketCode(option.market, option.code || option.name);
                setSelected({ ...option, market, currency: option.currency || defaultCurrencyForMarket(market) || inferred.currency });
                setQuery(option.name);
                setSearchOpen(false);
              }} className="flex w-full items-center justify-between border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-slate-50">
                <span className="truncate text-[12px] font-semibold text-[#0B2545]">{option.name}<span className="ml-1.5 font-mono text-[9px] text-slate-400">{option.market} · {option.asset_class}</span></span><span className="ml-3 shrink-0 font-mono text-[10px] text-slate-500">{option.code}</span>
              </button>)}
              {searching && <div className="flex items-center gap-1.5 px-3 py-2 text-[10px] text-slate-400"><Loader2 size={11} className="animate-spin" /> Searching…</div>}
              {!searching && options.length === 0 && <div className="px-3 py-2 text-[10px] text-slate-500">{searchUnavailable ? 'Search is unavailable.' : 'No exact match found.'} You can use the entered name or code.</div>}
              {!searching && options.length === 0 && <button type="button" onMouseDown={event => event.preventDefault()} onClick={useTypedInstrument} className="flex w-full items-center justify-between px-3 py-2 text-left text-[10px] font-bold text-[#EE6C4D]">Use “{query.trim()}” <ChevronRight size={12} /></button>}
            </div>}
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-400">For accurate holdings and P&amp;L, include the full history from the first opening trade. Partial history can produce incomplete positions.</p>
        </div> : <>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3">
            <div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Check size={13} /></span><div className="min-w-0"><div className="truncate text-[12px] font-bold text-[#0B2545]">{selected.name}</div><div className="font-mono text-[9px] text-slate-500">{selected.code || 'No ticker'} · {selected.market} · {selected.currency}</div></div></div>
            <div className="mt-3 flex gap-2"><button onClick={() => { setImportOpen(false); setSelected(null); setQuery(''); setSearchOpen(true); }} className="flex-1 rounded-lg border border-slate-200 bg-white py-2 text-[10px] font-bold text-slate-600">Change security</button><button onClick={() => setImportOpen(value => !value)} className="flex-1 rounded-lg bg-[#0B2545] py-2 text-[10px] font-bold text-white">{importOpen ? 'Back to security' : <><Upload size={12} className="mr-1 inline" />Add trade history</>}</button></div>
          </div>
          {importOpen && <div className="mt-2 rounded-xl border border-slate-100 bg-white"><TradeImportDrawer isOpen onClose={() => setImportOpen(false)} onImported={handleImported} embedded asset={selected} requireTradeDates /></div>}
        </>}
      </section>
    </div>
  </>;

  const modalRoot = document.getElementById('app-modal-root');
  return modalRoot ? createPortal(modal, modalRoot) : modal;
}
