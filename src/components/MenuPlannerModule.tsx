import React, { useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import {
  MenuDay,
  MenuPlan,
  MenuStatus,
  StudentAgeGroup,
  UserProfile,
  VietnameseFood,
} from '../types/domain';
import { AiEngineClient } from '../lib/aiClient';
import { normalizeFoodLookup } from '../lib/nutritionEngine';
import { MenuRepo } from '../lib/repositories';
import { AuditService, makeId } from '../lib/services';

interface MenuPlannerModuleProps {
  user: UserProfile;
  schoolId: string;
  foodsCatalog: VietnameseFood[];
  menus: MenuPlan[];
  onRefresh: () => void;
}

const STATUS_LABELS: Record<MenuStatus, string> = {
  draft: 'Bản nháp',
  ai_suggested: 'AI Đề xuất',
  pending_approval: 'Chờ duyệt',
  approved: 'Đã duyệt',
  rejected: 'Từ chối',
  published: 'Đã công bố',
};

export function MenuPlannerModule({
  user,
  schoolId,
  foodsCatalog,
  menus,
  onRefresh,
}: MenuPlannerModuleProps) {
  const [periodType, setPeriodType] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [ageGroup, setAgeGroup] = useState<StudentAgeGroup>('9-11');
  const [gradeLevel, setGradeLevel] = useState('Tiểu học');
  const [budgetVnd, setBudgetVnd] = useState(32000);
  const [allergensInput, setAllergensInput] = useState('đậu phộng');
  const [foodSourcesInput, setFoodSourcesInput] = useState('Nông sản sạch địa phương, VietGAP');

  const [generating, setGenerating] = useState(false);
  const [replacingKey, setReplacingKey] = useState<string>('');
  const [analyzingId, setAnalyzingId] = useState<string>('');
  const [menuAnalysis, setMenuAnalysis] = useState<Record<string, any>>({});
  const [errorMsg, setErrorMsg] = useState('');

  const canCreateOrEdit = ['teacher', 'school_admin', 'super_admin'].includes(user.role);
  const canApproveOrPublish = ['school_admin', 'super_admin'].includes(user.role);

  const recomputeDaysSummary = (rawDays: any[]): { days: MenuDay[]; summary: MenuPlan['nutritionSummary'] } => {
    let totalDayKcal = 0;
    let totalP = 0;
    let totalC = 0;
    let totalF = 0;
    let totalFib = 0;
    const allDishes = new Set<string>();

    const days: MenuDay[] = rawDays.map((d) => {
      let dayKcal = 0;
      let dayCostVnd = 0;
      const meals = (d.meals || []).map((m: any) => {
        let slotKcal = 0;
        const dishes = (m.dishes || []).map((dish: any) => {
          const matched = normalizeFoodLookup(foodsCatalog, dish.foodId || dish.nameVi);
          const grams = Number(dish.portionGrams || matched?.standardServingG || 100);
          const scale = matched && matched.standardServingG > 0 ? grams / matched.standardServingG : 1;
          const kcal = matched ? Math.round(matched.energyKcal * scale) : 0;
          const p = matched ? Math.round(matched.proteinG * scale * 10) / 10 : 0;
          const c = matched ? Math.round(matched.carbsG * scale * 10) / 10 : 0;
          const f = matched ? Math.round(matched.fatG * scale * 10) / 10 : 0;
          const fib = matched ? Math.round(matched.fiberG * scale * 10) / 10 : 0;
          slotKcal += kcal;
          totalP += p;
          totalC += c;
          totalF += f;
          totalFib += fib;
          allDishes.add(matched ? matched.nameVi : dish.nameVi);
          return {
            foodId: matched ? matched.id : dish.foodId || 'custom',
            nameVi: matched ? matched.nameVi : dish.nameVi,
            category: matched ? matched.category : 'boarding_meals',
            portionGrams: grams,
            kcal,
            proteinG: p,
            carbsG: c,
            fatG: f,
            fiberG: fib,
          };
        });
        dayKcal += slotKcal;
        const cost = Number(m.estimatedCostVnd || budgetVnd);
        dayCostVnd += cost;
        return {
          mealType: m.mealType || 'lunch',
          dishes,
          slotKcal,
          estimatedCostVnd: cost,
        };
      });
      totalDayKcal += dayKcal;
      return {
        dayLabel: d.dayLabel || 'Ngày học',
        meals,
        dayKcal,
        dayCostVnd,
      };
    });

    const n = Math.max(1, days.length);
    return {
      days,
      summary: {
        avgKcal: Math.round(totalDayKcal / n),
        avgProteinG: Math.round((totalP / n) * 10) / 10,
        avgCarbsG: Math.round((totalC / n) * 10) / 10,
        avgFatG: Math.round((totalF / n) * 10) / 10,
        avgFiberG: Math.round((totalFib / n) * 10) / 10,
        diversityAvg: allDishes.size,
      },
    };
  };

  const handleGenerateMenu = async () => {
    setErrorMsg('');
    setGenerating(true);
    try {
      const excludedAllergens = allergensInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const foodSources = foodSourcesInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const { data } = await AiEngineClient.generateMenu(user, {
        periodType,
        ageGroup,
        gradeLevel,
        budgetVndPerMeal: budgetVnd,
        excludedAllergens,
        foodSources,
        availableFoods: foodsCatalog,
      });

      const { days, summary } = recomputeDaysSummary(data.days || []);
      const newMenu: Omit<MenuPlan, 'createdAt' | 'updatedAt'> = {
        id: makeId('menu'),
        schoolId: schoolId || 'school_th_chu_van_an',
        title: data.title || `Thực đơn ${periodType} (${gradeLevel})`,
        periodType,
        gradeLevel,
        ageGroup,
        budgetVndPerMeal: budgetVnd,
        excludedAllergens,
        foodSources,
        status: 'ai_suggested',
        days,
        nutritionSummary: summary,
        createdByUid: user.uid,
      };
      await MenuRepo.upsert(newMenu, true);
      await AuditService.log({
        schoolId: newMenu.schoolId,
        actorUid: user.uid,
        actorEmail: user.email,
        actorRole: user.role,
        action: 'AI_MENU_GENERATED',
        targetCollection: 'menus',
        targetId: newMenu.id,
        details: `${newMenu.title} (${days.length} ngày)`,
      });
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể tạo thực đơn AI.');
    } finally {
      setGenerating(false);
    }
  };

  const handleReplaceDish = async (menu: MenuPlan, dayIdx: number, mealIdx: number, dishIdx: number) => {
    const key = `${menu.id}_${dayIdx}_${mealIdx}_${dishIdx}`;
    setReplacingKey(key);
    setErrorMsg('');
    try {
      const currentDish = menu.days[dayIdx].meals[mealIdx].dishes[dishIdx];
      const { data } = await AiEngineClient.replaceFood(user, {
        currentDish,
        excludedAllergens: menu.excludedAllergens || [],
        availableFoods: foodsCatalog,
        reason: 'Đổi món đa dạng dinh dưỡng bán trú',
      });

      const alt = data.alternatives?.[0];
      if (!alt) throw new Error('AI không trả về món thay thế phù hợp.');

      const clonedDays = structuredClone(menu.days);
      clonedDays[dayIdx].meals[mealIdx].dishes[dishIdx] = {
        ...clonedDays[dayIdx].meals[mealIdx].dishes[dishIdx],
        foodId: alt.foodId,
        nameVi: alt.nameVi,
        portionGrams: alt.recommendedGrams || currentDish.portionGrams,
      };
      const { days, summary } = recomputeDaysSummary(clonedDays);
      await MenuRepo.upsert({ ...menu, days, nutritionSummary: summary }, false);
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Lỗi khi thay thế món ăn.');
    } finally {
      setReplacingKey('');
    }
  };

  const handleAnalyzeMenu = async (menu: MenuPlan) => {
    setAnalyzingId(menu.id);
    setErrorMsg('');
    try {
      const { data } = await AiEngineClient.analyzeMenu(user, {
        menuTitle: menu.title,
        ageGroup: menu.ageGroup,
        nutritionSummary: menu.nutritionSummary,
        excludedAllergens: menu.excludedAllergens || [],
      });
      setMenuAnalysis((prev) => ({ ...prev, [menu.id]: data }));
    } catch (err: any) {
      setErrorMsg(err?.message || 'Lỗi phân tích thực đơn.');
    } finally {
      setAnalyzingId('');
    }
  };

  const handleStatusChange = async (menu: MenuPlan, nextStatus: MenuStatus) => {
    setErrorMsg('');
    try {
      await MenuRepo.upsert(
        {
          ...menu,
          status: nextStatus,
          ...(nextStatus === 'approved' || nextStatus === 'published' ? { approvedByUid: user.uid } : {}),
        },
        false
      );
      await AuditService.log({
        schoolId: menu.schoolId,
        actorUid: user.uid,
        actorEmail: user.email,
        actorRole: user.role,
        action: `MENU_STATUS_${nextStatus.toUpperCase()}`,
        targetCollection: 'menus',
        targetId: menu.id,
        details: menu.title,
      });
      onRefresh();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể cập nhật trạng thái thực đơn.');
    }
  };

  return (
    <div className="space-y-6">
      {canCreateOrEdit && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">AI Menu Planner — Lập Thực đơn Bán trú</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Tạo thực đơn theo ngày/tuần/tháng, cấp học, ngân sách, dị ứng và tự động tính lại dinh dưỡng khi đổi món.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Chu kỳ</label>
              <select
                value={periodType}
                onChange={(e) => setPeriodType(e.target.value as any)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              >
                <option value="daily">Theo ngày</option>
                <option value="weekly">Theo tuần (5 ngày)</option>
                <option value="monthly">Theo tháng (10 ngày mẫu)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Nhóm tuổi</label>
              <select
                value={ageGroup}
                onChange={(e) => setAgeGroup(e.target.value as StudentAgeGroup)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
              >
                <option value="6-8">6–8 tuổi (Lớp 1–3)</option>
                <option value="9-11">9–11 tuổi (Lớp 4–5)</option>
                <option value="12-14">12–14 tuổi (THCS)</option>
                <option value="15-18">15–18 tuổi (THPT)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Cấp học</label>
              <input
                type="text"
                value={gradeLevel}
                onChange={(e) => setGradeLevel(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Ngân sách / bữa (VND)</label>
              <input
                type="number"
                value={budgetVnd}
                onChange={(e) => setBudgetVnd(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Loại trừ dị ứng</label>
              <input
                type="text"
                value={allergensInput}
                onChange={(e) => setAllergensInput(e.target.value)}
                placeholder="VD: đậu phộng, tôm"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-600 mb-1">Nguồn thực phẩm ưu tiên</label>
              <input
                type="text"
                value={foodSourcesInput}
                onChange={(e) => setFoodSourcesInput(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <button
              type="button"
              onClick={handleGenerateMenu}
              disabled={generating}
              className="inline-flex items-center justify-center gap-2 px-5 py-2 text-sm font-medium bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap"
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {generating ? 'Đang lập thực đơn...' : 'Tạo thực đơn bằng AI'}
            </button>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-800">{errorMsg}</div>
      )}

      {menus.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
          Chưa có thực đơn nào trong Firestore cho phạm vi trường hiện tại.
        </div>
      ) : (
        <div className="space-y-4">
          {menus.map((menu) => (
            <div key={menu.id} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">{menu.title}</h3>
                  <div className="text-xs text-slate-500 mt-1">
                    Trạng thái: <span className="font-semibold text-slate-800">{STATUS_LABELS[menu.status]}</span> ·
                    Nhóm tuổi {menu.ageGroup} · Ngân sách{' '}
                    <span className="font-mono tabular-nums">{(menu.budgetVndPerMeal || 0).toLocaleString()}đ</span> · TB{' '}
                    <span className="font-mono tabular-nums">{menu.nutritionSummary?.avgKcal || 0} kcal/ngày</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {canCreateOrEdit && (
                    <button
                      type="button"
                      onClick={() => handleAnalyzeMenu(menu)}
                      disabled={analyzingId === menu.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50"
                    >
                      {analyzingId === menu.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                      Phân tích thực đơn
                    </button>
                  )}
                  {canCreateOrEdit && (menu.status === 'draft' || menu.status === 'ai_suggested') && (
                    <button
                      type="button"
                      onClick={() => handleStatusChange(menu, 'pending_approval')}
                      className="px-3 py-1.5 text-xs font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700"
                    >
                      Gửi duyệt
                    </button>
                  )}
                  {canApproveOrPublish && menu.status !== 'approved' && menu.status !== 'published' && (
                    <button
                      type="button"
                      onClick={() => handleStatusChange(menu, 'approved')}
                      className="px-3 py-1.5 text-xs font-medium bg-sky-700 text-white rounded-lg hover:bg-sky-800"
                    >
                      Duyệt
                    </button>
                  )}
                  {canApproveOrPublish && menu.status !== 'published' && (
                    <button
                      type="button"
                      onClick={() => handleStatusChange(menu, 'published')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-emerald-700 text-white rounded-lg hover:bg-emerald-800"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Công bố
                    </button>
                  )}
                  {canApproveOrPublish && (
                    <button
                      type="button"
                      onClick={async () => {
                        await MenuRepo.delete(menu.id);
                        onRefresh();
                      }}
                      className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg"
                      title="Xóa thực đơn"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {menuAnalysis[menu.id] && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1.5">
                  <div className="font-semibold text-slate-900">Đánh giá AI: {menuAnalysis[menu.id].overallAssessment}</div>
                  <div className="text-emerald-800">Điểm mạnh: {(menuAnalysis[menu.id].strengths || []).join(' · ')}</div>
                  <div className="text-amber-800">Gợi ý tối ưu: {(menuAnalysis[menu.id].improvements || []).join(' · ')}</div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {menu.days.map((day, dayIdx) => (
                  <div key={dayIdx} className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-900">
                      <span>{day.dayLabel}</span>
                      <span className="font-mono tabular-nums text-emerald-700">{day.dayKcal} kcal</span>
                    </div>
                    {day.meals.map((slot, mealIdx) => (
                      <div key={mealIdx} className="space-y-1">
                        <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
                          {slot.mealType} · {slot.slotKcal} kcal
                        </div>
                        {slot.dishes.map((dish, dishIdx) => {
                          const rKey = `${menu.id}_${dayIdx}_${mealIdx}_${dishIdx}`;
                          const canModifyDish =
                            canCreateOrEdit &&
                            (canApproveOrPublish || (menu.status !== 'published' && menu.createdByUid === user.uid));
                          const isUnmatched = dish.foodId === 'custom' || dish.kcal === 0;
                          return (
                            <div
                              key={dishIdx}
                              className="flex items-center justify-between gap-2 text-xs bg-white px-2.5 py-1.5 rounded border border-slate-200"
                            >
                              <div className="min-w-0">
                                <div className="font-medium text-slate-800 truncate">{dish.nameVi}</div>
                                <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                                  {dish.portionGrams}g · {dish.kcal} kcal
                                  {isUnmatched && (
                                    <span className="ml-1.5 font-sans text-amber-700">(Chưa khớp CSDL)</span>
                                  )}
                                </div>
                              </div>
                              {canModifyDish && (
                                <button
                                  type="button"
                                  onClick={() => handleReplaceDish(menu, dayIdx, mealIdx, dishIdx)}
                                  disabled={replacingKey === rKey}
                                  className="shrink-0 p-1 text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 rounded"
                                  title="Đổi món bằng AI"
                                >
                                  {replacingKey === rKey ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <RefreshCw className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
