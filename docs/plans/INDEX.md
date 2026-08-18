# docs/plans 索引

過去の設計・修正 plan の一覧。目的に近いものを本ファイルで探し、**該当ファイルだけ**を
開く（全件通読はしない）。新規 plan 追加時はこの索引にも1行追記する。


## 2026-02

- `2026-02-08-fix-match-count-delete.md` — 試合履歴削除時の試合回数デクリメント
- `2026-02-09-adjust-history-layout.md` — スコア入力画面のレイアウト調整
- `2026-02-09-continuous-match-mode.md` — 連続試合モード
- `2026-02-09-fix-spreadsheet-gender-bug.md` — スプレッドシート読み込み時の性別が全て「女」になる不具合修正
- `2026-02-09-gender-matching-logic.md` — 性別を考慮した配置ロジック改善
- `2026-02-09-match-focused-mode.md` — 試合回数重視モードの追加
- `2026-02-10-court-assignment-fixed.md` — コート配置の固定化 (upper→C1, middle→C2, lower→C3)
- `2026-02-10-undo-match-end.md` — 試合終了の取り消し機能（Undo Match End）
- `2026-02-12-session-start-improvements.md` — セッション開始画面の改善
- `2026-02-23-fix-female-player-balance.md` — 女性プレイヤーのバランス改善
- `2026-02-sync-fix-plan.md` — Firebase同期 修正プラン
- `2026-02-sync-review-complete.md` — Firebase同期 徹底レビュー完了
- `2026-02-sync-review-round3.md` — Firebase同期 第3弾レビュー完了

## 2026-03

- `2026-03-06-assignment-timing-priority.md` — 連続モードOFF時の配置優先モード設定
- `2026-03-06-auto-adjust-courts.md` — 自動コート数調整
- `2026-03-06-header-to-bottom-nav.md` — ヘッダー項目をボトムナビゲーションに移動
- `2026-03-06-management-tabs.md` — タブバー4タブ化 + 設定をヘッダーへ移動
- `2026-03-06-reservation-feature.md` — 予約機能（Reservation Feature）
- `2026-03-07-block-second-court-on-low-flow.md` — 流動優先時のコート配置ブロック強化
- `2026-03-07-fix-continuous-mode-threshold.md` — 流動優先モード時の連続モードブロック閾値修正
- `2026-03-07-prioritize-rotation-fix.md` — 流動優先モード: ブロック条件改善 & 連続モード競合修正
- `2026-03-07-remove-court-selection.md` — コート数選択UIの削除
- `2026-03-10-singles-mode.md` — シングルスモードの追加
- `2026-03-10-update-documentation.md` — ドキュメント全般更新プラン
- `2026-03-15-accounting-member-input.md` — 会計の合計金額算出：メンバー入力金額ベースへの改善
- `2026-03-15-accounting-shuttle-exempt-sync.md` — 会計画面ブラッシュアップ: シャトル使用可能数 & 免除同期
- `2026-03-15-edit-participant-details.md` — 参加者の名前・性別編集機能
- `2026-03-15-idempotent-finish-game.md` — べき等な試合終了 + 連続モード配置
- `2026-03-16-fix-layout-shift.md` — レイアウトシフト(CLS)見直し — 幅安定化
- `2026-03-25-fix-accounting-session-save.md` — 会計画面の練習種別がセッションに保存されないバグの修正
- `2026-03-26-fix-accounting-additional-bugs.md` — 会計画面の追加バグ修正
- `2026-03-27-fix-concurrent-rollback.md` — 同時操作による巻き戻り修正 + 勝敗記録モード共有
- `2026-03-29-fix-concurrent-sync-rollback.md` — 複数人同時操作の巻き戻り修正

## 2026-04

