import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  CalendarDays,
  Camera,
  LayoutDashboard,
  MessageSquare,
  Users,
} from 'lucide-react';
import {
  Line,
  LineChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ConsentRecord,
  MealLog,
  MenuPlan,
  NotificationItem,
  ParentChildLink,
  StudentProgress,
  TeacherComment,
  UserProfile,
  VietnameseFood,
} from '../types/domain';
import {
  ConsentRepo,
  FoodRepo,
  MealLogRepo,
  MenuRepo,
  NotificationRepo,
  ParentChildLinkRepo,
  StudentProgressRepo,
  TeacherCommentRepo,
  UserRepo,
} from '../lib/repositories';
import { SEED_VIETNAMESE_FOODS } from '../lib/vietnameseFoods';
import { makeId } from '../lib/services';
import { DashboardShell, NavItem } from '../components/DashboardShell';
import { MealAnalyzerModule } from '../components/MealAnalyzerModule';
import { ReportsCenter } from '../components/ReportsCenter';

interface ParentDashboardProps {
  user: UserProfile;
  schoolName: string;
  onLogout: () => void;
  onOpenPrivacyModal: () => void;
}

export function ParentDashboard({
  user,
  schoolName,
  onLogout,
  onOpenPrivacyModal,
}: ParentDashboardProps) {
  const [activeTab, setActiveTab] = useState('children');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const [links, setLinks] = useState<ParentChildLink[]>([]);
  const [childrenProfiles, setChildrenProfiles] = useState<UserProfile[]>([]);
  const [selectedChildUid, setSelectedChildUid] = useState<string>(user.linkedChildIds?.[0] || '');

  const [meals, setMeals] = useState<MealLog[]>([]);
  const [mealCursor, setMealCursor] = useState<any>(null);
  const [hasMoreMeals, setHasMoreMeals] = useState(false);
  const [menus, setMenus] = useState<MenuPlan[]>([]);
  const [comments, setComments] = useState<TeacherComment[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [foods, setFoods] = useState<VietnameseFood[]>(SEED_VIETNAMESE_FOODS);
  const [childProgress, setChildProgress] = useState<StudentProgress | null>(null);
  const [growthConsented, setGrowthConsented] = useState(false);

  const [requestStudentUid, setRequestStudentUid] = useState('');
  const [requestStudentName, setRequestStudentName] = useState('');
  const [allergyInput, setAllergyInput] = useState('');
  const [heightCm, setHeightCm] = useState(138);
  const [weightKg, setWeightKg] = useState(32);

  const navItems: NavItem[] = [
    { id: 'children', label: 'Quản lý con & Liên kết', icon: Users },
    { id: 'meals', label: 'Theo dõi & Chụp bữa ăn', icon: Camera },
    { id: 'allergies', label: 'Quản lý dị ứng', icon: AlertTriangle },
    { id: 'menus', label: 'Thực đơn trường', icon: CalendarDays },
    { id: 'feedback', label: 'Nhận xét & Thông báo', icon: MessageSquare },
    { id: 'growth', label: 'Phát triển thể chất', icon: Activity },
    { id: 'reports', label: 'Báo cáo tuần / tháng', icon: BarChart3 },
  ];

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const [linkList, mealRes, menuRes, commentRes, notifList, foodList] = await Promise.all([
        ParentChildLinkRepo.listForParent(user.uid),
        MealLogRepo.listForParent(user.uid, 40),
        user.schoolId ? MenuRepo.listForSchool(user.schoolId, 15) : Promise.resolve({ items: [], lastCursor: null, hasMore: false }),
        TeacherCommentRepo.listForParent(user.uid, 25),
        NotificationRepo.listForUser(user.uid, 25),
        FoodRepo.listAll(100),
      ]);
      setLinks(linkList);
      setMeals(mealRes.items);
      setMealCursor(mealRes.lastCursor);
      setHasMoreMeals(mealRes.hasMore);
      setMenus(menuRes.items.filter((m) => m.status === 'published' || m.status === 'approved'));
      setComments(commentRes.items);
      setNotifications(notifList);
      if (foodList.length > 0) setFoods(foodList);

      const linkedIds = user.linkedChildIds || [];
      const fetchedChildren: UserProfile[] = [];
      for (const cid of linkedIds) {
        const cp = await UserRepo.getById(cid);
        if (cp) fetchedChildren.push(cp);
      }
      setChildrenProfiles(fetchedChildren);
      const activeId = selectedChildUid && linkedIds.includes(selectedChildUid) ? selectedChildUid : linkedIds[0] || '';
      setSelectedChildUid(activeId);

      if (activeId) {
        const [prog, consents] = await Promise.all([
          StudentProgressRepo.get(activeId),
          ConsentRepo.listForUser(user.uid),
        ]);
        setChildProgress(prog);
        const hasConsent = consents.some(
          (c: ConsentRecord) => c.subjectStudentUid === activeId && c.consentType === 'growth_tracking' && c.granted
        );
        setGrowthConsented(hasConsent);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể tải dữ liệu phụ huynh.');
    } finally {
      setLoading(false);
    }
  }, [user.uid, user.schoolId, user.linkedChildIds, selectedChildUid]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const activeChild = useMemo(
    () => childrenProfiles.find((c) => c.uid === selectedChildUid) || null,
    [childrenProfiles, selectedChildUid]
  );

  const childMeals = useMemo(
    () => (selectedChildUid ? meals.filter((m) => m.studentUid === selectedChildUid) : meals),
    [meals, selectedChildUid]
  );

  const handleLoadMoreMeals = async () => {
    if (!mealCursor) return;
    const next = await MealLogRepo.listForParent(user.uid, 40, mealCursor);
    setMeals((prev) => [...prev, ...next.items]);
    setMealCursor(next.lastCursor);
    setHasMoreMeals(next.hasMore);
  };

  const handleRequestLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedUid = requestStudentUid.trim();
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(cleanedUid)) {
      setErrorMsg('Mã UID học sinh chỉ được chứa chữ cái, số, dấu gạch dưới (_) hoặc gạch ngang (-).');
      return;
    }
    setErrorMsg('');
    await ParentChildLinkRepo.create({
      id: makeId('link'),
      schoolId: user.schoolId || 'school_th_chu_van_an',
      parentUid: user.uid,
      parentEmail: user.email,
      studentUid: cleanedUid,
      studentName: requestStudentName.trim() || cleanedUid,
      status: 'pending',
    });
    setRequestStudentUid('');
    setRequestStudentName('');
    await loadData();
  };

  const handleUpdateAllergies = async (nextAllergies: string[]) => {
    if (!activeChild) return;
    await UserRepo.update(activeChild.uid, { allergies: nextAllergies });
    await loadData();
  };

  const handleAddGrowthRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeChild || !growthConsented) return;
    const records = [
      ...(childProgress?.growthRecords || []),
      { dateStr: new Date().toISOString().slice(0, 10), heightCm, weightKg },
    ].slice(-30);
    await StudentProgressRepo.upsert({
      studentUid: activeChild.uid,
      schoolId: activeChild.schoolId,
      classId: activeChild.classIds?.[0] || '',
      verifiedParentIds: activeChild.verifiedParentIds || [],
      points: childProgress?.points || 0,
      streakDays: childProgress?.streakDays || 0,
      completedTaskIds: childProgress?.completedTaskIds || [],
      quizHistory: childProgress?.quizHistory || [],
      badges: childProgress?.badges || [],
      growthRecords: records,
    });
    await loadData();
  };

  return (
    <DashboardShell
      user={user}
      schoolName={schoolName}
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
          {activeTab === 'children' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <h3 className="text-base font-semibold text-slate-900">Con đã liên kết & Xác minh</h3>
                {childrenProfiles.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    Chưa có học sinh nào được xác minh liên kết. Vui lòng gửi yêu cầu liên kết bên cạnh để Nhà trường duyệt.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {childrenProfiles.map((child) => (
                      <button
                        key={child.uid}
                        type="button"
                        onClick={() => setSelectedChildUid(child.uid)}
                        className={`w-full text-left p-3.5 rounded-lg border transition-colors ${
                          child.uid === selectedChildUid
                            ? 'bg-emerald-50 border-emerald-300'
                            : 'bg-white border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <div className="text-sm font-semibold text-slate-900">{child.displayName}</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          UID: <span className="font-mono">{child.uid}</span> · Tuổi {child.ageGroup || '9-11'} · Dị ứng:{' '}
                          {(child.allergies || []).join(', ') || 'Không'}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                <div className="pt-3 border-t border-slate-100 space-y-2">
                  <div className="text-xs font-semibold text-slate-700">Lịch sử yêu cầu liên kết</div>
                  {links.length === 0 ? (
                    <div className="text-xs text-slate-400">Chưa có yêu cầu nào.</div>
                  ) : (
                    links.map((lk) => (
                      <div key={lk.id} className="text-xs flex items-center justify-between py-1.5 border-b border-slate-100">
                        <span>
                          {lk.studentName} (<span className="font-mono">{lk.studentUid}</span>)
                        </span>
                        <span className="font-semibold text-slate-700">{lk.status}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <form onSubmit={handleRequestLink} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <h3 className="text-base font-semibold text-slate-900">Gửi yêu cầu liên kết với con</h3>
                <p className="text-xs text-slate-500">
                  Nhập mã UID học sinh (do nhà trường hoặc học sinh cung cấp). Yêu cầu sẽ được Quản trị nhà trường xác minh trước khi mở quyền xem dữ liệu.
                </p>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Mã UID Học sinh</label>
                  <input
                    required
                    value={requestStudentUid}
                    onChange={(e) => setRequestStudentUid(e.target.value)}
                    placeholder="VD: uid_hoc_sinh..."
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Họ tên học sinh</label>
                  <input
                    value={requestStudentName}
                    onChange={(e) => setRequestStudentName(e.target.value)}
                    placeholder="Nguyễn Minh An"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-700 text-white text-sm font-medium rounded-lg hover:bg-emerald-800"
                >
                  Gửi yêu cầu xác minh
                </button>
              </form>
            </div>
          )}

          {activeTab === 'meals' && (
            <div className="space-y-6">
              {activeChild ? (
                <MealAnalyzerModule
                  actor={user}
                  targetStudent={activeChild}
                  foodsCatalog={foods}
                  onSaved={() => void loadData()}
                />
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-500">
                  Cần liên kết ít nhất 1 học sinh đã xác minh để ghi nhận bữa ăn hộ con.
                </div>
              )}

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 font-semibold text-sm text-slate-900">
                  Bữa ăn đã ghi nhận của con
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                        <th className="py-2.5 px-4">Ngày</th>
                        <th className="py-2.5 px-4">Học sinh</th>
                        <th className="py-2.5 px-4">Bữa</th>
                        <th className="py-2.5 px-4">Món ăn</th>
                        <th className="py-2.5 px-4 text-right">Kcal</th>
                        <th className="py-2.5 px-4 text-right">Điểm</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {childMeals.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-6 text-center text-xs text-slate-500">
                            Chưa có dữ liệu bữa ăn.
                          </td>
                        </tr>
                      ) : (
                        childMeals.map((m) => (
                          <tr key={m.id}>
                            <td className="py-2.5 px-4 font-mono text-xs tabular-nums">{m.dateStr}</td>
                            <td className="py-2.5 px-4">{m.studentName}</td>
                            <td className="py-2.5 px-4">{m.mealType}</td>
                            <td className="py-2.5 px-4 text-xs">{m.items.map((i) => i.nameVi).join(', ')}</td>
                            <td className="py-2.5 px-4 text-right font-mono tabular-nums">{m.nutritionTotals.kcal}</td>
                            <td className="py-2.5 px-4 text-right font-mono tabular-nums text-emerald-700 font-semibold">
                              {m.scoreBreakdown.totalScore}/100
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {hasMoreMeals && (
                  <div className="p-3 border-t border-slate-200 text-center">
                    <button
                      type="button"
                      onClick={handleLoadMoreMeals}
                      className="px-4 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 rounded-lg"
                    >
                      Tải thêm lịch sử bữa ăn
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'allergies' && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <h3 className="text-base font-semibold text-slate-900">Quản lý dị ứng thực phẩm của con</h3>
              {!activeChild ? (
                <p className="text-sm text-slate-500">Vui lòng liên kết học sinh để cập nhật danh sách dị ứng.</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    {(activeChild.allergies || []).length === 0 ? (
                      <span className="text-xs text-slate-500">Chưa ghi nhận tác nhân dị ứng nào.</span>
                    ) : (
                      activeChild.allergies?.map((a, idx) => (
                        <div
                          key={idx}
                          className="inline-flex items-center gap-2 px-3 py-1.5 bg-rose-50 border border-rose-200 rounded-lg text-xs font-medium text-rose-800"
                        >
                          <span>{a}</span>
                          <button
                            type="button"
                            onClick={() =>
                              void handleUpdateAllergies((activeChild.allergies || []).filter((x) => x !== a))
                            }
                            className="text-rose-700 hover:underline"
                          >
                            Xóa
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="flex gap-2 max-w-md">
                    <input
                      value={allergyInput}
                      onChange={(e) => setAllergyInput(e.target.value)}
                      placeholder="VD: đậu phộng, tôm, sữa..."
                      className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!allergyInput.trim()) return;
                        const next = Array.from(new Set([...(activeChild.allergies || []), allergyInput.trim()]));
                        setAllergyInput('');
                        void handleUpdateAllergies(next);
                      }}
                      className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg"
                    >
                      Thêm dị ứng
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'menus' && (
            <div className="space-y-4">
              {menus.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
                  Chưa có thực đơn trường công bố.
                </div>
              ) : (
                menus.map((menu) => (
                  <div key={menu.id} className="bg-white border border-slate-200 rounded-xl p-5 space-y-2">
                    <div className="font-semibold text-slate-900">{menu.title}</div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {menu.days.map((d, i) => (
                        <div key={i} className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                          <div className="font-semibold">{d.dayLabel} · {d.dayKcal} kcal</div>
                          {d.meals.map((s, j) => (
                            <div key={j} className="mt-1 text-slate-700">
                              {s.mealType}: {s.dishes.map((x) => x.nameVi).join(', ')}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'feedback' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                <div className="flex items-center gap-2 font-semibold text-slate-900 text-base">
                  <Bell className="w-4 h-4 text-emerald-700" />
                  Thông báo
                </div>
                {notifications.length === 0 ? (
                  <p className="text-xs text-slate-500">Chưa có thông báo mới.</p>
                ) : (
                  notifications.map((n) => (
                    <div key={n.id} className="p-3 border border-slate-200 rounded-lg flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium text-slate-900">{n.title}</div>
                        <div className="text-xs text-slate-600 mt-0.5">{n.body}</div>
                      </div>
                      {!n.read && (
                        <button
                          type="button"
                          onClick={async () => {
                            await NotificationRepo.markRead(n.id);
                            await loadData();
                          }}
                          className="text-xs text-emerald-700 font-medium whitespace-nowrap"
                        >
                          Đánh dấu đã đọc
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                <div className="font-semibold text-slate-900 text-base">Nhận xét giáo viên & Gợi ý tại nhà</div>
                {comments.length === 0 ? (
                  <p className="text-xs text-slate-500">Chưa có nhận xét nào từ giáo viên.</p>
                ) : (
                  comments.map((c) => (
                    <div key={c.id} className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1 text-xs">
                      <div className="font-semibold text-slate-900">
                        {c.studentName} · {c.teacherName} ({c.category})
                      </div>
                      <p className="text-slate-700">{c.content}</p>
                      {c.homeSuggestion && (
                        <p className="text-emerald-800 font-medium">Gợi ý tại nhà: {c.homeSuggestion}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'growth' && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <h3 className="text-base font-semibold text-slate-900">Theo dõi thông tin phát triển</h3>
              {!growthConsented ? (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900 space-y-2">
                  <div>
                    Tính năng theo dõi chiều cao/cân nặng yêu cầu xác nhận đồng ý (Consent Record: <span className="font-mono">growth_tracking</span>).
                  </div>
                  <button
                    type="button"
                    onClick={onOpenPrivacyModal}
                    className="px-3.5 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg"
                  >
                    Mở quản lý đồng ý
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <form onSubmit={handleAddGrowthRecord} className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Chiều cao (cm)</label>
                      <input
                        type="number"
                        value={heightCm}
                        onChange={(e) => setHeightCm(Number(e.target.value))}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Cân nặng (kg)</label>
                      <input
                        type="number"
                        value={weightKg}
                        onChange={(e) => setWeightKg(Number(e.target.value))}
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                      />
                    </div>
                    <button type="submit" className="px-4 py-2 bg-emerald-700 text-white text-sm font-medium rounded-lg">
                      Ghi nhận chỉ số
                    </button>
                  </form>
                  <div className="lg:col-span-2 h-60">
                    {(childProgress?.growthRecords || []).length === 0 ? (
                      <div className="h-full flex items-center justify-center text-xs text-slate-400">
                        Chưa có bản ghi phát triển.
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={childProgress?.growthRecords || []}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis dataKey="dateStr" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <Tooltip />
                          <Line type="monotone" dataKey="heightCm" name="Chiều cao (cm)" stroke="#059669" />
                          <Line type="monotone" dataKey="weightKg" name="Cân nặng (kg)" stroke="#0284c7" />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'reports' && (
            <ReportsCenter
              user={user}
              mealLogs={childMeals}
              menus={menus}
              comments={comments}
              students={childrenProfiles}
            />
          )}
        </>
      )}
    </DashboardShell>
  );
}
