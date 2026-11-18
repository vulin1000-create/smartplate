import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Download, FileSpreadsheet, Printer } from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  AiUsageLog,
  MealLog,
  MenuPlan,
  School,
  SchoolClass,
  TeacherComment,
  UserProfile,
} from '../types/domain';
import { FOOD_CATEGORY_LABELS } from '../lib/vietnameseFoods';

interface ReportsCenterProps {
  user: UserProfile;
  mealLogs: MealLog[];
  menus?: MenuPlan[];
  comments?: TeacherComment[];
  schools?: School[];
  classes?: SchoolClass[];
  students?: UserProfile[];
  aiUsageLogs?: AiUsageLog[];
}

const CHART_COLORS = ['#059669', '#0284c7', '#d97706', '#7c3aed', '#dc2626', '#0d9488'];

function stripDiacriticsForPdf(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

export function ReportsCenter({
  user,
  mealLogs,
  menus = [],
  comments = [],
  schools = [],
  classes = [],
  students = [],
  aiUsageLogs = [],
}: ReportsCenterProps) {
  const [granularity, setGranularity] = useState<'day' | 'month' | 'year'>('day');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [schoolFilter, setSchoolFilter] = useState<string>(user.role === 'super_admin' ? 'all' : user.schoolId);
  const [classFilter, setClassFilter] = useState<string>('all');
  const [studentFilter, setStudentFilter] = useState<string>('all');

  const filteredMeals = useMemo(() => {
    return mealLogs.filter((m) => {
      if (schoolFilter !== 'all' && m.schoolId !== schoolFilter) return false;
      if (classFilter !== 'all' && m.classId !== classFilter) return false;
      if (studentFilter !== 'all' && m.studentUid !== studentFilter) return false;
      if (dateFrom && m.dateStr < dateFrom) return false;
      if (dateTo && m.dateStr > dateTo) return false;
      return true;
    });
  }, [mealLogs, schoolFilter, classFilter, studentFilter, dateFrom, dateTo]);

  const filteredUsage = useMemo(() => {
    return aiUsageLogs.filter((u) => {
      if (schoolFilter !== 'all' && u.schoolId !== schoolFilter) return false;
      return true;
    });
  }, [aiUsageLogs, schoolFilter]);

  const timeSeriesData = useMemo(() => {
    const map = new Map<string, { period: string; meals: number; avgScore: number; totalScore: number; avgKcal: number; totalKcal: number }>();
    filteredMeals.forEach((m) => {
      const key =
        granularity === 'year'
          ? m.dateStr.slice(0, 4)
          : granularity === 'month'
            ? m.dateStr.slice(0, 7)
            : m.dateStr;
      const cur = map.get(key) || { period: key, meals: 0, avgScore: 0, totalScore: 0, avgKcal: 0, totalKcal: 0 };
      cur.meals += 1;
      cur.totalScore += m.scoreBreakdown?.totalScore || 0;
      cur.totalKcal += m.nutritionTotals?.kcal || 0;
      cur.avgScore = Math.round(cur.totalScore / cur.meals);
      cur.avgKcal = Math.round(cur.totalKcal / cur.meals);
      map.set(key, cur);
    });
    return Array.from(map.values()).sort((a, b) => a.period.localeCompare(b.period));
  }, [filteredMeals, granularity]);

  const foodGroupDistribution = useMemo(() => {
    const counts = new Map<string, number>();
    filteredMeals.forEach((m) => {
      (m.items || []).forEach((item) => {
        const label = FOOD_CATEGORY_LABELS[item.foodGroup] || item.foodGroup;
        counts.set(label, (counts.get(label) || 0) + 1);
      });
    });
    return Array.from(counts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [filteredMeals]);

  const superAdminSchoolMetrics = useMemo(() => {
    if (user.role !== 'super_admin') return [];
    const bySchool = new Map<string, { schoolName: string; analyses: number; errors: number; costUsd: number }>();
    filteredUsage.forEach((u) => {
      const sName = schools.find((s) => s.id === u.schoolId)?.name || u.schoolId || 'Hệ thống chung';
      const cur = bySchool.get(sName) || { schoolName: sName, analyses: 0, errors: 0, costUsd: 0 };
      cur.analyses += 1;
      if (u.status !== 'success') cur.errors += 1;
      cur.costUsd = Number((cur.costUsd + (u.estimatedCostUsd || 0)).toFixed(5));
      bySchool.set(sName, cur);
    });
    return Array.from(bySchool.values());
  }, [user.role, filteredUsage, schools]);

  const summaryStats = useMemo(() => {
    const count = filteredMeals.length;
    const avgScore = count ? Math.round(filteredMeals.reduce((s, m) => s + (m.scoreBreakdown?.totalScore || 0), 0) / count) : 0;
    const avgKcal = count ? Math.round(filteredMeals.reduce((s, m) => s + (m.nutritionTotals?.kcal || 0), 0) / count) : 0;
    const allergyAlertsCount = filteredMeals.reduce((s, m) => s + (m.scoreBreakdown?.allergenAlerts?.length || 0), 0);
    const totalAiCalls = filteredUsage.length;
    const aiErrorRate = totalAiCalls
      ? Math.round((filteredUsage.filter((u) => u.status !== 'success').length / totalAiCalls) * 100)
      : 0;
    const totalCostUsd = filteredUsage.reduce((s, u) => s + (u.estimatedCostUsd || 0), 0);
    return { count, avgScore, avgKcal, allergyAlertsCount, totalAiCalls, aiErrorRate, totalCostUsd };
  }, [filteredMeals, filteredUsage]);

  const scopeLabel = useMemo(() => {
    if (user.role === 'student') return `Cá nhân học sinh: ${user.displayName}`;
    if (user.role === 'parent') return `Phụ huynh theo dõi con đã liên kết (${user.linkedChildIds?.length || 0} học sinh)`;
    if (user.role === 'teacher') return `Giáo viên lớp phụ trách (${user.classIds?.join(', ') || 'Trong trường'})`;
    if (user.role === 'school_admin') return `Toàn trường: ${schools.find((s) => s.id === user.schoolId)?.name || user.schoolId}`;
    return `Super Admin — Toàn hệ thống (${schools.length} trường)`;
  }, [user, schools]);

  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();
    const mealRows = filteredMeals.map((m) => ({
      Ngay: m.dateStr,
      HocSinh: m.studentName || m.studentUid,
      BuaAn: m.mealType,
      NangLuongKcal: m.nutritionTotals?.kcal || 0,
      DamG: m.nutritionTotals?.proteinG || 0,
      BotDuongG: m.nutritionTotals?.carbsG || 0,
      ChatBeoG: m.nutritionTotals?.fatG || 0,
      ChatXoG: m.nutritionTotals?.fiberG || 0,
      DiemDinhDuong: m.scoreBreakdown?.totalScore || 0,
      CanhBaoDiUng: (m.scoreBreakdown?.allergenAlerts || []).join('; '),
    }));
    const ws1 = XLSX.utils.json_to_sheet(
      mealRows.length > 0 ? mealRows : [{ ThongBao: 'Không có dữ liệu bữa ăn trong bộ lọc hiện tại' }]
    );
    XLSX.utils.book_append_sheet(wb, ws1, 'BaoCaoBuaAn');

    if (user.role === 'super_admin' && filteredUsage.length > 0) {
      const ws2 = XLSX.utils.json_to_sheet(
        filteredUsage.map((u) => ({
          Endpoint: u.endpoint,
          Model: u.model,
          Tokens: u.totalTokens,
          CostUSD: u.estimatedCostUsd,
          LatencyMs: u.latencyMs,
          Status: u.status,
        }))
      );
      XLSX.utils.book_append_sheet(wb, ws2, 'AI_Usage');
    }

    XLSX.writeFile(wb, `SmartPlate_BaoCao_${user.role}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const handleExportPdf = () => {
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text(stripDiacriticsForPdf(`SmartPlate VN 2.0 - Bao cao phan tich (${user.role})`), 14, 16);
    doc.setFontSize(10);
    doc.text(stripDiacriticsForPdf(`Pham vi: ${scopeLabel}`), 14, 23);
    doc.text(
      stripDiacriticsForPdf(
        `So bua an: ${summaryStats.count} | Diem TB: ${summaryStats.avgScore}/100 | Kcal TB: ${summaryStats.avgKcal}`
      ),
      14,
      29
    );

    autoTable(doc, {
      startY: 35,
      head: [['Ngay', 'Hoc sinh', 'Bua', 'Kcal', 'Protein(g)', 'Diem', 'Di ung']],
      body:
        filteredMeals.length > 0
          ? filteredMeals.slice(0, 60).map((m) => [
              m.dateStr,
              stripDiacriticsForPdf(m.studentName || m.studentUid),
              m.mealType,
              String(m.nutritionTotals?.kcal || 0),
              String(m.nutritionTotals?.proteinG || 0),
              String(m.scoreBreakdown?.totalScore || 0),
              stripDiacriticsForPdf((m.scoreBreakdown?.allergenAlerts || []).join('; ') || 'Khong'),
            ])
          : [['-', 'Chua co du lieu', '-', '-', '-', '-', '-']],
    });

    doc.save(`SmartPlate_BaoCao_${user.role}_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Trung tâm Báo cáo & Phân tích Tập trung</h2>
          <p className="text-xs text-slate-500 mt-1">
            Phạm vi dữ liệu thực tế: <span className="font-medium text-slate-700">{scopeLabel}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 no-print">
          <button
            type="button"
            onClick={handleExportExcel}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 whitespace-nowrap"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Xuất Excel
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            Xuất PDF
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 whitespace-nowrap"
          >
            <Printer className="w-4 h-4" />
            In báo cáo
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 no-print">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Nhóm thời gian</label>
          <select
            value={granularity}
            onChange={(e) => setGranularity(e.target.value as 'day' | 'month' | 'year')}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
          >
            <option value="day">Theo ngày</option>
            <option value="month">Theo tháng</option>
            <option value="year">Theo năm</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Từ ngày</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Đến ngày</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
          />
        </div>

        {user.role === 'super_admin' && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Lọc theo trường</label>
            <select
              value={schoolFilter}
              onChange={(e) => setSchoolFilter(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
            >
              <option value="all">Tất cả trường</option>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {(user.role === 'school_admin' || user.role === 'teacher') && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Lọc theo lớp</label>
            <select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
            >
              <option value="all">Tất cả lớp trong phạm vi</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.grade})
                </option>
              ))}
            </select>
          </div>
        )}

        {(user.role === 'parent' || user.role === 'teacher' || user.role === 'school_admin') && students.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Học sinh</label>
            <select
              value={studentFilter}
              onChange={(e) => setStudentFilter(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
            >
              <option value="all">Tất cả học sinh</option>
              {students.map((st) => (
                <option key={st.uid} value={st.uid}>
                  {st.displayName}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Bữa ăn đã ghi nhận</div>
          <div className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{summaryStats.count}</div>
          <div className="mt-1 text-xs text-slate-500">Trong bộ lọc thời gian</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Điểm dinh dưỡng trung bình</div>
          <div className="mt-1 text-2xl font-bold text-emerald-700 tabular-nums">{summaryStats.avgScore}/100</div>
          <div className="mt-1 text-xs text-slate-500">Tính theo quy tắc độ tuổi</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Năng lượng trung bình / bữa</div>
          <div className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{summaryStats.avgKcal} kcal</div>
          <div className="mt-1 text-xs text-slate-500">Thực đơn trường: {menus.length}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">
            {user.role === 'super_admin' ? 'Lượt AI / Chi phí ước tính' : 'Cảnh báo dị ứng / Nhận xét'}
          </div>
          <div className="mt-1 text-2xl font-bold text-amber-700 tabular-nums">
            {user.role === 'super_admin'
              ? `${summaryStats.totalAiCalls} · $${summaryStats.totalCostUsd.toFixed(4)}`
              : `${summaryStats.allergyAlertsCount} · ${comments.length}`}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {user.role === 'super_admin' ? `Tỷ lệ lỗi AI: ${summaryStats.aiErrorRate}%` : 'Từ nhật ký thực tế'}
          </div>
        </div>
      </div>

      {/* Charts Grid: Line + Bar + Pie */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Xu hướng điểm dinh dưỡng (Biểu đồ đường)</h3>
          {timeSeriesData.length === 0 ? (
            <div className="h-60 flex items-center justify-center text-xs text-slate-400">Chưa có dữ liệu theo thời gian</div>
          ) : (
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timeSeriesData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="avgScore" name="Điểm TB" stroke="#059669" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">
            {user.role === 'super_admin' ? 'Lượt phân tích AI theo trường (Biểu đồ cột)' : 'Năng lượng kcal trung bình (Biểu đồ cột)'}
          </h3>
          {(() => {
            const barData =
              user.role === 'super_admin'
                ? superAdminSchoolMetrics.map((s) => ({ label: s.schoolName, value: s.analyses }))
                : timeSeriesData.map((t) => ({ label: t.period, value: t.avgKcal }));
            if (barData.length === 0) {
              return (
                <div className="h-60 flex items-center justify-center text-xs text-slate-400">
                  Chưa có dữ liệu thống kê
                </div>
              );
            }
            return (
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar
                      dataKey="value"
                      name={user.role === 'super_admin' ? 'Lượt AI' : 'Kcal TB'}
                      fill="#0284c7"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            );
          })()}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Phân bố nhóm thực phẩm (Biểu đồ tròn)</h3>
          {foodGroupDistribution.length === 0 ? (
            <div className="h-60 flex items-center justify-center text-xs text-slate-400">Chưa có dữ liệu món ăn</div>
          ) : (
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={foodGroupDistribution}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={72}
                    label
                  >
                    {foodGroupDistribution.map((_entry, idx) => (
                      <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Statistical Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Bảng thống kê chi tiết từ dữ liệu thực tế</h3>
          <span className="text-xs text-slate-500 tabular-nums">{filteredMeals.length} bản ghi</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-2.5 px-4">Ngày</th>
                <th className="py-2.5 px-4">Học sinh</th>
                <th className="py-2.5 px-4">Bữa ăn</th>
                <th className="py-2.5 px-4 text-right">Năng lượng</th>
                <th className="py-2.5 px-4 text-right">Đạm / Bột / Béo</th>
                <th className="py-2.5 px-4 text-right">Điểm</th>
                <th className="py-2.5 px-4">Ghi nhận dị ứng</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filteredMeals.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500 text-sm">
                    Chưa có nhật ký bữa ăn khớp bộ lọc hiện tại.
                  </td>
                </tr>
              ) : (
                filteredMeals.slice(0, 50).map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono text-xs tabular-nums text-slate-700">{m.dateStr}</td>
                    <td className="py-2.5 px-4 text-slate-900 font-medium">{m.studentName || m.studentUid}</td>
                    <td className="py-2.5 px-4 text-slate-600">{m.mealType}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">{m.nutritionTotals?.kcal || 0} kcal</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-xs text-slate-600">
                      {m.nutritionTotals?.proteinG || 0}g / {m.nutritionTotals?.carbsG || 0}g / {m.nutritionTotals?.fatG || 0}g
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-emerald-700">
                      {m.scoreBreakdown?.totalScore || 0}/100
                    </td>
                    <td className="py-2.5 px-4 text-xs text-rose-700">
                      {(m.scoreBreakdown?.allergenAlerts || []).length > 0
                        ? m.scoreBreakdown.allergenAlerts.join('; ')
                        : 'An toàn'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
