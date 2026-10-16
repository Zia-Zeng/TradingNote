import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { 
  Hourglass, Fingerprint, Feather, Scale, Star, Heart
} from 'lucide-react';

export default function Feed() {
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const el = document.getElementById('main-scroll-container');
    if (el) el.scrollTo(0, 0);
  }, []);

  const articles = [
    {
      id: 1,
      title: "The Patience of Gold",
      author: "Macro Whisperer",
      rating: 5,
      icon: Hourglass,
      summary: "Holding ZIJIN MINING requires understanding the macro cycle. Gold doesn't rush; it waits for inflation to reveal its true face. Your conviction is your ultimate hedge."
    },
    {
      id: 2,
      title: "Signal vs. Noise",
      author: "Quant Zen",
      rating: 4,
      icon: Fingerprint,
      summary: "Your BIG DATA ETF is a bet on the inevitable future. Volatility is just the admission fee for technological revolutions. Breathe through the noise."
    },
    {
      id: 3,
      title: "The Grace of Letting Go",
      author: "Behavioral Coach",
      rating: 5,
      icon: Feather,
      summary: "Taking a loss on JEREH might sting, but cutting a losing position is the ultimate act of self-love for a trader. Capital preserved is capital earned."
    },
    {
      id: 4,
      title: "Safe Haven in Chaos",
      author: "Bond Guardian",
      rating: 4,
      icon: Scale,
      summary: "While equities gyrate, your 10Y CGB sits quietly, doing exactly what it was designed to do. A well-constructed portfolio always has a quiet corner."
    }
  ];

  return (
    <div className="w-full min-h-full pb-[100px] bg-[#F8F9FA] relative font-sans text-slate-900 overflow-hidden">
      {/* Background Ambience */}
      <div className="absolute top-0 left-0 w-full h-[300px] bg-gradient-to-b from-[#0B2545]/10 to-transparent pointer-events-none"></div>
      <div className="absolute top-[-50px] right-[-50px] w-64 h-64 bg-[#EE6C4D]/10 rounded-full blur-3xl pointer-events-none"></div>

      {/* Header / Slogan */}
      <div className="px-5 pt-[70px] pb-6 relative z-10">
        <div className="flex items-center gap-2 mb-3">
          <Heart size={16} className="text-[#EE6C4D]" />
          <span className="text-[12px] font-bold text-[#EE6C4D] uppercase tracking-widest">Mindful Trading</span>
        </div>
        <h1 className="text-[28px] font-bold text-[#0B2545] font-serif leading-tight mb-3">
          Stay grounded.
        </h1>
        <p className="text-[14px] text-slate-600 font-medium leading-relaxed max-w-[85%]">
          The market fluctuates, but your discipline shouldn't. Tailored perspectives to soothe the noise.
        </p>
      </div>

      {/* Feed List */}
      <div className="px-4 space-y-5 relative z-10">
        {articles.map((article) => {
          const Icon = article.icon;
          return (
            <div 
              key={article.id} 
              className="flex gap-4 p-4 bg-white/70 backdrop-blur-xl rounded-2xl border border-white shadow-[0_8px_24px_rgba(11,37,69,0.04)]"
            >
              <div className="shrink-0 w-14 flex justify-center pt-1">
                <Icon size={46} strokeWidth={1} className="text-[#0B2545]" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-[18px] font-bold text-[#0B2545] font-serif leading-snug mb-0.5 tracking-tight">
                  {article.title}
                </h3>
                <div className="text-[12px] text-slate-400 italic mb-2 font-serif">
                  {article.author}
                </div>
                <div className="flex text-teal-300 gap-1 mb-3">
                  {Array.from({ length: article.rating }).map((_, i) => (
                    <Star key={i} size={12} fill="currentColor" strokeWidth={0} />
                  ))}
                  {Array.from({ length: 5 - article.rating }).map((_, i) => (
                    <Star key={i + article.rating} size={12} fill="currentColor" className="text-slate-200" strokeWidth={0} />
                  ))}
                </div>
                <p className="text-[13px] text-slate-500 leading-relaxed font-serif">
                  {article.summary}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}