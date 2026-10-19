import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import TradesModule from '../components/TradesModule';

export default function AllTrades() {
  const navigate = useNavigate();

  return (
    <div className="min-h-full bg-[#F8F9FA] pb-6">
      <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-100 bg-white px-3 pb-3 pt-[54px]">
        <button onClick={() => navigate('/')} aria-label="Back to Today" className="rounded-lg p-1.5 text-[#0B2545] hover:bg-slate-100">
          <ChevronLeft size={20} />
        </button>
        <div>
          <h1 className="text-[16px] font-bold text-[#0B2545]">All Trades</h1>
          <p className="text-[10px] text-slate-500">Newest trades first · filter by date</p>
        </div>
      </div>
      <TradesModule view="history" />
    </div>
  );
}
