import { useNavigate } from 'react-router-dom';
import { CalendarCheck, History, Settings } from 'lucide-react';

interface BottomNavProps {
  onReservationOpen: () => void;
  reservationCount: number;
}

export function BottomNav({ onReservationOpen, reservationCount }: BottomNavProps) {
  const navigate = useNavigate();

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-background border-t border-border shadow-[0_-2px_10px_rgba(0,0,0,0.05)] z-20 pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around h-[60px] max-w-lg mx-auto">
        <button
          onClick={onReservationOpen}
          className="relative flex flex-col items-center justify-center gap-1 min-w-[64px] h-[48px] text-muted-foreground active:scale-95 transition-transform"
        >
          <CalendarCheck size={22} />
          <span className="text-[10px] font-medium">予約</span>
          {reservationCount > 0 && (
            <span className="absolute top-0 right-1.5 min-w-[18px] h-[18px] bg-orange-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
              {reservationCount}
            </span>
          )}
        </button>
        <button
          onClick={() => navigate('/history')}
          className="flex flex-col items-center justify-center gap-1 min-w-[64px] h-[48px] text-muted-foreground active:scale-95 transition-transform"
        >
          <History size={22} />
          <span className="text-[10px] font-medium">履歴</span>
        </button>
        <button
          onClick={() => navigate('/settings')}
          className="flex flex-col items-center justify-center gap-1 min-w-[64px] h-[48px] text-muted-foreground active:scale-95 transition-transform"
        >
          <Settings size={22} />
          <span className="text-[10px] font-medium">設定</span>
        </button>
      </div>
    </nav>
  );
}
