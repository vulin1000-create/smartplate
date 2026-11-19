import {
  getRedirectResult,
  onAuthStateChanged as firebaseOnAuthStateChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  Unsubscribe,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  AiUsageLog,
  ConsentType,
  MealLog,
  ParentChildLink,
  School,
  StudentProgress,
  UserProfile,
  UserRole,
} from '../types/domain';
import {
  AuthErrorInfo,
  clearRedirectPending,
  handleAuthError as mapAuthError,
  hasRecentPendingRedirect,
  markRedirectPending,
} from './authUtils';
import { auth, authPersistenceReady, googleProvider } from './firebase';
import {
  AcademicYearRepo,
  AiUsageLogRepo,
  AuditLogRepo,
  ClassRepo,
  ConsentRepo,
  FoodRepo,
  MealLogRepo,
  MenuRepo,
  NotificationRepo,
  ParentChildLinkRepo,
  SchoolRepo,
  StudentProgressRepo,
  SystemConfigRepo,
  TeacherCommentRepo,
  UserRepo,
} from './repositories';
import { SEED_VIETNAMESE_FOODS } from './vietnameseFoods';

export const BOOTSTRAP_SUPER_ADMIN_EMAIL = 'vulin10000@gmail.com';
export const DEFAULT_DEMO_SCHOOL_ID = 'school_th_chu_van_an';

export function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export interface ServerSessionInfo {
  authenticated: boolean;
  uid: string;
  email: string;
  emailVerified: boolean;
  role: UserRole;
  schoolId: string;
  status: UserProfile['status'];
}

let signInLock: Promise<unknown> | null = null;
let redirectResultPromise: Promise<{ user: FirebaseUser | null; errorInfo: AuthErrorInfo | null }> | null = null;
const inFlightProfileMap = new Map<string, Promise<UserProfile>>();

