import React, { useRef, useState } from 'react';
import { FileSpreadsheet, Image, Loader2, Upload, X } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { type ImportedTradeDraft, parseTradeSpreadsheet } from '../lib/trade-import';
import { currentLocalDate, hasTradeDate, toStoredTradeTime, tradeDateTimeFields } from '../lib/trade-time';
import { defaultCurrencyForMarket, inferMarketCurrency, normalizeMarketCode, type InstrumentSearchResult } from '../lib/instruments';
import { newIdempotencyKey, sha256File } from '../lib/import-dedupe';

type ImportResult = ImportedTradeDraft & { id: string };
type DuplicateMatch = { row_index: number; symbol: string; trade_date: string | null; existing_id?: string; duplicate_of_row?: number; source: 'ledger' | 'upload' };
type DuplicateMode = 'skip' | 'replace' | 'allow';

export default function TradeImportDrawer({ isOpen, onClose, onImported, embedded = false, defaultTradeDate, asset, requireTradeDates = false }: { isOpen: boolean; onClose: () => void; onImported: (items: ImportResult[]) => void; embedded?: boolean; defaultTradeDate?: string; asset?: InstrumentSearchResult; requireTradeDates?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ImportedTradeDraft[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [duplicateMatches, setDuplicateMatches] = useState<DuplicateMatch[] | null>(null);
  const [duplicateSourceSeen, setDuplicateSourceSeen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sourceHashes, setSourceHashes] = useState<string[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey('trades'));

  const rowsForImport = () => asset ? rows.map(row => ({
    ...row,
    symbol: asset.name,
    code: asset.code || undefined,
    market: asset.market,
    asset_class: asset.asset_class,
    currency: asset.currency,
  })) : rows;

  if (!isOpen) return null;

  const reset = () => { setRows([]); setWarnings([]); setError(null); setNotice(null); setDuplicateMatches(null); setDuplicateSourceSeen(false); setSourceHashes([]); setIdempotencyKey(newIdempotencyKey('trades')); setLoading(false); setSaving(false); };
  const close = () => { reset(); onClose(); };

  const selectFile = async (file?: File) => {
    if (!file) return;
    setLoading(true); setError(null); setNotice(null); setDuplicateMatches(null); setDuplicateSourceSeen(false); setRows([]); setWarnings([]);
    try {
      const sourceHash = await sha256File(file);
      setSourceHashes([sourceHash]);
      setIdempotencyKey(newIdempotencyKey('trades'));
      if (file.type.startsWith('image/')) {
        const body = new FormData(); body.append('image', file);
        const preview = await apiRequest<{ trades: ImportedTradeDraft[]; warnings: string[] }>('/api/today/import/ocr', { method: 'POST', body });
        setRows(preview.trades.map(trade => {
          const inferred = inferMarketCurrency(trade.code || trade.symbol);
          const market = normalizeMarketCode(trade.market, trade.code || trade.symbol);
          return { ...trade, market, currency: trade.currency || defaultCurrencyForMarket(market) || inferred.currency };
        })); setWarnings(preview.warnings);
      } else if (/\.(csv|xlsx|xls|txt)$/i.test(file.name)) {
        const preview = await parseTradeSpreadsheet(file);
        const missingDates = preview.trades.filter(trade => !hasTradeDate(trade.time)).length;
        const fallbackDateLabel = defaultTradeDate ? `the selected date (${defaultTradeDate})` : "today's date";
        setRows(preview.trades.map(trade => {
          const timestamp = hasTradeDate(trade.time)
            ? tradeDateTimeFields(trade.time)
            : { date: requireTradeDates ? '' : defaultTradeDate || currentLocalDate(), time: '' };
          return { ...trade, time: timestamp.date ? toStoredTradeTime(timestamp.date, timestamp.time) : '' };
        }));
        setWarnings([...preview.warnings, ...(missingDates ? [requireTradeDates ? `${missingDates} trade(s) need a date. Enter the date shown in the statement before importing.` : `${missingDates} trade(s) had no recognized date and were temporarily assigned ${fallbackDateLabel}. Review each date before importing. Unrecognized trade times will remain blank.`] : [])]);
      } else throw new Error('Choose a CSV, TXT, Excel, or PNG/JPEG/WebP screenshot file.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to parse this file.'); }
    finally { setLoading(false); }
  };

  const importWithDuplicateMode = async (duplicate_mode: DuplicateMode) => {
    const result = await apiRequest<{ trades: ImportResult[]; skipped_count: number; replaced_count: number }>('/api/today/import/trades', {
      method: 'POST', body: JSON.stringify({ trades: rowsForImport(), duplicate_mode, source_hashes: sourceHashes, idempotency_key: idempotencyKey }),
    });
    if (result.trades.length > 0) {
      onImported(result.trades);
      close();
      return;
    }
    setDuplicateMatches(null);
    setNotice(`No new trades imported. Skipped ${result.skipped_count} matching trade(s) already in your ledger.`);
  };

  const save = async () => {
    if (!rows.length) return;
    if (rows.some(row => !hasTradeDate(row.time))) { setError('Enter a trade date for every row. Trade time is optional.'); return; }
    if (rows.some(row => !row.currency?.trim())) { setError('Set the original currency for every row before importing.'); return; }
    setSaving(true); setError(null); setNotice(null);
    try {
      const check = await apiRequest<{ duplicates: DuplicateMatch[]; duplicate_sources?: string[] }>('/api/today/import/trades/check', {
        method: 'POST', body: JSON.stringify({ trades: rowsForImport(), source_hashes: sourceHashes, idempotency_key: idempotencyKey }),
      });
      if (check.duplicates.length > 0) {
        setDuplicateMatches(check.duplicates);
        setDuplicateSourceSeen(Boolean(check.duplicate_sources?.length));
        return;
      }
      if (check.duplicate_sources?.length) {
        setError('This file was imported before, but these rows do not match the saved trades. Review the dates and fills before trying again.');
        return;
      }
      await importWithDuplicateMode('skip');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Trade import failed.'); }
    finally { setSaving(false); }
  };

  const resolveDuplicates = async (mode: DuplicateMode) => {
    setSaving(true); setError(null);
    try { await importWithDuplicateMode(mode); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Trade import failed.'); }
    finally { setSaving(false); }
  };

  return <div className={embedded ? "p-3" : "pointer-events-auto fixed inset-0 z-[120] flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4"}>
    <div className={embedded ? "w-full" : "w-full max-w-lg rounded-t-2xl bg-white p-4 shadow-2xl sm:rounded-2xl"}>
      <div className="mb-4 flex items-start justify-between"><div><h2 className="text-[16px] font-bold text-[#0B2545]">{asset ? `Import history · ${asset.name}` : 'Batch import'}</h2><p className="mt-1 text-[11px] text-slate-500">Upload a CSV, TXT, Excel file, or trade screenshot. Check each side, price, quantity, and date before saving.</p></div>{!embedded && <button onClick={close} className="p-1 text-slate-400"><X size={18} /></button>}</div>
      {!rows.length && <button disabled={loading} onClick={() => inputRef.current?.click()} className="flex w-full flex-col items-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-slate-600 hover:border-[#EE6C4D]">
        {loading ? <Loader2 className="animate-spin text-[#EE6C4D]" /> : <Upload className="text-[#EE6C4D]" />}<span className="mt-2 text-[12px] font-bold">Choose a file</span><span className="mt-1 text-[10px]">CSV / TXT / XLSX / PNG / JPEG / WebP</span>
      </button>}
      <input ref={inputRef} type="file" className="hidden" accept=".csv,.txt,.xls,.xlsx,image/png,image/jpeg,image/webp" onChange={e => { void selectFile(e.target.files?.[0]); e.target.value = ''; }} />
      {error && <p className="mt-3 rounded-lg bg-rose-50 p-2 text-[11px] text-rose-700">{error}</p>}
      {notice && <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-2 text-[11px] text-emerald-700">{notice}</p>}
      {!asset && warnings.map(warning => <p key={warning} className="mt-2 rounded-lg bg-amber-50 p-2 text-[10px] text-amber-700">{warning}</p>)}
      {rows.length > 0 && <>
        <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
          {rows.map((row, index) => {
            const timestamp = tradeDateTimeFields(row.time);
            const updateTimestamp = (date: string, time = timestamp.time) => setRows(current => current.map((item, i) => i === index ? { ...item, time: toStoredTradeTime(date, time) } : item));
            return <div key={index} className="rounded-lg border border-slate-200 p-2">
              <div className="grid grid-cols-2 gap-2">
                <select value={row.type} onChange={e => setRows(current => current.map((item, i) => i === index ? { ...item, type: e.target.value as 'Buy' | 'Sell' } : item))} className="rounded border border-slate-200 p-1 text-[11px]"><option>Buy</option><option>Sell</option></select>
                {asset ? <div className="flex items-center rounded border border-slate-200 bg-slate-50 px-2 text-[10px] font-semibold text-[#0B2545]">{asset.name} · {asset.code || asset.market}</div> : <input value={row.symbol} onChange={e => setRows(current => current.map((item, i) => i === index ? { ...item, symbol: e.target.value } : item))} className="rounded border border-slate-200 p-1 text-[11px]" placeholder="Symbol" />}
                <input type="number" value={row.price} onChange={e => setRows(current => current.map((item, i) => i === index ? { ...item, price: Number(e.target.value) } : item))} className="rounded border border-slate-200 p-1 text-[11px]" placeholder="Price" />
                <input type="number" value={row.qty} onChange={e => setRows(current => current.map((item, i) => i === index ? { ...item, qty: Number(e.target.value) } : item))} className="rounded border border-slate-200 p-1 text-[11px]" placeholder="Quantity" />
                <input aria-label="Fee (optional)" type="number" min="0" step="any" value={row.fee ?? ''} onChange={e => setRows(current => current.map((item, i) => i === index ? { ...item, fee: e.target.value === '' ? undefined : Number(e.target.value) } : item))} className="rounded border border-slate-200 p-1 text-[11px]" placeholder="Fee (optional)" />
                {!asset && <select aria-label="Market" value={row.market || 'GLOBAL'} onChange={e => setRows(current => current.map((item, i) => i === index ? { ...item, market: e.target.value } : item))} className="rounded border border-slate-200 p-1 text-[11px]"><option value="CN">Mainland China</option><option value="HK">Hong Kong</option><option value="US">United States</option><option value="CRYPTO">Crypto</option><option value="GLOBAL">Other / Global</option></select>}
                {!asset && <input aria-label="Original currency" value={row.currency || ''} maxLength={8} onChange={e => setRows(current => current.map((item, i) => i === index ? { ...item, currency: e.target.value.toUpperCase() } : item))} className="rounded border border-slate-200 p-1 font-mono text-[11px] uppercase" placeholder="Currency (USD)" />}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label><span className="mb-1 block text-[9px] font-bold text-slate-400">Trade date (required)</span><input lang="en-US" type="date" required value={timestamp.date} onChange={e => updateTimestamp(e.target.value)} className="w-full rounded border border-slate-200 px-2 py-1.5 font-mono text-[10px] text-[#0B2545]" /></label>
                <label><span className="mb-1 block text-[9px] font-bold text-slate-400">Trade time (optional)</span><input lang="en-US" type="time" value={timestamp.time} onChange={e => updateTimestamp(timestamp.date, e.target.value)} className="w-full rounded border border-slate-200 px-2 py-1.5 font-mono text-[10px] text-[#0B2545]" /></label>
              </div>
            </div>;
          })}
        </div>
        {duplicateMatches?.length ? <div role="alert" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
          <p className="text-[11px] font-bold text-amber-900">Possible duplicate upload detected</p>
          <p className="mt-1 text-[10px] leading-relaxed text-amber-800">{duplicateMatches.length} row(s) match existing trades by date, time, instrument, side, price, and quantity. Skip them or replace the execution fields; saved motive and plan remain intact.</p>
          {duplicateSourceSeen && <p className="mt-1 text-[10px] text-amber-800">This same file was imported before. Creating another copy is disabled.</p>}
          <div className="mt-2 max-h-20 space-y-1 overflow-y-auto text-[9px] text-amber-800">
            {duplicateMatches.slice(0, 5).map(match => <div key={`${match.row_index}-${match.existing_id || match.duplicate_of_row}`}>Row {match.row_index} · {match.symbol} · {match.trade_date}{match.source === 'upload' ? ` · duplicate of row ${match.duplicate_of_row}` : ' · already in ledger'}</div>)}
            {duplicateMatches.length > 5 && <div>…and {duplicateMatches.length - 5} more</div>}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button disabled={saving} onClick={() => void resolveDuplicates('skip')} className="rounded-lg border border-amber-300 bg-white py-2 text-[10px] font-bold text-amber-900 disabled:opacity-60">{saving ? 'Working…' : 'Skip duplicates'}</button>
            <button disabled={saving} onClick={() => void resolveDuplicates('replace')} className="rounded-lg bg-[#EE6C4D] py-2 text-[10px] font-bold text-white disabled:opacity-60">Overwrite matches</button>
            {!duplicateSourceSeen && <button disabled={saving} onClick={() => void resolveDuplicates('allow')} className="rounded-lg border border-slate-200 bg-white py-2 text-[10px] font-bold text-slate-600 disabled:opacity-60">Import all as new</button>}
            <button disabled={saving} onClick={() => { setDuplicateMatches(null); setError(null); }} className="rounded-lg border border-slate-200 bg-white py-2 text-[10px] font-bold text-slate-600 disabled:opacity-60">Cancel</button>
          </div>
        </div> : <div className="mt-4 flex gap-2"><button onClick={() => inputRef.current?.click()} className="flex-1 rounded-lg border border-slate-200 py-2 text-[11px] font-bold text-slate-600">Choose another file</button><button disabled={saving} onClick={() => void save()} className="flex-1 rounded-lg bg-[#EE6C4D] py-2 text-[11px] font-bold text-white">{saving ? 'Checking…' : `Confirm ${rows.length} trades`}</button></div>}
      </>}
      <div className="mt-3 flex gap-3 text-[10px] text-slate-400"><span className="flex items-center gap-1"><FileSpreadsheet size={11}/>CSV / Excel</span><span className="flex items-center gap-1"><Image size={11}/>Screenshot</span></div>
    </div>
  </div>;
}