- `2026-04-01-fix-pwa-difficulty-reset.md` — PWAタスクキル後に練習種別が「楽」→「複」にリセットされる問題の修正
- `2026-04-08-auto-session.md` — E-tomoスクレイピング → セッション自動作成
- `2026-04-12-editable-income-headcount.md` — 収入欄の人数を手入力可能にする + その他金額にマイナス入力対応
- `2026-04-13-fix-sync-across-pages.md` — 会費入力・名簿入力の同期が他デバイスに反映されない問題の修正
- `2026-04-14-collapse-paid-participants.md` — タスク完了済み参加者の折りたたみ機能
- `2026-04-16-hidden-session-delete.md` — 隠し機能：dev URL経由でのセッション削除
- `2026-04-16-improve-booking-selection.md` — 予約機能改善：カテゴリ推測 + 最低2人制限 + 同性優先補充
- `2026-04-16-session-selection-screen.md` — セッション選択画面の追加
- `2026-04-17-dev-mode-creator-and-ttl.md` — 開発モードにセッション作成者権限を付与 + セッション有効期限の延長
- `2026-04-17-session-auto-archive.md` — セッション自動アーカイブ（12時間フィルタ）
- `2026-04-17-session-card-enhancements.md` — セッション選択画面の改善：試合数・種別表示、ソート順変更、古セッション除外の修正
- `2026-04-18-dev-mode-change-creator.md` — dev モードで作成者を変更可能に + bot セッション初回入室時の作成者自動委譲
- `2026-04-19-match-result-winner-only.md` — 試合終了直後のインターフェースを勝敗のみに
- `2026-04-20-fix-singles-mode-not-applied.md` — 単モード（シングルス）が配置アルゴリズムに反映されないバグ修正
- `2026-04-20-match-result-winner-only-dummy-score.md` — 試合終了直後のインターフェースを勝敗のみに（100-99 ダミースコア版）
- `2026-04-21-presence-indicator.md` — プレゼンス表示による二重操作抑止
- `2026-04-22-match-upload-dedup.md` — 試合アップロードの重複排除
- `2026-04-22-unify-practice-date.md` — `practiceDate` 廃止 — 日付フィールドを `practiceStartTime` に一本化
- `2026-04-23-bug-report-feature.md` — バグ報告機能の追加 — Discord Webhook 送信
- `2026-04-23-fix-accounting-session-storage.md` — 会計入力のセッション保存（Firebase 同期）
- `2026-04-25-filter-my-matches.md` — 試合履歴ページ「自分の試合のみ」フィルタ機能
- `2026-04-25-restrict-user-permissions.md` — 一般ユーザの操作権限を狭める
- `2026-04-25-sort-history-pair-by-strength.md` — 履歴ページのペア内名前を強い順に並べ替え
- `2026-04-26-fix-match-reset-bug.md` — 開始した試合が巻き戻る不具合の修正
- `2026-04-27-fix-practice-type-pricing.md` — 支払い登録のデフォルト料金が練習種別を反映しない不具合の修正
- `2026-04-29-fix-multiple-sessions.md` — セッション切替時のローカル再同期 + 旧セッション自動退出

## 2026-05

