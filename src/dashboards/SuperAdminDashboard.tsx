import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  Building2,
  Database,
  LayoutDashboard,
  Settings,
  ShieldAlert,
  Trash2,
  Users,
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
  AiUsageLog,
  AuditLog,
  FoodCategory,
  MealLog,
  MenuPlan,
  School,
  SystemConfig,
  UserProfile,
  UserRole,
  VietnameseFood,
} from '../types/domain';
import {
  AiUsageLogRepo,
  AuditLogRepo,
  FoodRepo,
  MealLogRepo,
  MenuRepo,
  SchoolRepo,
  SystemConfigRepo,
  UserRepo,
} from '../lib/repositories';
import { FOOD_CATEGORY_LABELS, SEED_VIETNAMESE_FOODS } from '../lib/vietnameseFoods';
import { AuditService, makeId } from '../lib/services';
import { DashboardShell, NavItem } from '../components/DashboardShell';
import { ReportsCenter } from '../components/ReportsCenter';

interface SuperAdminDashboardProps {
  user: UserProfile;
  onLogout: () => void;
  onOpenPrivacyModal: () => void;
}

export function SuperAdminDashboard({
  user,
  onLogout,
  onOpenPrivacyModal,
}: SuperAdminDashboardProps) {
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const [schools, setSchools] = useState<School[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [userCursor, setUserCursor] = useState<any>(null);
  const [hasMoreUsers, setHasMoreUsers] = useState(false);
  const [foods, setFoods] = useState<VietnameseFood[]>([]);
  const [meals, setMeals] = useState<MealLog[]>([]);
  const [menus, setMenus] = useState<MenuPlan[]>([]);
  const [aiLogs, setAiLogs] = useState<AiUsageLog[]>([]);
  const [aiCursor, setAiCursor] = useState<any>(null);
  const [hasMoreAiLogs, setHasMoreAiLogs] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditCursor, setAuditCursor] = useState<any>(null);
  const [hasMoreAuditLogs, setHasMoreAuditLogs] = useState(false);
  const [sysConfig, setSysConfig] = useState<SystemConfig | null>(null);

  // School CRUD state
  const [schName, setSchName] = useState('');
  const [schCode, setSchCode] = useState('');
  const [schProvince, setSchProvince] = useState('Hà Nội');
  const [schLevel, setSchLevel] = useState<School['level']>('primary');

  // Food CRUD state
  const [foodName, setFoodName] = useState('');
  const [foodCat, setFoodCat] = useState<FoodCategory>('boarding_meals');
  const [foodServing, setFoodServing] = useState(120);
  const [foodKcal, setFoodKcal] = useState(180);
  const [foodProtein, setFoodProtein] = useState(12);
  const [foodCarbs, setFoodCarbs] = useState(18);
  const [foodFat, setFoodFat] = useState(6);
  const [foodFiber, setFoodFiber] = useState(1.5);
  const [foodSource, setFoodSource] = useState('');

  // System config form
  const [rateLimit, setRateLimit] = useState(20);
  const [timeoutMs, setTimeoutMs] = useState(30000);
  const [retentionDays, setRetentionDays] = useState(730);
  const [maintenanceMode, setMaintenanceMode] = useState(false);

  const navItems: NavItem[] = [
    { id: 'overview', label: 'Tổng quan hệ thống', icon: LayoutDashboard },
    { id: 'schools', label: 'Quản lý trường học', icon: Building2 },
    { id: 'users', label: 'Người dùng & Phân quyền', icon: Users },
    { id: 'foods', label: 'CSDL Thực phẩm VN', icon: Database },
    { id: 'ai_monitor', label: 'AI Usage & Chi phí', icon: Activity },
    { id: 'audit_config', label: 'Audit Logs & Cấu hình', icon: Settings },
    { id: 'reports', label: 'Báo cáo toàn hệ thống', icon: BarChart3 },
  ];

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const [schRes, usrRes, foodList, mealRes, menuRes, aiRes, auditRes, cfg] = await Promise.all([
        SchoolRepo.listAll(60),
        UserRepo.listAll(120),
        FoodRepo.listAll(200),
        MealLogRepo.listAll(120),
        MenuRepo.listAll(60),
        AiUsageLogRepo.list(undefined, 120),
        AuditLogRepo.list(undefined, 80),
        SystemConfigRepo.getGlobal(),
      ]);
      setSchools(schRes.items);
      setUsers(usrRes.items);
      setUserCursor(usrRes.lastCursor);
      setHasMoreUsers(usrRes.hasMore);
      setFoods(foodList);
      setMeals(mealRes.items);
      setMenus(menuRes.items);
      setAiLogs(aiRes.items);
      setAiCursor(aiRes.lastCursor);
      setHasMoreAiLogs(aiRes.hasMore);
      setAuditLogs(auditRes.items);
      setAuditCursor(auditRes.lastCursor);
      setHasMoreAuditLogs(auditRes.hasMore);
      if (cfg) {
        setSysConfig(cfg);
        setRateLimit(cfg.aiRateLimitPerMinute);
        setTimeoutMs(cfg.aiTimeoutMs);
        setRetentionDays(cfg.defaultRetentionDays);
        setMaintenanceMode(cfg.maintenanceMode);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể tải dữ liệu quản trị hệ thống.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleLoadMoreUsers = async () => {
    if (!userCursor) return;
    const next = await UserRepo.listAll(120, userCursor);
    setUsers((prev) => [...prev, ...next.items]);
    setUserCursor(next.lastCursor);
    setHasMoreUsers(next.hasMore);
  };

  const handleLoadMoreAiLogs = async () => {
    if (!aiCursor) return;
    const next = await AiUsageLogRepo.list(undefined, 120, aiCursor);
    setAiLogs((prev) => [...prev, ...next.items]);
    setAiCursor(next.lastCursor);
    setHasMoreAiLogs(next.hasMore);
  };

  const handleLoadMoreAuditLogs = async () => {
    if (!auditCursor) return;
    const next = await AuditLogRepo.list(undefined, 80, auditCursor);
    setAuditLogs((prev) => [...prev, ...next.items]);
    setAuditCursor(next.lastCursor);
    setHasMoreAuditLogs(next.hasMore);
  };

  const totalAiCostUsd = useMemo(
    () => aiLogs.reduce((s, l) => s + (l.estimatedCostUsd || 0), 0),
    [aiLogs]
  );
  const aiErrorCount = useMemo(
    () => aiLogs.filter((l) => l.status !== 'success').length,
    [aiLogs]
  );

  const aiByEndpoint = useMemo(() => {
    const map = new Map<string, { endpoint: string; calls: number; tokens: number }>();
    aiLogs.forEach((l) => {
      const cur = map.get(l.endpoint) || { endpoint: l.endpoint, calls: 0, tokens: 0 };
      cur.calls += 1;
      cur.tokens += l.totalTokens || 0;
      map.set(l.endpoint, cur);
    });
    return Array.from(map.values());
  }, [aiLogs]);

  const handleCreateSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schName.trim() || !schCode.trim()) return;
    const id = makeId('school');
    await SchoolRepo.upsert(
      {
        id,
        name: schName.trim(),
        code: schCode.trim().toUpperCase(),
        province: schProvince,
        level: schLevel,
        boardingEnabled: true,
        status: 'active',
        retentionDays: 730,
      },
      true
    );
    await AuditService.log({
      schoolId: id,
      actorUid: user.uid,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'SCHOOL_CREATED',
      targetCollection: 'schools',
      targetId: id,
      details: schName.trim(),
    });
    setSchName('');
    setSchCode('');
    await loadData();
  };

  const handleCreateFood = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!foodName.trim()) return;
    const hasReliableSource = foodSource.trim().length >= 5;
    const id = makeId('food');
    await FoodRepo.upsert(
      {
        id,
        nameVi: foodName.trim(),
        category: foodCat,
        standardServingG: foodServing,
        energyKcal: foodKcal,
        proteinG: foodProtein,
        carbsG: foodCarbs,
        fatG: foodFat,
        fiberG: foodFiber,
        sourceRef: foodSource.trim(),
        verified: hasReliableSource,
        updatedDate: new Date().toISOString().slice(0, 10),
        createdByUid: user.uid,
      },
      true
    );
    setFoodName('');
    setFoodSource('');
    await loadData();
  };

  const handleSeedFoods = async () => {
    for (const f of SEED_VIETNAMESE_FOODS) {
      await FoodRepo.upsert({ ...f, createdByUid: user.uid }, true);
    }
    await loadData();
  };

  const handleSaveSystemConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    await SystemConfigRepo.saveGlobal({
      configId: 'global',
      aiRateLimitPerMinute: rateLimit,
      aiTimeoutMs: timeoutMs,
      defaultRetentionDays: retentionDays,
      backupSchedule: sysConfig?.backupSchedule || 'Hàng tuần (Chủ nhật 02:00)',
      lastBackupExportAt: new Date().toISOString(),
      maintenanceMode,
      updatedByUid: user.uid,
    });
    await AuditService.log({
      actorUid: user.uid,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'SYSTEM_CONFIG_UPDATED',
      targetCollection: 'system_config',
      targetId: 'global',
      details: `rateLimit=${rateLimit}, timeoutMs=${timeoutMs}, retentionDays=${retentionDays}`,
    });
    await loadData();
  };

  return (
    <DashboardShell
      user={user}
      schoolName="Quản trị Toàn hệ thống"
      navItems={navItems}
      activeTab={activeTab}
      onSelectTab={setActiveTab}
      onLogout={onLogout}
      onOpenPrivacyModal={onOpenPrivacyModal}
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
                  <div className="text-xs text-slate-500">Tổng số trường</div>
                  <div className="mt-1 text-2xl font-bold font-mono tabular-nums">{schools.length}</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="text-xs text-slate-500">Tổng tài khoản</div>
                  <div className="mt-1 text-2xl font-bold font-mono tabular-nums">{users.length}</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="text-xs text-slate-500">Nhật ký bữa ăn</div>
                  <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-emerald-700">{meals.length}</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="text-xs text-slate-500">Lượt AI (Lỗi)</div>
                  <div className="mt-1 text-2xl font-bold font-mono tabular-nums">
                    {aiLogs.length} ({aiErrorCount})
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="text-xs text-slate-500">Chi phí AI ước tính</div>
                  <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-amber-700">
                    ${totalAiCostUsd.toFixed(4)}
                  </div>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-slate-900 mb-3">Tần suất sử dụng theo AI Endpoint</h3>
                {aiByEndpoint.length === 0 ? (
                  <div className="h-56 flex items-center justify-center text-xs text-slate-400">
                    Chưa có lượt gọi AI nào được ghi nhận.
                  </div>
                ) : (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={aiByEndpoint}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="endpoint" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Bar dataKey="calls" name="Số lượt gọi" fill="#059669" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'schools' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <form onSubmit={handleCreateSchool} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                <h3 className="text-base font-semibold text-slate-900">Thêm trường học mới</h3>
                <input
                  required
                  value={schName}
                  onChange={(e) => setSchName(e.target.value)}
                  placeholder="Tên trường"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
                <input
                  required
                  value={schCode}
                  onChange={(e) => setSchCode(e.target.value)}
                  placeholder="Mã trường (VD: TH_LE_LOI)"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                />
                <input
                  value={schProvince}
                  onChange={(e) => setSchProvince(e.target.value)}
                  placeholder="Tỉnh / Thành phố"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
                <select
                  value={schLevel}
                  onChange={(e) => setSchLevel(e.target.value as any)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                >
                  <option value="primary">Tiểu học</option>
                  <option value="secondary">THCS</option>
                  <option value="high">THPT</option>
                  <option value="k12">Liên cấp K12</option>
                </select>
                <button type="submit" className="w-full px-4 py-2 bg-emerald-700 text-white text-sm font-medium rounded-lg">
                  Tạo trường học
                </button>
              </form>

              <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 font-semibold text-sm text-slate-900">
                  Danh sách trường trong hệ thống ({schools.length})
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                        <th className="py-2.5 px-4">Tên trường</th>
                        <th className="py-2.5 px-4">Mã</th>
                        <th className="py-2.5 px-4">Cấp</th>
                        <th className="py-2.5 px-4">Trạng thái</th>
                        <th className="py-2.5 px-4 text-right">Xóa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {schools.map((s) => (
                        <tr key={s.id}>
                          <td className="py-2.5 px-4 font-medium text-slate-900">{s.name}</td>
                          <td className="py-2.5 px-4 font-mono text-xs">{s.code}</td>
                          <td className="py-2.5 px-4 text-xs">{s.level}</td>
                          <td className="py-2.5 px-4 text-xs">{s.status}</td>
                          <td className="py-2.5 px-4 text-right">
                            <button
                              type="button"
                              onClick={async () => {
                                await SchoolRepo.delete(s.id);
                                await loadData();
                              }}
                              className="p-1.5 text-rose-600 hover:bg-rose-50 rounded"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'users' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 font-semibold text-sm text-slate-900">
                Quản lý Tài khoản & Phân quyền RBAC ({users.length})
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-2.5 px-4">Người dùng</th>
                      <th className="py-2.5 px-4">Email</th>
                      <th className="py-2.5 px-4">Trường</th>
                      <th className="py-2.5 px-4">Vai trò (RBAC)</th>
                      <th className="py-2.5 px-4">Trạng thái</th>
                      <th className="py-2.5 px-4 text-right">Xóa</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {users.map((u) => (
                      <tr key={u.uid}>
                        <td className="py-2.5 px-4 font-medium text-slate-900">{u.displayName}</td>
                        <td className="py-2.5 px-4 text-xs text-slate-600">{u.email}</td>
                        <td className="py-2.5 px-4">
                          <select
                            value={u.schoolId}
                            onChange={async (e) => {
                              await UserRepo.update(u.uid, { schoolId: e.target.value });
                              await loadData();
                            }}
                            className="px-2 py-1 text-xs border border-slate-200 rounded bg-white"
                          >
                            <option value="">Toàn hệ thống</option>
                            {schools.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2.5 px-4">
                          <select
                            value={u.role}
                            onChange={async (e) => {
                              const nextRole = e.target.value as UserRole;
                              await UserRepo.update(u.uid, { role: nextRole });
                              await AuditService.log({
                                schoolId: u.schoolId,
                                actorUid: user.uid,
                                actorEmail: user.email,
                                actorRole: user.role,
                                action: 'USER_ROLE_CHANGE',
                                targetCollection: 'users',
                                targetId: u.uid,
                                details: `${u.role} -> ${nextRole}`,
                              });
                              await loadData();
                            }}
                            className="px-2 py-1 text-xs border border-slate-200 rounded bg-white"
                          >
                            <option value="student">student</option>
                            <option value="parent">parent</option>
                            <option value="teacher">teacher</option>
                            <option value="school_admin">school_admin</option>
                            <option value="super_admin">super_admin</option>
                          </select>
                        </td>
                        <td className="py-2.5 px-4">
                          <button
                            type="button"
                            disabled={u.uid === user.uid}
                            onClick={async () => {
                              const nextStatus = u.status === 'suspended' ? 'active' : 'suspended';
                              await UserRepo.update(u.uid, { status: nextStatus });
                              await AuditService.log({
                                schoolId: u.schoolId,
                                actorUid: user.uid,
                                actorEmail: user.email,
                                actorRole: user.role,
                                action: nextStatus === 'suspended' ? 'USER_SUSPEND' : 'USER_ACTIVATE',
                                targetCollection: 'users',
                                targetId: u.uid,
                              });
                              await loadData();
                            }}
                            className={`px-2.5 py-1 text-xs rounded-lg font-medium ${
                              u.status === 'suspended'
                                ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            }`}
                          >
                            {u.status}
                          </button>
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          {u.uid !== user.uid && (
                            <button
                              type="button"
                              onClick={async () => {
                                await UserRepo.delete(u.uid);
                                await loadData();
                              }}
                              className="p-1.5 text-rose-600 hover:bg-rose-50 rounded"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
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
                    Tải thêm tài khoản
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'foods' && (
            <div className="space-y-6">
              <form onSubmit={handleCreateFood} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-slate-900">Thêm thực phẩm Việt Nam vào Firestore</h3>
                  <button
                    type="button"
                    onClick={handleSeedFoods}
                    className="px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg"
                  >
                    Đồng bộ 18 món chuẩn Viện Dinh dưỡng
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <input
                    required
                    value={foodName}
                    onChange={(e) => setFoodName(e.target.value)}
                    placeholder="Tên tiếng Việt"
                    className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                  <select
                    value={foodCat}
                    onChange={(e) => setFoodCat(e.target.value as FoodCategory)}
                    className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    {Object.entries(FOOD_CATEGORY_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    value={foodServing}
                    onChange={(e) => setFoodServing(Number(e.target.value))}
                    placeholder="Khẩu phần (g)"
                    className="px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                  />
                  <input
                    type="number"
                    value={foodKcal}
                    onChange={(e) => setFoodKcal(Number(e.target.value))}
                    placeholder="Kcal"
                    className="px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                  />
                  <input
                    type="number"
                    step="0.1"
                    value={foodProtein}
                    onChange={(e) => setFoodProtein(Number(e.target.value))}
                    placeholder="Protein (g)"
                    className="px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                  />
                  <input
                    type="number"
                    step="0.1"
                    value={foodCarbs}
                    onChange={(e) => setFoodCarbs(Number(e.target.value))}
                    placeholder="Carbs (g)"
                    className="px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                  />
                  <input
                    type="number"
                    step="0.1"
                    value={foodFat}
                    onChange={(e) => setFoodFat(Number(e.target.value))}
                    placeholder="Fat (g)"
                    className="px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                  />
                  <input
                    type="number"
                    step="0.1"
                    value={foodFiber}
                    onChange={(e) => setFoodFiber(Number(e.target.value))}
                    placeholder="Fiber (g)"
                    className="px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                  />
                </div>
                <div className="flex gap-3">
                  <input
                    value={foodSource}
                    onChange={(e) => setFoodSource(e.target.value)}
                    placeholder="Nguồn tham khảo (nếu để trống sẽ tự động đánh dấu Chưa xác minh)"
                    className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                  <button type="submit" className="px-4 py-2 bg-emerald-700 text-white text-sm font-medium rounded-lg">
                    Lưu thực phẩm
                  </button>
                </div>
              </form>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                        <th className="py-2.5 px-4">Tên món</th>
                        <th className="py-2.5 px-4">Nhóm</th>
                        <th className="py-2.5 px-4 text-right">Khẩu phần</th>
                        <th className="py-2.5 px-4 text-right">Kcal</th>
                        <th className="py-2.5 px-4">Xác minh nguồn</th>
                        <th className="py-2.5 px-4 text-right">Xóa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {foods.map((f) => (
                        <tr key={f.id}>
                          <td className="py-2.5 px-4 font-medium">{f.nameVi}</td>
                          <td className="py-2.5 px-4 text-xs text-slate-600">{FOOD_CATEGORY_LABELS[f.category]}</td>
                          <td className="py-2.5 px-4 text-right font-mono text-xs">{f.standardServingG}g</td>
                          <td className="py-2.5 px-4 text-right font-mono text-xs">{f.energyKcal}</td>
                          <td className="py-2.5 px-4 text-xs">
                            {f.verified ? (
                              <span className="text-emerald-700 font-medium">Đã xác minh</span>
                            ) : (
                              <span className="text-amber-700 font-medium">Chưa xác minh</span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            <button
                              type="button"
                              onClick={async () => {
                                await FoodRepo.delete(f.id);
                                await loadData();
                              }}
                              className="p-1.5 text-rose-600 hover:bg-rose-50 rounded"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'ai_monitor' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                <span className="font-semibold text-sm text-slate-900">Nhật ký API Usage & Chi phí Gemini ({aiLogs.length})</span>
                <span className="font-mono text-xs text-slate-600">Tổng ước tính: ${totalAiCostUsd.toFixed(5)}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-2.5 px-4">Endpoint</th>
                      <th className="py-2.5 px-4">Model</th>
                      <th className="py-2.5 px-4">Vai trò</th>
                      <th className="py-2.5 px-4 text-right">Tokens</th>
                      <th className="py-2.5 px-4 text-right">Latency</th>
                      <th className="py-2.5 px-4">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {aiLogs.map((l) => (
                      <tr key={l.id}>
                        <td className="py-2.5 px-4 font-mono text-slate-900">{l.endpoint}</td>
                        <td className="py-2.5 px-4 font-mono text-slate-600">{l.model}</td>
                        <td className="py-2.5 px-4">{l.userRole}</td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">{l.totalTokens}</td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">{l.latencyMs}ms</td>
                        <td className="py-2.5 px-4 font-semibold">{l.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {hasMoreAiLogs && (
                <div className="p-3 border-t border-slate-200 text-center">
                  <button
                    type="button"
                    onClick={handleLoadMoreAiLogs}
                    className="px-4 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 rounded-lg"
                  >
                    Tải thêm nhật ký AI Usage
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'audit_config' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <form onSubmit={handleSaveSystemConfig} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <div className="flex items-center gap-2 font-semibold text-slate-900">
                  <ShieldAlert className="w-4 h-4 text-emerald-700" />
                  Cấu hình AI, Lưu giữ & Sao lưu
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Giới hạn AI (lượt / phút / user)</label>
                  <input
                    type="number"
                    value={rateLimit}
                    onChange={(e) => setRateLimit(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Timeout AI (ms)</label>
                  <input
                    type="number"
                    value={timeoutMs}
                    onChange={(e) => setTimeoutMs(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Data Retention mặc định (ngày)</label>
                  <input
                    type="number"
                    value={retentionDays}
                    onChange={(e) => setRetentionDays(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={maintenanceMode}
                    onChange={(e) => setMaintenanceMode(e.target.checked)}
                  />
                  <span>Chế độ bảo trì hệ thống</span>
                </label>
                <button type="submit" className="w-full px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg">
                  Lưu cấu hình hệ thống
                </button>
              </form>

              <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 font-semibold text-sm text-slate-900">
                  Nhật ký kiểm toán bất biến (Audit Logs · {auditLogs.length})
                </div>
                <div className="overflow-x-auto max-h-[460px]">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                        <th className="py-2.5 px-4">Hành động</th>
                        <th className="py-2.5 px-4">Người thực hiện</th>
                        <th className="py-2.5 px-4">Đối tượng</th>
                        <th className="py-2.5 px-4">Chi tiết</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {auditLogs.map((a) => (
                        <tr key={a.id}>
                          <td className="py-2.5 px-4 font-mono font-semibold text-slate-900">{a.action}</td>
                          <td className="py-2.5 px-4 text-slate-600">
                            {a.actorEmail || a.actorUid} ({a.actorRole})
                          </td>
                          <td className="py-2.5 px-4 font-mono text-slate-600">
                            {a.targetCollection}/{a.targetId}
                          </td>
                          <td className="py-2.5 px-4 text-slate-700">{a.details}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {hasMoreAuditLogs && (
                  <div className="p-3 border-t border-slate-200 text-center">
                    <button
                      type="button"
                      onClick={handleLoadMoreAuditLogs}
                      className="px-4 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 rounded-lg"
                    >
                      Tải thêm nhật ký kiểm toán
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'reports' && (
            <ReportsCenter
              user={user}
              mealLogs={meals}
              menus={menus}
              schools={schools}
              aiUsageLogs={aiLogs}
            />
          )}
        </>
      )}
    </DashboardShell>
  );
}