export const AuthService = {
  async consumeRedirectResult(): Promise<{ user: FirebaseUser | null; errorInfo: AuthErrorInfo | null }> {
    if (redirectResultPromise) {
      return redirectResultPromise;
    }
    redirectResultPromise = (async () => {
      try {
        await authPersistenceReady;
        const result = await getRedirectResult(auth);
        clearRedirectPending();
        return { user: result?.user || null, errorInfo: null };
      } catch (err) {
        clearRedirectPending();
        return { user: null, errorInfo: mapAuthError(err) };
      }
    })();
    return redirectResultPromise;
  },

  async signInWithGoogle(options?: { mode?: 'popup' | 'redirect' }): Promise<FirebaseUser | null> {
    if (signInLock) {
      throw new Error('Đang có phiên đăng nhập đang xử lý. Vui lòng đợi trong giây lát.');
    }

    const mode = options?.mode || 'popup';
    const task = (async () => {
      await authPersistenceReady;
      if (mode === 'redirect') {
        if (hasRecentPendingRedirect()) {
          throw new Error('Phiên chuyển hướng đăng nhập vừa được thực hiện. Vui lòng chờ hoàn tất hoặc tải lại trang.');
        }
        markRedirectPending();
        await signInWithRedirect(auth, googleProvider);
        return null;
      }

      const result = await signInWithPopup(auth, googleProvider);
      return result.user;
    })();

    signInLock = task;
    try {
      return await task;
    } finally {
      signInLock = null;
    }
  },

  async signInWithEmail(email: string, password: string): Promise<FirebaseUser> {
    if (signInLock) {
      throw new Error('Đang có phiên đăng nhập đang xử lý. Vui lòng đợi trong giây lát.');
    }
    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      throw new Error('Vui lòng nhập đầy đủ email và mật khẩu.');
    }

    const task = (async () => {
      await authPersistenceReady;
      const credential = await signInWithEmailAndPassword(auth, cleanEmail, password);
      return credential.user;
    })();

    signInLock = task;
    try {
      return await task;
    } finally {
      signInLock = null;
    }
  },

  async resendVerificationEmail(user: FirebaseUser): Promise<void> {
    await sendEmailVerification(user);
  },

  async signOutUser(): Promise<void> {
    clearRedirectPending();
    await signOut(auth);
  },

  async logout(): Promise<void> {
    await this.signOutUser();
  },

  getCurrentUser(): FirebaseUser | null {
    return auth.currentUser;
  },

  onAuthStateChanged(callback: (user: FirebaseUser | null) => void): Unsubscribe {
    return firebaseOnAuthStateChanged(auth, callback);
  },

  handleAuthError(error: unknown): AuthErrorInfo {
    return mapAuthError(error);
  },

  async verifyBackendSession(fbUser: FirebaseUser): Promise<ServerSessionInfo | null> {
    try {
      const idToken = await fbUser.getIdToken();
      const resp = await fetch('/api/auth/session', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });
      if (resp.status === 401 || resp.status === 403) {
        const body = await resp.json().catch(() => ({}));
        if (body?.code === 'PROFILE_REQUIRED' || body?.code === 'ACCOUNT_INACTIVE') {
          return null;
        }
        throw new Error(body?.error || 'Phiên xác thực không hợp lệ hoặc tài khoản không có quyền truy cập.');
      }
      if (!resp.ok) {
        return null;
      }
      return (await resp.json()) as ServerSessionInfo;
    } catch (err: any) {
      if (err instanceof TypeError) {
        // Network error talking to API; allow Firestore authoritative profile check to proceed
        return null;
      }
      throw err;
    }
  },

  async ensureUserProfile(
    fbUser: FirebaseUser,
    selectedRole: 'student' | 'parent' = 'student',
    selectedSchoolId: string = DEFAULT_DEMO_SCHOOL_ID
  ): Promise<UserProfile> {
    const existingPending = inFlightProfileMap.get(fbUser.uid);
    if (existingPending) {
      return existingPending;
    }

    const runner = (async () => {
      const existing = await UserRepo.getById(fbUser.uid, { fromServer: true });
      if (existing) {
        return existing;
      }

      if (!fbUser.emailVerified) {
        throw new Error('EMAIL_NOT_VERIFIED');
      }

      const isBootstrapAdmin =
        fbUser.emailVerified &&
        fbUser.email?.toLowerCase() === BOOTSTRAP_SUPER_ADMIN_EMAIL.toLowerCase();

      // Never accept admin/teacher roles from client onboarding input
      const safeSelectedRole: 'student' | 'parent' = selectedRole === 'parent' ? 'parent' : 'student';
      const initialRole: UserRole = isBootstrapAdmin ? 'super_admin' : safeSelectedRole;
      const safeDisplayName = (fbUser.displayName || fbUser.email?.split('@')[0] || 'Người dùng')
        .trim()
        .slice(0, 120);
      const safePhotoUrl = (fbUser.photoURL || '').slice(0, 500);
      const safeSchoolId = isBootstrapAdmin ? '' : (selectedSchoolId || DEFAULT_DEMO_SCHOOL_ID).slice(0, 128);

      const newProfile: Omit<UserProfile, 'createdAt' | 'updatedAt'> = {
        uid: fbUser.uid,
        email: fbUser.email || '',
        displayName: safeDisplayName || 'Người dùng',
        photoURL: safePhotoUrl,
        role: initialRole,
        status: 'active',
        schoolId: safeSchoolId,
        classIds: [],
        ageGroup: initialRole === 'student' ? '9-11' : 'adult',
        allergies: [],
        linkedChildIds: [],
        verifiedParentIds: [],
      };

      await UserRepo.create(newProfile);

      if (initialRole === 'student') {
        await StudentProgressRepo.upsert({
          studentUid: fbUser.uid,
          schoolId: safeSchoolId || DEFAULT_DEMO_SCHOOL_ID,
          classId: '',
          verifiedParentIds: [],
          points: 10,
          streakDays: 1,
          completedTaskIds: [],
          quizHistory: [],
          badges: ['Thành viên mới SmartPlate'],
          growthRecords: [],
        });
      }

      await AuditService.log({
        schoolId: newProfile.schoolId,
        actorUid: fbUser.uid,
        actorEmail: fbUser.email || '',
        actorRole: initialRole,
        action: 'USER_REGISTERED',
        targetCollection: 'users',
        targetId: fbUser.uid,
        details: `Khởi tạo hồ sơ với vai trò ${initialRole}`,
      });

      const created = await UserRepo.getById(fbUser.uid, { fromServer: true });
      return created || ({ ...newProfile, createdAt: new Date(), updatedAt: new Date() } as UserProfile);
    })();

    inFlightProfileMap.set(fbUser.uid, runner);
    try {
      return await runner;
    } finally {
      inFlightProfileMap.delete(fbUser.uid);
    }
  },
};