- `2026-05-02-fix-court-sync-rollback.md` — 他メンバー同期で配置済みコートが巻き戻る不具合の修正
- `2026-05-02-fix-match-count-zero.md` — 同一セッション再入室時に matchHistory がワイプされる不具合の修正
- `2026-05-02-fix-sync-duplicates.md` — 同期によるメンバー重複・操作巻き戻り の修正
- `2026-05-03-firestore-as-source-of-truth.md` — Firestore を真実のソースに一本化（A+B リファクタ）
- `2026-05-03-fix-doubles-practice-mode.md` — 練習種別「楽」で配置タイミングUIがシングル扱いになる不具合の修正
- `2026-05-03-fix-participant-rollback.md` — 参加者管理情報の巻き戻り（field-level 3-way マージ拡張）
- `2026-05-06-fix-doubles-player-display.md` — ダブルス練習でコートに 2 人しか配置されない不具合の修正
- `2026-05-06-fix-rename-participants-sync.md` — メンバー名変更後に「未参加」表示になる不具合の修正
- `2026-05-06-local-storage-minimization.md` — ローカルストレージ最小化 (Phase B / Phase C)
- `2026-05-06-settings-persist-narrowing.md` — settingsStore の persist 対象を端末ローカル設定だけに絞る (Phase A)
- `2026-05-07-remove-session-id-join.md` — セッションIDから参加の導線削除
- `2026-05-07-remove-url-qr-sharing.md` — 各セッションの URL / QR 共有 UI 撤去
- `2026-05-07-restrict-break-changes.md` — 休憩変更を「管理者 or 自分のみ」に制限
- `2026-05-08-continuous-toggle-off-always-allowed.md` — 連続モードトグルの「OFF操作も不能」問題を修正
- `2026-05-08-cooperation-discount-in-totals.md` — 運営協力割引を会計合計に反映する
- `2026-05-08-remove-end-button-record-dialog.md` — 終了直後の勝者選択モーダル撤去
- `2026-05-08-remove-sheets-get-fetch.md` — Sheets メンバー GET フェッチ撤去
- `2026-05-10-fix-session-timeout-recovery.md` — セッションタイムアウト後の真っ白画面復帰
- `2026-05-16-score-input-winner-on-left.md` — スコア入力画面で勝者を左に表示
- `2026-05-17-iphone-session-select-layout.md` — iPhone レイアウト微調整 + 未定義 CSS クラスの全削除
- `2026-05-18-improve-singles-pairing.md` — シングルスモード配置アルゴリズムの改善
- `2026-05-18-recordscores-off-behavior.md` — 勝敗記録モードOFF時の挙動整理
- `2026-05-19-balance-match-participation.md` — 練習後半の試合回数均等化モード
- `2026-05-19-diversity-announcement-fix.md` — 多様性アナウンスの表示条件修正
- `2026-05-19-hidden-admin-role.md` — 裏管理ロール（観覧専用）
- `2026-05-19-hide-sessions-until-90min-before-start.md` — セッション一覧: 開始90分前まで非表示
- `2026-05-19-short-match-warning.md` — 短時間試合の警告マーク表示
- `2026-05-20-normalize-raku-note.md` — 「楽基礎」など `楽` で始まる note を `楽` として認識させる
- `2026-05-20-phase4-cleanup.md` — Phase 4 クリーンアップ: ローカルモード残骸の削除
- `2026-05-20-remove-playerselect-setup-mode.md` — PlayerSelect Setup Mode 廃止 + セッション切断時の即時遷移
- `2026-05-25-reservation-block-by-games-played.md` — 予約と休憩の連動・試合数による予約制限
- `2026-05-30-quick-finish-confirmation.md` — 1分以内の試合終了に確認ダイアログ
- `2026-05-30-reservation-break-visibility.md` — 予約中メンバーの休憩エリア表示改善

## 2026-06

- `2026-06-01-singles-priority-reorder.md` — シングルス自動配置の優先度入れ替え（回数公平 > 総当たり）
- `2026-06-02-match-auto-end-15min.md` — 15分超過試合の自動終了
- `2026-06-07-continuous-mode-keep-on-during-diversity-block.md` — 連続モードを diversity_block で自動 OFF にしない

## 2026-07

