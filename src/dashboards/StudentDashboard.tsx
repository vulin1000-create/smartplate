import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Award,
  BarChart3,
  BookOpen,
  CalendarDays,
  Camera,
  CheckCircle2,
  ClipboardList,
  LayoutDashboard,
  Trash2,
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
  MealLog,
  MenuPlan,
  StudentProgress,
  StudentTask,
  TeacherComment,
  UserProfile,
  VietnameseFood,
} from '../types/domain';
import {
  FoodRepo,
  MealLogRepo,
  MenuRepo,
  StudentProgressRepo,
  StudentTaskRepo,
  TeacherCommentRepo,
} from '../lib/repositories';
import { getMealTarget } from '../lib/nutritionEngine';
import { SEED_VIETNAMESE_FOODS } from '../lib/vietnameseFoods';
import { DashboardShell, NavItem } from '../components/DashboardShell';
import { MealAnalyzerModule } from '../components/MealAnalyzerModule';
import { ReportsCenter } from '../components/ReportsCenter';

const NUTRITION_QUIZZES = [
  {
    id: 'q1',
    question: 'Nhóm thực phẩm nào cung cấp chất xơ và vitamin C dồi dào giúp hệ tiêu hóa khỏe mạnh?',
    options: ['Rau củ và trái cây tươi', 'Dầu ăn và mỡ động vật', 'Đường tinh luyện'],
    answerIdx: 0,
  },
  {
    id: 'q2',
    question: 'Một bữa trưa cân đối cho học sinh tiểu học cần có đủ mấy nhóm thực phẩm chính?',
    options: ['Chỉ cần tinh bột', 'Ít nhất 4 nhóm (Tinh bột, Đạm, Rau củ, Chất béo/Quả)', 'Chỉ cần thịt và cơm'],
    answerIdx: 1,
  },
  {
    id: 'q3',
    question: 'Thói quen nào tốt nhất trước khi ăn trưa bán trú tại trường?',
    options: ['Rửa tay bằng xà phòng và ăn đa dạng món', 'Bỏ qua canh và rau xanh', 'Uống nước ngọt có ga'],
    answerIdx: 0,
  },
];

interface StudentDashboardProps {
  user: UserProfile;
  schoolName: string;
  onLogout: () => void;
  onOpenPrivacyModal: () => void;
}

