import { firebasePublicMetadata } from './firebase';

export interface AuthErrorInfo {
  code: string;
  message: string;
  hostname?: string;
  isUnauthorizedDomain: boolean;
  isPopupBlocked: boolean;
  isUserCancelled: boolean;
  canOfferRedirect: boolean;
}

export interface DomainAuthorizationStatus {
  hostname: string;
  isAuthorized: boolean | null;
  authorizedDomains: string[];
  checked: boolean;
  projectId: string;
  authDomain: string;
}

const REDIRECT_GUARD_KEY = 'smartplate_auth_redirect_pending_at';
const REDIRECT_GUARD_TTL_MS = 2 * 60 * 1000;

export function getCurrentHostname(): string {
  if (typeof window === 'undefined' || !window.location) {
    return '';
  }
  return (window.location.hostname || '').trim();
}

export function markRedirectPending(): void {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem(REDIRECT_GUARD_KEY, String(Date.now()));
    }
  } catch {
    // Ignore restricted storage errors
  }
}

export function clearRedirectPending(): void {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(REDIRECT_GUARD_KEY);
    }
  } catch {
    // Ignore restricted storage errors
  }
}

export function hasRecentPendingRedirect(): boolean {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return false;
    const raw = window.sessionStorage.getItem(REDIRECT_GUARD_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < REDIRECT_GUARD_TTL_MS;
  } catch {
    return false;
  }
}

function extractFirebaseAuthCode(error: unknown): string {
  if (!error) return 'unknown';
  const anyErr = error as { code?: unknown; message?: unknown };
  if (typeof anyErr.code === 'string' && anyErr.code.trim()) {
    return anyErr.code.trim();
  }
  const msg = typeof anyErr.message === 'string' ? anyErr.message : String(error);
  const match = msg.match(/\((auth\/[a-z0-9-]+)\)/i) || msg.match(/(auth\/[a-z0-9-]+)/i);
  return match ? match[1].toLowerCase() : 'unknown';
}