export const AuditService = {
  async log(entry: {
    schoolId?: string;
    actorUid: string;
    actorEmail?: string;
    actorRole: string;
    action: string;
    targetCollection: string;
    targetId: string;
    details?: string;
  }): Promise<void> {
    try {
      await AuditLogRepo.create({
        id: makeId('audit'),
        ...entry,
      });
    } catch (e) {
      console.warn('Không thể ghi audit log:', e);
    }
  },
};

export const BootstrapService = {
  async ensureInitialSeed(profile: UserProfile): Promise<void> {
    // Seed foods if catalog is empty and user has privilege
    const existingFoods = await FoodRepo.listAll(5);
    if (
      existingFoods.length === 0 &&
      ['super_admin', 'school_admin', 'teacher'].includes(profile.role)
    ) {
      for (const food of SEED_VIETNAMESE_FOODS) {
        await FoodRepo.upsert(
          {
            ...food,
            createdByUid: profile.uid,
          },
          true
        );
      }
    }

    // Seed default school & academic year & sample classes if super_admin
    if (profile.role === 'super_admin') {
      const existingSchool = await SchoolRepo.getById(DEFAULT_DEMO_SCHOOL_ID);
      if (!existingSchool) {
        const defaultSchool: Omit<School, 'createdAt' | 'updatedAt'> = {
          id: DEFAULT_DEMO_SCHOOL_ID,
          name: 'Trường Tiểu học Chu Văn An',
          code: 'TH_CVA_HN',
          province: 'Hà Nội',
          level: 'primary',
          boardingEnabled: true,
          status: 'active',
          adminUid: '',
          retentionDays: 730,
        };
        await SchoolRepo.upsert(defaultSchool, true);
        await AcademicYearRepo.upsert(
          {
            id: 'ay_2026_2027',
            schoolId: DEFAULT_DEMO_SCHOOL_ID,
            name: '2026-2027',
            startDate: '2026-09-05',
            endDate: '2027-05-31',
            isCurrent: true,
          },
          true
        );
        await ClassRepo.upsert(
          {
            id: 'class_5a',
            schoolId: DEFAULT_DEMO_SCHOOL_ID,
            academicYearId: 'ay_2026_2027',
            name: 'Lớp 5A',
            grade: 'Khối 5',
            ageGroup: '9-11',
            teacherUid: '',
            teacherName: 'Chưa phân công',
            studentCount: 0,
          },
          true
        );
        await ClassRepo.upsert(
          {
            id: 'class_3b',
            schoolId: DEFAULT_DEMO_SCHOOL_ID,
            academicYearId: 'ay_2026_2027',
            name: 'Lớp 3B',
            grade: 'Khối 3',
            ageGroup: '6-8',
            teacherUid: '',
            teacherName: 'Chưa phân công',
            studentCount: 0,
          },
          true
        );
      }

      const globalCfg = await SystemConfigRepo.getGlobal();
      if (!globalCfg) {
        await SystemConfigRepo.saveGlobal({
          configId: 'global',
          aiRateLimitPerMinute: 20,
          aiTimeoutMs: 30000,
          defaultRetentionDays: 730,
          backupSchedule: 'Hàng tuần (Chủ nhật 02:00)',
          lastBackupExportAt: '',
          maintenanceMode: false,
          updatedByUid: profile.uid,
        });
      }
    }
  },
};

