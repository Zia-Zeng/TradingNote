import * as XLSX from 'xlsx';
import { defaultCurrencyForMarket, inferMarketCurrency, normalizeMarketCode } from './instruments';

export type ImportedTradeDraft = {
  time?: string;
  type: 'Buy' | 'Sell';
  symbol: string;
  code?: string;
  market?: string;
  asset_class?: string;
  currency?: string;
  price: number;
  qty: number;
  amount?: number;
  fee?: number;
  motive?: { posTag?: string; tags?: string[]; desc?: string };
  plan?: { tp?: string | number; sl?: string | number; desc?: string };
};

export type FileImportPreview = {
  trades: ImportedTradeDraft[];
  warnings: string[];
};

const HEADER_ALIASES: Record<keyof Omit<ImportedTradeDraft, 'motive' | 'plan'>, string[]> = {
  time: ['time', 'datetime', 'date', 'trade time', 'trade date', '成交时间', '成交日期', '日期', '时间'],
  type: ['type', 'side', 'direction', 'action', '买卖方向', '方向', '交易方向', '操作'],
  symbol: ['symbol', 'name', 'security', 'stock', '标的', '证券名称', '股票名称', '名称'],
  code: ['code', 'ticker', 'symbol code', '证券代码', '股票代码', '代码'],
  market: ['market', 'exchange', '市场', '交易所'],
  asset_class: ['asset class', 'asset type', 'security type', '资产类别', '证券类型'],
  currency: ['currency', 'currency code', 'trade currency', '币种', '交易币种'],
  price: ['price', 'fill price', '成交价格', '成交均价', '价格', '均价'],
  qty: ['qty', 'quantity', 'shares', 'volume', '成交数量', '数量', '股数'],
  amount: ['amount', 'turnover', '成交金额', '金额'],
  fee: ['fee', 'fees', 'commission', 'transaction fee', '费用', '手续费', '交易税费'],
};

const normalizeHeader = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/[\s_\-()（）]/g, '');
const normalizeText = (value: unknown) => String(value ?? '').trim();
const DATE_ALIASES = ['trade date', 'date', '成交日期', '日期'];
const CLOCK_ALIASES = ['trade time', 'time', '成交时间', '时间'];

const numberValue = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const cleaned = normalizeText(value).replace(/[¥￥,$，,\s]/g, '');
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const directionValue = (value: unknown): ImportedTradeDraft['type'] | undefined => {
  const normalized = normalizeText(value).toLowerCase();
  if (['buy', 'b', '买入', '买'].includes(normalized)) return 'Buy';
  if (['sell', 's', '卖出', '卖'].includes(normalized)) return 'Sell';
  if (normalized.includes('买')) return 'Buy';
  if (normalized.includes('卖')) return 'Sell';
  return undefined;
};

const lookup = (row: Record<string, unknown>, field: keyof typeof HEADER_ALIASES) => {
  const normalizedRow = new Map(Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]));
  const header = HEADER_ALIASES[field].find(alias => normalizedRow.has(normalizeHeader(alias)));
  return header ? normalizedRow.get(normalizeHeader(header)) : undefined;
};

const lookupAliases = (row: Record<string, unknown>, aliases: string[]) => {
  const normalizedRow = new Map(Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]));
  const header = aliases.find(alias => normalizedRow.has(normalizeHeader(alias)));
  return header ? normalizedRow.get(normalizeHeader(header)) : undefined;
};

function normalizedDate(value: unknown): string | undefined {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  const text = normalizeText(value);
  const match = text.match(/^(\d{4})[-/.]?(\d{2})[-/.]?(\d{2})(?:[ T](\d{1,2}:\d{2}(?::\d{2})?))?/);
  if (!match) return undefined;
  return `${match[1]}-${match[2]}-${match[3]}${match[4] ? ` ${match[4]}` : ''}`;
}

