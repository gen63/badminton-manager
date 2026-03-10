import { useNavigate } from 'react-router-dom';
import { CalendarCheck, History, Users, DollarSign, LayoutGrid } from 'lucide-react';
import { useReservationStore } from '../stores/reservationStore';
import { useGameStore } from '../stores/gameStore';
import { usePlayerStore } from '../stores/playerStore';
import { useSessionStore } from '../stores/sessionStore';
import { useToast } from '../hooks/useToast';
import { Toast } from './Toast';

type TabId = 'reservation' | 'court' | 'players' | 'accounting' | 'history';

interface BottomNavProps {
  activeTab: TabId;
}

export function BottomNav({ activeTab }: BottomNavProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const session = useSessionStore((s) => s.session);
  const currentUser = useSessionStore((s) => s.currentUser);
  const isAdmin = useSessionStore((s) => s.isAdmin);
  const reservationCount = useReservationStore(
    (s) => s.reservations.filter((r) => r.status === 'pending').length
  );
  
  // 履歴バッジ: オンラインモードでは権限により表示内容を変える
  const matchHistory = useGameStore((s) => s.matchHistory);
  const players = usePlayerStore((s) => s.players);
  
  const unrecordedMatchesCount = (() => {
    const unrecordedMatches = matchHistory.filter((m) => m.winner === undefined);
    
    // ローカルモード or 管理者: 全件表示
    if (!session?.createdBy || isAdmin()) {
      return unrecordedMatches.length;
    }
    
    // オンラインモード & 一般ユーザー: 自分が参加した試合のみ
    if (currentUser) {
      return unrecordedMatches.filter((match) => {
        // matchに含まれるplayerIdから名前を取得
        const playerIds = [...match.teamA, ...match.teamB];
        const playerNames = playerIds
          .map((id) => players.find((p) => p.id === id)?.name)
          .filter(Boolean);
        
        // 自分が参加しているかチェック
        return playerNames.includes(currentUser);
      }).length;
    }
    
    return 0;
  })();

  // PWA判定
  const isPWA = window.matchMedia('(display-mode: standalone)').matches || 
                (navigator as Navigator & { standalone?: boolean }).standalone;

  const tabs: { id: TabId; label: string; icon: typeof CalendarCheck; path: string }[] = [
    { id: 'court', label: 'メイン', icon: LayoutGrid, path: '/main' },
    { id: 'reservation', label: '試合予約', icon: CalendarCheck, path: '/reservation' },
    { id: 'history', label: '履歴', icon: History, path: '/history' },
    { id: 'players', label: '参加者', icon: Users, path: '/players' },
    { id: 'accounting', label: '会計', icon: DollarSign, path: '/accounting' },
  ];

  const handleTabClick = (tab: (typeof tabs)[number]) => {
    if (tab.id === activeTab) return;

    // オンラインセッション + ブラウザの場合、試合予約はPWA専用
    if (tab.id === 'reservation' && session?.createdBy && !isPWA) {
      console.log('[BottomNav] Blocking reservation access:', {
        sessionCreatedBy: session.createdBy,
        isPWA,
      });
      toast.warning('試合予約はPWAアプリ専用機能です', 1000);
      return;
    }

    navigate(tab.path);
  };

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 bg-background border-t border-border shadow-[0_-2px_10px_rgba(0,0,0,0.05)] z-20 pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-around h-[60px] max-w-lg mx-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabClick(tab)}
                className={`relative flex flex-col items-center justify-center gap-1 min-w-[56px] h-[48px] active:scale-95 transition-transform ${
                  isActive ? 'text-blue-600' : 'text-muted-foreground'
                }`}
              >
                <Icon size={22} />
                <span className="text-[10px] font-medium">{tab.label}</span>
                {tab.id === 'reservation' && reservationCount > 0 && (
                  <span className="absolute top-0 right-0.5 min-w-[18px] h-[18px] bg-orange-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                    {reservationCount}
                  </span>
                )}
                {tab.id === 'history' && unrecordedMatchesCount > 0 && (
                  <span className="absolute top-0 right-0.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                    {unrecordedMatchesCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Toast表示 */}
      {toast.toasts.map((t) => (
        <Toast
          key={t.id}
          message={t.message}
          type={t.type}
          duration={t.duration}
          onClose={() => toast.hideToast(t.id)}
        />
      ))}
    </>
  );
}