export const GovernanceService = {
  async verifyParentChildLink(
    link: ParentChildLink,
    approved: boolean,
    verifier: UserProfile
  ): Promise<void> {
    const nextStatus = approved ? 'verified' : 'rejected';
    await ParentChildLinkRepo.updateStatus(link.id, nextStatus, verifier.uid);

    if (approved) {
      const parent = await UserRepo.getById(link.parentUid);
      const student = await UserRepo.getById(link.studentUid);
      if (parent) {
        const nextLinked = Array.from(new Set([...(parent.linkedChildIds || []), link.studentUid]));
        await UserRepo.update(parent.uid, { linkedChildIds: nextLinked });
      }
      if (student) {
        const nextParents = Array.from(new Set([...(student.verifiedParentIds || []), link.parentUid]));
        await UserRepo.update(student.uid, { verifiedParentIds: nextParents });
      }
      const prog = await StudentProgressRepo.get(link.studentUid);
      if (prog) {
        const nextParents = Array.from(new Set([...(prog.verifiedParentIds || []), link.parentUid]));
        await StudentProgressRepo.upsert({ ...prog, verifiedParentIds: nextParents });
      }
      // Backfill existing meal_logs and teacher_comments for verified parent visibility
      const [existingMeals, existingComments] = await Promise.all([
        MealLogRepo.listForStudent(link.studentUid, 100),
        TeacherCommentRepo.listForStudent(link.studentUid, 100),
      ]);
      for (const m of existingMeals.items) {
        const nextParents = Array.from(new Set([...(m.verifiedParentIds || []), link.parentUid]));
        await MealLogRepo.update(m.id, { verifiedParentIds: nextParents });
      }
      for (const c of existingComments.items) {
        const nextParents = Array.from(new Set([...(c.verifiedParentIds || []), link.parentUid]));
        await TeacherCommentRepo.update(c.id, { verifiedParentIds: nextParents });
      }
      await NotificationRepo.create({
        id: makeId('notif'),
        schoolId: link.schoolId,
        recipientUid: link.parentUid,
        title: 'Liên kết phụ huynh - học sinh đã được xác minh',
        body: `Tài khoản của bạn đã được liên kết hợp lệ với học sinh ${link.studentName || link.studentUid}.`,
        type: 'system',
        read: false,
      });
    }

    await AuditService.log({
      schoolId: link.schoolId,
      actorUid: verifier.uid,
      actorEmail: verifier.email,
      actorRole: verifier.role,
      action: approved ? 'PARENT_LINK_VERIFIED' : 'PARENT_LINK_REJECTED',
      targetCollection: 'parent_child_links',
      targetId: link.id,
      details: `Parent ${link.parentUid} <-> Student ${link.studentUid}`,
    });
  },

  async setConsent(
    actor: UserProfile,
    subjectStudentUid: string,
    consentType: ConsentType,
    granted: boolean
  ): Promise<void> {
    const id = `${actor.uid}_${subjectStudentUid}_${consentType}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    const existing = (await ConsentRepo.listForUser(actor.uid)).find((c) => c.id === id);
    await ConsentRepo.upsert(
      {
        id,
        schoolId: actor.schoolId || DEFAULT_DEMO_SCHOOL_ID,
        userId: actor.uid,
        subjectStudentUid,
        consentType,
        granted,
        policyVersion: '2026.1',
      },
      !existing
    );
    await AuditService.log({
      schoolId: actor.schoolId,
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: granted ? 'CONSENT_GRANTED' : 'CONSENT_REVOKED',
      targetCollection: 'consent_records',
      targetId: id,
      details: `${consentType} for ${subjectStudentUid}`,
    });
  },

  async logMealAndUpdateProgress(
    student: UserProfile,
    mealData: Omit<MealLog, 'createdAt' | 'updatedAt'>,
    actor?: UserProfile
  ): Promise<void> {
    const actingUser = actor || student;
    const verifiedParents = Array.from(
      new Set([
        ...(student.verifiedParentIds || []),
        ...(mealData.verifiedParentIds || []),
        ...(actingUser.role === 'parent' ? [actingUser.uid] : []),
      ])
    );

    await MealLogRepo.create({
      ...mealData,
      verifiedParentIds: verifiedParents,
    });

    // Parents do not have write permission on points/streakDays in student_progress (only growthRecords)
    if (actingUser.role !== 'parent') {
      const current = (await StudentProgressRepo.get(student.uid)) || {
        studentUid: student.uid,
        schoolId: student.schoolId || DEFAULT_DEMO_SCHOOL_ID,
        classId: student.classIds?.[0] || '',
        verifiedParentIds: verifiedParents,
        points: 0,
        streakDays: 0,
        completedTaskIds: [],
        quizHistory: [],
        badges: [],
        growthRecords: [],
        updatedAt: null,
      };

      const earnedPoints = mealData.scoreBreakdown.totalScore >= 80 ? 20 : 10;
      const nextPoints = (current.points || 0) + earnedPoints;
      const badges = new Set<string>(current.badges || []);
      if (mealData.scoreBreakdown.totalScore >= 85) badges.add('Bữa ăn Cân đối 85+');
      if (mealData.scoreBreakdown.detectedGroups.length >= 4) badges.add('Đĩa cơm 4+ Nhóm chất');
      if (nextPoints >= 100) badges.add('Chiến binh Dinh dưỡng 100đ');

      const progressPayload: Omit<StudentProgress, 'updatedAt'> = {
        studentUid: student.uid,
        schoolId: student.schoolId || DEFAULT_DEMO_SCHOOL_ID,
        classId: student.classIds?.[0] || '',
        verifiedParentIds: verifiedParents,
        points: nextPoints,
        streakDays: (current.streakDays || 0) + 1,
        completedTaskIds: current.completedTaskIds || [],
        quizHistory: current.quizHistory || [],
        badges: Array.from(badges),
        growthRecords: current.growthRecords || [],
      };
      await StudentProgressRepo.upsert(progressPayload);
    }

    await AuditService.log({
      schoolId: actingUser.schoolId || student.schoolId,
      actorUid: actingUser.uid,
      actorEmail: actingUser.email,
      actorRole: actingUser.role,
      action: 'MEAL_LOG_CREATED',
      targetCollection: 'meal_logs',
      targetId: mealData.id,
      details: `${mealData.mealType} ${mealData.dateStr} (${mealData.nutritionTotals.kcal} kcal)`,
    });
  },

  async recordAiUsage(usage: Omit<AiUsageLog, 'id' | 'createdAt'>): Promise<void> {
    try {
      await AiUsageLogRepo.create({
        id: makeId('aiuse'),
        ...usage,
      });
    } catch (e) {
      console.warn('Không thể ghi AI usage log:', e);
    }
  },

  async exportSchoolBackupJson(actor: UserProfile, schoolId: string): Promise<string> {
    const [school, classes, years, users, meals, menus, comments] = await Promise.all([
      SchoolRepo.getById(schoolId),
      ClassRepo.list(schoolId),
      AcademicYearRepo.list(schoolId),
      UserRepo.listBySchool(schoolId, 200),
      MealLogRepo.listForSchool(schoolId, 200),
      MenuRepo.listForSchool(schoolId, 100),
      TeacherCommentRepo.listForSchool(schoolId, 200),
    ]);
    const payload = {
      exportedAt: new Date().toISOString(),
      exportedBy: actor.email,
      schoolId,
      school,
      academicYears: years,
      classes,
      users: users.items,
      mealLogs: meals.items,
      menus: menus.items,
      teacherComments: comments.items,
    };

    await AuditService.log({
      schoolId,
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'BACKUP_EXPORT',
      targetCollection: 'schools',
      targetId: schoolId,
      details: `Xuất bản sao lưu JSON (${users.items.length} users, ${meals.items.length} meals)`,
    });

    return JSON.stringify(payload, null, 2);
  },

  async deleteAccountAndOwnData(user: UserProfile): Promise<void> {
    const ownMeals = await MealLogRepo.listForStudent(user.uid, 200);
    for (const m of ownMeals.items) {
      await MealLogRepo.delete(m.id);
    }
    const consents = await ConsentRepo.listForUser(user.uid);
    for (const c of consents) {
      await ConsentRepo.upsert({ ...c, granted: false }, false);
    }
    await AuditService.log({
      schoolId: user.schoolId,
      actorUid: user.uid,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'ACCOUNT_SELF_DELETED',
      targetCollection: 'users',
      targetId: user.uid,
      details: `Xóa tài khoản và ${ownMeals.items.length} nhật ký bữa ăn`,
    });
    await UserRepo.delete(user.uid);
  },
};
