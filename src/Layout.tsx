import React from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import StatusBar from './components/mobile-shell/status-bar';
import HomeIndicator from './components/mobile-shell/home-indicator';
import { cn } from './lib/utils';
import { Notebook, PieChart, BookOpen, BotMessageSquare } from 'lucide-react';

const getPhoneScale = () => Math.max(
  0.1,
  Math.min(1, (window.innerWidth - 24) / 422, (window.innerHeight - 24) / 894)
);

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [phoneScale, setPhoneScale] = React.useState(getPhoneScale);

  const tabs = [
    { path: '/', label: 'Today', icon: Notebook },
    { path: '/agent', label: 'Agent', icon: BotMessageSquare },
    { path: '/report', label: 'Tracking', icon: PieChart },
    { path: '/feed', label: 'Feed', icon: BookOpen },
  ];

  const isMainTab = tabs.some(t => t.path === location.pathname || location.pathname.startsWith('/?') && t.path === '/');

  React.useEffect(() => {
    const mainEl = document.getElementById('main-scroll-container');
    if (mainEl) {
      mainEl.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [location.pathname, location.search]);

  React.useEffect(() => {
    const updateScale = () => setPhoneScale(getPhoneScale());
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  return (
    <div className="demo-stage">
      <div className="phone-frame" style={{ transform: `scale(${phoneScale})` }} aria-label="M-TradingNote mobile app preview">
        <span className="phone-button phone-button-silent" aria-hidden="true" />
        <span className="phone-button phone-button-volume-up" aria-hidden="true" />
        <span className="phone-button phone-button-volume-down" aria-hidden="true" />
        <span className="phone-button phone-button-side" aria-hidden="true" />
        <div className="phone-screen">
          <div className="relative w-full h-full bg-[#F8F9FA] overflow-hidden flex flex-col font-sans text-slate-900">
            <StatusBar color="black" />
            <div className="dynamic-island" aria-hidden="true" />

            {/* Main content area */}
            <main id="main-scroll-container" className="flex-1 min-h-0 w-full overflow-y-auto no-scrollbar">
              <Outlet />
            </main>

            {/* Bottom Navigation for Main Tabs */}
            {isMainTab && (
              <div className="absolute bottom-0 w-full bg-white rounded-t-[24px] shadow-[0_-10px_40px_rgba(0,0,0,0.06)] z-40">
                <div className="flex justify-around items-center h-[64px] px-2 pb-[34px] box-content">
                  {tabs.map((tab) => {
                    const isActive = location.pathname === tab.path;
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.path}
                        onClick={() => navigate(tab.path)}
                        className="flex flex-col items-center justify-center w-16 gap-1 mt-2 transition-transform active:scale-95"
                      >
                        <Icon
                          size={24}
                          className={cn("transition-colors duration-200", isActive ? "text-[#EE6C4D]" : "text-slate-300")}
                          strokeWidth={isActive ? 2.5 : 2}
                        />
                        <span
                          className={cn(
                            "text-[10px] font-medium transition-colors duration-200 mt-0.5",
                            isActive ? "text-[#EE6C4D]" : "text-slate-400"
                          )}
                        >
                          {tab.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <HomeIndicator />
          </div>
        </div>
      </div>
    </div>
  );
}
