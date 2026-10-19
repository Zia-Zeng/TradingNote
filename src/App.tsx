import React from 'react';
import { BrowserRouter, HashRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import Layout from './Layout';
import Home from './pages/Home';
import Report from './pages/Report';
import Feed from './pages/Feed';
import Agent from './pages/Agent';
import Detail from './pages/Detail';
import Notes from './pages/Notes';
import AllTrades from './pages/AllTrades';
import { localDate } from './lib/daily-notes';

function DailyRouteRedirect() {
  const { date } = useParams();
  const parsed = date ? new Date(`${date}T00:00:00`) : null;
  const validDate = parsed && !Number.isNaN(parsed.getTime()) && localDate(parsed) === date;
  return <Navigate to={validDate ? `/?date=${date}` : '/'} replace />;
}

export default function App() {
  const Router = import.meta.env.BASE_URL === '/' ? BrowserRouter : HashRouter;

  return (
    <Router>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/report" element={<Report />} />
          <Route path="/feed" element={<Feed />} />
          <Route path="/feed/:articleIndex" element={<Feed />} />
          <Route path="/agent" element={<Agent />} />
          <Route path="/detail/:id" element={<Detail />} />
          <Route path="/detail/:id/history" element={<Detail />} />
          <Route path="/daily/:date" element={<DailyRouteRedirect />} />
          <Route path="/notes" element={<Notes />} />
          <Route path="/trades" element={<AllTrades />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Router>
  );
}
