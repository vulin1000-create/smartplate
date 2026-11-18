import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { AlertOctagon, ArrowRight, Lock, LogOut, ShieldCheck } from 'lucide-react';
import { School, UserProfile } from './types/domain';
import { auth } from './lib/firebase';
import { SchoolRepo, UserRepo } from './lib/repositories';
import { AuthService, BootstrapService, DEFAULT_DEMO_SCHOOL_ID } from './lib/services';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PrivacyConsentModal } from './components/PrivacyConsentModal';
import { StudentDashboard } from './dashboards/StudentDashboard';
import { ParentDashboard } from './dashboards/ParentDashboard';
import { TeacherDashboard } from './dashboards/TeacherDashboard';
import { SchoolAdminDashboard } from './dashboards/SchoolAdminDashboard';
import { SuperAdminDashboard } from './dashboards/SuperAdminDashboard';

function SmartPlateApp() {
  const [authReady, setAuthReady] = useState(false);
  const [fbUser, setFbUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [schools, setSchools] = useState<School[]>([]);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [authError, setAuthError] = useState('');

  // Onboarding defaults for first-time Google Sign-In
  const [initialRole, setInitialRole] = useState<'student' | 'parent'>('student');
  const [initialSchoolId, setInitialSchoolId] = useState<string>(DEFAULT_DEMO_SCHOOL_ID);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  const initialRoleRef = React.useRef<'student' | 'parent'>(initialRole);
  const initialSchoolIdRef = React.useRef<string>(initialSchoolId);
  const resolvingUidRef = React.useRef<string | null>(null);

  useEffect(() => {
    initialRoleRef.current = initialRole;
  }, [initialRole]);

  useEffect(() => {
    initialSchoolIdRef.current = initialSchoolId;
  }, [initialSchoolId]);

  const resolveSignedInUser = React.useCallback(async (user: FirebaseUser) => {
    if (resolvingUidRef.current === user.uid) return;
    resolvingUidRef.current = user.uid;
    setLoadingProfile(true);
    setAuthError('');
    try {
      const [existing, activeSchools] = await Promise.all([
        UserRepo.getById(user.uid),
        SchoolRepo.listActive().catch(() => []),
      ]);
      setSchools(activeSchools);

      const resolved =
        existing ||
        (await AuthService.ensureUserProfile(
          user,
          initialRoleRef.current,
          initialSchoolIdRef.current
        ));
      setProfile(resolved);
      await BootstrapService.ensureInitialSeed(resolved);
    } catch (err: any) {
      setAuthError(err?.message || 'Không thể tải hồ sơ người dùng từ Firestore.');
    } finally {
      resolvingUidRef.current = null;
      setLoadingProfile(false);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFbUser(user);
      setAuthReady(true);
      if (!user) {
        setProfile(null);
        resolvingUidRef.current = null;
        return;
      }
      await resolveSignedInUser(user);
    });
    return () => unsub();
  }, [resolveSignedInUser]);

  const handleGoogleSignIn = async () => {
    setAuthError('');
    try {
      const user = await AuthService.signInWithGoogle();
      await resolveSignedInUser(user);
    } catch (err: any) {
      setAuthError(err?.message || 'Đăng nhập Google không thành công.');
      setLoadingProfile(false);
    }
  };

  const handleLogout = async () => {
    await AuthService.logout();
    setProfile(null);
  };

  if (!authReady || loadingProfile) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-3">
          <div className="h-5 w-48 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-64 bg-slate-100 rounded animate-pulse" />
          <div className="h-10 w-full bg-slate-100 rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  // Unauthenticated Landing & Google Sign-In Gate
  if (!fbUser || !profile) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between gap-8">
          <div className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            SmartPlate VN 2.0
          </div>
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
            onClick={handleGoogleSignIn}
            className="px-4 py-2 text-xs font-medium bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 whitespace-nowrap shrink-0"
          >
            Đăng nhập Google
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
              <div className="text-sm font-semibold text-slate-900">Thiết lập lần đầu khi đăng nhập Google</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Vai trò đăng ký mới</label>
                  <select
                    value={initialRole}
                    onChange={(e) => setInitialRole(e.target.value as 'student' | 'parent')}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="student">Học sinh</option>
                    <option value="parent">Phụ huynh</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Trường học</label>
                  <select
                    value={initialSchoolId}
                    onChange={(e) => setInitialSchoolId(e.target.value)}
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

              {authError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800">
                  {authError}
                </div>
              )}

              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors"
              >
                <span>Đăng nhập bằng tài khoản Google</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <div className="text-xs text-slate-500">
                Tài khoản Giáo viên, Quản trị trường được phân quyền bởi Quản trị viên sau khi đăng nhập.
              </div>
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
      </div>
    );
  }

  // Suspended / Deleted Account Gate
  if (profile.status === 'suspended' || profile.status === 'deleted') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-rose-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-3 text-rose-700">
            <Lock className="w-6 h-6" />
            <h2 className="text-lg font-semibold text-slate-900">Tài khoản đã bị khóa</h2>
          </div>
          <p className="text-sm text-slate-600">
            Tài khoản <span className="font-medium text-slate-900">{profile.email}</span> hiện có trạng thái{' '}
            <span className="font-mono text-rose-700">{profile.status}</span> và không thể truy cập dữ liệu. Vui lòng liên hệ Quản trị nhà trường hoặc Super Admin.
          </p>
          <button
            type="button"
            onClick={handleLogout}
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
          <div className="flex items-center gap-3 text-amber-700">
            <AlertOctagon className="w-6 h-6" />
            <h2 className="text-lg font-semibold text-slate-900">Tài khoản đang chờ xác minh</h2>
          </div>
          <p className="text-sm text-slate-600">
            Tài khoản <span className="font-medium">{profile.email}</span> đang chờ Quản trị viên kích hoạt.
          </p>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg"
          >
            <LogOut className="w-4 h-4" />
            Đăng xuất
          </button>
        </div>
      </div>
    );
  }

  const schoolName = schools.find((s) => s.id === profile.schoolId)?.name || profile.schoolId || 'Trường Tiểu học Chu Văn An';

  return (
    <>
      {profile.role === 'student' && (
        <StudentDashboard
          user={profile}
          schoolName={schoolName}
          onLogout={handleLogout}
          onOpenPrivacyModal={() => setPrivacyOpen(true)}
        />
      )}
      {profile.role === 'parent' && (
        <ParentDashboard
          user={profile}
          schoolName={schoolName}
          onLogout={handleLogout}
          onOpenPrivacyModal={() => setPrivacyOpen(true)}
        />
      )}
      {profile.role === 'teacher' && (
        <TeacherDashboard
          user={profile}
          schoolName={schoolName}
          onLogout={handleLogout}
          onOpenPrivacyModal={() => setPrivacyOpen(true)}
        />
      )}
      {profile.role === 'school_admin' && (
        <SchoolAdminDashboard
          user={profile}
          schoolName={schoolName}
          onLogout={handleLogout}
          onOpenPrivacyModal={() => setPrivacyOpen(true)}
        />
      )}
      {profile.role === 'super_admin' && (
        <SuperAdminDashboard
          user={profile}
          onLogout={handleLogout}
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
      <SmartPlateApp />
    </ErrorBoundary>
  );
}
