import { useState } from 'react';
import { X, Check } from 'lucide-react';

interface WinnerSelectModalProps {
  courtId: number;
  teamA: string[];
  teamB: string[];
  getPlayerName: (id: string) => string;
  getPlayerGender: (id: string) => 'M' | 'F' | undefined;
  onConfirm: (winnerTeam: 'A' | 'B' | 'unknown') => void;
  onCancel: () => void;
}

export function WinnerSelectModal({
  courtId,
  teamA,
  teamB,
  getPlayerName,
  getPlayerGender,
  onConfirm,
  onCancel,
}: WinnerSelectModalProps) {
  const [selectedTeam, setSelectedTeam] = useState<'A' | 'B' | null>(null);

  const handleConfirm = () => {
    if (selectedTeam) {
      onConfirm(selectedTeam);
    }
  };

  const handleUnknown = () => {
    onConfirm('unknown');
  };

  const renderPlayerCard = (playerId: string, isSelected: boolean, onClick: () => void) => {
    const playerGender = getPlayerGender(playerId);
    const bgColor = isSelected
      ? 'bg-green-100 border-green-500'
      : 'bg-card border-border';
    const textColor = playerGender === 'M' 
      ? 'text-blue-600' 
      : playerGender === 'F' 
      ? 'text-pink-600' 
      : 'text-foreground';

    return (
      <button
        onClick={onClick}
        className={`relative flex items-center justify-between ${bgColor} border-2 p-3 rounded-xl transition-all shadow-sm hover:shadow-md active:scale-95`}
      >
        <span className={`font-semibold text-sm ${textColor}`}>
          {getPlayerName(playerId)}
        </span>
        {isSelected && (
          <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center text-white">
            <Check size={16} />
          </div>
        )}
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background rounded-2xl shadow-2xl w-[90%] max-w-md max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-background border-b border-border px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">勝ちペアを選択</h2>
            <p className="text-xs text-muted-foreground mt-1">
              コート {courtId} の試合
            </p>
          </div>
          <button
            onClick={onCancel}
            className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex flex-col gap-6">
          {/* Team A */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-muted-foreground">チーム A</h3>
              {selectedTeam === 'A' && (
                <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-semibold">
                  勝ち
                </span>
              )}
            </div>
            <div
              onClick={() => setSelectedTeam('A')}
              className="flex flex-col gap-2 p-3 bg-muted/20 rounded-xl border-2 border-transparent hover:border-primary/30 transition-colors cursor-pointer"
            >
              {teamA.map((playerId) => renderPlayerCard(playerId, selectedTeam === 'A', () => setSelectedTeam('A')))}
            </div>
          </div>

          <div className="flex items-center justify-center">
            <span className="text-xs font-black text-muted-foreground/50">VS</span>
          </div>

          {/* Team B */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-muted-foreground">チーム B</h3>
              {selectedTeam === 'B' && (
                <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-semibold">
                  勝ち
                </span>
              )}
            </div>
            <div
              onClick={() => setSelectedTeam('B')}
              className="flex flex-col gap-2 p-3 bg-muted/20 rounded-xl border-2 border-transparent hover:border-primary/30 transition-colors cursor-pointer"
            >
              {teamB.map((playerId) => renderPlayerCard(playerId, selectedTeam === 'B', () => setSelectedTeam('B')))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-background border-t border-border px-6 py-4 flex gap-3">
          <button
            onClick={handleUnknown}
            className="flex-1 py-3 bg-muted text-foreground rounded-xl font-semibold text-sm hover:bg-muted/80 transition-colors"
          >
            不明
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedTeam}
            className="flex-1 py-3 bg-primary text-primary-foreground rounded-xl font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            確定
          </button>
        </div>
      </div>
    </div>
  );
}