export function handleAuthError(error: unknown): AuthErrorInfo {
  const code = extractFirebaseAuthCode(error);
  const hostname = getCurrentHostname();
  const rawMessage = error instanceof Error ? error.message : String(error || '');

  switch (code) {
    case 'auth/unauthorized-domain':
      return {
        code,
        hostname,
        isUnauthorizedDomain: true,
        isPopupBlocked: false,
        isUserCancelled: false,
        canOfferRedirect: false,
        message: hostname
          ? `Domain hiện tại (${hostname}) chưa được cấp quyền đăng nhập Firebase. Vui lòng thêm domain này vào Authorized Domains trong Firebase Console.`
          : 'Domain hiện tại chưa được cấp quyền đăng nhập Firebase. Vui lòng thêm domain vào Authorized Domains.',
      };

    case 'auth/popup-blocked':
      return {
        code,
        hostname,
        isUnauthorizedDomain: false,
        isPopupBlocked: true,
        isUserCancelled: false,
        canOfferRedirect: true,
        message: 'Trình duyệt đã chặn cửa sổ đăng nhập. Vui lòng cho phép popup hoặc thử lại bằng phương thức chuyển hướng.',
      };

    case 'auth/operation-not-supported-in-this-environment':
      return {
        code,
        hostname,
        isUnauthorizedDomain: false,
        isPopupBlocked: false,
        isUserCancelled: false,
        canOfferRedirect: true,
        message: 'Môi trường trình duyệt hiện tại không hỗ trợ cửa sổ popup. Vui lòng dùng phương thức đăng nhập chuyển hướng.',
      };

    case 'auth/popup-closed-by-user':
      return {
        code,
        hostname,
        isUnauthorizedDomain: false,
        isPopupBlocked: false,
        isUserCancelled: true,
        canOfferRedirect: false,
        message: 'Bạn đã đóng cửa sổ đăng nhập.',
      };

    case 'auth/cancelled-popup-request':
      return {
        code,
        hostname,
        isUnauthorizedDomain: false,
        isPopupBlocked: false,
        isUserCancelled: true,
        canOfferRedirect: false,
        message: 'Yêu cầu đăng nhập trước đó đã bị hủy do mở cửa sổ mới. Vui lòng thử lại.',
      };

    case 'auth/network-request-failed':
      return {
        code,
        hostname,
        isUnauthorizedDomain: false,
        isPopupBlocked: false,
        isUserCancelled: false,
        canOfferRedirect: false,
        message: 'Không thể kết nối máy chủ. Vui lòng kiểm tra Internet.',
      };

    case 'auth/user-disabled':
      return {
        code,
        hostname,
        isUnauthorizedDomain: false,
        isPopupBlocked: false,
        isUserCancelled: false,
        canOfferRedirect: false,
        message: 'Tài khoản đã bị vô hiệu hóa. Vui lòng liên hệ quản trị viên.',
      };

    case 'auth/operation-not-allowed':
      return {
        code,
        hostname,
        isUnauthorizedDomain: false,
        isPopupBlocked: false,
        isUserCancelled: false,
        canOfferRedirect: false,
        message: 'Phương thức đăng nhập này chưa được kích hoạt trong Firebase Console → Authentication → Sign-in method.',
      };

    case 'auth/invalid-email':
      return {
        code,
        hostname,
        isUnauthorizedDomain: false,
        isPopupBlocked: false,
        isUserCancelled: false,
        canOfferRedirect: false,
        message: 'Địa chỉ email không hợp lệ. Vui lòng kiểm tra lại.',
      };

    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return {
        code,
        hostname,
        isUnauthorizedDomain: false,
        isPopupBlocked: false,
        isUserCancelled: false,
        canOfferRedirect: false,
        message: 'Email hoặc mật khẩu không chính xác hoặc tài khoản chưa được đăng ký.',
      };

    case 'auth/too-many-requests':
      return {
        code,
        hostname,
        isUnauthorizedDomain: false,
        isPopupBlocked: false,
        isUserCancelled: false,
        canOfferRedirect: false,
        message: 'Bạn đã thử đăng nhập quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.',
      };

    case 'auth/account-exists-with-different-credential':
      return {
        code,
        hostname,
        isUnauthorizedDomain: false,
        isPopupBlocked: false,
        isUserCancelled: false,
        canOfferRedirect: false,
        message: 'Email này đã được liên kết với một phương thức đăng nhập khác. Vui lòng đăng nhập bằng phương thức ban đầu.',
      };

    case 'auth/web-storage-unsupported':
      return {
        code,
        hostname,
        isUnauthorizedDomain: false,
        isPopupBlocked: false,
        isUserCancelled: false,
        canOfferRedirect: false,
        message: 'Trình duyệt đang chặn bộ nhớ phiên (cookie/storage bên thứ ba). Vui lòng bật cookie hoặc mở ứng dụng ở tab mới.',
      };

    default: {
      const safeFallback =
        rawMessage.includes('PERMISSION_DENIED') || rawMessage.includes('Missing or insufficient permissions')
          ? 'Không đủ quyền truy cập hồ sơ người dùng trong Firestore. Vui lòng liên hệ quản trị viên.'
          : rawMessage.includes('EMAIL_NOT_VERIFIED')
            ? 'Email tài khoản chưa được xác minh. Vui lòng kiểm tra hộp thư để xác minh email.'
            : rawMessage && !rawMessage.toLowerCase().includes('aizasy')
              ? rawMessage
              : 'Đăng nhập không thành công. Vui lòng thử lại.';

      return {
        code,
        hostname,
        isUnauthorizedDomain: false,
        isPopupBlocked: false,
        isUserCancelled: false,
        canOfferRedirect: false,
        message: safeFallback,
      };
    }
  }
}

export function isDomainMatchedInList(hostname: string, authorizedDomains: string[]): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return false;
  return authorizedDomains.some((entry) => {
    const dom = entry.trim().toLowerCase();
    return dom === host || host.endsWith(`.${dom}`);
  });
}

export async function checkAuthorizedDomainStatus(): Promise<DomainAuthorizationStatus> {
  const hostname = getCurrentHostname();
  const base: DomainAuthorizationStatus = {
    hostname,
    isAuthorized: null,
    authorizedDomains: [],
    checked: false,
    projectId: firebasePublicMetadata.projectId,
    authDomain: firebasePublicMetadata.authDomain,
  };

  if (!hostname || !firebasePublicMetadata.apiKey) {
    return base;
  }

  try {
    const url = `https://www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig?key=${encodeURIComponent(
      firebasePublicMetadata.apiKey
    )}`;
    const resp = await fetch(url, { method: 'GET' });
    if (!resp.ok) {
      return base;
    }
    const data: { authorizedDomains?: unknown } = await resp.json();
    const list = Array.isArray(data.authorizedDomains)
      ? data.authorizedDomains.filter((d): d is string => typeof d === 'string')
      : [];

    return {
      ...base,
      authorizedDomains: list,
      isAuthorized: isDomainMatchedInList(hostname, list),
      checked: true,
    };
  } catch {
    return base;
  }
}
