import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore } from '../stores/playerStore';
import { useGameStore } from '../stores/gameStore';
import { useSessionStore } from '../stores/sessionStore';
import { assignCourts } from '../lib/algorithm';
import { Settings, History, Coffee, Users, ArrowUp, Plus } from 'lucide-react';
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
        matchHistory
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

    // コートをクリア（プレイヤーを待機に戻す）
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

  // スコア未入力の試合（0-0の試合）を最大5件
  const unfinishedMatches = [...matchHistory]
    .reverse()
    .filter((m) => m.scoreA === 0 && m.scoreB === 0)
    .slice(0, 5);

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

    updateCourt(courtId, {
      teamA: [newTeamA[0], newTeamA[1]],
      teamB: [newTeamB[0], newTeamB[1]],
    });
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
    <div className="min-h-screen bg-gray-100 pb-20">
      {/* ヘッダー */}
      <div className="bg-white p-3 shadow-sm">
        <div className="max-w-6xl mx-auto flex items-center justify-end gap-2">
          <button
            onClick={() => handleAutoAssign()}
            disabled={!canAutoAssign}
            className="px-4 py-2.5 bg-blue-500 text-white rounded-full hover:bg-blue-600 active:bg-blue-700 active:scale-[0.98] transition-all duration-150 text-sm font-medium flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
          >
            <Users size={18} />
            一括配置
          </button>
          <button
            onClick={() => navigate('/history')}
            aria-label="履歴"
            className="p-3 bg-gray-100 rounded-full hover:bg-gray-200 active:bg-gray-300 active:scale-[0.98] transition-all duration-150 min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <History size={20} className="text-gray-600" />
          </button>
          <button
            onClick={() => navigate('/settings')}
            aria-label="設定"
            className="p-3 bg-gray-100 rounded-full hover:bg-gray-200 active:bg-gray-300 active:scale-[0.98] transition-all duration-150 min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <Settings size={20} className="text-gray-600" />
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-5 space-y-6">
        {/* メンバー交換の説明 */}
        {selectedPlayer && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-700">
            <strong>{players.find(p => p.id === selectedPlayer.id)?.name}</strong> を選択中 — 交換したいプレイヤーをタップ
          </div>
        )}

        {/* コート一覧 */}
        <div className="flex gap-3 overflow-x-auto">
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
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <h3 className="text-base font-semibold text-gray-700 mb-3">
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
                    className="flex items-center justify-between gap-2 p-3 bg-gray-50 rounded-xl text-sm"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="font-medium text-gray-400">
                        #{matchNumber}
                      </span>
                      <span className="text-gray-700 truncate">{teamANames}</span>
                      <span className="text-gray-400">vs</span>
                      <span className="text-gray-700 truncate">{teamBNames}</span>
                    </div>
                    <button
                      onClick={() => navigate(`/score/${match.id}`, { state: { from: '/main' } })}
                      className="px-4 py-2 bg-blue-500 text-white rounded-full text-sm font-medium hover:bg-blue-600 active:bg-blue-700 active:scale-[0.98] transition-all duration-150 flex-shrink-0 min-h-[44px]"
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
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-base font-semibold text-gray-700">
              参加者一覧 ({players.length}人)
            </h3>
            <span className="text-sm text-gray-500">
              待機中 {activePlayers.length}人
            </span>
          </div>
          <div className="space-y-3">
            <div>
              <div className="grid gap-2 grid-cols-3">
                {activePlayers.map((player) => {
                  const isSelected = selectedPlayer?.id === player.id;
                  return (
                    <div
                      key={player.id}
                      onClick={() => handlePlayerTap(player.id)}
                      className={`flex items-center justify-between p-2 rounded-full border cursor-pointer transition ${
                        isSelected
                          ? 'bg-blue-50 border-blue-400 ring-2 ring-blue-200'
                          : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <span className="text-gray-800 text-sm truncate">
                        {player.name}
                        <span className="text-xs text-gray-400 ml-1">
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
                          className="p-2 text-red-500 hover:bg-red-50 active:bg-red-100 rounded-full flex-shrink-0 ml-1 transition-all duration-150"
                        >
                          ✕
                        </button>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleRest(player.id);
                          }}
                          aria-label="休憩"
                          className="p-2 text-gray-400 hover:text-orange-500 hover:bg-orange-50 active:bg-orange-100 rounded-full flex-shrink-0 ml-1 transition-all duration-150"
                        >
                          <Coffee size={16} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* メンバー追加 */}
            <div className="flex gap-2 mt-3">
              <input
                type="text"
                value={newPlayerName}
                onChange={(e) => setNewPlayerName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newPlayerName.trim()) {
                    addPlayers([newPlayerName.trim()]);
                    setNewPlayerName('');
                  }
                }}
                placeholder="メンバー名を入力"
                className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-full text-base focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent min-h-[44px]"
              />
              <button
                onClick={() => {
                  if (newPlayerName.trim()) {
                    addPlayers([newPlayerName.trim()]);
                    setNewPlayerName('');
                  }
                }}
                disabled={!newPlayerName.trim()}
                aria-label="追加"
                className="p-3 bg-green-500 text-white rounded-full font-medium hover:bg-green-600 active:bg-green-700 active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed min-w-[44px] min-h-[44px] flex items-center justify-center"
              >
                <Plus size={20} />
              </button>
            </div>

            <div className="mt-3">
              <h4 className="text-sm text-orange-500 mb-1">
                休憩中 ({restingPlayers.length}人)
              </h4>
              {restingPlayers.length > 0 ? (
                <div className="grid gap-2 grid-cols-3">
                  {restingPlayers.map((player) => {
                    const isSelected = selectedPlayer?.id === player.id;
                    return (
                      <div
                        key={player.id}
                        onClick={() => handlePlayerTap(player.id)}
                        className={`flex items-center justify-between p-2 rounded-full border cursor-pointer transition ${
                          isSelected
                            ? 'bg-orange-50 border-orange-400 ring-2 ring-orange-200'
                            : 'bg-orange-50 border-orange-200 hover:border-orange-300'
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
                            className="p-2 text-red-500 hover:bg-red-50 active:bg-red-100 rounded-full flex-shrink-0 ml-1 transition-all duration-150"
                          >
                            ✕
                          </button>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleRest(player.id);
                            }}
                            aria-label="復帰"
                            className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 active:bg-blue-100 rounded-full flex-shrink-0 ml-1 transition-all duration-150"
                          >
                            <ArrowUp size={16} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
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