- `2026-07-02-reservation-aware-capacity.md` — 予約中メンバーを考慮した配置可能人数の判定（2コート10人+4人予約対応）
- `2026-07-08-auto-session-admin-perms.md` — オートセッション作成時の固定管理者付与
- `2026-07-08-rest-return-after-tap-swap.md` — タップ交換で出場した休憩者の試合後復帰先の修正
- `2026-07-08-session-upload-status.md` — セッション一覧にアップロード済ステータスを表示（開発モード限定）
- `2026-07-09-code-cleanup.md` — コードクリーンアップ（不要コード削除・ブラッシュアップ）
- `2026-07-09-default-announcement.md` — デフォルト周知事項（デフォルトアナウンス）機能
- `2026-07-09-fix-accounting-remote-sync.md` — 会計入力の修正がプレビュー/アップロードに反映されない問題の修正
- `2026-07-09-fix-payment-amount-correction.md` — 支払い金額の修正フローの改善（誤って未登録に戻る不具合の修正）
- `2026-07-09-unpaid-auto-rest.md` — 会費・名簿未対応メンバー / 結果未登録試合の強制休憩 + 全員通知
- `2026-07-10-overpayment-donation.md` — 過払い分を「寄付」として会計に反映
- `2026-07-12-fix-continuous-mode-missing-setting.md` — 連続モードが ON 表示なのに効かないバグの修正
- `2026-07-14-score-validation-relaxation.md` — スコア入力バリデーションの緩和（同点禁止のみに）
- `2026-07-14-settings-screen-cleanup.md` — 設定画面の整理（目標点数・オンラインモード表記・セッション情報の削除）
- `2026-07-15-auto-session-etomo-sync.md` — オート作成セッションの再実行時 E-ToMo 出欠同期
- `2026-07-15-payment-operator-visibility.md` — 支払い一覧に「誰が支払い操作をしたか」を表示する
- `2026-07-16-auto-session-tmp-sheet-cleanup.md` — オート作成セッションの tmp_MMDD シート自動掃除
- `2026-07-20-history-filter-expansion.md` — 試合履歴フィルタの拡充（成績サマリ + メンバー選択）
- `2026-07-20-session-selection-filters.md` — セッション選択画面へのフィルタ追加
- `2026-07-20-unpaid-forced-rest-every-match.md` — 未対応メンバーの「毎試合ごと」強制休憩（ボーダー超過後の再発火）
- `2026-07-21-payment-list-label-filter.md` — 支払い一覧の改善（「支払い済み」→「会計対応済み」+送金済み行 / 金額フィルタチップ / 連番）
- `2026-07-25-participant-last-seen.md` — 参加者管理ページに「最終画面参照からの経過時間」を表示（管理者以上）
- `2026-07-25-participant-sort-and-accordion.md` — 参加者管理ページのソート切替（試合数順/見ていない順）+ 全員完了時のアコーディオン自動展開
- `2026-07-27-performance-rating.md` — その日の強さ指標（パフォーマンスレート / 強さ偏差値。開発モード限定）
- `2026-07-28-skill-gap-separation.md` — 実力が離れすぎた組み合わせを避ける（ハシゴ式の移動幅制限 + 実力差ペナルティ）
- `2026-07-28-minority-gender-fairness.md` — 少数派性別が1人のときの試合数不利を解消（3-1ペナルティの無効化）
- `2026-07-28-pair-diversity.md` — ペア・対戦相手の多様性を上げる（formTeams のペア分け選択 + 重複ペナルティ）
- `2026-07-28-mix-preference.md` — 少数派性別が少ないとき MIX（2-2）の試合を増やす + ペア重複ペナルティ上限の調整
- `2026-07-29-minority-gender-followup.md` — 少数派性別の試合数差の縮小 + 2コート配置への MIX 修復の適用
- `2026-07-28-holistic-court-assignment.md` — 3コート以上の逐次貪欲配置の解消と2コート経路との統合
- `2026-07-28-deterministic-court-noise.md` — 2コート振り分けの乱数を決定的にする（再現性の確保）
- `2026-07-28-gender-parity-with-bench.md` — 3コートで人数が少ないときの 3-1 増加を抑える（待機者との入れ替え）
- `2026-07-28-two-court-skill-separation.md` — 2コート同時配置の実力分離（同時配置推奨案は不採用）
- `2026-07-29-sequential-skill-separation.md` — 2コート逐次配置（片方のコートずつ）の実力分離。バンド幅を人数で可変にして試合数幅の悪化を+0.3未満に抑制
- `2026-07-29-adaptive-skill-ranking.md` — 実力差判定に実測レート（Bradley-Terry）を混ぜる案（不採用）。Kを振っても序列が正確な場合の悪化と勝敗からの改善が両立せずrevert
- `2026-07-29-ladder-drift-limit.md` — ハシゴ式の `maxDrift`（序列からの移動幅）制限を緩める案（不採用）。真の実力基準（`truth.ts`）で計測し直しても、序列ノイズの有無に関わらず緩めるほど3コートの分離が悪化。循環していたのは計測方法のみで、元の制限の結論は正しかった
- `2026-07-29-rating-vocabulary.md` — 自動セッション作成の序列反転バグの再発防止: 外部境界（GAS ↔ アプリ）のフィールド名を `ordering` → `skill`/レーティングに改名 + 新旧キー後方互換
- `2026-07-29-history-member-highlight.md` — 履歴画面で絞り込み中のメンバー名を試合カード内で強調（indigo 太字）
- `2026-08-04-skill-band-guard-and-diversity.md` — 3コートで素の序列の上位×下位同居ガード（`hasTopBottomExtremes`）が2コート限定で効いておらず、ハシゴ式で上がった下位者が上位帯に混ざる問題の修正 + 帯内の多様性強化。実アルゴリズムを叩く bench をリポジトリに常設
- `2026-08-11-stay-start-at-ops-complete.md` — 滞在時間優先モードの滞在開始時刻を「休憩解除(activatedAt)」から「名簿＋会費の両方完了時刻(`opsCompletedAt`)」へ変更。未完了メンバーは滞在時間ゼロ扱い
- `2026-08-11-auto-session-retry.md` — オートセッション自動作成が時々失敗する問題の対策: E-ToMo/GAS/Discord への fetch を指数バックオフでリトライ + 失敗時の Discord 通知。併せて詳細取得失敗を「参加者0名」と誤認して空セッション作成・登録メンバー全員削除を起こす経路を封じる
- `2026-08-11-stay-duration-mode-not-applied.md` — 待機時間優先モードが実質効いていない問題の修正: (1) 連続配置経路 (`computeFinishAndContinue`) に `practiceStartTime` が渡っておらず全員の滞在時間が下限5分に潰れてモードが no-op 化していたバグ、(2) `useStayDurationPriority` を端末ローカル persist から Firestore 同期設定へ移行
- `2026-08-12-history-name-overflow.md` — 試合履歴カードの名前見切れ解消: チームの左右並びをやめて上下2段にし、`truncate` を廃止（折り返しは名前の区切り優先）
- `2026-08-13-auto-start-after-assign.md` — 配置後3分での試合自動開始（開始押し忘れ対策）。開始時刻は配置時刻を採用し、`Court.assignedAt` をべき等キーにする
- `2026-08-13-next-match-prediction.md` — 次の試合に入るメンバーの予測表示: 配置アルゴリズムを空打ちして「どのコートが終わってもほぼ確定」/「候補」の2段階を待機中セクションに表示。実測で確定4人は原理的に出せない（3コートで平均2人）ことを確認し出現率ランク方式を採用
- `2026-08-13-auto-session-rating-sync.md` — 自動セッション再実行で tmp シートの skill を既存プレイヤーの rating へ反映（試合開始後は据え置き）+ レート未設定は作成・追加をブロックせず通知のみ（FORCE_CREATE 廃止）。17:30 JST の定期実行（TARGET_DATE=nearest）を追加
- `2026-08-13-in-progress-games-in-fairness.md` — 配置済みコートに乗っているメンバーを `gamesPlayed + 1` として公平性の母集団（後半均等化の最大値・予約保留の中央値）に数える。保存値と表示は据え置きで導出値のみ変更するため減算・ロールバック不要
- `2026-08-13-next-match-call-notification.md` — 試合開始通知（事後）を廃止し、配置予測の「ほぼ確定」メンバーへ試合経過4分30秒での事前呼び出し通知に置き換え。閾値は目白実測（試合時間5〜9分・σ≒1分）に基づく
- `2026-08-13-session-list-median-games.md` — セッション一覧カードに1人あたり試合数の中央値を表示（開発モード限定）。母集団は `gamesPlayed > 0` のみ（アルゴリズムの予約保留判定の中央値とは母集団が別なので統一しない）。2行目メモの先頭に固定幅チップとして置き、`median()` を `src/lib/median.ts` へ抽出して algorithm.ts の重複2箇所も差し替え
- `2026-08-13-force-bulk-assignment.md` — 「配置タイミング＝多様性優先」がバナー表示だけで実効性ゼロだった問題の解消。`prioritizeDiversity` → `forceBulkAssignment`（UI「一括配置強制」ON/OFF・デフォルトON・Firestore 同期化）に改め、`free`/`waiting`/`bulkOnly` の3状態でボタン自体を制御する。解除条件は「プレイ中0面」ではなく**空き2面**（3コート13人の2面終了時にプール9人で一括できる）。効くのは余り≤2人のときだけ
- `2026-08-14-session-filter-recent-months-and-aggregate-median.md` — セッション選択の月フィルタに「直近60日」を追加しデフォルト選択化（月軸は常時描画・絞り込み適用も devMode 限定に）。併せてフィルタ結果のサマリ「N開催・中央 X（実績 M開催）」を追加。中央値は開催を1データ点とした中央値の中央値で、試合数ゼロの開催は母集団から除外
- `2026-08-14-match-call-vibration-sound.md` — 事前呼び出し通知に音（WebAudio のビープ2音）と振動を追加。ヘッダーのベルトグルで全メンバーが ON/OFF でき（設定画面は非管理者に見えないため）、タップが AudioContext の unlock を兼ねる。併せて Android Chrome で `new Notification()` が throw して通知もトーストも出ていなかったバグを `ServiceWorkerRegistration.showNotification()` 化で修正。iOS の消音スイッチは尊重し、Web Push によるバックグラウンド通知はスコープ外
- `2026-08-14-match-call-speech.md` — 呼び出し通知をトーストと同内容で音声読み上げ（Web Speech API）。登録名はカナ中心のためよみがなフィールドは追加せず、記号のみ読み上げ前に除去する。チャイム→読み上げの順で鳴らし、設定は既存のベル（`matchCallAlert`）に相乗り。iOS の初回ユーザー操作要件は既存の unlock ハンドラでプライミング
- `2026-08-14-single-court-message.md` — 呼び出し通知（body/toast/speech）の「Nコート付近で」を1面運用時のみ省略。`buildNextMatchCallMessage` の第1引数を `number | null` にし、番号を出すかの判断は呼び出し側（`MainPage`）が `courts.length <= 1` で決める。`basisCourtId === null`（基準コート不特定）とは別物として扱い、ベルのテスト再生も同じ判定を通す
- `2026-08-15-admin-match-call-announce.md` — 本人向け呼び出し（4:30）の30秒後（5:00）に、管理者へ「誰がもうすぐ試合か」をトースト＋読み上げでアナウンスし、動いていない人への声かけを促す。自分が対象のとき・対象が全員コート上のときは鳴らさない。重複防止は経過最大コートの `id:startedAt` キー（boolean フラグだと2面運用でリセットされない）。設定は端末ローカルで設定画面に管理者バッジ付きで配置
- `2026-08-15-auto-session-sync-no-removal-after-start.md` — オートセッション再実行時の出欠同期で、セッション開始後（`hasSessionStarted`＝試合履歴あり or コートに配置済み）はメンバーを削除しない。ニックネーム表記揺れで手動追加した人や試合結果を持つ人を消してしまう事故を防ぐ。追加は従来どおり反映し、見送った削除は Discord に理由付きで通知
- `2026-08-15-history-orphan-player-repair.md` — 履歴画面の「未設定」（同期事故で消されたメンバーの ID）をタップして現在の名簿の本人へ割り当て直す修復機能。作成者/開発モード限定、対象は orphan ID のみ（空きスロットと正しい記録は触れない）で、既定は「その人の全試合」をまとめて修復。`gamesPlayed` は履歴から再計算。復旧スクリプトは廃止しアプリ内に一本化
- `2026-08-18-court-time-emphasis.md` — 試合経過4分30秒でコートカードの外枠を太く（オレンジ）、6分で赤枠＋点滅にして長引いているコートを一目で分かるようにする。判定は純粋関数 `courtEmphasis.ts`、枠は `CourtCardFrame` に切り出し、毎秒 tick せず次の閾値までの `setTimeout` 1本で更新。`prefers-reduced-motion` では点滅せず赤い太枠のまま
