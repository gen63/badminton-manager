import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SessionCreate } from './pages/SessionCreate';
import { PlayerSelect } from './pages/PlayerSelect';
import { MainPage } from './pages/MainPage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { ScoreInputPage } from './pages/ScoreInputPage';
import { SessionJoinPage } from './pages/SessionJoinPage';
import { PWAPrompt } from './components/PWAPrompt';

function App() {
  return (
    <BrowserRouter basename="/badminton-manager">
      <Routes>
        {/* Phase 0 ルート（LocalStorage版） */}
        <Route path="/" element={<SessionCreate />} />
        <Route path="/players" element={<PlayerSelect />} />
        
        {/* Phase 1 ルート（Firebase版） */}
        <Route path="/session/create" element={<SessionCreate />} />
        <Route path="/session/:sessionId" element={<SessionJoinPage />} />
        
        {/* 共通ルート */}
        <Route path="/main" element={<MainPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/score/:matchId" element={<ScoreInputPage />} />
        
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <PWAPrompt />
    </BrowserRouter>
  );
}

export default App;
