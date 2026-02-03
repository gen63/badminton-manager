import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useSessionStore } from '../stores/sessionStore';
import { assignCourts } from '../lib/algorithm';
import { Settings, History, Coffee, Users, ArrowUp, Plus, X } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { Toast } from '../components/Toast';
import { CourtCard } from '../components/CourtCard';

export function MainPage() {
  const navigate = useNavigate();
  const { session } = useSessionStore();
  const { players, toggleRest, updatePlayer, addPlayers } = usePlayerStore();
  const { courts, matchHistory, updateCourt, startGame, finishGame } =
    useGameStore();
  const toast = useToast();
  const [selectedPlayer, setSelectedPlayer] = useState<{
    id: string;
    courtId?: number;
    position?: number;
  } | null>(null);
  const [newPlayerName, setNewPlayerName] = useState('');

  if (!session) {
    navigate('/');
    return null;
  }

  const handleClearCourt = (courtId: number) => {
    updateCourt(courtId, {
      teamA: ['', ''],
      teamB: ['', ''],
      scoreA: 0,
      scoreB: 0,
      isPlaying: false,
      startedAt: null,
      finishedAt: null,
    });
  };

  const handleAutoAssign = (courtId?: number) => {
    try {
      // 空のコートのみを対象にする
      let courtsToAssign: number[];
      if (courtId) {
        courtsToAssign = [courtId];
      } else {
        // 全コートから未配置のコートのみを抽出
        courtsToAssign = courts
          .filter(c => !c.teamA[0] || c.teamA[0] === '')
          .map(c => c.id);
      }

      // 待機中のプレイヤーのみを使用（コート内のプレイヤーを除外）
      const waitingPlayers = players.filter(
        (p) => !p.isResting && !playersInCourts.has(p.id)
      );

      const assignments = assignCourts(
        waitingPlayers,
        courtsToAssign.length,
        matchHistory,
        {
          totalCourtCount: courts.length,
          targetCourtIds: courtsToAssign,
          practiceStartTime: session?.config.practiceStartTime,
        }
      );

      courtsToAssign.forEach((id, index) => {
        const assignment = assignments[index];
        if (assignment) {
          updateCourt(id, {
            teamA: assignment.teamA,
            teamB: assignment.teamB,
            scoreA: 0,
            scoreB: 0,
            isPlaying: false,
            startedAt: null,
            finishedAt: null,
          });
        }
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'プレイヤーの配置に失敗しました'
      );
    }
  };

  const handleStartGame = (courtId: number) => {
    startGame(courtId);
  };

  const handleFinishGame = (courtId: number) => {
    const court = courts.find((c) => c.id === courtId);
    if (!court) return;

    finishGame(courtId, court.scoreA, court.scoreB);

    // プレイヤーの統計を更新
    [...court.teamA, ...court.teamB].forEach((playerId) => {
      const player = players.find((p) => p.id === playerId);
      if (player) {
        updatePlayer(playerId, {
          gamesPlayed: player.gamesPlayed + 1,
          lastPlayedAt: Date.now(),
        });
      }
    });

    // 元々休憩中だったプレイヤーを休憩に戻す
    if (court.restingPlayerIds && court.restingPlayerIds.length > 0) {
      court.restingPlayerIds.forEach((playerId) => {
        updatePlayer(playerId, { isResting: true });
      });
    }

    // コートをクリア（プレイヤーを待機に戻す）
    updateCourt(courtId, {
      teamA: ['', ''],
      teamB: ['', ''],
      scoreA: 0,
      scoreB: 0,
      isPlaying: false,
      startedAt: null,
      finishedAt: null,
      restingPlayerIds: [],
    });
  };

  const getPlayerName = (playerId: string) => {
    return players.find((p) => p.id === playerId)?.name || '未設定';
  };

  // コート内のプレイヤーIDを取得（空文字列を除外）
  const playersInCourts = new Set(
    courts.flatMap((c) => [...c.teamA, ...c.teamB]).filter((id) => id && id.trim())
  );

  // 待機中のプレイヤー（コート外 & 休憩中でない）
  const activePlayers = players
    .filter((p) => !p.isResting && !playersInCourts.has(p.id))
    .sort((a, b) => a.gamesPlayed - b.gamesPlayed); // 試合数昇順ソート
  const restingPlayers = players.filter((p) => p.isResting);

  // スコア未入力の試合（0-0の試合）を最大2件
  const unfinishedMatches = [...matchHistory]
    .reverse()
    .filter((m) => m.scoreA === 0 && m.scoreB === 0)
    .slice(0, 2);

  // 空のコート数
  const emptyCourts = courts.filter(c => !c.teamA[0] || c.teamA[0] === '');
  const canAutoAssign = emptyCourts.length > 0 && activePlayers.length >= 4;

  const handleSwapPlayer = (courtId: number, position: number, newPlayerId: string) => {
    const court = courts.find((c) => c.id === courtId);
    if (!court) return;

    // 新しい配置を作成
    const newTeamA = [...court.teamA];
    const newTeamB = [...court.teamB];

    if (position < 2) {
      newTeamA[position] = newPlayerId;
    } else {
      newTeamB[position - 2] = newPlayerId;
    }

    // コートに入るプレイヤーが休憩中だった場合、記録しておく
    const newPlayer = players.find((p) => p.id === newPlayerId);
    const restingPlayerIds = [...(court.restingPlayerIds || [])];
    if (newPlayer?.isResting && !restingPlayerIds.includes(newPlayerId)) {
      restingPlayerIds.push(newPlayerId);
    }

    updateCourt(courtId, {
      teamA: [newTeamA[0], newTeamA[1]],
      teamB: [newTeamB[0], newTeamB[1]],
      restingPlayerIds,
    });

    // コートに入るプレイヤーの休憩フラグを解除
    if (newPlayer?.isResting) {
      updatePlayer(newPlayerId, { isResting: false });
    }
  };

  const handlePlayerTap = (
    playerId: string,
    courtId?: number,
    position?: number
  ) => {
    if (!selectedPlayer) {
      // 1回目のタップ：プレイヤーを選択
      setSelectedPlayer({ id: playerId, courtId, position });
    } else if (selectedPlayer.id === playerId) {
      // 同じプレイヤーをタップ：選択解除（念のため残す）
      setSelectedPlayer(null);
    } else {
      // 2回目のタップ：交換実行
      if (
        selectedPlayer.courtId !== undefined &&
        selectedPlayer.position !== undefined &&
        courtId !== undefined &&
        position !== undefined
      ) {
        // コート内 ↔ コート内
        if (selectedPlayer.courtId === courtId) {
          // 同じコート内での交換
          const court = courts.find((c) => c.id === courtId);
          if (court) {
            const allPlayers = [...court.teamA, ...court.teamB];
            // 交換
            const temp = allPlayers[selectedPlayer.position];
            allPlayers[selectedPlayer.position] = allPlayers[position];
            allPlayers[position] = temp;

            updateCourt(courtId, {
              teamA: [allPlayers[0], allPlayers[1]],
              teamB: [allPlayers[2], allPlayers[3]],
            });
          }
        } else {
          // 異なるコート間での交換
          const court1 = courts.find((c) => c.id === selectedPlayer.courtId);
          const court2 = courts.find((c) => c.id === courtId);
          if (court1 && court2) {
            const allPlayers1 = [...court1.teamA, ...court1.teamB];
            const allPlayers2 = [...court2.teamA, ...court2.teamB];

            const temp = allPlayers1[selectedPlayer.position];
            allPlayers1[selectedPlayer.position] = allPlayers2[position];
            allPlayers2[position] = temp;

            updateCourt(selectedPlayer.courtId!, {
              teamA: [allPlayers1[0], allPlayers1[1]],
              teamB: [allPlayers1[2], allPlayers1[3]],
            });
            updateCourt(courtId, {
              teamA: [allPlayers2[0], allPlayers2[1]],
              teamB: [allPlayers2[2], allPlayers2[3]],
            });
          }
        }
      } else if (
        selectedPlayer.courtId !== undefined &&
        selectedPlayer.position !== undefined
      ) {
        // コート内 ↔ 待機者
        handleSwapPlayer(
          selectedPlayer.courtId,
          selectedPlayer.position,
          playerId
        );
      } else if (courtId !== undefined && position !== undefined) {
        // 待機者 ↔ コート内
        handleSwapPlayer(courtId, position, selectedPlayer.id);
      }
      setSelectedPlayer(null);
    }
  };

  return (
    <div className="bg-app pb-20">
      {/* ヘッダー */}
      <div className="header-gradient text-white p-4 shadow-lg">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="text-lg font-bold flex items-center gap-2">
            <span className="text-xl">🏸</span>
            練習管理
          </h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleAutoAssign()}
              disabled={!canAutoAssign}
              className="px-4 py-2.5 bg-white/20 backdrop-blur-sm text-white rounded-full hover:bg-white/30 active:bg-white/40 active:scale-[0.98] transition-all duration-150 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] border border-white/20"
            >
              <Users size={18} />
              一括配置
            </button>
            <button
              onClick={() => navigate('/history')}
              aria-label="履歴"
              className="icon-btn bg-white/20 hover:bg-white/30 text-white border border-white/20"
            >
              <History size={20} />
            </button>
            <button
              onClick={() => navigate('/settings')}
              aria-label="設定"
              className="icon-btn bg-white/20 hover:bg-white/30 text-white border border-white/20"
            >
              <Settings size={20} />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-5 space-y-6">
        {/* メンバー交換の説明 */}
        {selectedPlayer && (
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-xl p-4 text-sm text-blue-700 flex items-center justify-between shadow-sm">
            <span>
              <strong className="font-semibold">{players.find(p => p.id === selectedPlayer.id)?.name}</strong> を選択中 — 交換したいプレイヤーをタップ
            </span>
            <button
              onClick={() => setSelectedPlayer(null)}
              className="p-2 hover:bg-blue-100 rounded-full transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        )}

        {/* コート一覧 */}
        <div className="flex gap-4 overflow-x-auto pb-2">
          {courts.map((court) => (
            <CourtCard
              key={court.id}
              court={court}
              getPlayerName={getPlayerName}
              onStartGame={() => handleStartGame(court.id)}
              onFinishGame={() => handleFinishGame(court.id)}
              onAutoAssign={() => handleAutoAssign(court.id)}
              onClear={() => handleClearCourt(court.id)}
              onPlayerTap={(playerId, position) =>
                handlePlayerTap(playerId, court.id, position)
              }
              selectedPlayerId={selectedPlayer?.id}
              onClearSelection={() => setSelectedPlayer(null)}
              canAutoAssign={canAutoAssign}
            />
          ))}
        </div>

        {/* スコア未入力の試合 */}
        {unfinishedMatches.length > 0 && (
          <div className="card p-5">
            <h3 className="section-title mb-4 flex items-center gap-2">
              <span className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
              スコア未入力の試合
            </h3>
            <div className="space-y-2">
              {unfinishedMatches.map((match) => {
                const teamANames = match.teamA.map(getPlayerName).join(' ');
                const teamBNames = match.teamB.map(getPlayerName).join(' ');
                const matchNumber = matchHistory.findIndex((m) => m.id === match.id) + 1;
                return (
                  <div
                    key={match.id}
                    className="flex items-center justify-between gap-3 p-3 bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl text-sm border border-amber-100"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="font-bold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full text-xs">
                        #{matchNumber}
                      </span>
                      <span className="text-gray-700 truncate">{teamANames}</span>
                      <span className="text-gray-400 font-medium">vs</span>
                      <span className="text-gray-700 truncate">{teamBNames}</span>
                    </div>
                    <button
                      onClick={() => navigate(`/score/${match.id}`, { state: { from: '/main' } })}
                      className="btn-primary px-4 py-2 text-sm flex-shrink-0"
                    >
                      スコア入力
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* プレイヤーリスト */}
        <div className="card p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="section-title">
              参加者一覧
              <span className="ml-2 text-sm font-normal text-gray-500">
                ({players.length}人)
              </span>
            </h3>
            <span className="badge badge-waiting">
              待機中 {activePlayers.length}人
            </span>
          </div>
          <div className="space-y-4">
            <div>
              <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
                {activePlayers.map((player) => {
                  const isSelected = selectedPlayer?.id === player.id;
                  return (
                    <div
                      key={player.id}
                      onClick={() => handlePlayerTap(player.id)}
                      className={`player-pill cursor-pointer ${
                        isSelected ? 'player-pill-selected' : ''
                      }`}
                    >
                      <span className="text-gray-800 text-sm truncate">
                        {player.name}
                        <span className="text-xs text-gray-400 ml-1.5 font-medium">
                          ({player.gamesPlayed})
                        </span>
                      </span>
                      {isSelected ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedPlayer(null);
                          }}
                          aria-label="選択解除"
                          className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center text-red-500 hover:bg-red-50 active:bg-red-100 rounded-full flex-shrink-0 transition-all duration-150"
                        >
                          <X size={18} />
                        </button>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleRest(player.id);
                          }}
                          aria-label="休憩"
                          className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center text-gray-400 hover:text-orange-500 hover:bg-orange-50 active:bg-orange-100 rounded-full flex-shrink-0 transition-all duration-150"
                        >
                          <Coffee size={18} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* メンバー追加 */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newPlayerName}
                onChange={(e) => setNewPlayerName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newPlayerName.trim()) {
                    addPlayers([{ name: newPlayerName.trim() }]);
                    setNewPlayerName('');
                  }
                }}
                placeholder="メンバー名を入力"
                className="input-field flex-1"
              />
              <button
                onClick={() => {
                  if (newPlayerName.trim()) {
                    addPlayers([{ name: newPlayerName.trim() }]);
                    setNewPlayerName('');
                  }
                }}
                disabled={!newPlayerName.trim()}
                aria-label="追加"
                className="btn-accent p-3 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
              >
                <Plus size={20} />
              </button>
            </div>

            {/* 休憩中 */}
            {restingPlayers.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-orange-500 mb-2 flex items-center gap-1.5">
                  <Coffee size={14} />
                  休憩中 ({restingPlayers.length}人)
                </h4>
                <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
                  {restingPlayers.map((player) => {
                    const isSelected = selectedPlayer?.id === player.id;
                    return (
                      <div
                        key={player.id}
                        onClick={() => handlePlayerTap(player.id)}
                        className={`player-pill cursor-pointer ${
                          isSelected
                            ? 'player-pill-selected'
                            : 'bg-orange-50 border-orange-200'
                        }`}
                      >
                        <span className="text-gray-700 text-sm truncate">{player.name}</span>
                        {isSelected ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedPlayer(null);
                            }}
                            aria-label="選択解除"
                            className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center text-red-500 hover:bg-red-50 active:bg-red-100 rounded-full flex-shrink-0 transition-all duration-150"
                          >
                            <X size={18} />
                          </button>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleRest(player.id);
                            }}
                            aria-label="復帰"
                            className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center text-gray-400 hover:text-blue-500 hover:bg-blue-50 active:bg-blue-100 rounded-full flex-shrink-0 transition-all duration-150"
                          >
                            <ArrowUp size={18} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Toast notifications */}
      {toast.toasts.map((t) => (
        <Toast
          key={t.id}
          message={t.message}
          type={t.type}
          onClose={() => toast.hideToast(t.id)}
        />
      ))}
    </div>
  );
}
