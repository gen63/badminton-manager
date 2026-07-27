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
