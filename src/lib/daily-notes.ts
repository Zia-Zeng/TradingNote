import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from './api';
import { notifyDailyReviewInputsChanged } from './daily-review';

export type DailyNote = {
  id: string;
  trade_date: string;
  text: string;
  created_at: string;
};

export function useDailyNotes(tradeDate?: string) {
  const [notes, setNotes] = useState<DailyNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setNotes([]);
    try {
      const query = tradeDate ? `?trade_date=${encodeURIComponent(tradeDate)}` : '';
      setNotes(await apiRequest<DailyNote[]>(`/api/today/notes${query}`));
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '笔记加载失败');
    } finally {
      setLoading(false);
    }
  }, [tradeDate]);

  useEffect(() => { void reload(); }, [reload]);

  const add = useCallback(async (text: string) => {
    try {
      const note = await apiRequest<DailyNote>('/api/today/notes', {
        method: 'POST',
        body: JSON.stringify({ trade_date: tradeDate ?? localDate(), text: text.trim() }),
      });
      setNotes(current => [note, ...current]);
      setError('');
      notifyDailyReviewInputsChanged(note.trade_date);
      return note;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '笔记保存失败');
      throw reason;
    }
  }, [tradeDate]);

  const update = useCallback(async (id: string, text: string, date = tradeDate ?? localDate()) => {
    try {
      const note = await apiRequest<DailyNote>(`/api/today/notes/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify({ trade_date: date, text: text.trim() }),
      });
      setNotes(current => current.map(item => item.id === id ? note : item));
      setError('');
      notifyDailyReviewInputsChanged(note.trade_date);
      return note;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '笔记更新失败');
      throw reason;
    }
  }, [tradeDate]);

  const remove = useCallback(async (id: string) => {
    try {
      const removedNote = notes.find(note => note.id === id);
      await apiRequest<void>(`/api/today/notes/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setNotes(current => current.filter(note => note.id !== id));
      setError('');
      notifyDailyReviewInputsChanged(removedNote?.trade_date ?? tradeDate ?? localDate());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '笔记删除失败');
      throw reason;
    }
  }, [notes, tradeDate]);

  return { notes, loading, error, reload, add, update, remove };
}

export function localDate(value = new Date()): string {
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

export function formatNoteDate(note: DailyNote): string {
  const created = new Date(note.created_at);
  const time = Number.isNaN(created.getTime())
    ? ''
    : created.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${note.trade_date}${time ? ` ${time}` : ''}`;
}
