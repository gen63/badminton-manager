import { useState } from 'react';
import { X, Check } from 'lucide-react';

interface WinnerSelectModalProps {
  courtId: number;
  teamA: string[];
  teamB: string[];
  getPlayerName: (id: string) => string;
  getPlayerGender: (id: string) => 'M' | 'F' | undefined;
  onConfirm: (winnerIds: string[] | 'unknown') => void;
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
  const teamAPlayers = teamA.filter(Boolean);
  const teamBPlayers = teamB.filter(Boolean);
  const isSingles = teamA[1] === '' && teamB[1] === '';
  const maxSelect = isSingles ? 1 : 2;
  const teamASet = new Set(teamAPlayers);
  const teamBSet = new Set(teamBPlayers);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<string>>(new Set());

  // WINNER1 fix: 既に「片方のチーム」を選んでいる時、もう一方のチームを
  // 触れても無視ではなく「選び直し」として 1 人にリセットする。
  // 旧仕様: 異チーム選択を確定すると `allInA && allInB` がどちらも false
  //        になり呼び出し側が無言で modal を閉じてスコア未記録になっていた。
  const handlePlayerToggle = (playerId: string) => {
    const newSelected = new Set(selectedPlayerIds);
    if (newSelected.has(playerId)) {
      newSelected.delete(playerId);
      setSelectedPlayerIds(newSelected);
      return;
    }
    const targetTeam = teamASet.has(playerId) ? 'A' : teamBSet.has(playerId) ? 'B' : null;
    if (targetTeam) {
      const hasOtherTeamSelected = Array.from(newSelected).some((id) =>
        targetTeam === 'A' ? teamBSet.has(id) : teamASet.has(id),
      );
      if (hasOtherTeamSelected) {
        setSelectedPlayerIds(new Set([playerId]));
        return;
      }
    }
    if (newSelected.size < maxSelect) {
      newSelected.add(playerId);
    }
    setSelectedPlayerIds(newSelected);
  };

  const handleConfirm = () => {
    if (selectedPlayerIds.size === maxSelect) {
      onConfirm(Array.from(selectedPlayerIds));
    }
  };

  const handleUnknown = () => {
    onConfirm('unknown');
  };

  const renderPlayerCard = (playerId: string) => {
    const isSelected = selectedPlayerIds.has(playerId);
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
        key={playerId}
        onClick={() => handlePlayerToggle(playerId)}
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
            <h2 className="text-lg font-bold text-foreground">{isSingles ? '勝者を選択' : '勝ちペア2人を選択'}</h2>
            <p className="text-xs text-muted-foreground mt-1">
              コート {courtId} の試合 ({selectedPlayerIds.size}/{maxSelect}人選択中)
            </p>
          </div>
          <button
            onClick={onCancel}
            aria-label="閉じる"
            className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content: チームごとにグループ表示 */}
        <div className="p-6 flex flex-col gap-4">
          {/* チームA */}
          <div className="flex flex-col gap-2">
            {!isSingles && (
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">チームA</p>
            )}
            {teamAPlayers.map((playerId) => renderPlayerCard(playerId))}
          </div>

          {/* 区切り */}
          {!isSingles && (
            <div className="flex items-center gap-2">
              <div className="flex-1 border-t border-border" />
              <span className="text-xs text-muted-foreground">VS</span>
              <div className="flex-1 border-t border-border" />
            </div>
          )}

          {/* チームB */}
          <div className="flex flex-col gap-2">
            {!isSingles && (
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">チームB</p>
            )}
            {teamBPlayers.map((playerId) => renderPlayerCard(playerId))}
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
            disabled={selectedPlayerIds.size !== maxSelect}
            className="flex-1 py-3 bg-primary text-primary-foreground rounded-xl font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            確定
          </button>
        </div>
      </div>
    </div>
  );
}
