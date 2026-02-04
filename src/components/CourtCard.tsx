import { Play, Square, Clock, Users, X } from 'lucide-react';
import { useGameTimer } from '../hooks/useGameTimer';
import type { Court } from '../types/court';

interface CourtCardProps {
  court: Court;
  getPlayerName: (playerId: string) => string;
  onStartGame: () => void;
  onFinishGame: () => void;
  onAutoAssign: () => void;
  onClear: () => void;
  onPlayerTap: (playerId: string, position: number) => void;
  selectedPlayerId?: string | null;
  onClearSelection: () => void;
  canAutoAssign?: boolean;
}

// 丸囲み数字
const circledNumbers = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

export function CourtCard({
  court,
  getPlayerName,
  onStartGame,
  onFinishGame,
  onAutoAssign,
  onClear,
  onPlayerTap,
  selectedPlayerId,
  onClearSelection,
  canAutoAssign = true,
}: CourtCardProps) {
  const timer = useGameTimer(court.startedAt, court.isPlaying);

  // プレイヤーピルボタン（44px以上のタップターゲット）
  const PlayerPill = ({ playerId, position }: { playerId: string | null; position: number }) => {
    if (!playerId) {
      return (
        <div className="h-12 bg-gradient-to-r from-gray-50 to-gray-100 rounded-xl border-2 border-dashed border-gray-200" />
      );
    }

    const isSelected = selectedPlayerId === playerId;

    return (
      <div
        onClick={() => onPlayerTap(playerId, position)}
        className={`player-pill h-12 cursor-pointer ${
          isSelected ? 'player-pill-selected' : ''
        }`}
      >
        <span className="text-gray-800 text-xs font-medium truncate">
          {getPlayerName(playerId)}
        </span>
        {isSelected && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClearSelection();
            }}
            aria-label="選択解除"
            className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center text-red-500 hover:bg-red-50 active:bg-red-100 rounded-full transition-all duration-150"
          >
            <X size={18} />
          </button>
        )}
      </div>
    );
  };

  // 未配置状態
  const EmptySlots = () => (
    <div className="space-y-2">
      <div className="h-12 bg-gradient-to-r from-gray-50 to-gray-100 rounded-xl border-2 border-dashed border-gray-200" />
      <div className="h-12 bg-gradient-to-r from-gray-50 to-gray-100 rounded-xl border-2 border-dashed border-gray-200" />
    </div>
  );

  // 完全未配置の表示（配置済みと同じ高さを確保）
  const UnassignedDisplay = () => (
    <>
      {/* 上ペア相当のスペース */}
      <EmptySlots />

      {/* VS相当のスペースに「未配置」テキスト */}
      <div className="text-center text-gray-400 text-xs py-1 font-medium">未配置</div>

      {/* 下ペア相当のスペース */}
      <EmptySlots />
    </>
  );

  const hasPlayers = court.teamA[0] || court.teamB[0];

  return (
    <div
      className={`card p-4 space-y-3 ${
        court.isPlaying ? 'court-playing' : ''
      }`}
    >
      {/* コート番号とステータス */}
      <div className="flex items-center justify-center gap-2">
        <span className="text-2xl font-bold text-gray-400">
          {circledNumbers[court.id - 1] || court.id}
        </span>
        {court.isPlaying && (
          <span className="badge badge-playing">
            <Clock size={12} />
            {timer.formatted}
          </span>
        )}
      </div>

      {/* プレイヤー表示エリア */}
      {hasPlayers ? (
        <>
          {/* チームA */}
          <div className="space-y-2">
            {court.teamA[0] ? (
              <>
                <PlayerPill playerId={court.teamA[0]} position={0} />
                <PlayerPill playerId={court.teamA[1]} position={1} />
              </>
            ) : (
              <EmptySlots />
            )}
          </div>

          {/* VS */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-300 to-transparent" />
            <span className="text-gray-400 text-xs font-bold px-2">VS</span>
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-300 to-transparent" />
          </div>

          {/* チームB */}
          <div className="space-y-2">
            {court.teamB[0] ? (
              <>
                <PlayerPill playerId={court.teamB[0]} position={2} />
                <PlayerPill playerId={court.teamB[1]} position={3} />
              </>
            ) : (
              <EmptySlots />
            )}
          </div>
        </>
      ) : (
        <UnassignedDisplay />
      )}

      {/* コントロールボタン */}
      <div className="flex gap-2 pt-2">
        {!court.isPlaying && !hasPlayers && (
          <button
            onClick={onAutoAssign}
            disabled={!canAutoAssign}
            className="btn-secondary w-full flex items-center justify-center gap-1.5 text-sm py-2.5 whitespace-nowrap"
          >
            <Users size={16} />
            配置
          </button>
        )}
        {!court.isPlaying && hasPlayers && (
          <>
            <button
              onClick={onStartGame}
              className="btn-primary flex-1 flex items-center justify-center gap-1 text-xs py-2.5 whitespace-nowrap px-2"
            >
              <Play size={14} />
              開始
            </button>
            <button
              onClick={onClear}
              className="btn-secondary flex-1 flex items-center justify-center gap-1 text-xs py-2.5 whitespace-nowrap px-2"
            >
              クリア
            </button>
          </>
        )}
        {court.isPlaying && (
          <button
            onClick={onFinishGame}
            className="btn-warning w-full flex items-center justify-center gap-1.5 text-sm py-2.5"
          >
            <Square size={16} />
            終了
          </button>
        )}
      </div>
    </div>
  );
}
