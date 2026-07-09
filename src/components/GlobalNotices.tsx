import { useNoticeStore } from '../stores/noticeStore';
import { Toast } from './Toast';

/** noticeStore のグローバルトーストを表示する（App 直下にマウント） */
export function GlobalNotices() {
  const notices = useNoticeStore((s) => s.notices);
  const hide = useNoticeStore((s) => s.hide);

  return (
    <>
      {notices.map((n) => (
        <Toast
          key={n.id}
          message={n.message}
          type={n.type}
          duration={n.duration}
          onClose={() => hide(n.id)}
        />
      ))}
    </>
  );
}
