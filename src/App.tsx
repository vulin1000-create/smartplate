import React, { useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  Lock,
  LogOut,
  Mail,
  RefreshCw,
} from 'lucide-react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { BrandLogo } from './components/BrandLogo';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PrivacyConsentModal } from './components/PrivacyConsentModal';
import { ParentDashboard } from './dashboards/ParentDashboard';
import { SchoolAdminDashboard } from './dashboards/SchoolAdminDashboard';
import { StudentDashboard } from './dashboards/StudentDashboard';
import { SuperAdminDashboard } from './dashboards/SuperAdminDashboard';
import { TeacherDashboard } from './dashboards/TeacherDashboard';
import { DEFAULT_DEMO_SCHOOL_ID } from './lib/services';

function UnauthorizedDomainNotice({
  hostname,
  projectId,
  onCopy,
  copied,
  onRecheck,
}: {
  hostname: string;
  projectId: string;
  onCopy: () => void;
  copied: boolean;
  onRecheck: () => void;
}) {
  return (
    <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl space-y-3 text-xs text-amber-950">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-semibold text-amber-950">
            Domain hiện tại chưa có trong Authorized Domains của Firebase
          </div>
          <p className="text-amber-900 leading-relaxed">
            Firebase Authentication chặn đăng nhập từ hostname chưa được cấp phép (lỗi{' '}
            <span className="font-mono font-semibold">auth/unauthorized-domain</span>).
          </p>
        </div>
      </div>

      <div className="bg-white border border-amber-200 rounded-lg p-2.5 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] text-slate-500">Hostname thực tế cần thêm (window.location.hostname)</div>
          <div className="font-mono text-xs font-semibold text-slate-900 truncate">
            {hostname || '(không xác định)'}
          </div>
        </div>
        {hostname && (
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-900 text-white rounded-md text-[11px] font-medium hover:bg-slate-800 shrink-0"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Đã sao chép' : 'Sao chép'}
          </button>
        )}
      </div>

      <ol className="list-decimal list-inside space-y-1 text-amber-900 leading-relaxed">
        <li>
          Mở <span className="font-semibold">Firebase Console</span> (dự án{' '}
          <span className="font-mono font-medium">{projectId}</span>).
        </li>
        <li>
          Vào <span className="font-semibold">Authentication → Settings → Authorized domains → Add domain</span>.
        </li>
        <li>
          Dán chính xác hostname <span className="font-mono font-semibold">{hostname}</span> (chỉ nhập hostname,{' '}
          <span className="font-semibold">không</span> thêm <span className="font-mono">https://</span>, đường dẫn{' '}
          <span className="font-mono">/</span> hay ký tự <span className="font-mono">*</span>).
        </li>
        <li>
          Kiểm tra đủ các môi trường sử dụng: <span className="font-mono">localhost</span> (phát triển), Google AI
          Studio Preview, domain triển khai thực tế và domain tùy chỉnh (nếu có).
        </li>
      </ol>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onRecheck}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-900 text-white rounded-lg text-[11px] font-medium hover:bg-amber-800"
        >
          <RefreshCw className="w-3 h-3" />
          Kiểm tra lại trạng thái domain
        </button>
      </div>
    </div>
  );
}

