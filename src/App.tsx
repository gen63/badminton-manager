import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SessionCreate } from './pages/SessionCreate';
import { PlayerSelect } from './pages/PlayerSelect';
import { MainPage } from './pages/MainPage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { useSessionStore } from './stores/sessionStore';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<SessionCreate />} />
        <Route path="/players" element={<PlayerSelect />} />
        <Route path="/main" element={<MainPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