function normalizedClock(value: unknown): string | undefined {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}:${String(value.getSeconds()).padStart(2, '0')}`;
  }
  const match = normalizeText(value).match(/^(\d{1,2}:\d{2}(?::\d{2})?)/);
  return match?.[1];
}

function rowToTrade(row: Record<string, unknown>, rowNumber: number): { trade?: ImportedTradeDraft; warning?: string } {
  const type = directionValue(lookup(row, 'type'));
  const symbol = normalizeText(lookup(row, 'symbol')) || normalizeText(lookup(row, 'code'));
  const code = normalizeText(lookup(row, 'code')) || undefined;
  const inferred = inferMarketCurrency(code || symbol);
  const market = normalizeMarketCode(normalizeText(lookup(row, 'market')) || undefined, code || symbol);
  const price = numberValue(lookup(row, 'price'));
  const qty = numberValue(lookup(row, 'qty'));
  const invalid = [!type && 'side', !symbol && 'symbol/code', !(price && price > 0) && 'price', !(qty && qty > 0) && 'quantity'].filter(Boolean);
  if (invalid.length) return { warning: `Row ${rowNumber}: missing or unrecognized ${invalid.join(', ')}.` };

  const rawTime = lookup(row, 'time');
  const datePart = normalizedDate(lookupAliases(row, DATE_ALIASES));
  const clockPart = normalizedClock(lookupAliases(row, CLOCK_ALIASES));
  const rawTimeText = rawTime instanceof Date && Number.isFinite(rawTime.getTime())
    ? `${rawTime.getFullYear()}-${String(rawTime.getMonth() + 1).padStart(2, '0')}-${String(rawTime.getDate()).padStart(2, '0')} ${String(rawTime.getHours()).padStart(2, '0')}:${String(rawTime.getMinutes()).padStart(2, '0')}`
    : normalizeText(rawTime) || undefined;
  const importedTime = datePart
    ? `${datePart}${clockPart && !datePart.includes(' ') ? ` ${clockPart}` : ''}`
    : rawTimeText;

  return {
    trade: {
      type: type!,
      symbol,
      code,
      market,
      asset_class: normalizeText(lookup(row, 'asset_class')) || 'Stock',
      currency: normalizeText(lookup(row, 'currency')).toUpperCase() || defaultCurrencyForMarket(market) || inferred.currency,
      time: importedTime,
      price: price!,
      qty: qty!,
      amount: numberValue(lookup(row, 'amount')),
      fee: numberValue(lookup(row, 'fee')),
    },
  };
}

export async function parseTradeSpreadsheet(file: File): Promise<FileImportPreview> {
  if (/\.txt$/i.test(file.name)) return parseBrokerText(file);
  const bytes = await file.arrayBuffer();
  const workbook = XLSX.read(bytes, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('This file does not contain a readable worksheet.');
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: '' });
  if (!rows.length) throw new Error('No importable rows were found in this file.');

  const preview: FileImportPreview = { trades: [], warnings: [] };
  rows.forEach((row, index) => {
    const result = rowToTrade(row, index + 2);
    if (result.trade) preview.trades.push(result.trade);
    if (result.warning) preview.warnings.push(result.warning);
  });
  if (!preview.trades.length) throw new Error('No valid trades were found. Check the column headers and transaction data.');
  return preview;
}

async function parseBrokerText(file: File): Promise<FileImportPreview> {
  const bytes = await file.arrayBuffer();
  const text = new TextDecoder('gb18030').decode(bytes);
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const headerIndex = lines.findIndex(line => line.includes('\t') && line.includes('成交日期') && line.includes('操作'));
  if (headerIndex < 0) throw new Error('Broker statement headers were not found. Upload a TXT file with Trade Date and Action columns.');
  const headers = lines[headerIndex].split('\t');
  const preview: FileImportPreview = { trades: [], warnings: [] };
  lines.slice(headerIndex + 1).filter(line => line.includes('\t')).forEach((line, index) => {
    const cells = line.split('\t');
    const row = Object.fromEntries(headers.map((header, column) => [header, cells[column] ?? '']));
    const action = normalizeText(lookup(row, 'type'));
    if (!directionValue(action)) {
      return;
    }
    const date = normalizeText(row['成交日期']);
    const time = normalizeText(row['成交时间']);
    if (/^\d{8}$/.test(date) && time) row['成交日期'] = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)} ${time}`;
    const result = rowToTrade(row, headerIndex + index + 2);
    if (result.trade) preview.trades.push(result.trade);
    if (result.warning) preview.warnings.push(result.warning);
  });
  if (!preview.trades.length) throw new Error('No valid stock buy or sell transactions were found.');
  return preview;
}
