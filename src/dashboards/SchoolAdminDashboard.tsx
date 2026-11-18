import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Building2,
  CalendarDays,
  Camera,
  Check,
  Download,
  GraduationCap,
  LayoutDashboard,
  Users,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AcademicYear,
  MealLog,
  MenuPlan,
  ParentChildLink,
  School,
  SchoolClass,
  StudentAgeGroup,
  UserProfile,
  VietnameseFood,
} from '../types/domain';
import {
  AcademicYearRepo,
  ClassRepo,
  FoodRepo,
  MealLogRepo,
  MenuRepo,
  ParentChildLinkRepo,
  SchoolRepo,
  UserRepo,
} from '../lib/repositories';
import { SEED_VIETNAMESE_FOODS } from '../lib/vietnameseFoods';
import { AuditService, GovernanceService, makeId } from '../lib/services';
import { DashboardShell, NavItem } from '../components/DashboardShell';
import { MealAnalyzerModule } from '../components/MealAnalyzerModule';
import { MenuPlannerModule } from '../components/MenuPlannerModule';
import { ReportsCenter } from '../components/ReportsCenter';

interface SchoolAdminDashboardProps {
  user: UserProfile;
  schoolName: string;
  onLogout: () => void;
  onOpenPrivacyModal: () => void;
}

