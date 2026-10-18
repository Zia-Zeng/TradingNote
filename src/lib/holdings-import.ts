import * as XLSX from 'xlsx';
import { defaultCurrencyForMarket, inferMarketCurrency, normalizeMarketCode } from './instruments';

export type HoldingDraft = {
  symbol: string;
  code?: string;
  market: string;
  asset_class: string;
  currency: string;
  quantity: number;
  average_cost?: number;
  market_price?: number;
  market_value?: number;
};

export type HoldingsPreview = { rows: HoldingDraft[]; warnings: string[]; total_assets?: number; total_assets_currency?: string };

const aliases = {
  symbol: ['symbol', 'name', 'security name', 'stock name', '证券名称', '证券简称', '股票名称', '股票简称', '标的名称'],
  code: ['code', 'ticker', 'symbol code', '证券代码', '股票代码', '代码'],
  market: ['market', 'exchange', 'market name', '市场', '交易所'],
  asset_class: ['asset class', 'asset type', 'security type', '资产类别', '证券类型'],
  currency: ['currency', 'currency code', '币种', '交易币种', '计价币种'],
  quantity: ['quantity', 'qty', 'shares', 'position', '持仓数量', '股票余额', '股份余额', '证券余额', '数量', '持仓'],
  average_cost: ['average cost', 'avg cost', 'cost price', 'average price', '成本价', '摊薄成本', '持仓成本价', '保本价'],
  market_price: ['market price', 'last price', 'price', '最新价', '市价', '现价', '当前价格'],
  market_value: ['market value', 'position value', 'value', '市值', '参考市值', '持仓市值', '证券市值'],
  total_assets: ['total assets', 'total asset', 'account total assets', 'net assets', 'asset total', '总资产', '资产总额', '总资产金额', '资产总值', '账户总资产'],
} as const;

const normalizeHeader = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/[\s_\-()（）]/g, '');
const text = (value: unknown) => String(value ?? '').trim();
const numberValue = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const cleaned = text(value).replace(/[¥￥$€£,，\s]/g, '');
  if (!cleaned || cleaned === '--' || cleaned === '-') return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
};

function resolveHeader(headers: string[], field: keyof typeof aliases): number {
  const normalized = headers.map(normalizeHeader);
  return aliases[field].map(normalizeHeader).map(alias => normalized.indexOf(alias)).find(index => index >= 0) ?? -1;
}

function readTotalAssets(rawRows: unknown[][]): { value?: number; currency?: string; currencyDetected?: boolean } {
  const totalAliases = aliases.total_assets.map(normalizeHeader);
  const currencyPattern = /\b(CNY|RMB|HKD|USD|JPY|EUR|GBP|CAD|AUD|SGD|KRW|TWD|INR|CHF)\b|HK\$|US\$|\$|[¥￥]/i;
  const normalizeCurrency = (match: RegExpMatchArray | null) => {
    const code = match?.[1]?.toUpperCase();
    if (code === 'RMB' || match?.[0] === '¥' || match?.[0] === '￥') return 'CNY';
    if (match?.[0]?.toUpperCase() === 'HK$') return 'HKD';
    if (match?.[0]?.toUpperCase() === 'US$' || match?.[0] === '$') return 'USD';
    return code;
  };
  for (const row of rawRows) {
    for (let index = 0; index < row.length; index += 1) {
      const label = text(row[index]);
      const normalized = normalizeHeader(label);
      if (!totalAliases.some(alias => normalized === alias || normalized.includes(alias))) continue;
      const adjacent = [row[index + 1], row[index - 1], ...row.slice(index + 2)];
      const value = adjacent.map(numberValue).find(item => item !== undefined);
      if (value === undefined) continue;
      const currencyText = `${label} ${adjacent.map(text).join(' ')}`;
      const currencyMatch = currencyText.match(currencyPattern);
      const currency = normalizeCurrency(currencyMatch);
      return { value, currency: currency || 'CNY', currencyDetected: Boolean(currency) };
    }
  }
  for (let rowIndex = 0; rowIndex < rawRows.length; rowIndex += 1) {
    const row = rawRows[rowIndex];
    const column = row.findIndex(cell => totalAliases.includes(normalizeHeader(cell)));
    if (column < 0) continue;
    const currencyMatch = text(row[column]).match(currencyPattern);
    for (const values of rawRows.slice(rowIndex + 1)) {
      const value = numberValue(values[column]);
      if (value !== undefined) return { value, currency: normalizeCurrency(currencyMatch) || 'CNY', currencyDetected: Boolean(currencyMatch) };
    }
  }
  return {};
}

export async function parseHoldingsFile(file: File): Promise<HoldingsPreview> {
  if (!/\.(csv|xlsx|xls)$/i.test(file.name)) throw new Error('Choose a CSV or Excel holdings statement.');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('This file does not contain a readable worksheet.');
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: '' });
  const totalAssets = readTotalAssets(rawRows);
  const headerIndex = rawRows.findIndex(row => {
    const headers = row.map(text);
    return resolveHeader(headers, 'quantity') >= 0 && (resolveHeader(headers, 'symbol') >= 0 || resolveHeader(headers, 'code') >= 0);
  });
  if (headerIndex < 0) throw new Error('Could not find holdings columns. Include a security name or code and a quantity column.');
  const headers = rawRows[headerIndex].map(text);
  const rows: HoldingDraft[] = [];
  const warnings: string[] = [];
  rawRows.slice(headerIndex + 1).forEach((values, index) => {
    const get = (field: keyof typeof aliases) => {
      const position = resolveHeader(headers, field);
      return position >= 0 ? values[position] : undefined;
    };
    const code = text(get('code')) || undefined;
    const symbol = text(get('symbol')) || code || '';
    const quantity = numberValue(get('quantity'));
    const rowNumber = headerIndex + index + 2;
    if (!symbol && values.every(value => !text(value))) return;
    if (!symbol || quantity === undefined) {
      warnings.push(`Row ${rowNumber}: skipped because security name/code or quantity is missing.`);
      return;
    }
    const inferred = inferMarketCurrency(code || symbol);
    const market = normalizeMarketCode(text(get('market')) || undefined, code || symbol);
    const marketValue = numberValue(get('market_value'));
    const price = numberValue(get('market_price'));
    const averageCost = numberValue(get('average_cost'));
    rows.push({
      symbol,
      code,
      market,
      asset_class: text(get('asset_class')) || 'Stock',
      currency: (text(get('currency')) || defaultCurrencyForMarket(market) || inferred.currency || '').toUpperCase(),
      quantity,
      average_cost: averageCost,
      market_price: price,
      market_value: marketValue ?? (price !== undefined ? price * quantity : undefined),
    });
  });
  if (!rows.length) throw new Error('No valid holdings found. Check that the file contains security names/codes and quantities.');
  if (rows.some(row => !row.currency)) warnings.push('Some rows have no identifiable currency. Set the original currency in the preview before importing.');
  if (totalAssets.value !== undefined && !totalAssets.currencyDetected) warnings.push('Total assets currency was not specified; CNY is assumed.');
  return { rows, warnings, ...(totalAssets.value !== undefined ? { total_assets: totalAssets.value, total_assets_currency: totalAssets.currency || 'CNY' } : {}) };
}
