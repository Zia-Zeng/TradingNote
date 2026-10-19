import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Plus, Trash2, Upload, X } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { parseHoldingsFile, type HoldingDraft } from '../lib/holdings-import';
import { defaultCurrencyForMarket, inferMarketCurrency, normalizeMarketCode } from '../lib/instruments';
import { newIdempotencyKey, sha256File } from '../lib/import-dedupe';

export type HoldingSnapshot = {
  id: string;
  as_of: string;
  account: string;
  imported_at: string;
  total_assets?: number | null;
  total_assets_currency?: string | null;
  initial_cash?: number | null;
  snapshot_scope?: 'FULL_ACCOUNT' | 'MARKET_ONLY' | 'PAGE_PARTIAL';
  duplicate?: boolean;
  warnings?: string[];
  rows: HoldingDraft[];
};

const emptyHolding = (): HoldingDraft => ({ symbol: '', code: '', market: 'CN', asset_class: 'Stock', currency: 'CNY', quantity: 0 });

function holdingIdentity(row: HoldingDraft): string {
  return `${row.market}|${row.currency}|${(row.code || row.symbol).trim().toUpperCase()}`;
}

function mergeHoldingRows(current: HoldingDraft[], incoming: HoldingDraft[]): { rows: HoldingDraft[]; merged: number } {
  const rows = [...current];
  let merged = 0;
  for (const row of incoming) {
    const identity = holdingIdentity(row);
    const index = identity.endsWith('|') ? -1 : rows.findIndex(item => holdingIdentity(item) === identity);
    if (index < 0) rows.push(row);
    else {
      rows[index] = { ...rows[index], ...Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined && value !== '')) } as HoldingDraft;
      merged += 1;
    }
  }
  return { rows, merged };
}