export function SchoolAdminDashboard({
  user,
  schoolName,
  onLogout,
  onOpenPrivacyModal,
}: SchoolAdminDashboardProps) {
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const [school, setSchool] = useState<School | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [userCursor, setUserCursor] = useState<any>(null);
  const [hasMoreUsers, setHasMoreUsers] = useState(false);
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [links, setLinks] = useState<ParentChildLink[]>([]);
  const [meals, setMeals] = useState<MealLog[]>([]);
  const [mealCursor, setMealCursor] = useState<any>(null);
  const [hasMoreMeals, setHasMoreMeals] = useState(false);
  const [menus, setMenus] = useState<MenuPlan[]>([]);
  const [foods, setFoods] = useState<VietnameseFood[]>(SEED_VIETNAMESE_FOODS);

  // Academic Year form
  const [yearName, setYearName] = useState('2026-2027');
  const [yearStart, setYearStart] = useState('2026-09-05');
  const [yearEnd, setYearEnd] = useState('2027-05-31');

  // Class form
  const [clsName, setClsName] = useState('');
  const [clsGrade, setClsGrade] = useState('Khối 5');
  const [clsAgeGroup, setClsAgeGroup] = useState<StudentAgeGroup>('9-11');
  const [clsTeacherUid, setClsTeacherUid] = useState('');

  const navItems: NavItem[] = [
    { id: 'overview', label: 'Tổng quan nhà trường', icon: LayoutDashboard },
    { id: 'users', label: 'Giáo viên, Học sinh & Phụ huynh', icon: Users },
    { id: 'academics', label: 'Lớp học & Năm học', icon: GraduationCap },
    { id: 'menus', label: 'Thực đơn & Bán trú', icon: CalendarDays },
    { id: 'analyzer', label: 'Phân tích dinh dưỡng AI', icon: Camera },
    { id: 'reports', label: 'Báo cáo & Sao lưu trường', icon: BarChart3 },
  ];

  const schoolId = user.schoolId || 'school_th_chu_van_an';

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const [sch, usrRes, clsList, yrList, linkList, mealRes, menuRes, foodList] = await Promise.all([
        SchoolRepo.getById(schoolId),
        UserRepo.listBySchool(schoolId, 120),
        ClassRepo.list(schoolId),
        AcademicYearRepo.list(schoolId),
        ParentChildLinkRepo.listForSchool(schoolId),
        MealLogRepo.listForSchool(schoolId, 100),
        MenuRepo.listForSchool(schoolId, 30),
        FoodRepo.listAll(100),
      ]);
      setSchool(sch);
      setUsers(usrRes.items);
      setUserCursor(usrRes.lastCursor);
      setHasMoreUsers(usrRes.hasMore);
      setClasses(clsList);
      setYears(yrList);
      setLinks(linkList);
      setMeals(mealRes.items);
      setMealCursor(mealRes.lastCursor);
      setHasMoreMeals(mealRes.hasMore);
      setMenus(menuRes.items);
      if (foodList.length > 0) setFoods(foodList);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể tải dữ liệu nhà trường.');
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleLoadMoreUsers = async () => {
    if (!userCursor) return;
    const next = await UserRepo.listBySchool(schoolId, 120, userCursor);
    setUsers((prev) => [...prev, ...next.items]);
    setUserCursor(next.lastCursor);
    setHasMoreUsers(next.hasMore);
  };

  const handleLoadMoreMeals = async () => {
    if (!mealCursor) return;
    const next = await MealLogRepo.listForSchool(schoolId, 100, mealCursor);
    setMeals((prev) => [...prev, ...next.items]);
    setMealCursor(next.lastCursor);
    setHasMoreMeals(next.hasMore);
  };

  const teachers = useMemo(() => users.filter((u) => u.role === 'teacher'), [users]);
  const students = useMemo(() => users.filter((u) => u.role === 'student'), [users]);
  const parents = useMemo(() => users.filter((u) => u.role === 'parent'), [users]);

  const filteredUsers = useMemo(
    () => (roleFilter === 'all' ? users : users.filter((u) => u.role === roleFilter)),
    [users, roleFilter]
  );

  const classDistributionChart = useMemo(() => {
    return classes.map((c) => ({
      name: c.name,
      meals: meals.filter((m) => m.classId === c.id).length,
      students: students.filter((s) => s.classIds?.includes(c.id)).length,
    }));
  }, [classes, meals, students]);

  const handleCreateYear = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!yearName.trim()) return;
    await AcademicYearRepo.upsert(
      {
        id: makeId('ay'),
        schoolId,
        name: yearName.trim(),
        startDate: yearStart,
        endDate: yearEnd,
        isCurrent: true,
      },
      true
    );
    await loadData();
  };

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clsName.trim()) return;
    const teacher = teachers.find((t) => t.uid === clsTeacherUid);
    const id = makeId('cls');
    await ClassRepo.upsert(
      {
        id,
        schoolId,
        academicYearId: years[0]?.id || 'ay_2026_2027',
        name: clsName.trim(),
        grade: clsGrade,
        ageGroup: clsAgeGroup,
        teacherUid: teacher?.uid || '',
        teacherName: teacher?.displayName || 'Chưa phân công',
        studentCount: 0,
      },
      true
    );
    if (teacher) {
      await UserRepo.update(teacher.uid, {
        classIds: Array.from(new Set([...(teacher.classIds || []), id])),
      });
    }
    setClsName('');
    await loadData();
  };

  const handleUpdateUserRoleOrClass = async (target: UserProfile, patch: Partial<UserProfile>) => {
    await UserRepo.update(target.uid, patch);
    await AuditService.log({
      schoolId,
      actorUid: user.uid,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'SCHOOL_USER_UPDATED',
      targetCollection: 'users',
      targetId: target.uid,
      details: JSON.stringify(patch),
    });
    await loadData();
  };

  const handleExportSchoolBackup = async () => {
    const jsonStr = await GovernanceService.exportSchoolBackupJson(user, schoolId);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SmartPlate_Backup_${schoolId}_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DashboardShell
      user={user}
      schoolName={school?.name || schoolName}
      navItems={navItems}
      activeTab={activeTab}
      onSelectTab={setActiveTab}
      onLogout={onLogout}
      onOpenPrivacyModal={onOpenPrivacyModal}
      headerAction={
        <button
          type="button"
          onClick={handleExportSchoolBackup}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 whitespace-nowrap"
        >
          <Download className="w-3.5 h-3.5" />
          Sao lưu JSON
        </button>
      }
    >
      {errorMsg && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-800">{errorMsg}</div>
      )}

      {loading ? (
        <div className="h-40 bg-white border border-slate-200 rounded-xl animate-pulse" />
      ) : (
        <>
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="text-xs text-slate-500">Giáo viên</div>
                  <div className="mt-1 text-2xl font-bold font-mono tabular-nums">{teachers.length}</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="text-xs text-slate-500">Học sinh</div>
                  <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-emerald-700">{students.length}</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="text-xs text-slate-500">Phụ huynh</div>
                  <div className="mt-1 text-2xl font-bold font-mono tabular-nums">{parents.length}</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="text-xs text-slate-500">Lớp học</div>
                  <div className="mt-1 text-2xl font-bold font-mono tabular-nums">{classes.length}</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="text-xs text-slate-500">Bữa ăn / Thực đơn</div>
                  <div className="mt-1 text-2xl font-bold font-mono tabular-nums">
                    {meals.length} · {menus.length}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
                <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5">
                  <h3 className="text-sm font-semibold text-slate-900 mb-3">Hoạt động theo lớp trong trường</h3>
                  {classDistributionChart.length === 0 ? (
                    <div className="h-56 flex items-center justify-center text-xs text-slate-400">
                      Chưa có lớp học nào.
                    </div>
                  ) : (
                    <div className="h-60">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={classDistributionChart}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <Tooltip />
                          <Bar dataKey="students" name="Học sinh" fill="#0284c7" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="meals" name="Bữa ăn" fill="#059669" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
                  <img
                    src="/src/assets/images/school_canteen_emblem_1795015019223.jpg"
                    alt="Không gian nhà ăn bán trú trường học"
                    className="w-full h-36 object-cover"
                  />
                  <div className="p-4 space-y-2 flex-1">
                    <div className="flex items-center gap-2 font-semibold text-sm text-slate-900">
                      <Building2 className="w-4 h-4 text-emerald-700" />
                      {school?.name || schoolId}
                    </div>
                    <div className="text-xs text-slate-600 space-y-1">
                      <div>Bán trú: {school?.boardingEnabled ? 'Đang kích hoạt' : 'Chưa kích hoạt'}</div>
                      <div>Chính sách lưu giữ dữ liệu: {school?.retentionDays || 730} ngày</div>
                      <div>Liên kết phụ huynh chờ duyệt: {links.filter((l) => l.status === 'pending').length}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'users' && (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <h3 className="text-base font-semibold text-slate-900">Quản lý thành viên trong trường ({filteredUsers.length})</h3>
                  <select
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                    className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="all">Tất cả vai trò</option>
                    <option value="student">Học sinh</option>
                    <option value="parent">Phụ huynh</option>
                    <option value="teacher">Giáo viên</option>
                    <option value="school_admin">Quản trị trường</option>
                  </select>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                        <th className="py-2.5 px-4">Họ tên</th>
                        <th className="py-2.5 px-4">Email</th>
                        <th className="py-2.5 px-4">Vai trò</th>
                        <th className="py-2.5 px-4">Lớp gán</th>
                        <th className="py-2.5 px-4">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {filteredUsers.map((u) => (
                        <tr key={u.uid}>
                          <td className="py-2.5 px-4 font-medium text-slate-900">{u.displayName}</td>
                          <td className="py-2.5 px-4 text-xs text-slate-600">{u.email}</td>
                          <td className="py-2.5 px-4">
                            {u.role === 'school_admin' || u.role === 'super_admin' ? (
                              <span className="text-xs font-semibold text-slate-700">{u.role}</span>
                            ) : (
                              <select
                                value={u.role}
                                onChange={(e) => void handleUpdateUserRoleOrClass(u, { role: e.target.value as any })}
                                className="px-2 py-1 text-xs border border-slate-200 rounded bg-white"
                              >
                                <option value="student">student</option>
                                <option value="parent">parent</option>
                                <option value="teacher">teacher</option>
                              </select>
                            )}
                          </td>
                          <td className="py-2.5 px-4">
                            <select
                              value={u.classIds?.[0] || ''}
                              onChange={(e) =>
                                void handleUpdateUserRoleOrClass(u, {
                                  classIds: e.target.value ? [e.target.value] : [],
                                })
                              }
                              className="px-2 py-1 text-xs border border-slate-200 rounded bg-white"
                            >
                              <option value="">-- Chưa gán lớp --</option>
                              {classes.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2.5 px-4">
                            <button
                              type="button"
                              disabled={u.uid === user.uid || u.role === 'school_admin' || u.role === 'super_admin'}
                              onClick={() =>
                                void handleUpdateUserRoleOrClass(u, {
                                  status: u.status === 'suspended' ? 'active' : 'suspended',
                                })
                              }
                              className={`px-2.5 py-1 text-xs rounded-lg font-medium disabled:opacity-50 ${
                                u.status === 'suspended'
                                  ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                  : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              }`}
                            >
                              {u.status}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {hasMoreUsers && (
                  <div className="p-3 border-t border-slate-200 text-center">
                    <button
                      type="button"
                      onClick={handleLoadMoreUsers}
                      className="px-4 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 rounded-lg"
                    >
                      Tải thêm thành viên
                    </button>
                  </div>
                )}
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                <h3 className="text-base font-semibold text-slate-900">Xác minh liên kết Phụ huynh - Học sinh</h3>
                {links.length === 0 ? (
                  <p className="text-xs text-slate-500">Không có yêu cầu liên kết nào trong trường.</p>
                ) : (
                  links.map((lk) => (
                    <div key={lk.id} className="p-3 border border-slate-200 rounded-lg flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div>
                        <span className="font-semibold text-slate-900">{lk.parentEmail || lk.parentUid}</span> xin liên kết với{' '}
                        <span className="font-semibold text-slate-900">{lk.studentName || lk.studentUid}</span> · Trạng thái:{' '}
                        <span className="font-semibold">{lk.status}</span>
                      </div>
                      {lk.status === 'pending' && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={async () => {
                              await GovernanceService.verifyParentChildLink(lk, true, user);
                              await loadData();
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-700 text-white rounded-md"
                          >
                            <Check className="w-3.5 h-3.5" />
                            Xác minh
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await GovernanceService.verifyParentChildLink(lk, false, user);
                              await loadData();
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-rose-600 text-white rounded-md"
                          >
                            <X className="w-3.5 h-3.5" />
                            Từ chối
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'academics' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <h3 className="text-base font-semibold text-slate-900">Quản lý Năm học</h3>
                <form onSubmit={handleCreateYear} className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    required
                    value={yearName}
                    onChange={(e) => setYearName(e.target.value)}
                    placeholder="2026-2027"
                    className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                  <input
                    type="date"
                    value={yearStart}
                    onChange={(e) => setYearStart(e.target.value)}
                    className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                  <input
                    type="date"
                    value={yearEnd}
                    onChange={(e) => setYearEnd(e.target.value)}
                    className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                  <button type="submit" className="sm:col-span-3 px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg">
                    Thêm năm học
                  </button>
                </form>
                <div className="space-y-2">
                  {years.map((y) => (
                    <div key={y.id} className="p-3 border border-slate-200 rounded-lg flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-900">
                        {y.name} ({y.startDate} → {y.endDate})
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          await AcademicYearRepo.delete(schoolId, y.id);
                          await loadData();
                        }}
                        className="text-rose-600 hover:underline"
                      >
                        Xóa
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <h3 className="text-base font-semibold text-slate-900">Quản lý Lớp học</h3>
                <form onSubmit={handleCreateClass} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    required
                    value={clsName}
                    onChange={(e) => setClsName(e.target.value)}
                    placeholder="Tên lớp (VD: Lớp 4A)"
                    className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                  <input
                    value={clsGrade}
                    onChange={(e) => setClsGrade(e.target.value)}
                    placeholder="Khối"
                    className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                  <select
                    value={clsAgeGroup}
                    onChange={(e) => setClsAgeGroup(e.target.value as StudentAgeGroup)}
                    className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="6-8">6–8 tuổi</option>
                    <option value="9-11">9–11 tuổi</option>
                    <option value="12-14">12–14 tuổi</option>
                    <option value="15-18">15–18 tuổi</option>
                  </select>
                  <select
                    value={clsTeacherUid}
                    onChange={(e) => setClsTeacherUid(e.target.value)}
                    className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="">-- Giáo viên chủ nhiệm --</option>
                    {teachers.map((t) => (
                      <option key={t.uid} value={t.uid}>
                        {t.displayName}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="sm:col-span-2 px-4 py-2 bg-emerald-700 text-white text-sm font-medium rounded-lg">
                    Tạo lớp mới
                  </button>
                </form>

                <div className="space-y-2">
                  {classes.map((c) => (
                    <div key={c.id} className="p-3 border border-slate-200 rounded-lg flex items-center justify-between text-xs">
                      <div>
                        <span className="font-semibold text-slate-900">{c.name}</span> · {c.grade} · Tuổi {c.ageGroup} · GV:{' '}
                        {c.teacherName}
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          await ClassRepo.delete(schoolId, c.id);
                          await loadData();
                        }}
                        className="text-rose-600 hover:underline"
                      >
                        Xóa
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'menus' && (
            <MenuPlannerModule
              user={user}
              schoolId={schoolId}
              foodsCatalog={foods}
              menus={menus}
              onRefresh={() => void loadData()}
            />
          )}

          {activeTab === 'analyzer' && (
            <MealAnalyzerModule
              actor={user}
              targetStudent={students[0] || user}
              foodsCatalog={foods}
              onSaved={() => void loadData()}
            />
          )}

          {activeTab === 'reports' && (
            <div className="space-y-4">
              {hasMoreMeals && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center justify-between text-xs text-amber-900">
                  <span>Đang hiển thị {meals.length} nhật ký bữa ăn gần nhất của trường.</span>
                  <button
                    type="button"
                    onClick={handleLoadMoreMeals}
                    className="px-3 py-1 bg-slate-900 text-white rounded-md font-medium"
                  >
                    Tải thêm dữ liệu báo cáo
                  </button>
                </div>
              )}
              <ReportsCenter
                user={user}
                mealLogs={meals}
                menus={menus}
                schools={school ? [school] : []}
                classes={classes}
                students={students}
              />
            </div>
          )}
        </>
      )}
    </DashboardShell>
  );
}
