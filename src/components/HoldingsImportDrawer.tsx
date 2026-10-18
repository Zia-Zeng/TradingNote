import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Upload, X } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { parseHoldingsFile, type HoldingDraft } from '../lib/holdings-import';
import { defaultCurrencyForMarket, inferMarketCurrency, normalizeMarketCode } from '../lib/instruments';

export type HoldingSnapshot = {
  id: string;
  as_of: string;
  account: string;
  imported_at: string;
  total_assets?: number | null;
  total_assets_currency?: string | null;
  warnings?: string[];
  rows: HoldingDraft[];
};

export default function HoldingsImportDrawer({ open, onClose, onImported, defaultDate }: {
  open: boolean;
  onClose: () => void;
  onImported: (snapshot: HoldingSnapshot) => void;
  defaultDate: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [asOf, setAsOf] = useState(defaultDate);
  const [manualTotalAssets, setManualTotalAssets] = useState('');
  const [manualTotalAssetsCurrency, setManualTotalAssetsCurrency] = useState('CNY');
  const [fileTotalAssets, setFileTotalAssets] = useState<number | null>(null);
  const [fileTotalAssetsCurrency, setFileTotalAssetsCurrency] = useState('CNY');
  const [rows, setRows] = useState<HoldingDraft[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAsOf(defaultDate); setRows([]); setWarnings([]); setError(''); setFileTotalAssets(null); setFileTotalAssetsCurrency('CNY');
  }, [defaultDate, open]);

  if (!open) return null;
  const updateRow = (index: number, changes: Partial<HoldingDraft>) => setRows(current => current.map((row, i) => i === index ? { ...row, ...changes } : row));
  const chooseFile = async (file?: File) => {
    if (!file) return;
    setLoading(true); setError(''); setWarnings([]); setRows([]); setFileTotalAssets(null); setFileTotalAssetsCurrency('CNY');
    try {
      if (file.type.startsWith('image/')) {
        const body = new FormData(); body.append('image', file);
        const preview = await apiRequest<{ rows: Array<Partial<HoldingDraft> & Pick<HoldingDraft, 'symbol' | 'quantity'>>; total_assets?: number | null; total_assets_currency?: string | null; warnings: string[] }>('/api/today/import/holdings/ocr', { method: 'POST', body });
        let assumedCurrencyCount = 0;
        const normalizedRows = preview.rows.map(row => {
          const identity = row.code || row.symbol;
          const market = normalizeMarketCode(row.market, identity);
          const inferred = inferMarketCurrency(identity);
          const currency = row.currency || defaultCurrencyForMarket(market) || inferred.currency;
          if (!currency) assumedCurrencyCount += 1;
          return { ...row, market, asset_class: row.asset_class || 'Stock', currency: (currency || 'CNY').toUpperCase() } as HoldingDraft;
        });
        setRows(normalizedRows);
        setWarnings([...preview.warnings, ...(assumedCurrencyCount ? [`Original currency was unclear for ${assumedCurrencyCount} position(s); CNY was assumed. Please verify the preview.`] : []), ...(preview.total_assets !== undefined && preview.total_assets !== null && !preview.total_assets_currency ? ['Total assets currency was unclear; CNY was assumed. Please verify it.'] : []), ...(normalizedRows.length ? [] : ['No holdings were recognized. Try a clearer screenshot or upload a spreadsheet.'])]);
        if (preview.total_assets !== undefined && preview.total_assets !== null) {
          setFileTotalAssets(preview.total_assets);
          setFileTotalAssetsCurrency(preview.total_assets_currency || 'CNY');
        }
      } else {
        const preview = await parseHoldingsFile(file);
        setRows(preview.rows); setWarnings(preview.warnings);
        if (preview.total_assets !== undefined) {
          setFileTotalAssets(preview.total_assets);
          setFileTotalAssetsCurrency(preview.total_assets_currency || 'CNY');
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to read holdings file.');
    } finally { setLoading(false); }
  };
  const confirmImport = async () => {
    const totalAssetsText = fileTotalAssets !== null ? String(fileTotalAssets) : manualTotalAssets.trim();
    const totalAssets = totalAssetsText ? Number(totalAssetsText) : undefined;
    if (!asOf) { setError('Enter the snapshot date.'); return; }
    if (totalAssetsText && (!Number.isFinite(totalAssets) || (totalAssets ?? -1) < 0)) { setError('Enter a valid non-negative total assets amount.'); return; }
    if (rows.some(row => !row.symbol.trim() || !row.currency.trim() || !Number.isFinite(row.quantity))) { setError('Complete the security name, original currency, and quantity for every row.'); return; }
    setSaving(true); setError('');
    try {
      const snapshot = await apiRequest<HoldingSnapshot>('/api/today/import/holdings', {
        method: 'POST', body: JSON.stringify({ as_of: asOf, account: 'Default account', total_assets: totalAssets, total_assets_currency: totalAssets !== undefined ? (fileTotalAssets !== null ? fileTotalAssetsCurrency : manualTotalAssetsCurrency) : undefined, rows }),
      });
      onImported(snapshot); onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Holdings import failed.');
    } finally { setSaving(false); }
  };

  const modal = <div className="pointer-events-auto fixed inset-0 z-[130] flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4">
    <section role="dialog" aria-modal="true" aria-labelledby="holdings-import-title" className="flex max-h-[92vh] w-full max-w-xl flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
      <header className="flex items-center justify-between border-b border-slate-100 p-4">
        <div><h2 id="holdings-import-title" className="text-[15px] font-bold text-[#0B2545]">Import holdings snapshot</h2><p className="mt-1 text-[10px] text-slate-500">This is the end-of-day baseline for P&amp;L; calculations start on the next trading day. Original currencies are kept.</p></div>
        <button onClick={onClose} aria-label="Close" className="rounded-full bg-slate-100 p-1.5 text-slate-500"><X size={15} /></button>
      </header>
      <div className="space-y-3 overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[9px] font-bold uppercase text-slate-400">Snapshot date<input type="date" value={asOf} onChange={event => setAsOf(event.target.value)} className="mt-1 w-full rounded border border-slate-200 p-2 font-mono text-[11px] text-[#0B2545]" /></label>
          <label className="text-[9px] font-bold uppercase text-slate-400">Total assets (optional)<span className="mt-1 flex gap-1"><input aria-label="Total assets" type="number" min="0" step="any" value={fileTotalAssets !== null ? fileTotalAssets : manualTotalAssets} readOnly={fileTotalAssets !== null} onChange={event => setManualTotalAssets(event.target.value)} placeholder="Enter total assets" className="min-w-0 flex-1 rounded border border-slate-200 p-2 font-mono text-[11px] text-[#0B2545] read-only:bg-slate-50" /><select aria-label="Total assets currency" disabled={fileTotalAssets !== null} value={fileTotalAssets !== null ? fileTotalAssetsCurrency : manualTotalAssetsCurrency} onChange={event => setManualTotalAssetsCurrency(event.target.value)} className="w-[76px] rounded border border-slate-200 bg-white p-1 text-[10px] disabled:bg-slate-50"><option>CNY</option><option>HKD</option><option>USD</option><option>JPY</option><option>EUR</option><option>GBP</option><option>CAD</option><option>AUD</option><option>SGD</option></select></span></label>
        </div>
        {fileTotalAssets !== null && <p className="rounded bg-emerald-50 p-2 text-[10px] text-emerald-700">Total assets detected in the file. The file value will be used instead of manual input.</p>}
        {!rows.length && <button disabled={loading} onClick={() => fileRef.current?.click()} className="flex w-full flex-col items-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-7 text-slate-600 hover:border-[#EE6C4D]">
          {loading ? <Loader2 className="animate-spin text-[#EE6C4D]" /> : <Upload className="text-[#EE6C4D]" />}<span className="mt-2 text-[12px] font-bold">{loading ? 'Reading holdings…' : 'Choose holdings file or screenshot'}</span><span className="mt-1 text-[10px]">CSV / XLS / XLSX / PNG / JPEG / WebP</span>
        </button>}
        <input ref={fileRef} type="file" accept=".csv,.xls,.xlsx,image/png,image/jpeg,image/webp" className="hidden" onChange={event => { void chooseFile(event.target.files?.[0]); event.target.value = ''; }} />
        {warnings.map(warning => <p key={warning} className="rounded bg-amber-50 p-2 text-[10px] text-amber-700">{warning}</p>)}
        {error && <p role="alert" className="rounded bg-rose-50 p-2 text-[10px] text-rose-700">{error}</p>}
        {rows.length > 0 && <>
          <div className="flex items-center justify-between text-[10px] font-bold text-[#0B2545]"><span>Preview · {rows.length} positions</span><button onClick={() => fileRef.current?.click()} className="text-[#EE6C4D]">Choose another file</button></div>
          <div className="max-h-[42vh] space-y-2 overflow-y-auto">
            {rows.map((row, index) => <div key={`${row.code}-${index}`} className="space-y-2 rounded-lg border border-slate-200 p-2">
              <div className="grid grid-cols-2 gap-2">
                <input aria-label="Security name" value={row.symbol} onChange={event => updateRow(index, { symbol: event.target.value })} placeholder="Name / symbol" className="min-w-0 rounded border border-slate-200 p-1.5 text-[10px]" />
                <input aria-label="Ticker" value={row.code || ''} onChange={event => updateRow(index, { code: event.target.value })} placeholder="Ticker / code" className="min-w-0 rounded border border-slate-200 p-1.5 font-mono text-[10px]" />
                <select aria-label="Market" value={row.market} onChange={event => updateRow(index, { market: event.target.value })} className="rounded border border-slate-200 p-1.5 text-[10px]"><option value="CN">Mainland China</option><option value="HK">Hong Kong</option><option value="US">United States</option><option value="CRYPTO">Crypto</option><option value="GLOBAL">Other / Global</option></select>
                <input aria-label="Original currency" value={row.currency} maxLength={8} onChange={event => updateRow(index, { currency: event.target.value.toUpperCase() })} placeholder="Currency" className="rounded border border-slate-200 p-1.5 font-mono text-[10px] uppercase" />
                <input aria-label="Asset class" value={row.asset_class} maxLength={32} onChange={event => updateRow(index, { asset_class: event.target.value })} placeholder="Asset class" className="rounded border border-slate-200 p-1.5 text-[10px]" />
                <input aria-label="Quantity" type="number" value={row.quantity} onChange={event => updateRow(index, { quantity: Number(event.target.value) })} placeholder="Quantity" className="rounded border border-slate-200 p-1.5 font-mono text-[10px]" />
                <input aria-label="Average cost" type="number" value={row.average_cost ?? ''} onChange={event => updateRow(index, { average_cost: event.target.value ? Number(event.target.value) : undefined })} placeholder="Average cost" className="rounded border border-slate-200 p-1.5 font-mono text-[10px]" />
                <input aria-label="Market price" type="number" value={row.market_price ?? ''} onChange={event => updateRow(index, { market_price: event.target.value ? Number(event.target.value) : undefined })} placeholder="Market price" className="rounded border border-slate-200 p-1.5 font-mono text-[10px]" />
                <input aria-label="Market value" type="number" value={row.market_value ?? ''} onChange={event => updateRow(index, { market_value: event.target.value ? Number(event.target.value) : undefined })} placeholder="Market value" className="rounded border border-slate-200 p-1.5 font-mono text-[10px]" />
              </div>
            </div>)}
          </div>
          <button disabled={saving} onClick={() => void confirmImport()} className="w-full rounded-lg bg-[#EE6C4D] py-2.5 text-[11px] font-bold text-white disabled:opacity-60">{saving ? 'Importing…' : `Confirm ${rows.length} positions`}</button>
        </>}
      </div>
    </section>
  </div>;

  const modalRoot = document.getElementById('app-modal-root');
  return modalRoot ? createPortal(modal, modalRoot) : modal;
}
