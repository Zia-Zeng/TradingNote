import React from 'react';
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './Layout';
import Home from './pages/Home';
import Report from './pages/Report';
import Feed from './pages/Feed';
import Agent from './pages/Agent';
import Detail from './pages/Detail';
import DailyDetail from './pages/DailyDetail';
import Notes from './pages/Notes';

export default function App() {
  const Router = import.meta.env.BASE_URL === '/' ? BrowserRouter : HashRouter;

  return (
    <Router>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/report" element={<Report />} />
          <Route path="/feed" element={<Feed />} />
          <Route path="/agent" element={<Agent />} />
          <Route path="/detail/:id" element={<Detail />} />
          <Route path="/daily/:date" element={<DailyDetail />} />
          <Route path="/notes" element={<Notes />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Router>
  );
}