export default function HoldingsImportDrawer({ open, onClose, onImported, defaultDate }: {
  open: boolean;
  onClose: () => void;
  onImported: (snapshot: HoldingSnapshot) => void;
  defaultDate: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [asOf, setAsOf] = useState(defaultDate);
  const [account, setAccount] = useState('Default account');
  const [snapshotScope, setSnapshotScope] = useState<'FULL_ACCOUNT' | 'MARKET_ONLY' | 'PAGE_PARTIAL'>('FULL_ACCOUNT');
  const [manualTotalAssets, setManualTotalAssets] = useState('');
  const [manualTotalAssetsCurrency, setManualTotalAssetsCurrency] = useState('CNY');
  const [fileTotalAssets, setFileTotalAssets] = useState<number | null>(null);
  const [fileTotalAssetsCurrency, setFileTotalAssetsCurrency] = useState('CNY');
  const [rows, setRows] = useState<HoldingDraft[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sourceFiles, setSourceFiles] = useState<Array<{ name: string; hash: string }>>([]);
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey('holdings'));

  useEffect(() => {
    if (!open) return;
    setAsOf(defaultDate); setAccount('Default account'); setSnapshotScope('FULL_ACCOUNT'); setRows([]); setWarnings([]); setError(''); setManualTotalAssets(''); setManualTotalAssetsCurrency('CNY'); setFileTotalAssets(null); setFileTotalAssetsCurrency('CNY'); setSourceFiles([]); setIdempotencyKey(newIdempotencyKey('holdings'));
  }, [defaultDate, open]);

  if (!open) return null;
  const updateRow = (index: number, changes: Partial<HoldingDraft>) => setRows(current => current.map((row, i) => i === index ? { ...row, ...changes } : row));
  const chooseFiles = async (files?: FileList | null) => {
    if (!files?.length) return;
    setLoading(true); setError('');
    try {
      let nextRows = [...rows];
      const nextWarnings = [...warnings];
      const knownHashes = new Set(sourceFiles.map(item => item.hash));
      const addedFiles = [...sourceFiles];
      let nextTotal = fileTotalAssets;
      let nextTotalCurrency = fileTotalAssetsCurrency;
      for (const file of Array.from(files)) {
        const hash = await sha256File(file);
        if (knownHashes.has(hash)) {
          nextWarnings.push(`${file.name}: skipped because the same file is already in this batch.`);
          continue;
        }
        knownHashes.add(hash); addedFiles.push({ name: file.name, hash });
        let incoming: HoldingDraft[] = [];
        let detectedTotal: number | null | undefined;
        let detectedCurrency: string | null | undefined;
        if (file.type.startsWith('image/')) {
          const body = new FormData(); body.append('image', file);
          const preview = await apiRequest<{ rows: Array<Partial<HoldingDraft> & Pick<HoldingDraft, 'symbol' | 'quantity'>>; total_assets?: number | null; total_assets_currency?: string | null; as_of?: string | null; warnings: string[] }>('/api/today/import/holdings/ocr', { method: 'POST', body });
          let assumedCurrencyCount = 0;
          incoming = preview.rows.map(row => {
            const identity = row.code || row.symbol;
            const market = normalizeMarketCode(row.market, identity);
            const inferred = inferMarketCurrency(identity);
            const currency = row.currency || defaultCurrencyForMarket(market) || inferred.currency;
            if (!currency) assumedCurrencyCount += 1;
            return { ...row, market, asset_class: row.asset_class || 'Stock', currency: (currency || 'CNY').toUpperCase() } as HoldingDraft;
          });
          nextWarnings.push(...preview.warnings.map(value => `${file.name}: ${value}`));
          if (assumedCurrencyCount) nextWarnings.push(`${file.name}: original currency was unclear for ${assumedCurrencyCount} position(s); CNY was assumed.`);
          if (preview.as_of && preview.as_of !== asOf) nextWarnings.push(`${file.name}: screenshot date ${preview.as_of} differs from snapshot date ${asOf}. Import it separately if it belongs to another account state.`);
          detectedTotal = preview.total_assets; detectedCurrency = preview.total_assets_currency;
        } else {
          const preview = await parseHoldingsFile(file);
          incoming = preview.rows; nextWarnings.push(...preview.warnings.map(value => `${file.name}: ${value}`));
          detectedTotal = preview.total_assets; detectedCurrency = preview.total_assets_currency;
        }
        const merged = mergeHoldingRows(nextRows, incoming);
        nextRows = merged.rows;
        if (merged.merged) nextWarnings.push(`${file.name}: merged ${merged.merged} repeated position(s) instead of adding quantities twice.`);
        if (!incoming.length) nextWarnings.push(`${file.name}: no holdings were recognized.`);
        if (detectedTotal !== undefined && detectedTotal !== null) {
          if (nextTotal !== null && (nextTotal !== detectedTotal || nextTotalCurrency !== (detectedCurrency || 'CNY'))) nextWarnings.push(`${file.name}: total assets conflicts with an earlier file; the latest detected value is shown for review.`);
          nextTotal = detectedTotal; nextTotalCurrency = detectedCurrency || 'CNY';
        }
      }
      setRows(nextRows); setWarnings(nextWarnings); setSourceFiles(addedFiles); setFileTotalAssets(nextTotal); setFileTotalAssetsCurrency(nextTotalCurrency); setIdempotencyKey(newIdempotencyKey('holdings'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to read holdings file.');
    } finally { setLoading(false); }
  };
  const confirmImport = async () => {
    const totalAssetsText = fileTotalAssets !== null ? String(fileTotalAssets) : manualTotalAssets.trim();
    const totalAssets = totalAssetsText ? Number(totalAssetsText) : undefined;
    if (!asOf) { setError('Enter the snapshot date.'); return; }
    if (totalAssetsText && (!Number.isFinite(totalAssets) || (totalAssets ?? -1) < 0)) { setError('Enter a valid non-negative total assets amount.'); return; }
    if (!account.trim()) { setError('Enter the brokerage account name.'); return; }
    if (!rows.length) { setError('Add at least one initial position.'); return; }
    if (rows.some(row => !row.symbol.trim() || !row.currency.trim() || !Number.isFinite(row.quantity) || row.quantity <= 0)) { setError('Complete the security name, original currency, and a positive quantity for every row.'); return; }
    setSaving(true); setError('');
    try {
      const snapshot = await apiRequest<HoldingSnapshot>('/api/today/import/holdings', {
        method: 'POST', body: JSON.stringify({
          as_of: asOf, account: account.trim(), snapshot_scope: snapshotScope,
          total_assets: totalAssets,
          total_assets_currency: totalAssets !== undefined ? (fileTotalAssets !== null ? fileTotalAssetsCurrency : manualTotalAssetsCurrency) : undefined,
          source_hashes: sourceFiles.map(item => item.hash), idempotency_key: idempotencyKey, rows,
        }),
      });
      onImported(snapshot); onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Holdings import failed.');
    } finally { setSaving(false); }
  };

  const modal = <div className="pointer-events-auto fixed inset-0 z-[130] flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4">
    <section role="dialog" aria-modal="true" aria-labelledby="holdings-import-title" className="flex max-h-[92vh] w-full max-w-xl flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
      <header className="flex items-center justify-between border-b border-slate-100 p-4">
        <div><h2 id="holdings-import-title" className="text-[15px] font-bold text-[#0B2545]">Set initial account state</h2><p className="mt-1 text-[10px] text-slate-500">This date is a valuation anchor. Same-day P&amp;L stays blank unless the broker reports it; tracking starts from the next market day.</p></div>
        <button onClick={onClose} aria-label="Close" className="rounded-full bg-slate-100 p-1.5 text-slate-500"><X size={15} /></button>
      </header>
      <div className="space-y-3 overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[9px] font-bold uppercase text-slate-400">Account<input value={account} onChange={event => setAccount(event.target.value)} className="mt-1 w-full rounded border border-slate-200 p-2 text-[11px] text-[#0B2545]" /></label>
          <label className="text-[9px] font-bold uppercase text-slate-400">Snapshot scope<select value={snapshotScope} onChange={event => setSnapshotScope(event.target.value as typeof snapshotScope)} className="mt-1 w-full rounded border border-slate-200 bg-white p-2 text-[10px] text-[#0B2545]"><option value="FULL_ACCOUNT">Full account</option><option value="MARKET_ONLY">One market only</option><option value="PAGE_PARTIAL">Partial page</option></select></label>
          <label className="text-[9px] font-bold uppercase text-slate-400">Account state date<input type="date" value={asOf} onChange={event => setAsOf(event.target.value)} className="mt-1 w-full rounded border border-slate-200 p-2 font-mono text-[11px] text-[#0B2545]" /></label>
          <label className="text-[9px] font-bold uppercase text-slate-400">Total assets (optional)<span className="mt-1 flex gap-1"><input aria-label="Total assets" type="number" min="0" step="any" value={fileTotalAssets !== null ? fileTotalAssets : manualTotalAssets} readOnly={fileTotalAssets !== null} onChange={event => setManualTotalAssets(event.target.value)} placeholder="Enter total assets" className="min-w-0 flex-1 rounded border border-slate-200 p-2 font-mono text-[11px] text-[#0B2545] read-only:bg-slate-50" /><select aria-label="Total assets currency" disabled={fileTotalAssets !== null} value={fileTotalAssets !== null ? fileTotalAssetsCurrency : manualTotalAssetsCurrency} onChange={event => setManualTotalAssetsCurrency(event.target.value)} className="w-[76px] rounded border border-slate-200 bg-white p-1 text-[10px] disabled:bg-slate-50"><option>CNY</option><option>HKD</option><option>USD</option><option>JPY</option><option>EUR</option><option>GBP</option><option>CAD</option><option>AUD</option><option>SGD</option></select></span></label>
        </div>
        {fileTotalAssets !== null && <p className="rounded bg-emerald-50 p-2 text-[10px] text-emerald-700">Total assets detected in the file. The file value will be used instead of manual input.</p>}
        {!rows.length && <div className="grid grid-cols-2 gap-2"><button disabled={loading} onClick={() => fileRef.current?.click()} className="flex flex-col items-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-slate-600 hover:border-[#EE6C4D]">
          {loading ? <Loader2 className="animate-spin text-[#EE6C4D]" /> : <Upload className="text-[#EE6C4D]" />}<span className="mt-2 text-[11px] font-bold">{loading ? 'Reading…' : 'Upload one or more files'}</span><span className="mt-1 text-[9px]">Files must describe the same account date</span>
        </button><button onClick={() => setRows([emptyHolding()])} className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-white px-3 py-6 text-slate-600 hover:border-[#EE6C4D]"><Plus className="text-[#EE6C4D]"/><span className="mt-2 text-[11px] font-bold">Enter positions manually</span></button></div>}
        <input ref={fileRef} type="file" multiple accept=".csv,.xls,.xlsx,image/png,image/jpeg,image/webp" className="hidden" onChange={event => { void chooseFiles(event.target.files); event.target.value = ''; }} />
        {sourceFiles.length > 0 && <p className="rounded bg-slate-50 p-2 text-[9px] text-slate-500">Sources in this batch: {sourceFiles.map(item => item.name).join(' · ')}</p>}
        {warnings.map(warning => <p key={warning} className="rounded bg-amber-50 p-2 text-[10px] text-amber-700">{warning}</p>)}
        {error && <p role="alert" className="rounded bg-rose-50 p-2 text-[10px] text-rose-700">{error}</p>}
        {rows.length > 0 && <>
          <div className="flex items-center justify-between text-[10px] font-bold text-[#0B2545]"><span>Preview · {rows.length} positions</span><span className="flex gap-3"><button disabled={loading} onClick={() => fileRef.current?.click()} className="text-[#EE6C4D]">Add files</button><button onClick={() => setRows(current => [...current, emptyHolding()])} className="text-[#EE6C4D]">Add position</button></span></div>
          <div className="max-h-[42vh] space-y-2 overflow-y-auto">
            {rows.map((row, index) => <div key={`${row.code}-${index}`} className="space-y-2 rounded-lg border border-slate-200 p-2">
              <div className="flex justify-end"><button aria-label="Remove position" onClick={() => setRows(current => current.filter((_, itemIndex) => itemIndex !== index))} className="text-slate-400 hover:text-rose-600"><Trash2 size={13}/></button></div>
              <div className="grid grid-cols-2 gap-2">
                <input aria-label="Security name" value={row.symbol} onChange={event => updateRow(index, { symbol: event.target.value })} placeholder="Name / symbol" className="min-w-0 rounded border border-slate-200 p-1.5 text-[10px]" />
                <input aria-label="Ticker" value={row.code || ''} onChange={event => updateRow(index, { code: event.target.value })} placeholder="Ticker / code" className="min-w-0 rounded border border-slate-200 p-1.5 font-mono text-[10px]" />
                <select aria-label="Market" value={row.market} onChange={event => updateRow(index, { market: event.target.value })} className="rounded border border-slate-200 p-1.5 text-[10px]"><option value="CN">Mainland China</option><option value="HK">Hong Kong</option><option value="US">United States</option><option value="CRYPTO">Crypto</option><option value="GLOBAL">Other / Global</option></select>
                <input aria-label="Original currency" value={row.currency} maxLength={8} onChange={event => updateRow(index, { currency: event.target.value.toUpperCase() })} placeholder="Currency" className="rounded border border-slate-200 p-1.5 font-mono text-[10px] uppercase" />
                <input aria-label="Asset class" value={row.asset_class} maxLength={32} onChange={event => updateRow(index, { asset_class: event.target.value })} placeholder="Asset class" className="rounded border border-slate-200 p-1.5 text-[10px]" />
                <input aria-label="Quantity" type="number" value={row.quantity} onChange={event => updateRow(index, { quantity: Number(event.target.value) })} placeholder="Quantity" className="rounded border border-slate-200 p-1.5 font-mono text-[10px]" />
                <input aria-label="Average cost" type="number" value={row.average_cost ?? ''} onChange={event => updateRow(index, { average_cost: event.target.value ? Number(event.target.value) : undefined })} placeholder="Average cost" className="rounded border border-slate-200 p-1.5 font-mono text-[10px]" />
                <input aria-label="Broker price at snapshot" type="number" value={row.market_price ?? ''} onChange={event => updateRow(index, { market_price: event.target.value ? Number(event.target.value) : undefined })} placeholder="Price at snapshot (optional)" className="rounded border border-slate-200 p-1.5 font-mono text-[10px]" />
                <input aria-label="Broker market value at snapshot" type="number" value={row.market_value ?? ''} onChange={event => updateRow(index, { market_value: event.target.value ? Number(event.target.value) : undefined })} placeholder="Market value at snapshot" className="rounded border border-slate-200 p-1.5 font-mono text-[10px]" />
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
