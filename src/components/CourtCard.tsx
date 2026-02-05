import { Play, Square, Clock, Users, X } from 'lucide-react';
import { useGameTimer } from '../hooks/useGameTimer';
import type { Court } from '../types/court';

interface CourtCardProps {
  court: Court;
  getPlayerName: (playerId: string) => string;
  getPlayerGamesPlayed: (playerId: string) => number;
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

interface PlayerPillProps {
  playerId: string | null;
  position: number;
  selectedPlayerId?: string | null;
  getPlayerName: (playerId: string) => string;
  getPlayerGamesPlayed: (playerId: string) => number;
  onPlayerTap: (playerId: string, position: number) => void;
  onClearSelection: () => void;
}

function PlayerPill({ playerId, position, selectedPlayerId, getPlayerName, getPlayerGamesPlayed, onPlayerTap, onClearSelection }: PlayerPillProps) {
  if (!playerId) {
    return (
      <div className="h-9 bg-gradient-to-r from-gray-50 to-gray-100 rounded border border-dashed border-gray-200" />
    );
  }

  const isSelected = selectedPlayerId === playerId;
  const name = getPlayerName(playerId);
  const gamesPlayed = getPlayerGamesPlayed(playerId);

  return (
    <div
      onClick={() => onPlayerTap(playerId, position)}
      className={`player-pill h-9 cursor-pointer ${
        isSelected ? 'player-pill-selected' : ''
      }`}
    >
      <span className="text-gray-800 font-medium flex items-center min-w-0 overflow-hidden flex-1">
        <span className="player-name-court flex-1 min-w-0">{name}</span>
        <span className="text-[10px] text-gray-400 ml-1 flex-shrink-0 tabular-nums">
          {gamesPlayed}
        </span>
      </span>
      {isSelected && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClearSelection();
          }}
          aria-label="選択解除"
          className="min-w-[36px] min-h-[36px] -mr-1 flex items-center justify-center text-red-500 hover:bg-red-50 active:bg-red-100 rounded-full transition-all duration-150"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}

function EmptySlots() {
  return (
    <div className="space-y-1">
      <div className="h-9 bg-gradient-to-r from-gray-50 to-gray-100 rounded border border-dashed border-gray-200" />
      <div className="h-9 bg-gradient-to-r from-gray-50 to-gray-100 rounded border border-dashed border-gray-200" />
    </div>
  );
}

function UnassignedDisplay() {
  return (
    <>
      {/* 上ペア相当のスペース */}
      <EmptySlots />

      {/* VS相当のスペースに「未配置」テキスト */}
      <div className="text-center text-gray-400 text-xs py-1 font-medium">未配置</div>

      {/* 下ペア相当のスペース */}
      <EmptySlots />
    </>
  );
}

export function CourtCard({
  court,
  getPlayerName,
  getPlayerGamesPlayed,
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

  const hasPlayers = court.teamA[0] || court.teamB[0];

  const pillProps = { selectedPlayerId, getPlayerName, getPlayerGamesPlayed, onPlayerTap, onClearSelection };

  return (
    <div
      className={`card p-1.5 flex flex-col w-full ${
        court.isPlaying ? 'court-playing' : ''
      }`}
    >
      {/* コート番号とステータス */}
      <div className="flex items-center justify-center gap-1.5 mb-1.5">
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

      {/* プレイヤー表示エリア - 高さを固定して配置時のジャンプを防止 */}
      <div className="flex flex-col justify-center space-y-1" style={{ minHeight: '172px' }}>
      {hasPlayers ? (
        <>
          {/* チームA */}
          <div className="space-y-1">
            {court.teamA[0] ? (
              <>
                <PlayerPill playerId={court.teamA[0]} position={0} {...pillProps} />
                <PlayerPill playerId={court.teamA[1]} position={1} {...pillProps} />
              </>
            ) : (
              <EmptySlots />
            )}
          </div>

          {/* VS */}
          <div className="flex items-center gap-1 my-1">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-300 to-transparent" />
            <span className="text-gray-400 text-[10px] font-bold">VS</span>
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-300 to-transparent" />
          </div>

          {/* チームB */}
          <div className="space-y-1">
            {court.teamB[0] ? (
              <>
                <PlayerPill playerId={court.teamB[0]} position={2} {...pillProps} />
                <PlayerPill playerId={court.teamB[1]} position={3} {...pillProps} />
              </>
            ) : (
              <EmptySlots />
            )}
          </div>
        </>
      ) : (
        <UnassignedDisplay />
      )}
      </div>

      {/* コントロールボタン */}
      <div className="flex pt-1">
        {!court.isPlaying && !hasPlayers && (
          <button
            onClick={onAutoAssign}
            disabled={!canAutoAssign}
            className="btn-secondary w-full flex items-center justify-center gap-1 text-xs py-1.5 whitespace-nowrap"
          >
            <Users size={14} />
            配置
          </button>
        )}
        {!court.isPlaying && hasPlayers && (
          <>
            <button
              onClick={onStartGame}
              className="btn-primary w-1/2 flex items-center justify-center gap-1 text-xs py-1.5 whitespace-nowrap px-1"
            >
              <Play size={12} />
              開始
            </button>
            <button
              onClick={onClear}
              className="btn-secondary w-1/2 flex items-center justify-center gap-1 text-xs py-1.5 whitespace-nowrap px-1"
            >
              クリア
            </button>
          </>
        )}
        {court.isPlaying && (
          <button
            onClick={onFinishGame}
            className="btn-warning w-full flex items-center justify-center gap-1 text-xs py-1.5"
          >
            <Square size={14} />
            終了
          </button>
        )}
      </div>
    </div>
  );
}
