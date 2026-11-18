import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  CalendarDays,
  Check,
  ClipboardCheck,
  LayoutDashboard,
  ListTodo,
  MessageSquarePlus,
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
  MealLog,
  MenuPlan,
  SchoolClass,
  StudentTask,
  TeacherComment,
  UserProfile,
  VietnameseFood,
} from '../types/domain';
import {
  ClassRepo,
  FoodRepo,
  MealLogRepo,
  MenuRepo,
  NotificationRepo,
  StudentTaskRepo,
  TeacherCommentRepo,
  UserRepo,
} from '../lib/repositories';
import { SEED_VIETNAMESE_FOODS } from '../lib/vietnameseFoods';
import { AuditService, makeId } from '../lib/services';
import { DashboardShell, NavItem } from '../components/DashboardShell';
import { MenuPlannerModule } from '../components/MenuPlannerModule';
import { ReportsCenter } from '../components/ReportsCenter';

interface TeacherDashboardProps {
  user: UserProfile;
  schoolName: string;
  onLogout: () => void;
  onOpenPrivacyModal: () => void;
}

export function TeacherDashboard({
  user,
  schoolName,
  onLogout,
  onOpenPrivacyModal,
}: TeacherDashboardProps) {
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>(user.classIds?.[0] || '');
  const [students, setStudents] = useState<UserProfile[]>([]);
  const [meals, setMeals] = useState<MealLog[]>([]);
  const [mealCursor, setMealCursor] = useState<any>(null);
  const [hasMoreMeals, setHasMoreMeals] = useState(false);
  const [menus, setMenus] = useState<MenuPlan[]>([]);
  const [tasks, setTasks] = useState<StudentTask[]>([]);
  const [comments, setComments] = useState<TeacherComment[]>([]);
  const [foods, setFoods] = useState<VietnameseFood[]>(SEED_VIETNAMESE_FOODS);

  // Task form
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [taskPoints, setTaskPoints] = useState(20);

  // Comment form
  const [commentStudentUid, setCommentStudentUid] = useState('');
  const [commentCat, setCommentCat] = useState<TeacherComment['category']>('praise');
  const [commentContent, setCommentContent] = useState('');
  const [homeSuggestion, setHomeSuggestion] = useState('');

  const assignedClassIds = useMemo(() => user.classIds || [], [user.classIds]);

  const navItems: NavItem[] = [
    { id: 'overview', label: 'Thống kê lớp', icon: LayoutDashboard },
    { id: 'students', label: 'Học sinh & Nhật ký bữa ăn', icon: Users },
    { id: 'menus', label: 'Thực đơn bán trú', icon: CalendarDays },
    { id: 'tasks', label: 'Hoạt động & Nhiệm vụ', icon: ListTodo },
    { id: 'comments', label: 'Nhận xét học sinh', icon: MessageSquarePlus },
    { id: 'reports', label: 'Xuất báo cáo lớp', icon: BarChart3 },
  ];

  const loadData = useCallback(async () => {
    if (!user.schoolId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErrorMsg('');
    try {
      const [clsList, studentRes, mealRes, menuRes, taskRes, commentRes, foodList] = await Promise.all([
        ClassRepo.list(user.schoolId),
        UserRepo.listStudentsByTeacherClasses(user.schoolId, assignedClassIds, 60),
        MealLogRepo.listForTeacherClasses(user.schoolId, assignedClassIds, 40),
        MenuRepo.listForSchool(user.schoolId, 20),
        StudentTaskRepo.listForSchool(user.schoolId),
        TeacherCommentRepo.listForTeacherClasses(user.schoolId, assignedClassIds, 40),
        FoodRepo.listAll(100),
      ]);

      const assignedClasses = clsList.filter((c) => assignedClassIds.includes(c.id));
      setClasses(assignedClasses);
      const activeCls =
        selectedClassId && assignedClasses.some((c) => c.id === selectedClassId)
          ? selectedClassId
          : assignedClasses[0]?.id || '';
      setSelectedClassId(activeCls);

      setStudents(studentRes.items);
      if (!commentStudentUid && studentRes.items[0]) setCommentStudentUid(studentRes.items[0].uid);

      setMeals(mealRes.items);
      setMealCursor(mealRes.lastCursor);
      setHasMoreMeals(mealRes.hasMore);
      setMenus(menuRes.items);
      setTasks(
        assignedClassIds.length > 0
          ? taskRes.items.filter((t) => assignedClassIds.includes(t.classId))
          : []
      );
      setComments(commentRes.items);
      if (foodList.length > 0) setFoods(foodList);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể tải dữ liệu lớp.');
    } finally {
      setLoading(false);
    }
  }, [user.schoolId, assignedClassIds, selectedClassId, commentStudentUid]);

  const handleLoadMoreMeals = async () => {
    if (!mealCursor || !user.schoolId || assignedClassIds.length === 0) return;
    const next = await MealLogRepo.listForTeacherClasses(user.schoolId, assignedClassIds, 40, mealCursor);
    setMeals((prev) => [...prev, ...next.items]);
    setMealCursor(next.lastCursor);
    setHasMoreMeals(next.hasMore);
  };

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const classMeals = useMemo(
    () => (selectedClassId ? meals.filter((m) => !m.classId || m.classId === selectedClassId) : meals),
    [meals, selectedClassId]
  );

  const attentionCases = useMemo(() => {
    return classMeals.filter(
      (m) => (m.scoreBreakdown?.allergenAlerts?.length || 0) > 0 || (m.scoreBreakdown?.totalScore || 0) < 60
    );
  }, [classMeals]);

  const classChart = useMemo(() => {
    return students.slice(0, 12).map((st) => {
      const stMeals = classMeals.filter((m) => m.studentUid === st.uid);
      const avg = stMeals.length
        ? Math.round(stMeals.reduce((s, m) => s + m.scoreBreakdown.totalScore, 0) / stMeals.length)
        : 0;
      return { name: st.displayName, avgScore: avg, meals: stMeals.length };
    });
  }, [students, classMeals]);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    const cid = selectedClassId || user.classIds?.[0] || 'class_5a';
    const id = makeId('task');
    await StudentTaskRepo.create({
      id,
      schoolId: user.schoolId,
      classId: cid,
      teacherUid: user.uid,
      title: taskTitle.trim(),
      description: taskDesc.trim(),
      points: taskPoints,
    });
    await AuditService.log({
      schoolId: user.schoolId,
      actorUid: user.uid,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'TASK_ASSIGNED',
      targetCollection: 'student_tasks',
      targetId: id,
      details: `${taskTitle} (${cid})`,
    });
    setTaskTitle('');
    setTaskDesc('');
    await loadData();
  };

  const handleCreateComment = async (e: React.FormEvent) => {
    e.preventDefault();
    const student = students.find((s) => s.uid === commentStudentUid);
    if (!student || !commentContent.trim()) return;
    const id = makeId('cmt');
    await TeacherCommentRepo.create({
      id,
      schoolId: user.schoolId,
      classId: student.classIds?.[0] || selectedClassId || 'class_5a',
      teacherUid: user.uid,
      teacherName: user.displayName,
      studentUid: student.uid,
      studentName: student.displayName,
      verifiedParentIds: student.verifiedParentIds || [],
      category: commentCat,
      content: commentContent.trim(),
      homeSuggestion: homeSuggestion.trim(),
    });
    for (const pUid of student.verifiedParentIds || []) {
      await NotificationRepo.create({
        id: makeId('notif'),
        schoolId: user.schoolId,
        recipientUid: pUid,
        title: `Nhận xét mới cho ${student.displayName}`,
        body: commentContent.trim().slice(0, 180),
        type: 'comment',
        read: false,
      });
    }
    setCommentContent('');
    setHomeSuggestion('');
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
        classes.length > 0 ? (
          <select
            value={selectedClassId}
            onChange={(e) => setSelectedClassId(e.target.value)}
            className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg bg-white"
          >
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : null
      }
    >
      {errorMsg && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-800">{errorMsg}</div>
      )}

      {!loading && assignedClassIds.length === 0 && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
          Tài khoản Giáo viên của bạn chưa được Quản trị nhà trường phân công lớp phụ trách (<span className="font-mono">classIds</span>). Vui lòng liên hệ Quản trị trường để gán lớp trước khi xem học sinh hoặc giao nhiệm vụ.
        </div>
      )}

      {loading ? (
        <div className="h-40 bg-white border border-slate-200 rounded-xl animate-pulse" />
      ) : (
        <>
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="text-xs text-slate-500">Học sinh phụ trách</div>
                  <div className="mt-1 text-2xl font-bold font-mono tabular-nums">{students.length}</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="text-xs text-slate-500">Nhật ký bữa ăn lớp</div>
                  <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-emerald-700">
                    {classMeals.length}
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="text-xs text-slate-500">Trường hợp cần quan tâm</div>
                  <div className="mt-1 text-2xl font-bold font-mono tabular-nums text-amber-700">
                    {attentionCases.length}
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="text-xs text-slate-500">Nhiệm vụ giáo dục đã giao</div>
                  <div className="mt-1 text-2xl font-bold font-mono tabular-nums">{tasks.length}</div>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-slate-900 mb-3">Điểm dinh dưỡng trung bình theo học sinh</h3>
                {classChart.length === 0 ? (
                  <div className="h-56 flex items-center justify-center text-xs text-slate-400">
                    Chưa có học sinh hoặc dữ liệu bữa ăn trong lớp.
                  </div>
                ) : (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={classChart}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Bar dataKey="avgScore" name="Điểm TB" fill="#059669" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'students' && (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 font-semibold text-sm text-slate-900">
                  Danh sách học sinh trong lớp ({students.length})
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                        <th className="py-2.5 px-4">Học sinh</th>
                        <th className="py-2.5 px-4">Email</th>
                        <th className="py-2.5 px-4">Nhóm tuổi</th>
                        <th className="py-2.5 px-4">Dị ứng</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {students.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-6 text-center text-xs text-slate-500">
                            Chưa có học sinh nào được gán vào lớp.
                          </td>
                        </tr>
                      ) : (
                        students.map((st) => (
                          <tr key={st.uid}>
                            <td className="py-2.5 px-4 font-medium text-slate-900">{st.displayName}</td>
                            <td className="py-2.5 px-4 text-xs text-slate-600">{st.email}</td>
                            <td className="py-2.5 px-4 font-mono text-xs">{st.ageGroup || '9-11'}</td>
                            <td className="py-2.5 px-4 text-xs text-rose-700">
                              {(st.allergies || []).join(', ') || 'Không'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 font-semibold text-sm text-slate-900">
                  Nhật ký bữa ăn của lớp (xác nhận giáo viên)
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                        <th className="py-2.5 px-4">Ngày</th>
                        <th className="py-2.5 px-4">Học sinh</th>
                        <th className="py-2.5 px-4">Món ăn</th>
                        <th className="py-2.5 px-4 text-right">Điểm</th>
                        <th className="py-2.5 px-4 text-right">Duyệt xem</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {classMeals.map((m) => (
                        <tr key={m.id}>
                          <td className="py-2.5 px-4 font-mono text-xs tabular-nums">{m.dateStr}</td>
                          <td className="py-2.5 px-4 font-medium">{m.studentName}</td>
                          <td className="py-2.5 px-4 text-xs">{m.items.map((i) => i.nameVi).join(', ')}</td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums">{m.scoreBreakdown.totalScore}/100</td>
                          <td className="py-2.5 px-4 text-right">
                            <button
                              type="button"
                              disabled={m.teacherReviewed}
                              onClick={async () => {
                                await MealLogRepo.update(m.id, { teacherReviewed: true });
                                await loadData();
                              }}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg ${
                                m.teacherReviewed
                                  ? 'bg-emerald-50 text-emerald-800'
                                  : 'bg-slate-900 text-white hover:bg-slate-800'
                              }`}
                            >
                              <ClipboardCheck className="w-3.5 h-3.5" />
                              {m.teacherReviewed ? 'Đã xem' : 'Xác nhận'}
                            </button>
                          </td>
                        </tr>
                      ))}
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
                      Tải thêm nhật ký lớp
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'menus' && (
            <MenuPlannerModule
              user={user}
              schoolId={user.schoolId}
              foodsCatalog={foods}
              menus={menus}
              onRefresh={() => void loadData()}
            />
          )}

          {activeTab === 'tasks' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <form onSubmit={handleCreateTask} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <h3 className="text-base font-semibold text-slate-900">Giao nhiệm vụ giáo dục dinh dưỡng</h3>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tiêu đề nhiệm vụ</label>
                  <input
                    required
                    value={taskTitle}
                    onChange={(e) => setTaskTitle(e.target.value)}
                    placeholder="VD: Ăn đủ rau xanh suốt 5 ngày bán trú"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Mô tả chi tiết</label>
                  <textarea
                    rows={3}
                    value={taskDesc}
                    onChange={(e) => setTaskDesc(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Điểm thưởng</label>
                  <input
                    type="number"
                    min={5}
                    max={200}
                    value={taskPoints}
                    onChange={(e) => setTaskPoints(Number(e.target.value))}
                    className="w-32 px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                  />
                </div>
                <button
                  type="submit"
                  disabled={assignedClassIds.length === 0}
                  className="px-4 py-2 bg-emerald-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
                >
                  Giao nhiệm vụ
                </button>
              </form>

              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                <h3 className="text-base font-semibold text-slate-900">Nhiệm vụ đã giao ({tasks.length})</h3>
                {tasks.map((t) => (
                  <div key={t.id} className="p-3 border border-slate-200 rounded-lg flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium text-slate-900">{t.title}</div>
                      <div className="text-xs text-slate-500">Lớp {t.classId} · +{t.points} điểm</div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        await StudentTaskRepo.delete(t.id);
                        await loadData();
                      }}
                      className="text-xs text-rose-600 hover:underline"
                    >
                      Xóa
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'comments' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <form onSubmit={handleCreateComment} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                <h3 className="text-base font-semibold text-slate-900">Gửi nhận xét & Gợi ý cho phụ huynh</h3>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Học sinh</label>
                  <select
                    value={commentStudentUid}
                    onChange={(e) => setCommentStudentUid(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    {students.map((st) => (
                      <option key={st.uid} value={st.uid}>
                        {st.displayName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Phân loại</label>
                  <select
                    value={commentCat}
                    onChange={(e) => setCommentCat(e.target.value as any)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="praise">Khen ngợi</option>
                    <option value="attention">Cần quan tâm</option>
                    <option value="allergy_note">Lưu ý dị ứng</option>
                    <option value="home_activity">Hoạt động tại nhà</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Nội dung nhận xét</label>
                  <textarea
                    required
                    rows={3}
                    value={commentContent}
                    onChange={(e) => setCommentContent(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Gợi ý hoạt động tại nhà</label>
                  <input
                    value={homeSuggestion}
                    onChange={(e) => setHomeSuggestion(e.target.value)}
                    placeholder="VD: Bổ sung thêm 1 hộp sữa chua hoặc trái cây buổi tối"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <button
                  type="submit"
                  disabled={students.length === 0}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  Gửi nhận xét
                </button>
              </form>

              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
                <h3 className="text-base font-semibold text-slate-900">Lịch sử nhận xét ({comments.length})</h3>
                {comments.map((c) => (
                  <div key={c.id} className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1">
                    <div className="font-semibold text-slate-900">
                      {c.studentName} · {c.category}
                    </div>
                    <div className="text-slate-700">{c.content}</div>
                    {c.homeSuggestion && <div className="text-emerald-800">Tại nhà: {c.homeSuggestion}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'reports' && (
            <ReportsCenter
              user={user}
              mealLogs={classMeals}
              menus={menus}
              comments={comments}
              classes={classes}
              students={students}
            />
          )}
        </>
      )}
    </DashboardShell>
  );
}
