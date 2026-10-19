export type MarketCode = 'CN' | 'HK' | 'US' | 'GLOBAL' | 'CRYPTO';

export type InstrumentSearchResult = {
  code: string;
  name: string;
  market: MarketCode | string;
  currency: string;
  asset_class: string;
};

export function defaultCurrencyForMarket(market: string): string {
  const normalized = market.toUpperCase();
  if (normalized === 'CN') return 'CNY';
  if (normalized === 'HK') return 'HKD';
  if (normalized === 'US' || normalized === 'CRYPTO') return 'USD';
  return '';
}

export function normalizeMarketCode(market: string | undefined, codeOrSymbol: string): MarketCode {
  const value = (market || '').trim().toUpperCase();
  if (value === 'CN' || /中国|大陆|SHANGHAI|SHENZHEN|BEIJING|SSE|SZSE/.test(value)) return 'CN';
  if (value === 'HK' || /HKEX|HKG|HONG KONG|香港/.test(value)) return 'HK';
  if (value === 'US' || /NASDAQ|NYSE|AMEX|ARCA|BATS|NEW YORK|UNITED STATES/.test(value)) return 'US';
  if (value === 'CRYPTO' || /CRYPTO/.test(value)) return 'CRYPTO';
  return inferMarketCurrency(codeOrSymbol).market;
}

export function inferMarketCurrency(code: string): { market: MarketCode; currency: string } {
  const normalized = code.trim().toUpperCase();
  if (/\.HK$/.test(normalized)) return { market: 'HK', currency: 'HKD' };
  if (/\.(SH|SS|SZ|BJ)$/.test(normalized) || /^\d{6}$/.test(normalized)) return { market: 'CN', currency: 'CNY' };
  if (/-USD$/.test(normalized)) return { market: 'CRYPTO', currency: 'USD' };
  const globalSuffixes: Array<[RegExp, string]> = [
    [/\.T$/, 'JPY'], [/\.L$/, 'GBP'], [/\.(DE|F|PA|AS|BR|HE)$/, 'EUR'],
    [/\.TO$/, 'CAD'], [/\.AX$/, 'AUD'], [/\.SI$/, 'SGD'], [/\.(NS|BO)$/, 'INR'],
    [/\.(KS|KQ)$/, 'KRW'], [/\.(TW|TWO)$/, 'TWD'], [/\.SW$/, 'CHF'],
    [/\.ST$/, 'SEK'], [/\.CO$/, 'DKK'], [/\.OL$/, 'NOK'],
  ];
  const match = globalSuffixes.find(([pattern]) => pattern.test(normalized));
  if (match) return { market: 'GLOBAL', currency: match[1] };
  if (/^[A-Z][A-Z0-9.-]{0,9}$/.test(normalized)) return { market: 'US', currency: 'USD' };
  return { market: 'GLOBAL', currency: '' };
}

export function formatCurrencyAmount(value: number | string | undefined, currency = 'CNY'): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '--';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: currency.toUpperCase(),
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency.toUpperCase()} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}
