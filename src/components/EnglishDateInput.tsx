import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { currentLocalDate } from '../lib/trade-time';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (value: number) => String(value).padStart(2, '0');

function dateParts(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? { year, month: month - 1, day } : null;
}

export default function EnglishDateInput({ value, onChange, label }: { value: string; onChange: (date: string) => void; label: string }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const today = dateParts(currentLocalDate())!;
  const selected = dateParts(value);
  const [view, setView] = useState({ year: today.year, month: today.month });

  const show = () => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    setView(selected ? { year: selected.year, month: selected.month } : { year: today.year, month: today.month });
    const popupHeight = 320;
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 280)),
      top: rect.bottom + popupHeight > window.innerHeight ? Math.max(8, rect.top - popupHeight - 4) : rect.bottom + 4,
    });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!popupRef.current?.contains(event.target as Node) && !anchorRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    const closeOnScroll = () => setOpen(false);
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    window.addEventListener('scroll', closeOnScroll, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
      window.removeEventListener('scroll', closeOnScroll, true);
    };
  }, [open]);

  const changeMonth = (offset: number) => {
    const date = new Date(view.year, view.month + offset, 1);
    setView({ year: date.getFullYear(), month: date.getMonth() });
  };
  const firstWeekday = new Date(view.year, view.month, 1).getDay();
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const cells = Array.from({ length: firstWeekday + daysInMonth }, (_, index) => index - firstWeekday + 1);
  const years = Array.from({ length: 66 }, (_, index) => today.year - 60 + index);

  return <>
    <button ref={anchorRef} type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={() => open ? setOpen(false) : show()} className="flex w-full items-center justify-between rounded border border-slate-200 bg-white px-2 py-1.5 text-left font-mono text-[10px] text-[#0B2545]">
      <span className={value ? '' : 'text-slate-400'}>{value || 'YYYY-MM-DD'}</span><CalendarDays size={12} className="text-slate-500" />
    </button>
    {open && createPortal(<div ref={popupRef} role="dialog" aria-label={`${label} calendar`} style={{ top: position.top, left: position.left }} className="fixed z-[200] w-[272px] rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
      <div className="mb-2 flex items-center justify-between gap-1">
        <button type="button" aria-label="Previous month" onClick={() => changeMonth(-1)} className="rounded p-1 text-slate-600 hover:bg-slate-100"><ChevronLeft size={15} /></button>
        <select aria-label="Month" value={view.month} onChange={event => setView({ ...view, month: Number(event.target.value) })} className="min-w-0 flex-1 bg-white text-[11px] font-bold text-[#0B2545] outline-none">{MONTHS.map((month, index) => <option key={month} value={index}>{month}</option>)}</select>
        <select aria-label="Year" value={view.year} onChange={event => setView({ ...view, year: Number(event.target.value) })} className="w-[58px] bg-white text-[11px] font-bold text-[#0B2545] outline-none">{years.map(year => <option key={year} value={year}>{year}</option>)}</select>
        <button type="button" aria-label="Next month" onClick={() => changeMonth(1)} className="rounded p-1 text-slate-600 hover:bg-slate-100"><ChevronRight size={15} /></button>
      </div>
      <div className="grid grid-cols-7 text-center text-[9px] font-semibold text-slate-400">{WEEKDAYS.map(day => <span key={day} className="py-1">{day}</span>)}</div>
      <div className="grid grid-cols-7 text-center text-[10px]">{cells.map((day, index) => day > 0 ? <button key={index} type="button" aria-label={`${MONTHS[view.month]} ${day}, ${view.year}`} onClick={() => { onChange(`${view.year}-${pad(view.month + 1)}-${pad(day)}`); setOpen(false); }} className={`h-8 rounded-md hover:bg-slate-100 ${selected?.year === view.year && selected.month === view.month && selected.day === day ? 'bg-[#0B2545] font-bold text-white hover:bg-[#134074]' : 'text-[#0B2545]'}`}>{day}</button> : <span key={index} />)}</div>
      <div className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-[10px] font-semibold">
        <button type="button" onClick={() => { onChange(''); setOpen(false); }} className="text-slate-500">Clear</button>
        <button type="button" onClick={() => { onChange(currentLocalDate()); setOpen(false); }} className="text-[#EE6C4D]">Today</button>
      </div>
    </div>, document.body)}
  </>;
}
