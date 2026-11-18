import { FoodCategory } from '../types/domain';

export const VALID_FOOD_CATEGORIES: FoodCategory[] = [
  'grains_starches',
  'meat',
  'seafood',
  'eggs',
  'dairy',
  'vegetables',
  'fruits',
  'legumes',
  'fats_oils',
  'traditional_dishes',
  'soups_broths',
  'boarding_meals',
];

export const VALID_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export const MAX_BASE64_IMAGE_CHARS = 7_000_000; // ~5.1 MB binary image ceiling

export function clampNumber(val: unknown, min: number, max: number, fallback: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function sanitizeAnalyzeMealResponse(raw: any) {
  const validQualities = ['good', 'blurry', 'dark', 'partial'] as const;
  const imageQuality = validQualities.includes(raw?.imageQuality) ? raw.imageQuality : 'good';
  const qualityNote = typeof raw?.qualityNote === 'string' ? raw.qualityNote.slice(0, 240) : '';
  const rawItems = Array.isArray(raw?.items) ? raw.items : [];

  const items = rawItems.slice(0, 20).map((it: any) => {
    const foodGroup: FoodCategory = VALID_FOOD_CATEGORIES.includes(it?.foodGroup)
      ? it.foodGroup
      : 'traditional_dishes';
    return {
      nameVi: String(it?.nameVi || 'Món ăn chưa rõ').trim().slice(0, 140),
      ingredients: Array.isArray(it?.ingredients)
        ? it.ingredients.slice(0, 12).map((s: any) => String(s).trim().slice(0, 60)).filter(Boolean)
        : [],
      foodGroup,
      estimatedGrams: Math.round(clampNumber(it?.estimatedGrams, 5, 3000, 100)),
      confidence: Number(clampNumber(it?.confidence, 0, 1, 0.7).toFixed(2)),
    };
  });

  return { imageQuality, qualityNote, items };
}

export function sanitizeExplainMealResponse(raw: any) {
  return {
    explanation: String(raw?.explanation || 'Đã hoàn tất đánh giá dinh dưỡng theo quy tắc độ tuổi.').slice(0, 1200),
    childFriendlyTips: Array.isArray(raw?.childFriendlyTips)
      ? raw.childFriendlyTips.slice(0, 6).map((t: any) => String(t).trim().slice(0, 220)).filter(Boolean)
      : [],
    suggestedAdditions: Array.isArray(raw?.suggestedAdditions)
      ? raw.suggestedAdditions.slice(0, 6).map((a: any) => String(a).trim().slice(0, 180)).filter(Boolean)
      : [],
    groupBenefits: Array.isArray(raw?.groupBenefits)
      ? raw.groupBenefits
          .slice(0, 8)
          .map((g: any) => ({
            group: String(g?.group || '').trim().slice(0, 80),
            benefit: String(g?.benefit || '').trim().slice(0, 280),
          }))
          .filter((g: any) => g.group && g.benefit)
      : [],
  };
}

export function sanitizeEstimatePortionResponse(raw: any) {
  return {
    estimatedGrams: Math.round(clampNumber(raw?.estimatedGrams, 5, 3000, 100)),
    householdUnit: String(raw?.householdUnit || '1 phần tiêu chuẩn').trim().slice(0, 100),
    confidence: Number(clampNumber(raw?.confidence, 0, 1, 0.7).toFixed(2)),
    rationale: String(raw?.rationale || '').trim().slice(0, 400),
  };
}

export function sanitizeGenerateMenuResponse(raw: any, fallbackBudget = 32000) {
  const title = String(raw?.title || 'Thực đơn bán trú đề xuất').trim().slice(0, 160);
  const rawDays = Array.isArray(raw?.days) ? raw.days : [];
  const days = rawDays.slice(0, 31).map((d: any, dIdx: number) => ({
    dayLabel: String(d?.dayLabel || `Ngày ${dIdx + 1}`).trim().slice(0, 60),
    meals: (Array.isArray(d?.meals) ? d.meals : []).slice(0, 4).map((m: any) => ({
      mealType: ['breakfast', 'lunch', 'dinner', 'snack'].includes(m?.mealType) ? m.mealType : 'lunch',
      estimatedCostVnd: Math.round(clampNumber(m?.estimatedCostVnd, 0, 1_000_000, fallbackBudget)),
      dishes: (Array.isArray(m?.dishes) ? m.dishes : []).slice(0, 12).map((dish: any) => ({
        foodId: String(dish?.foodId || 'custom').trim().slice(0, 128),
        nameVi: String(dish?.nameVi || 'Món ăn').trim().slice(0, 140),
        portionGrams: Math.round(clampNumber(dish?.portionGrams, 10, 2000, 100)),
      })),
    })),
  }));
  return { title, days };
}

export function sanitizeAnalyzeMenuResponse(raw: any) {
  return {
    overallAssessment: String(raw?.overallAssessment || '').trim().slice(0, 800),
    strengths: Array.isArray(raw?.strengths)
      ? raw.strengths.slice(0, 8).map((s: any) => String(s).trim().slice(0, 240)).filter(Boolean)
      : [],
    improvements: Array.isArray(raw?.improvements)
      ? raw.improvements.slice(0, 8).map((s: any) => String(s).trim().slice(0, 240)).filter(Boolean)
      : [],
    budgetEfficiencyNote: typeof raw?.budgetEfficiencyNote === 'string' ? raw.budgetEfficiencyNote.slice(0, 300) : '',
  };
}

export function sanitizeReplaceFoodResponse(raw: any) {
  const alts = Array.isArray(raw?.alternatives) ? raw.alternatives : [];
  return {
    alternatives: alts.slice(0, 5).map((a: any) => ({
      foodId: String(a?.foodId || 'custom').trim().slice(0, 128),
      nameVi: String(a?.nameVi || 'Món thay thế').trim().slice(0, 140),
      recommendedGrams: Math.round(clampNumber(a?.recommendedGrams, 10, 2000, 100)),
      reason: String(a?.reason || '').trim().slice(0, 300),
    })),
  };
}