export function StudentDashboard({
  user,
  schoolName,
  onLogout,
  onOpenPrivacyModal,
}: StudentDashboardProps) {
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const [meals, setMeals] = useState<MealLog[]>([]);
  const [mealCursor, setMealCursor] = useState<any>(null);
  const [hasMoreMeals, setHasMoreMeals] = useState(false);

  const [menus, setMenus] = useState<MenuPlan[]>([]);
  const [tasks, setTasks] = useState<StudentTask[]>([]);
  const [comments, setComments] = useState<TeacherComment[]>([]);
  const [foods, setFoods] = useState<VietnameseFood[]>(SEED_VIETNAMESE_FOODS);
  const [progress, setProgress] = useState<StudentProgress | null>(null);

  const [mealFilter, setMealFilter] = useState<string>('all');
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
  const [quizMessage, setQuizMessage] = useState('');

  const navItems: NavItem[] = [
    { id: 'overview', label: 'Tổng quan hôm nay', icon: LayoutDashboard },
    { id: 'analyze', label: 'Chụp & Phân tích bữa ăn', icon: Camera },
    { id: 'journal', label: 'Nhật ký & Lịch sử', icon: ClipboardList },
    { id: 'menus', label: 'Thực đơn trường', icon: CalendarDays },
    { id: 'learn', label: 'Nhiệm vụ, Quiz & Huy hiệu', icon: Award },
    { id: 'reports', label: 'Báo cáo cá nhân', icon: BarChart3 },
  ];

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const [mealRes, menuRes, taskRes, commentRes, foodRes, progRes] = await Promise.all([
        MealLogRepo.listForStudent(user.uid, 20),
        user.schoolId ? MenuRepo.listForSchool(user.schoolId, 15) : Promise.resolve({ items: [], lastCursor: null, hasMore: false }),
        user.schoolId ? StudentTaskRepo.listForSchool(user.schoolId, user.classIds?.[0]) : Promise.resolve({ items: [], lastCursor: null, hasMore: false }),
        TeacherCommentRepo.listForStudent(user.uid, 15),
        FoodRepo.listAll(100),
        StudentProgressRepo.get(user.uid),
      ]);
      setMeals(mealRes.items);
      setMealCursor(mealRes.lastCursor);
      setHasMoreMeals(mealRes.hasMore);
      setMenus(menuRes.items.filter((m) => m.status === 'published' || m.status === 'approved'));
      setTasks(taskRes.items);
      setComments(commentRes.items);
      if (foodRes.length > 0) setFoods(foodRes);
      setProgress(progRes);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể tải dữ liệu học sinh.');
    } finally {
      setLoading(false);
    }
  }, [user.uid, user.schoolId, user.classIds]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleLoadMoreMeals = async () => {
    if (!mealCursor) return;
    const next = await MealLogRepo.listForStudent(user.uid, 20, mealCursor);
    setMeals((prev) => [...prev, ...next.items]);
    setMealCursor(next.lastCursor);
    setHasMoreMeals(next.hasMore);
  };

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayMeals = useMemo(() => meals.filter((m) => m.dateStr === todayStr), [meals, todayStr]);
  const todayKcal = todayMeals.reduce((s, m) => s + (m.nutritionTotals?.kcal || 0), 0);
  const lunchTarget = getMealTarget(user.ageGroup || '9-11', 'lunch').kcal;

  const weeklyChartData = useMemo(() => {
    return meals
      .slice(0, 10)
      .reverse()
      .map((m) => ({
        label: `${m.dateStr.slice(5)} (${m.mealType})`,
        kcal: m.nutritionTotals?.kcal || 0,
        score: m.scoreBreakdown?.totalScore || 0,
      }));
  }, [meals]);

  const filteredMeals = useMemo(() => {
    if (mealFilter === 'all') return meals;
    return meals.filter((m) => m.mealType === mealFilter);
  }, [meals, mealFilter]);

  const handleCompleteTask = async (task: StudentTask) => {
    const completed = new Set(progress?.completedTaskIds || []);
    if (completed.has(task.id)) return;
    completed.add(task.id);
    const nextPoints = (progress?.points || 0) + task.points;
    const badges = new Set(progress?.badges || []);
    if (completed.size >= 3) badges.add('Hoàn thành 3 nhiệm vụ');
    await StudentProgressRepo.upsert({
      studentUid: user.uid,
      schoolId: user.schoolId || 'school_th_chu_van_an',
      classId: user.classIds?.[0] || '',
      verifiedParentIds: user.verifiedParentIds || [],
      points: nextPoints,
      streakDays: progress?.streakDays || 1,
      completedTaskIds: Array.from(completed),
      quizHistory: progress?.quizHistory || [],
      badges: Array.from(badges),
      growthRecords: progress?.growthRecords || [],
    });
    await loadData();
  };

  const handleSubmitQuiz = async () => {
    let correct = 0;
    NUTRITION_QUIZZES.forEach((q) => {
      if (quizAnswers[q.id] === q.answerIdx) correct += 1;
    });
    const earned = correct * 10;
    const nextPoints = (progress?.points || 0) + earned;
    const badges = new Set(progress?.badges || []);
    if (correct === NUTRITION_QUIZZES.length) badges.add('Thông thái Dinh dưỡng 100%');

    const history = [
      ...(progress?.quizHistory || []),
      {
        quizId: 'quiz_daily_vn',
        score: correct,
        total: NUTRITION_QUIZZES.length,
        completedAt: new Date().toISOString().slice(0, 10),
      },
    ].slice(-20);

    await StudentProgressRepo.upsert({
      studentUid: user.uid,
      schoolId: user.schoolId || 'school_th_chu_van_an',
      classId: user.classIds?.[0] || '',
      verifiedParentIds: user.verifiedParentIds || [],
      points: nextPoints,
      streakDays: progress?.streakDays || 1,
      completedTaskIds: progress?.completedTaskIds || [],
      quizHistory: history,
      badges: Array.from(badges),
      growthRecords: progress?.growthRecords || [],
    });
    setQuizMessage(`Bạn trả lời đúng ${correct}/${NUTRITION_QUIZZES.length} câu và nhận +${earned} điểm!`);
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
      headerAction={
        <button
          type="button"
          onClick={() => setActiveTab('analyze')}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 whitespace-nowrap"
        >
          <Camera className="w-3.5 h-3.5" />
          Chụp bữa ăn
        </button>
      }
    >
      {errorMsg && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-800">{errorMsg}</div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="text-xs text-slate-500">Năng lượng hôm nay</div>
                  <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
                    {todayKcal} kcal
                  </div>
                  <div className="mt-1 text-xs text-slate-500">Mục tiêu bữa trưa: ~{lunchTarget} kcal</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="text-xs text-slate-500">Số bữa đã ghi nhận</div>
                  <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-emerald-700">
                    {meals.length}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">Hôm nay: {todayMeals.length} bữa</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="text-xs text-slate-500">Điểm rèn luyện</div>
                  <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-slate-900">
                    {progress?.points || 0}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">Chuỗi ghi nhận: {progress?.streakDays || 0} ngày</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="text-xs text-slate-500">Huy hiệu đạt được</div>
                  <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-amber-700">
                    {progress?.badges?.length || 0}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">Nhiệm vụ lớp: {tasks.length}</div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
                <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5">
                  <h3 className="text-sm font-semibold text-slate-900 mb-3">Năng lượng các bữa ăn gần đây</h3>
                  {weeklyChartData.length === 0 ? (
                    <div className="h-60 flex flex-col items-center justify-center text-sm text-slate-500 gap-3">
                      <span>Bạn chưa ghi nhận bữa ăn nào.</span>
                      <button
                        type="button"
                        onClick={() => setActiveTab('analyze')}
                        className="px-4 py-2 bg-emerald-700 text-white text-xs font-medium rounded-lg"
                      >
                        Chụp & ghi bữa ăn đầu tiên
                      </button>
                    </div>
                  ) : (
                    <div className="h-60">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={weeklyChartData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <Tooltip />
                          <Bar dataKey="kcal" name="Năng lượng (kcal)" fill="#059669" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
                  <img
                    src="/src/assets/images/nutrition_edu_banner_1795015019394.jpg"
                    alt="Rau củ và ngũ cốc dinh dưỡng"
                    className="w-full h-36 object-cover"
                  />
                  <div className="p-4 space-y-2 flex-1">
                    <div className="text-sm font-semibold text-slate-900">Mục tiêu giáo dục dinh dưỡng</div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Ăn đủ 4 nhóm chất mỗi bữa chính, ưu tiên rau xanh theo mùa và hạn chế đồ uống nhiều đường.
                    </p>
                    {comments.length > 0 && (
                      <div className="pt-2 border-t border-slate-100 text-xs text-slate-700">
                        <span className="font-semibold">Nhận xét mới nhất:</span> {comments[0].content}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'analyze' && (
            <MealAnalyzerModule
              actor={user}
              targetStudent={user}
              foodsCatalog={foods}
              onSaved={() => {
                void loadData();
              }}
            />
          )}

          {activeTab === 'journal' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <h3 className="text-base font-semibold text-slate-900">Nhật ký & Lịch sử bữa ăn</h3>
                <select
                  value={mealFilter}
                  onChange={(e) => setMealFilter(e.target.value)}
                  className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white"
                >
                  <option value="all">Tất cả bữa ăn</option>
                  <option value="breakfast">Bữa sáng</option>
                  <option value="lunch">Bữa trưa</option>
                  <option value="dinner">Bữa tối</option>
                  <option value="snack">Bữa phụ</option>
                </select>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-2.5 px-4">Ngày</th>
                      <th className="py-2.5 px-4">Bữa</th>
                      <th className="py-2.5 px-4">Món ăn</th>
                      <th className="py-2.5 px-4 text-right">Năng lượng</th>
                      <th className="py-2.5 px-4 text-right">Điểm</th>
                      <th className="py-2.5 px-4 text-right">Xóa</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {filteredMeals.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-500 text-sm">
                          Chưa có nhật ký bữa ăn phù hợp.
                        </td>
                      </tr>
                    ) : (
                      filteredMeals.map((m) => (
                        <tr key={m.id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-4 font-mono text-xs tabular-nums">{m.dateStr}</td>
                          <td className="py-2.5 px-4 text-slate-700">{m.mealType}</td>
                          <td className="py-2.5 px-4 text-slate-800">
                            {m.items.map((i) => `${i.nameVi} (${i.portionGrams}g)`).join(', ')}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums">{m.nutritionTotals.kcal} kcal</td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-emerald-700">
                            {m.scoreBreakdown.totalScore}/100
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            <button
                              type="button"
                              onClick={async () => {
                                await MealLogRepo.delete(m.id);
                                await loadData();
                              }}
                              className="p-1.5 text-rose-600 hover:bg-rose-50 rounded"
                              title="Xóa nhật ký"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
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
                    Tải thêm lịch sử
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'menus' && (
            <div className="space-y-4">
              {menus.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
                  Nhà trường chưa công bố thực đơn bán trú nào.
                </div>
              ) : (
                menus.map((menu) => (
                  <div key={menu.id} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-semibold text-slate-900">{menu.title}</h3>
                      <span className="text-xs text-slate-500 font-mono tabular-nums">
                        TB {menu.nutritionSummary?.avgKcal || 0} kcal/ngày
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {menu.days.map((d, idx) => (
                        <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1.5">
                          <div className="font-semibold text-slate-900 flex justify-between">
                            <span>{d.dayLabel}</span>
                            <span className="font-mono tabular-nums text-emerald-700">{d.dayKcal} kcal</span>
                          </div>
                          {d.meals.map((slot, sIdx) => (
                            <div key={sIdx} className="text-slate-700">
                              <span className="font-medium">{slot.mealType}:</span>{' '}
                              {slot.dishes.map((dish) => dish.nameVi).join(', ')}
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

          {activeTab === 'learn' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-emerald-700" />
                  <h3 className="text-base font-semibold text-slate-900">Mini Quiz Dinh dưỡng Học đường</h3>
                </div>
                <div className="space-y-4">
                  {NUTRITION_QUIZZES.map((q, qIdx) => (
                    <div key={q.id} className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                      <div className="text-sm font-medium text-slate-900">
                        {qIdx + 1}. {q.question}
                      </div>
                      <div className="space-y-1.5">
                        {q.options.map((opt, oIdx) => (
                          <label key={oIdx} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                            <input
                              type="radio"
                              name={q.id}
                              checked={quizAnswers[q.id] === oIdx}
                              onChange={() => setQuizAnswers((prev) => ({ ...prev, [q.id]: oIdx }))}
                            />
                            <span>{opt}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={handleSubmitQuiz}
                    className="px-4 py-2 bg-emerald-700 text-white text-sm font-medium rounded-lg hover:bg-emerald-800"
                  >
                    Nộp bài & Nhận điểm
                  </button>
                  {quizMessage && <div className="text-xs font-medium text-emerald-700">{quizMessage}</div>}
                </div>
              </div>

              <div className="space-y-6">
                <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                  <h3 className="text-base font-semibold text-slate-900">Nhiệm vụ từ Giáo viên</h3>
                  {tasks.length === 0 ? (
                    <p className="text-xs text-slate-500">Hiện chưa có nhiệm vụ lớp nào.</p>
                  ) : (
                    tasks.map((task) => {
                      const done = progress?.completedTaskIds?.includes(task.id);
                      return (
                        <div
                          key={task.id}
                          className="p-3 border border-slate-200 rounded-lg flex items-center justify-between gap-3"
                        >
                          <div>
                            <div className="text-sm font-medium text-slate-900">{task.title}</div>
                            <div className="text-xs text-slate-500">
                              {task.description || 'Hoàn thành và xác nhận'} · +{task.points} điểm
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={done}
                            onClick={() => handleCompleteTask(task)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap ${
                              done
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'bg-slate-900 text-white hover:bg-slate-800'
                            }`}
                          >
                            {done ? 'Đã xong' : 'Hoàn thành'}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                  <h3 className="text-base font-semibold text-slate-900">Huy hiệu & Thành tích</h3>
                  <div className="flex flex-wrap gap-2">
                    {(progress?.badges || []).length === 0 ? (
                      <span className="text-xs text-slate-500">Chưa có huy hiệu.</span>
                    ) : (
                      progress?.badges?.map((b, i) => (
                        <div
                          key={i}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-xs font-medium text-amber-900"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-amber-700" />
                          {b}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'reports' && (
            <ReportsCenter user={user} mealLogs={meals} menus={menus} comments={comments} />
          )}
        </>
      )}
    </DashboardShell>
  );
}
