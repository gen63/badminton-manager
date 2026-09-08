import { QRCodeSVG } from 'qrcode.react';

interface SessionQrCodeProps {
  /** QR にエンコードするセッション参加 URL（`buildSessionUrl` の戻り値） */
  url: string;
  /** 一辺のピクセル数。既定 192px（スマホ画面で 30cm 程度離れても読める大きさ） */
  size?: number;
}

/**
 * セッション参加 URL の QR コード。
 *
 * 体育館でその場にいる人へ URL を渡すには、送るより画面を見せる方が速いため
 * 設定画面の「セッションURL」カードに常時表示する。設計判断は
 * `docs/plans/2026-09-08-settings-session-qr.md` を参照。
 *
 * 色はテーマ変数を使わず白背景・黒モジュールをハードコードする。QR はコントラストと
 * クワイエットゾーン（外周の余白）が読み取り成否を決めるため、地色の変更を許さない。
 */
export function SessionQrCode({ url, size = 192 }: SessionQrCodeProps) {
  return (
    <div className="flex justify-center">
      <div className="bg-white rounded-xl p-3 border border-gray-200">
        <QRCodeSVG
          value={url}
          size={size}
          // 誤り訂正 M。URL は 50 文字程度の ASCII なのでバージョンは小さく収まる。
          // H にするとモジュールが細かくなり、かえって読み取りにくい。
          level="M"
          bgColor="#ffffff"
          fgColor="#000000"
          // 仕様上のクワイエットゾーン（4モジュール推奨）。外側の padding と合わせて確保する。
          marginSize={2}
          role="img"
          aria-label="セッション参加用QRコード"
          data-testid="session-qr-code"
        />
      </div>
    </div>
  );
}
