import React from 'react';
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './Layout';
import Home from './pages/Home';
import Report from './pages/Report';
import Strategy from './pages/Strategy';
import Agent from './pages/Agent';
import Detail from './pages/Detail';
import DayDetail from './pages/DayDetail';

export default function App() {
  const Router = import.meta.env.BASE_URL === '/' ? BrowserRouter : HashRouter;
  return (
    <Router>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/report" element={<Report />} />
          <Route path="/strategy" element={<Strategy />} />
          <Route path="/agent" element={<Agent />} />
          <Route path="/detail/:id" element={<Detail />} />
          <Route path="/day/:date" element={<DayDetail />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Router>
  );
}