function MainApp() {
  const {
    authReady,
    loadingProfile,
    isSigningIn,
    profileState,
    fbUser,
    profile,
    schools,
    authErrorInfo,
    profileErrorMessage,
    domainStatus,
    emailVerificationRequired,
    onboardingRole,
    setOnboardingRole,
    onboardingSchoolId,
    setOnboardingSchoolId,
    signInWithGoogle,
    signInWithEmail,
    signOutUser,
    retryProfileLoad,
    resendVerificationEmail,
    reloadAuthUser,
    clearAuthError,
    refreshDomainCheck,
  } = useAuth();

  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [copiedHost, setCopiedHost] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [verificationSent, setVerificationSent] = useState(false);
  const [checkingVerify, setCheckingVerify] = useState(false);

  const handleCopyHostname = async () => {
    if (!domainStatus.hostname) return;
    try {
      await navigator.clipboard.writeText(domainStatus.hostname);
      setCopiedHost(true);
      setTimeout(() => setCopiedHost(false), 2000);
    } catch {
      // Ignore clipboard permission denial
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await signInWithEmail(emailInput, passwordInput);
  };

  if (!authReady || loadingProfile) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <BrandLogo showTagline size="lg" />
          <div className="space-y-2.5 pt-1">
            <div className="h-4 w-56 bg-slate-200 rounded animate-pulse" />
            <div className="h-4 w-64 bg-slate-100 rounded animate-pulse" />
            <div className="h-10 w-full bg-slate-100 rounded-lg animate-pulse" />
          </div>
          <div className="text-xs text-slate-500">Đang khởi tạo phiên xác thực SMARTPLATE...</div>
        </div>
      </div>
    );
  }

  // Email verification required gate (e.g., Email/Password account not yet verified)
  if (fbUser && emailVerificationRequired) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-amber-200 rounded-xl p-6 space-y-4">
          <BrandLogo showTagline />
          <div className="flex items-center gap-3 text-amber-700 pt-1">
            <Mail className="w-6 h-6 shrink-0" />
            <h2 className="text-lg font-semibold text-slate-900">Xác minh email tài khoản</h2>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">
            Tài khoản <span className="font-medium text-slate-900">{fbUser.email}</span> chưa xác minh địa chỉ email.
            Hệ thống yêu cầu xác minh email để bảo vệ dữ liệu trường học trong Firestore.
          </p>
          {verificationSent && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800">
              Đã gửi lại liên kết xác minh đến hộp thư {fbUser.email}. Vui lòng kiểm tra cả thư mục Spam.
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={checkingVerify}
              onClick={async () => {
                setCheckingVerify(true);
                try {
                  await reloadAuthUser();
                } finally {
                  setCheckingVerify(false);
                }
              }}
              className="px-4 py-2 bg-emerald-700 text-white text-xs font-medium rounded-lg hover:bg-emerald-800 disabled:opacity-50"
            >
              {checkingVerify ? 'Đang kiểm tra...' : 'Tôi đã xác minh, kiểm tra lại'}
            </button>
            <button
              type="button"
              onClick={async () => {
                await resendVerificationEmail();
                setVerificationSent(true);
              }}
              className="px-4 py-2 bg-slate-100 text-slate-800 text-xs font-medium rounded-lg hover:bg-slate-200"
            >
              Gửi lại email xác minh
            </button>
            <button
              type="button"
              onClick={signOutUser}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50"
            >
              <LogOut className="w-3.5 h-3.5" />
              Đăng xuất
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Authenticated user whose Firestore profile hit PERMISSION_DENIED / PROFILE_ERROR / PROFILE_NOT_FOUND
  if (
    fbUser &&
    (profileState === 'PERMISSION_DENIED' ||
      profileState === 'PROFILE_ERROR' ||
      profileState === 'PROFILE_NOT_FOUND')
  ) {
    const isPerm = profileState === 'PERMISSION_DENIED';
    const isNotFound = profileState === 'PROFILE_NOT_FOUND';
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-rose-200 rounded-xl p-6 space-y-4">
          <BrandLogo showTagline />
          <div className="flex items-center gap-3 text-rose-700 pt-1">
            <AlertTriangle className="w-6 h-6 shrink-0" />
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                {isPerm
                  ? 'Không đủ quyền truy cập hồ sơ Firestore'
                  : isNotFound
                    ? 'Chưa tìm thấy hồ sơ người dùng'
                    : 'Lỗi tải hồ sơ người dùng'}
              </h2>
              <div className="text-xs font-mono text-slate-500 mt-0.5">Trạng thái: {profileState}</div>
            </div>
          </div>

          <p className="text-sm text-slate-600 leading-relaxed">
            {profileErrorMessage ||
              authErrorInfo?.message ||
              'Không thể hoàn tất tải hồ sơ người dùng từ Firestore.'}
          </p>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 space-y-1">
            <div>
              Tài khoản đã xác thực: <span className="font-medium text-slate-900">{fbUser.email}</span>
            </div>
            <div>
              Đường dẫn hồ sơ: <span className="font-mono text-slate-800">users/{fbUser.uid}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={retryProfileLoad}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-700 text-white text-xs font-medium rounded-lg hover:bg-emerald-800"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Thử tải lại hồ sơ
            </button>
            <button
              type="button"
              onClick={signOutUser}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800"
            >
              <LogOut className="w-3.5 h-3.5" />
              Đăng xuất
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Unauthenticated Landing & Sign-In Gate
  if (!fbUser || !profile) {
    const showDomainBanner =
      domainStatus.isAuthorized === false || Boolean(authErrorInfo?.isUnauthorizedDomain);

    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between gap-8">
          <BrandLogo showTagline />
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a href="#features" className="hover:text-slate-900 whitespace-nowrap shrink-0">
              AI Dinh dưỡng
            </a>
            <a href="#portals" className="hover:text-slate-900 whitespace-nowrap shrink-0">
              5 Cổng vai trò
            </a>
            <a href="#security" className="hover:text-slate-900 whitespace-nowrap shrink-0">
              Phân tách dữ liệu
            </a>
          </nav>
          <button
            type="button"
            disabled={isSigningIn}
            onClick={() => signInWithGoogle('popup')}
            className="px-4 py-2 text-xs font-medium bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {isSigningIn ? 'Đang đăng nhập...' : 'Đăng nhập Google'}
          </button>
        </header>

        <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-12 grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
            <div className="text-xs font-medium text-emerald-800">
              Dinh dưỡng học đường Việt Nam · Firebase RBAC · Gemini Vision
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-slate-900 leading-tight [text-wrap:balance]">
              Quản trị dinh dưỡng bán trú và theo dõi bữa ăn học đường chuẩn hóa
            </h1>
            <p className="text-base text-slate-600 leading-relaxed max-w-xl">
              Nhận diện khay cơm Việt Nam qua ảnh, tính toán khẩu phần theo độ tuổi, chấm điểm quy tắc minh bạch và đồng bộ báo cáo 5 cấp từ học sinh đến toàn hệ thống.
            </p>

            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="text-sm font-semibold text-slate-900">Thiết lập lần đầu khi đăng nhập</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Vai trò đăng ký mới</label>
                  <select
                    value={onboardingRole}
                    onChange={(e) => setOnboardingRole(e.target.value as 'student' | 'parent')}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="student">Học sinh</option>
                    <option value="parent">Phụ huynh</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Trường học</label>
                  <select
                    value={onboardingSchoolId}
                    onChange={(e) => setOnboardingSchoolId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    {schools.length > 0 ? (
                      schools.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))
                    ) : (
                      <option value={DEFAULT_DEMO_SCHOOL_ID}>Trường Tiểu học Chu Văn An</option>
                    )}
                  </select>
                </div>
              </div>

              {showDomainBanner && (
                <UnauthorizedDomainNotice
                  hostname={domainStatus.hostname}
                  projectId={domainStatus.projectId}
                  onCopy={handleCopyHostname}
                  copied={copiedHost}
                  onRecheck={refreshDomainCheck}
                />
              )}

              {authErrorInfo && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <span>{authErrorInfo.message}</span>
                    <button
                      type="button"
                      onClick={clearAuthError}
                      className="text-rose-700 underline shrink-0"
                    >
                      Đóng
                    </button>
                  </div>

                  {authErrorInfo.canOfferRedirect && (
                    <button
                      type="button"
                      disabled={isSigningIn}
                      onClick={() => signInWithGoogle('redirect')}
                      className="w-full px-3 py-2 bg-rose-700 text-white font-medium rounded-lg hover:bg-rose-800 disabled:opacity-50"
                    >
                      Thử đăng nhập bằng chuyển hướng (Redirect)
                    </button>
                  )}
                </div>
              )}

              <button
                type="button"
                disabled={isSigningIn}
                onClick={() => signInWithGoogle('popup')}
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors"
              >
                <span>{isSigningIn ? 'Đang xác thực với Google...' : 'Đăng nhập bằng tài khoản Google'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>
                  Giáo viên, Quản trị trường được phân quyền bởi Quản trị viên sau khi đăng nhập.
                </span>
                <button
                  type="button"
                  onClick={() => setShowEmailForm((v) => !v)}
                  className="text-emerald-700 font-medium hover:underline whitespace-nowrap ml-3"
                >
                  {showEmailForm ? 'Ẩn Email' : 'Đăng nhập Email'}
                </button>
              </div>

              {showEmailForm && (
                <form onSubmit={handleEmailSubmit} className="pt-3 border-t border-slate-100 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      type="email"
                      required
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder="Email tài khoản"
                      className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
                    />
                    <input
                      type="password"
                      required
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      placeholder="Mật khẩu"
                      className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isSigningIn}
                    className="w-full px-4 py-2 text-xs font-medium bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 disabled:opacity-50"
                  >
                    {isSigningIn ? 'Đang xử lý...' : 'Đăng nhập bằng Email'}
                  </button>
                </form>
              )}
            </div>
          </div>

          <div className="lg:col-span-6 flex flex-col justify-between gap-4">
            <div className="flex-1 border border-slate-200 rounded-xl overflow-hidden bg-white">
              <img
                src="/src/assets/images/smartplate_hero_tray_1795015017554.jpg"
                alt="Khay cơm bán trú học đường Việt Nam cân đối dinh dưỡng"
                className="w-full h-full min-h-[320px] object-cover"
              />
            </div>

            <div id="features" className="grid grid-cols-3 gap-3">
              <div id="portals" className="bg-white border border-slate-200 rounded-xl p-3.5">
                <div className="text-xs text-slate-500">Phân quyền</div>
                <div className="mt-1 text-base font-bold text-slate-900 tabular-nums">5 Vai trò RBAC</div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-3.5">
                <div className="text-xs text-slate-500">Dữ liệu chuẩn</div>
                <div className="mt-1 text-base font-bold text-emerald-700 tabular-nums">12 Nhóm món VN</div>
              </div>
              <div id="security" className="bg-white border border-slate-200 rounded-xl p-3.5">
                <div className="text-xs text-slate-500">Bảo mật</div>
                <div className="mt-1 text-base font-bold text-slate-900">Tách dữ liệu trường</div>
              </div>
            </div>
          </div>
        </main>

        <footer className="bg-white border-t border-slate-200 px-6 py-5">
          <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-900">SMARTPLATE</span>
              <span>| AI Nutrition Education Platform</span>
            </div>
            <div className="font-medium text-emerald-700">Eat Smart – Live Healthy</div>
          </div>
        </footer>
      </div>
    );
  }

  // Suspended / Deleted Account Gate
  if (profile.status === 'suspended' || profile.status === 'deleted') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-rose-200 rounded-xl p-6 space-y-4">
          <BrandLogo showTagline />
          <div className="flex items-center gap-3 text-rose-700 pt-1">
            <Lock className="w-6 h-6" />
            <h2 className="text-lg font-semibold text-slate-900">Tài khoản đã bị khóa</h2>
          </div>
          <p className="text-sm text-slate-600">
            Tài khoản <span className="font-medium text-slate-900">{profile.email}</span> hiện có trạng thái{' '}
            <span className="font-mono text-rose-700">{profile.status}</span> và không thể truy cập dữ liệu. Vui lòng liên hệ Quản trị nhà trường hoặc Super Admin.
          </p>
          <button
            type="button"
            onClick={signOutUser}
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg"
          >
            <LogOut className="w-4 h-4" />
            Đăng xuất
          </button>
        </div>
      </div>
    );
  }

  if (profile.status === 'pending_verification') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-amber-200 rounded-xl p-6 space-y-4">
          <BrandLogo showTagline />
          <div className="flex items-center gap-3 text-amber-700 pt-1">
            <AlertOctagon className="w-6 h-6" />
            <h2 className="text-lg font-semibold text-slate-900">Tài khoản đang chờ xác minh</h2>
          </div>
          <p className="text-sm text-slate-600">
            Tài khoản <span className="font-medium">{profile.email}</span> đang chờ Quản trị viên kích hoạt.
          </p>
          <button
            type="button"
            onClick={signOutUser}
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg"
          >
            <LogOut className="w-4 h-4" />
            Đăng xuất
          </button>
        </div>
      </div>
    );
  }

  const schoolName =
    schools.find((s) => s.id === profile.schoolId)?.name ||
    profile.schoolId ||
    'Trường Tiểu học Chu Văn An';

  const VALID_ROLES = ['student', 'parent', 'teacher', 'school_admin', 'super_admin'];
  if (!VALID_ROLES.includes(profile.role)) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-rose-200 rounded-xl p-6 space-y-4">
          <BrandLogo showTagline />
          <div className="flex items-center gap-3 text-rose-700 pt-1">
            <Lock className="w-6 h-6" />
            <h2 className="text-lg font-semibold text-slate-900">Vai trò không hợp lệ</h2>
          </div>
          <p className="text-sm text-slate-600">
            Tài khoản <span className="font-medium text-slate-900">{profile.email}</span> chưa có vai trò hợp lệ trong hệ thống. Vui lòng liên hệ Quản trị viên.
          </p>
          <button
            type="button"
            onClick={signOutUser}
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg"
          >
            <LogOut className="w-4 h-4" />
            Đăng xuất
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {profile.role === 'student' && (
        <StudentDashboard
          user={profile}
          schoolName={schoolName}
          onLogout={signOutUser}
          onOpenPrivacyModal={() => setPrivacyOpen(true)}
        />
      )}
      {profile.role === 'parent' && (
        <ParentDashboard
          user={profile}
          schoolName={schoolName}
          onLogout={signOutUser}
          onOpenPrivacyModal={() => setPrivacyOpen(true)}
        />
      )}
      {profile.role === 'teacher' && (
        <TeacherDashboard
          user={profile}
          schoolName={schoolName}
          onLogout={signOutUser}
          onOpenPrivacyModal={() => setPrivacyOpen(true)}
        />
      )}
      {profile.role === 'school_admin' && (
        <SchoolAdminDashboard
          user={profile}
          schoolName={schoolName}
          onLogout={signOutUser}
          onOpenPrivacyModal={() => setPrivacyOpen(true)}
        />
      )}
      {profile.role === 'super_admin' && (
        <SuperAdminDashboard
          user={profile}
          onLogout={signOutUser}
          onOpenPrivacyModal={() => setPrivacyOpen(true)}
        />
      )}

      <PrivacyConsentModal
        user={profile}
        open={privacyOpen}
        onClose={() => setPrivacyOpen(false)}
      />
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <MainApp />
      </AuthProvider>
    </ErrorBoundary>
  );
}
