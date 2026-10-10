export type AssetClass = 'Stock' | 'ETF' | 'Bond' | 'Crypto';
export type Verdict = 'held' | 'broke' | 'early' | 'late';

export interface DayTrade {
  time: string;
  symbol: string;
  code: string;
  asset: AssetClass;
  side: 'Buy' | 'Sell';
  price: number;
  qty: number;
  close: number;
  note: string;
  verdict: Verdict;
  aiRead: string;
}

export interface TradingDay {
  date: string;
  pnl: number;
  trades: DayTrade[];
  aiSummary: string;
  aiNext: string;
}

export const CALENDAR_YEAR = 2026;
export const CALENDAR_MONTH = 6;
export const MOCK_TODAY = 14;
const LATEST_TOTAL_ASSETS = 258210.5;

export const VERDICT_META: Record<Verdict, { label: string; className: string }> = {
  held: { label: 'Thesis held', className: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
  broke: { label: 'Thesis broke', className: 'bg-rose-50 text-rose-600 border-rose-200' },
  early: { label: 'Price ran on', className: 'bg-amber-50 text-amber-600 border-amber-200' },
  late: { label: 'Late vs plan', className: 'bg-amber-50 text-amber-600 border-amber-200' },
};

export const tradingDays: TradingDay[] = [
  {
    date: '2026-07-01',
    pnl: 1240,
    trades: [
      {
        time: '09:42', symbol: 'CATL', code: '300750', asset: 'Stock', side: 'Buy', price: 182.0, qty: 100, close: 184.7,
        note: 'EV sales data due Friday. Starting a half position ahead of it. Target 190, stop 176.',
        verdict: 'held',
        aiRead: 'CATL rose 1.5% on day one. Your note names the catalyst (Friday’s sales data), a target and a stop, which is everything needed to review this trade later.',
      },
      {
        time: '10:15', symbol: '10Y CGB', code: '019547', asset: 'Bond', side: 'Buy', price: 104.05, qty: 50, close: 104.12,
        note: 'Parking idle cash. PMI data tomorrow could push yields lower.',
        verdict: 'held',
        aiRead: 'Up 0.07% ahead of the PMI. The trade is working as a cash buffer; the yield thesis itself is still untested until the data lands.',
      },
      {
        time: '21:30', symbol: 'BITCOIN', code: 'BTC/USDT', asset: 'Crypto', side: 'Buy', price: 66800, qty: 0.05, close: 67350,
        note: 'Bounced off 66k twice this week. Buying the third test with a stop at 65.4k.',
        verdict: 'held',
        aiRead: 'The 66k floor held a third time and price lifted 0.8%. Your stop sits 2.1% below entry, a sensible distance for BTC’s usual daily range.',
      },
    ],
    aiSummary: 'All three entries had a stated catalyst or price level, and all three closed in your favor. CATL contributed most of the gain.',
    aiNext: 'Keep writing the stop into the note at entry, as you did on all three trades today. It makes every later review faster.',
  },
  {
    date: '2026-07-02',
    pnl: -860,
    trades: [
      {
        time: '09:35', symbol: '10Y CGB', code: '019547', asset: 'Bond', side: 'Sell', price: 104.18, qty: 50, close: 103.92,
        note: 'PMI came in hot. Taking the small gain before yields jump.',
        verdict: 'held',
        aiRead: 'Your PMI read was right: the bond fell 0.25% after you sold, so exiting early protected the gain.',
      },
      {
        time: '10:50', symbol: 'SANY HEAVY', code: '600031', asset: 'Stock', side: 'Buy', price: 16.8, qty: 500, close: 16.54,
        note: 'Infrastructure headlines everywhere. Feels like a breakout, jumping in.',
        verdict: 'broke',
        aiRead: 'The note describes a feeling, not a level. SANY faded 1.5% into the close and no stop was recorded, so there is no planned exit to fall back on.',
      },
      {
        time: '22:10', symbol: 'ETHEREUM', code: 'ETH/USDT', asset: 'Crypto', side: 'Sell', price: 3480, qty: 1.2, close: 3515,
        note: 'ETH lagging BTC all week. Rotating out to reduce alt exposure.',
        verdict: 'early',
        aiRead: 'ETH bounced 1.0% after your exit. Rotating on a week of relative weakness is reasonable, but the signal was too short to act on.',
      },
    ],
    aiSummary: 'The loss came almost entirely from SANY HEAVY, the one trade where your note described a feeling instead of a plan.',
    aiNext: 'Before your next momentum entry, write the stop price into the note. If you can’t name one, skip the trade.',
  },
  {
    date: '2026-07-03',
    pnl: 2150,
    trades: [
      {
        time: '09:31', symbol: 'SANY HEAVY', code: '600031', asset: 'Stock', side: 'Sell', price: 16.5, qty: 500, close: 16.28,
        note: 'Cutting yesterday’s impulse trade. No plan, no position.',
        verdict: 'held',
        aiRead: 'Cutting fast was right. SANY slid another 1.3% after you sold, about ¥110 you didn’t lose.',
      },
      {
        time: '13:20', symbol: '30Y CGB', code: '019742', asset: 'Bond', side: 'Buy', price: 112.4, qty: 30, close: 112.88,
        note: 'Equities wobbly into the weekend. Adding duration as a hedge.',
        verdict: 'held',
        aiRead: 'Long bonds rallied 0.43% as equities softened, exactly the hedge you described.',
      },
      {
        time: '20:45', symbol: 'SOLANA', code: 'SOL/USDT', asset: 'Crypto', side: 'Buy', price: 142.3, qty: 8, close: 147.1,
        note: 'Network upgrade next week. Buying ahead of the news, will sell into the event.',
        verdict: 'held',
        aiRead: 'SOL ran 3.4% on the upgrade story. You already wrote an exit (sell into the event). Keep it, since pre-event runs often reverse on the day.',
      },
    ],
    aiSummary: 'You closed the SANY mistake within a day, and both new positions came with a written purpose. CATL, still held, added to the gain after strong sales data.',
    aiNext: 'Set a price alert for SOL near 150 so your “sell into the event” plan doesn’t depend on watching the chart.',
  },
  {
    date: '2026-07-06',
    pnl: -2480,
    trades: [
      {
        time: '09:30', symbol: 'CATL', code: '300750', asset: 'Stock', side: 'Buy', price: 186.0, qty: 100, close: 180.4,
        note: 'Sales data beat. Gap-up open, adding the second half in the first minute.',
        verdict: 'broke',
        aiRead: 'The data was good, but buying the first minute of a gap-up meant paying near the day’s high. CATL faded 3.0% and pulled your first half down with it.',
      },
      {
        time: '11:05', symbol: '30Y CGB', code: '019742', asset: 'Bond', side: 'Sell', price: 112.95, qty: 30, close: 113.2,
        note: 'Hedge did its job. Taking profit.',
        verdict: 'early',
        aiRead: 'You sold the hedge on the morning equities turned down, and the bond added 0.22% after. A hedge earns its keep on days like this. Consider holding it until the risk it covers has passed.',
      },
      {
        time: '23:15', symbol: 'BITCOIN', code: 'BTC/USDT', asset: 'Crypto', side: 'Sell', price: 65200, qty: 0.05, close: 64900,
        note: 'Broke my 65.4k stop. Out, as planned.',
        verdict: 'held',
        aiRead: 'You honored the stop you set on Jul 1. BTC slipped another 0.5% after, a textbook planned exit.',
      },
    ],
    aiSummary: 'Two of three trades followed a plan. The loss is concentrated in CATL, where you added by chasing a gap-up open.',
    aiNext: 'On gap-up news days, wait 30 minutes for the opening range to form before adding.',
  },
  {
    date: '2026-07-07',
    pnl: 620,
    trades: [
      {
        time: '10:20', symbol: 'CATL', code: '300750', asset: 'Stock', side: 'Sell', price: 179.2, qty: 100, close: 181.6,
        note: 'Selling yesterday’s gap-up add. That half was a chase; keeping the original half.',
        verdict: 'early',
        aiRead: 'CATL bounced 1.3% after you sold. Cutting the chased half still made sense: it reset the position to the size your Jul 1 plan called for.',
      },
      {
        time: '14:10', symbol: 'CDB 3Y', code: '220203', asset: 'Bond', side: 'Buy', price: 101.2, qty: 40, close: 101.22,
        note: 'Rates steady. Rolling spare cash into short-duration paper.',
        verdict: 'held',
        aiRead: 'Flat (+0.02%), as expected for short-duration paper. This is cash management and needs no further review.',
      },
      {
        time: '21:50', symbol: 'ETHEREUM', code: 'ETH/USDT', asset: 'Crypto', side: 'Buy', price: 3420, qty: 1.0, close: 3395,
        note: 'Buying back the ETH I sold on the 2nd, 60 lower.',
        verdict: 'broke',
        aiRead: 'Re-entering 60 below your old exit felt like a win, but ETH kept drifting and closed 0.7% under your fill. The note anchors on your previous price, not on a chart level.',
      },
    ],
    aiSummary: 'A small green day, carried by positions you held. Trimming the CATL chase was sound; the ETH re-entry was anchored to your old exit price.',
    aiNext: 'Base re-entries on the current chart, not on where you last traded.',
  },
  {
    date: '2026-07-08',
    pnl: 1780,
    trades: [
      {
        time: '09:35', symbol: 'CDB 3Y', code: '220203', asset: 'Bond', side: 'Sell', price: 101.25, qty: 40, close: 101.24,
        note: 'Need cash for the gold entry. Selling the short paper.',
        verdict: 'held',
        aiRead: 'Pure cash management. Price barely moved after (-0.01%).',
      },
      {
        time: '09:50', symbol: 'ZIJIN INTL', code: '02259', asset: 'Stock', side: 'Buy', price: 97.5, qty: 100, close: 98.4,
        note: 'Gold at a record high. Buying the sector leader, stop at 94.',
        verdict: 'held',
        aiRead: 'Up 0.9% on day one, and the stop at 94 is written down. A complete entry note.',
      },
      {
        time: '22:30', symbol: 'SOLANA', code: 'SOL/USDT', asset: 'Crypto', side: 'Buy', price: 148.0, qty: 4, close: 151.2,
        note: 'Upgrade hype building. Adding a bit more.',
        verdict: 'held',
        aiRead: 'SOL rose 2.2%, but this add contradicts your Jul 3 plan to sell into the event. Your cost basis is now higher heading into the riskiest day.',
      },
    ],
    aiSummary: 'A green day. The ZIJIN INTL entry has a clear stop; the SOL add drifts away from the exit plan you wrote on Jul 3.',
    aiNext: 'Re-read your Jul 3 SOL note before the upgrade and decide the exit price in advance.',
  },
  {
    date: '2026-07-09',
    pnl: -1320,
    trades: [
      {
        time: '09:45', symbol: 'ZIJIN MINING', code: '601899', asset: 'Stock', side: 'Buy', price: 24.5, qty: 200, close: 24.82,
        note: 'Copper breaking out on heavy volume. Right-side entry, target 27, stop 23.50.',
        verdict: 'held',
        aiRead: 'Up 1.3% by the close. Entry, target and stop are all in one note, which is the strongest setup this month.',
      },
      {
        time: '10:30', symbol: 'JEREH', code: '002353', asset: 'Stock', side: 'Buy', price: 155.0, qty: 100, close: 152.0,
        note: 'Oil names ripping. Don’t want to miss it. Quick bounce play, stop 145.',
        verdict: 'broke',
        aiRead: 'The note admits the real motive: not wanting to miss out. JEREH closed 1.9% below your fill on day one. At least the stop at 145 is written down. Hold yourself to it.',
      },
      {
        time: '22:00', symbol: 'SOLANA', code: 'SOL/USDT', asset: 'Crypto', side: 'Sell', price: 146.5, qty: 12, close: 139.8,
        note: 'Upgrade delayed a week. Thesis gone, selling everything.',
        verdict: 'held',
        aiRead: 'Exiting the moment the catalyst disappeared saved you from a 4.6% drop. The note states the thesis and why it broke. Use it as the model for every exit.',
      },
    ],
    aiSummary: 'A red day, mostly from JEREH. Your best decision was the SOL exit, which avoided a much larger loss.',
    aiNext: 'JEREH is a fear-of-missing-out entry with a stop at 145. Place that stop as a conditional order tonight so it executes without hesitation.',
  },
  {
    date: '2026-07-10',
    pnl: 2960,
    trades: [
      {
        time: '10:05', symbol: '10Y CGB', code: '019547', asset: 'Bond', side: 'Buy', price: 103.8, qty: 60, close: 104.02,
        note: 'Yields spiked after the auction. Buying the dip.',
        verdict: 'held',
        aiRead: 'Your auction-dip read was right. The bond recovered 0.21% by the close.',
      },
      {
        time: '11:20', symbol: 'CATL', code: '300750', asset: 'Stock', side: 'Sell', price: 191.5, qty: 100, close: 189.8,
        note: 'Hit 190, my original target. Closing the rest.',
        verdict: 'held',
        aiRead: 'You reached the target set on Jul 1 and sold. CATL slipped 0.9% after. Entry, stop and target were all in your notes, and you executed all three.',
      },
      {
        time: '21:15', symbol: 'BITCOIN', code: 'BTC/USDT', asset: 'Crypto', side: 'Buy', price: 63900, qty: 0.04, close: 65100,
        note: 'Below 64k is the bottom of the monthly range. Small starter.',
        verdict: 'held',
        aiRead: 'The range floor held and BTC rose 1.9%. A small starter at a named level is the right size for a range trade.',
      },
    ],
    aiSummary: 'The best day so far. Every trade pointed to a level or a rule, and CATL closed out at its original target.',
    aiNext: 'ZIJIN MINING is approaching your 27 target. Set an alert there now, while you’re not emotionally attached to the position.',
  },
  {
    date: '2026-07-13',
    pnl: -410,
    trades: [
      {
        time: '10:15', symbol: 'BIG DATA ETF', code: '159739', asset: 'ETF', side: 'Buy', price: 0.95, qty: 4000, close: 0.962,
        note: 'Capital rotating from high-valuation tech into computing. Starting a partial position.',
        verdict: 'held',
        aiRead: 'The rotation showed up on day one: +1.3% by the close. Starting partial leaves room to add if it breaks 1.00.',
      },
      {
        time: '13:50', symbol: '10Y CGB', code: '019547', asset: 'Bond', side: 'Sell', price: 104.1, qty: 60, close: 104.08,
        note: 'Taking the auction-dip profit.',
        verdict: 'held',
        aiRead: 'A clean exit near the top of the bounce. The bond went flat afterwards (-0.02%).',
      },
      {
        time: '22:40', symbol: 'BITCOIN', code: 'BTC/USDT', asset: 'Crypto', side: 'Buy', price: 65600, qty: 0.03, close: 64700,
        note: 'Momentum building. Adding before the breakout.',
        verdict: 'broke',
        aiRead: '“Before the breakout” meant buying the middle of the range. BTC fell 1.4% back toward 64.7k, undoing part of Friday’s starter.',
      },
    ],
    aiSummary: 'Slightly red. JEREH closed at 142, already below your 145 stop, and no exit was logged.',
    aiNext: 'JEREH is through your stop. Exit at tomorrow’s open, as your own plan says.',
  },
  {
    date: '2026-07-14',
    pnl: 3330,
    trades: [
      {
        time: '10:00', symbol: 'ZIJIN MINING', code: '601899', asset: 'Stock', side: 'Sell', price: 26.81, qty: 200, close: 26.95,
        note: 'Close to my 27 target. Taking profit before the afternoon fade.',
        verdict: 'early',
        aiRead: 'ZIJIN closed at 26.95, 0.5% above your fill, so it may feel like you sold too soon. You still exited within 0.7% of your 27 target. That is the plan working, not a mistake.',
      },
      {
        time: '11:10', symbol: 'ZIJIN INTL', code: '02259', asset: 'Stock', side: 'Sell', price: 94.0, qty: 100, close: 92.6,
        note: 'Gold dipping with the market. Hit my 94 stop. Out.',
        verdict: 'held',
        aiRead: 'You sold exactly at the stop you set on Jul 8, and the stock fell another 1.5%. Discipline paid.',
      },
      {
        time: '14:30', symbol: 'JEREH', code: '002353', asset: 'Stock', side: 'Sell', price: 140.0, qty: 100, close: 138.9,
        note: 'Short-term logic broke after a failed intraday bounce. Exiting, no averaging down.',
        verdict: 'late',
        aiRead: 'JEREH kept falling (-0.8%) after you sold, so exiting was right. But the plan’s stop was 145; waiting cost about ¥500 more than the plan allowed.',
      },
    ],
    aiSummary: 'Most of today’s gain came before your exits: ZIJIN MINING rose 3.2% into your sale and BIG DATA ETF added 1.5%. Two of the three sells followed plan; JEREH came late.',
    aiNext: 'Place stops as orders at entry, so an exit like JEREH’s doesn’t wait on a decision you’d rather not make.',
  },
];

export function getTradingDay(date: string) {
  return tradingDays.find(d => d.date === date);
}

export function getDayStats(date: string) {
  const sorted = [...tradingDays].sort((a, b) => a.date.localeCompare(b.date));
  let end = LATEST_TOTAL_ASSETS;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const start = end - sorted[i].pnl;
    if (sorted[i].date === date) {
      return { pnl: sorted[i].pnl, start, end, returnPct: (sorted[i].pnl / start) * 100 };
    }
    end = start;
  }
  return null;
}

export function toDateKey(day: number) {
  return `${CALENDAR_YEAR}-${String(CALENDAR_MONTH + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function formatPrice(asset: AssetClass, value: number) {
  const digits = asset === 'ETF' ? 3 : 2;
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatSigned(value: number, digits = 0) {
  const abs = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${value >= 0 ? '+' : '-'}${abs}`;
}
