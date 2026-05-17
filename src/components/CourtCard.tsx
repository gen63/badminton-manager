import { Play, Square, Clock, Users, X } from 'lucide-react';
import { useGameTimer } from '../hooks/useGameTimer';
import type { Court } from '../types/court';

interface CourtCardProps {
  court: Court;
  getPlayerName: (playerId: string) => string;
  getPlayerGamesPlayed: (playerId: string) => number;
  getPlayerGender?: (playerId: string) => 'M' | 'F' | undefined;
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
  getPlayerGender?: (playerId: string) => 'M' | 'F' | undefined;
  onPlayerTap: (playerId: string, position: number) => void;
  onClearSelection: () => void;
}

function PlayerPill({ playerId, position, selectedPlayerId, getPlayerName, getPlayerGamesPlayed, onPlayerTap, onClearSelection }: PlayerPillProps) {
  if (!playerId) {
    return (
      <div className="h-9 bg-gradient-to-r from-gray-50 to-gray-100 rounded border border-dashed border-border" />
    );
  }

  const isSelected = selectedPlayerId === playerId;
  const name = getPlayerName(playerId);
  const gamesPlayed = getPlayerGamesPlayed(playerId);

  return (
    <div
      onClick={() => onPlayerTap(playerId, position)}
      className="h-9 cursor-pointer"
    >
      <span className="text-foreground font-medium flex items-center min-w-0 overflow-hidden flex-1">
        <span className="flex-1 min-w-0">{name}</span>
        <span className="text-[10px] text-muted-foreground ml-1 flex-shrink-0 tabular-nums">
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
      <div className="h-9 bg-gradient-to-r from-gray-50 to-gray-100 rounded border border-dashed border-border" />
      <div className="h-9 bg-gradient-to-r from-gray-50 to-gray-100 rounded border border-dashed border-border" />
    </div>
  );
}

function UnassignedDisplay() {
  return (
    <>
      {/* 上ペア相当のスペース */}
      <EmptySlots />

      {/* VS相当のスペースに「未配置」テキスト */}
      <div className="text-center text-muted-foreground text-xs py-1 font-medium">未配置</div>

      {/* 下ペア相当のスペース */}
      <EmptySlots />
    </>
  );
}

export function CourtCard({
  court,
  getPlayerName,
  getPlayerGamesPlayed,
  getPlayerGender,
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

  // teamA[0] だけで判定すると、teamA[0] が空文字（プレイヤー削除等で
  // ['', 'B'] になったケース）に teamA[1] や teamB が描画されず、ダブルスでも
  // 2 人しか見えなくなるため全スロットを見る。
  const hasPlayers = court.teamA[0] || court.teamA[1] || court.teamB[0] || court.teamB[1];

  const pillProps = { selectedPlayerId, getPlayerName, getPlayerGamesPlayed, getPlayerGender, onPlayerTap, onClearSelection };

  return (
    <div
      className={`card p-1.5 flex flex-col w-full ${
        court.isPlaying ? 'court-playing' : ''
      }`}
    >
      {/* コート番号とステータス */}
      <div className="flex items-center justify-center gap-1.5 mb-1.5 min-h-[36px]">
        <span className="text-2xl font-bold text-muted-foreground">
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
          {/* チームA: スロット毎に判定して、teamA[0]=='' だが teamA[1] にプレイヤーが
              残っている部分配置でも残ったプレイヤーを描画する */}
          <div className="space-y-1">
            <PlayerPill playerId={court.teamA[0]} position={0} {...pillProps} />
            <PlayerPill playerId={court.teamA[1]} position={1} {...pillProps} />
          </div>

          {/* VS */}
          <div className="flex items-center gap-1 my-1">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-300 to-transparent" />
            <span className="text-muted-foreground text-[10px] font-bold">VS</span>
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gray-300 to-transparent" />
          </div>

          {/* チームB */}
          <div className="space-y-1">
            <PlayerPill playerId={court.teamB[0]} position={2} {...pillProps} />
            <PlayerPill playerId={court.teamB[1]} position={3} {...pillProps} />
          </div>
        </>
      ) : (
        <UnassignedDisplay />
      )}
      </div>

      {/* コントロールボタン */}
      <div className="flex pt-1 min-h-[48px]">
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
            className="w-full flex items-center justify-center gap-1 text-xs py-1.5"
          >
            <Square size={14} />
            終了
          </button>
        )}
      </div>
    </div>
  );
}
