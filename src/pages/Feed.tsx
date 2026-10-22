import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, Heart, Loader2, RefreshCw } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { API_BASE_URL, apiRequest } from '../lib/api';

type FeedArticle = {
  book: string;
  title: string;
  tags: string[];
  summary: string;
  body: string;
  cover: string;
};

type DailyFeed = {
  date: string;
  generated_at: string;
  news: { title: string; url: string; source: string; date?: string; summary?: string };
  articles: FeedArticle[];
};

const tagStyles = [
  'bg-[#FCECE5] text-[#B7583D]',
  'bg-[#EAF2E9] text-[#587252]',
  'bg-[#F3EEE4] text-[#867148]',
  'bg-[#F0EAF1] text-[#7A627F]',
];

function TagList({ tags }: { tags: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag, index) => (
        <span
          key={tag}
          className={`rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide ${tagStyles[index % tagStyles.length]}`}
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

function ArticleTitle({ title }: { title: string }) {
  const colon = title.indexOf(':');
  if (colon < 1) return <>{title}</>;
  return <><em>{title.slice(0, colon)}</em>{title.slice(colon)}</>;
}

export default function Feed() {
  const { articleIndex: articleIndexParam } = useParams();
  const navigate = useNavigate();
  const [feed, setFeed] = useState<DailyFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadFeed = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setFeed(await apiRequest<DailyFeed>('/api/feed'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load today’s essays.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const el = document.getElementById('main-scroll-container');
    if (el) el.scrollTo(0, 0);
    void loadFeed();
  }, [loadFeed]);

  const articleIndex = articleIndexParam === undefined ? null : Number(articleIndexParam);
  const selectedArticle = useMemo(() => {
    if (articleIndex === null || !Number.isInteger(articleIndex) || articleIndex < 0) return null;
    return feed?.articles[articleIndex] ?? null;
  }, [articleIndex, feed]);

  const formattedDate = feed?.date
    ? new Intl.DateTimeFormat('en-US', {
      month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Shanghai',
    }).format(new Date(`${feed.date}T12:00:00+08:00`))
    : '';

  const pageShell = 'relative min-h-full w-full overflow-hidden bg-[#F8F7F4] pb-[110px] text-[#18263A]';
  const background = (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[360px] bg-gradient-to-b from-[#F3EAE4] to-transparent" />
      <div className="pointer-events-none absolute -right-20 top-20 h-56 w-56 rounded-full bg-[#E8D7CD]/35 blur-3xl" />
    </>
  );

  if (articleIndexParam !== undefined) {
    return (
      <div className={`${pageShell} font-sans`}>
        {background}
        <header className="relative z-10 px-5 pb-6 pt-[66px]">
          <button
            type="button"
            onClick={() => navigate('/feed')}
            className="mb-6 inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-2 text-[12px] font-semibold text-[#7B6860] shadow-sm"
          >
            <ArrowLeft size={15} /> All essays
          </button>
          {selectedArticle && (
            <>
              <div className="mb-3 flex items-center gap-2">
                <Heart size={15} className="text-[#D9795B]" />
                <span className="text-[10px] font-bold italic uppercase tracking-[0.17em] text-[#D9795B]">{selectedArticle.book}</span>
              </div>
              <h1 className="font-serif text-[27px] font-bold leading-[1.16] text-[#18263A]">
                <ArticleTitle title={selectedArticle.title} />
              </h1>
              <div className="mt-4"><TagList tags={selectedArticle.tags} /></div>
            </>
          )}
        </header>

        <main className="relative z-10 px-5">
          {loading && <LoadingState />}
          {!loading && error && <ErrorState error={error} onRetry={() => void loadFeed()} />}
          {!loading && !error && selectedArticle && (
            <article className="rounded-[22px] border border-white/90 bg-white/85 p-5 shadow-[0_10px_30px_rgba(61,48,41,0.06)]">
              <div className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#A89B91]">
                <BookOpen size={13} /> {formattedDate}
              </div>
              <div className="space-y-5">
                {selectedArticle.body.split(/\n\s*\n/).filter(Boolean).map((paragraph, index) => (
                  <p key={index} className="font-serif text-[15px] leading-[1.9] text-[#4E5359]">{paragraph}</p>
                ))}
              </div>
            </article>
          )}
          {!loading && !error && !selectedArticle && <NotFoundState onBack={() => navigate('/feed')} />}
        </main>
      </div>
    );
  }

  return (
    <div className={`${pageShell} font-sans`}>
      {background}
      <header className="relative z-10 px-5 pb-6 pt-[70px]">
        <div className="mb-3 flex items-center gap-2">
          <Heart size={16} className="text-[#D9795B]" />
          <span className="text-[11px] font-bold uppercase tracking-[0.17em] text-[#D9795B]">Mindful Trading</span>
        </div>
        <h1 className="mb-2 font-serif text-[30px] font-bold leading-tight text-[#18263A]">Stay grounded.</h1>
        <p className="max-w-[88%] font-serif text-[14px] leading-[1.65] text-[#6B6C6E]">
          The market fluctuates, but your discipline shouldn’t. Tailored perspectives to soothe the noise.
        </p>
        {feed && (
          <div className="mt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#A69B94]">
            {formattedDate}<span className="mx-2 text-[#D9795B]">·</span>{feed.articles.length} essays
          </div>
        )}
      </header>

      <main className="relative z-10 space-y-4 px-4">
        {loading && <LoadingState />}
        {!loading && error && <ErrorState error={error} onRetry={() => void loadFeed()} />}
        {!loading && feed?.articles.map((article, index) => (
          <button
            key={`${feed.date}-${article.book}`}
            type="button"
            onClick={() => navigate(`/feed/${index}`)}
            aria-label={`Open ${article.title}`}
            className="flex w-full items-start gap-3 rounded-[20px] border border-white/90 bg-white/90 p-3.5 text-left shadow-[0_8px_24px_rgba(61,48,41,0.055)] transition-transform active:scale-[0.99]"
          >
            <img
              src={`${API_BASE_URL}/api/feed/covers/${encodeURIComponent(article.cover)}`}
              alt=""
              loading="lazy"
              className="mt-1 h-[clamp(50px,16vw,64px)] w-[clamp(50px,16vw,64px)] shrink-0 rounded-[14px] object-cover"
            />
            <div className="min-w-0 flex-1">
              <h2 className="font-serif text-[17px] font-bold leading-[1.25] text-[#18263A]">
                <ArticleTitle title={article.title} />
              </h2>
              <div className="mt-2"><TagList tags={article.tags} /></div>
              <p className="mt-2 line-clamp-3 font-serif text-[12px] leading-[1.6] text-[#686B6E]">
                {article.summary}
              </p>
            </div>
          </button>
        ))}
      </main>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[20px] bg-white/80 px-6 py-10 text-center shadow-sm">
      <Loader2 size={22} className="animate-spin text-[#D9795B]" />
      <p className="font-serif text-[15px] text-[#6B6C6E]">Gathering today’s essays</p>
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="rounded-[20px] border border-[#E9D9D0] bg-white/85 p-4 shadow-sm">
      <h2 className="font-serif text-[16px] font-semibold text-[#18263A]">Today’s essays are not ready</h2>
      <p className="mt-1 text-[12px] leading-relaxed text-[#727477]">{error}</p>
      <button type="button" onClick={onRetry} className="mt-3 inline-flex items-center gap-2 text-[12px] font-semibold text-[#C96D50]">
        <RefreshCw size={13} /> Try again
      </button>
    </div>
  );
}

function NotFoundState({ onBack }: { onBack: () => void }) {
  return (
    <div className="rounded-[20px] bg-white/85 p-5 text-center shadow-sm">
      <p className="font-serif text-[15px] text-[#6B6C6E]">This essay is no longer in today’s edition.</p>
      <button type="button" onClick={onBack} className="mt-3 text-[12px] font-semibold text-[#C96D50]">Back to Feed</button>
    </div>
  );
}
