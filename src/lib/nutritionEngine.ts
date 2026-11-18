import {
  AgeGroup,
  FoodCategory,
  MealType,
  NutritionTotals,
  RecognizedMealItem,
  ScoreBreakdown,
  VietnameseFood,
} from '../types/domain';
import { FOOD_CATEGORY_LABELS } from './vietnameseFoods';

export interface DailyReferenceTarget {
  dailyKcal: number;
  dailyProteinG: number;
  dailyCarbsG: number;
  dailyFatG: number;
  dailyFiberG: number;
}

// Reference values adapted from Vietnamese RDA / NIN school-age dietary recommendations
export const AGE_NUTRITION_TARGETS: Record<AgeGroup, DailyReferenceTarget> = {
  '6-8': { dailyKcal: 1600, dailyProteinG: 56, dailyCarbsG: 225, dailyFatG: 48, dailyFiberG: 18 },
  '9-11': { dailyKcal: 1950, dailyProteinG: 68, dailyCarbsG: 275, dailyFatG: 58, dailyFiberG: 22 },
  '12-14': { dailyKcal: 2300, dailyProteinG: 82, dailyCarbsG: 325, dailyFatG: 68, dailyFiberG: 26 },
  '15-18': { dailyKcal: 2600, dailyProteinG: 94, dailyCarbsG: 365, dailyFatG: 76, dailyFiberG: 30 },
  adult: { dailyKcal: 2100, dailyProteinG: 75, dailyCarbsG: 295, dailyFatG: 60, dailyFiberG: 25 },
};

export const MEAL_TYPE_RATIO: Record<MealType, number> = {
  breakfast: 0.25,
  lunch: 0.35,
  dinner: 0.3,
  snack: 0.1,
};

export interface MealCalculationInput {
  food: VietnameseFood;
  portionGrams: number;
  confidence?: number;
  userConfirmed?: boolean;
}

export function getMealTarget(ageGroup: AgeGroup = '9-11', mealType: MealType = 'lunch') {
  const daily = AGE_NUTRITION_TARGETS[ageGroup] || AGE_NUTRITION_TARGETS['9-11'];
  const ratio = MEAL_TYPE_RATIO[mealType] || 0.35;
  return {
    kcal: Math.round(daily.dailyKcal * ratio),
    proteinG: Math.round(daily.dailyProteinG * ratio * 10) / 10,
    carbsG: Math.round(daily.dailyCarbsG * ratio * 10) / 10,
    fatG: Math.round(daily.dailyFatG * ratio * 10) / 10,
    fiberG: Math.round(daily.dailyFiberG * ratio * 10) / 10,
  };
}

export function calculateMealNutrition(
  inputs: MealCalculationInput[],
  ageGroup: AgeGroup = '9-11',
  mealType: MealType = 'lunch'
): { items: RecognizedMealItem[]; totals: NutritionTotals } {
  const target = getMealTarget(ageGroup, mealType);

  let kcal = 0;
  let proteinG = 0;
  let carbsG = 0;
  let fatG = 0;
  let fiberG = 0;
  let ironMg = 0;
  let calciumMg = 0;
  let vitaminAMcg = 0;
  let vitaminCMg = 0;
  let sodiumMg = 0;

  const items: RecognizedMealItem[] = inputs.map(({ food, portionGrams, confidence = 1, userConfirmed = true }) => {
    const scale = food.standardServingG > 0 ? portionGrams / food.standardServingG : 1;
    const itemKcal = Math.round(food.energyKcal * scale);
    const itemP = Math.round(food.proteinG * scale * 10) / 10;
    const itemC = Math.round(food.carbsG * scale * 10) / 10;
    const itemF = Math.round(food.fatG * scale * 10) / 10;
    const itemFib = Math.round(food.fiberG * scale * 10) / 10;

    kcal += itemKcal;
    proteinG += itemP;
    carbsG += itemC;
    fatG += itemF;
    fiberG += itemFib;

    if (food.micronutrients?.ironMg) ironMg += food.micronutrients.ironMg * scale;
    if (food.micronutrients?.calciumMg) calciumMg += food.micronutrients.calciumMg * scale;
    if (food.micronutrients?.vitaminAMcg) vitaminAMcg += food.micronutrients.vitaminAMcg * scale;
    if (food.micronutrients?.vitaminCMg) vitaminCMg += food.micronutrients.vitaminCMg * scale;
    if (food.micronutrients?.sodiumMg) sodiumMg += food.micronutrients.sodiumMg * scale;

    return {
      foodId: food.id,
      nameVi: food.nameVi,
      foodGroup: food.category,
      portionGrams: Math.round(portionGrams),
      confidence,
      userConfirmed,
      energyKcal: itemKcal,
      proteinG: itemP,
      carbsG: itemC,
      fatG: itemF,
      fiberG: itemFib,
      allergens: food.allergens || [],
    };
  });

  const targetCoveragePct = target.kcal > 0 ? Math.round((kcal / target.kcal) * 100) : 0;

  return {
    items,
    totals: {
      kcal: Math.round(kcal),
      proteinG: Math.round(proteinG * 10) / 10,
      carbsG: Math.round(carbsG * 10) / 10,
      fatG: Math.round(fatG * 10) / 10,
      fiberG: Math.round(fiberG * 10) / 10,
      ironMg: Math.round(ironMg * 10) / 10,
      calciumMg: Math.round(calciumMg),
      vitaminAMcg: Math.round(vitaminAMcg),
      vitaminCMg: Math.round(vitaminCMg),
      sodiumMg: Math.round(sodiumMg),
      targetKcal: target.kcal,
      targetCoveragePct,
    },
  };
}

/**
 * Deterministic rule-based nutrition scorer (transparent & auditable; never delegated to LLM).
 */
export function scoreMealDeterministically(
  items: RecognizedMealItem[],
  totals: NutritionTotals,
  ageGroup: AgeGroup = '9-11',
  mealType: MealType = 'lunch',
  studentAllergies: string[] = []
): ScoreBreakdown {
  const rulesSummary: string[] = [];
  const detectedGroups = Array.from(new Set(items.map((i) => i.foodGroup)));

  // 1. Diversity score (max 25 pts): distinct dishes & food categories
  const uniqueFoods = new Set(items.map((i) => i.foodId || i.nameVi)).size;
  const diversityScore = Math.min(25, uniqueFoods * 5 + Math.min(10, detectedGroups.length * 3));
  rulesSummary.push(`Đa dạng món (${uniqueFoods} món / ${detectedGroups.length} nhóm): ${diversityScore}/25 điểm`);

  // 2. Group coverage score (max 25 pts): Starch + Protein + Veggie/Fruit + Micronutrient/Soup
  const hasStarch = detectedGroups.some((g) => ['grains_starches', 'traditional_dishes'].includes(g));
  const hasProtein = detectedGroups.some((g) => ['meat', 'seafood', 'eggs', 'legumes', 'boarding_meals', 'traditional_dishes'].includes(g));
  const hasVeg = detectedGroups.some((g) => ['vegetables', 'soups_broths'].includes(g));
  const hasFruitOrDairy = detectedGroups.some((g) => ['fruits', 'dairy'].includes(g));

  let groupCoverageScore = 0;
  if (hasStarch) groupCoverageScore += 7;
  if (hasProtein) groupCoverageScore += 7;
  if (hasVeg) groupCoverageScore += 7;
  if (hasFruitOrDairy) groupCoverageScore += 4;
  rulesSummary.push(
    `Độ phủ nhóm thực phẩm (${detectedGroups.map((g) => FOOD_CATEGORY_LABELS[g] || g).join(', ') || 'Chưa có'}): ${groupCoverageScore}/25 điểm`
  );

  // 3. Portion appropriateness for ageGroup & mealType (max 25 pts)
  const target = getMealTarget(ageGroup, mealType);
  const ratio = target.kcal > 0 ? totals.kcal / target.kcal : 0;
  let portionBalanceScore = 0;
  if (ratio >= 0.85 && ratio <= 1.15) {
    portionBalanceScore = 25;
  } else if (ratio >= 0.7 && ratio <= 1.3) {
    portionBalanceScore = 18;
  } else if (ratio >= 0.5 && ratio <= 1.5) {
    portionBalanceScore = 11;
  } else if (totals.kcal > 0) {
    portionBalanceScore = 5;
  }
  const ageAppropriate = ratio >= 0.65 && ratio <= 1.35;
  rulesSummary.push(
    `Khẩu phần theo độ tuổi ${ageGroup} (${totals.kcal}/${target.kcal} kcal, đạt ${Math.round(ratio * 100)}%): ${portionBalanceScore}/25 điểm`
  );

  // 4. Macro & fiber balance (max 25 pts)
  const totalMacroKcal = totals.proteinG * 4 + totals.carbsG * 4 + totals.fatG * 9;
  let macroBalanceScore = 0;
  if (totalMacroKcal > 0) {
    const pPct = (totals.proteinG * 4) / totalMacroKcal;
    const cPct = (totals.carbsG * 4) / totalMacroKcal;
    const fPct = (totals.fatG * 9) / totalMacroKcal;
    if (pPct >= 0.12 && pPct <= 0.25) macroBalanceScore += 8;
    else if (pPct >= 0.08) macroBalanceScore += 4;

    if (cPct >= 0.45 && cPct <= 0.68) macroBalanceScore += 8;
    else if (cPct >= 0.35) macroBalanceScore += 4;

    if (fPct >= 0.15 && fPct <= 0.33) macroBalanceScore += 5;
    else macroBalanceScore += 2;

    if (totals.fiberG >= target.fiberG * 0.6) macroBalanceScore += 4;
    else if (totals.fiberG >= 1.5) macroBalanceScore += 2;
  }
  rulesSummary.push(`Cân đối đạm-bột-béo-xơ: ${macroBalanceScore}/25 điểm`);

  // 5. Allergen checking
  const normalizedStudentAllergies = studentAllergies.map((a) => a.trim().toLowerCase()).filter(Boolean);
  const allergenAlerts: string[] = [];
  items.forEach((item) => {
    const itemAllergens = (item.allergens || []).map((a) => a.toLowerCase());
    normalizedStudentAllergies.forEach((allergy) => {
      if (
        itemAllergens.some((ia) => ia.includes(allergy) || allergy.includes(ia)) ||
        item.nameVi.toLowerCase().includes(allergy)
      ) {
        allergenAlerts.push(`${item.nameVi} có khả năng chứa tác nhân dị ứng "${allergy}"`);
      }
    });
  });

  const allergenPenalty = Math.min(40, allergenAlerts.length * 20);
  if (allergenAlerts.length > 0) {
    rulesSummary.push(`Cảnh báo dị ứng (-${allergenPenalty} điểm): ${allergenAlerts.join('; ')}`);
  }

  const totalScore = Math.max(
    0,
    Math.min(100, diversityScore + groupCoverageScore + portionBalanceScore + macroBalanceScore - allergenPenalty)
  );

  return {
    totalScore,
    diversityScore,
    groupCoverageScore,
    portionBalanceScore,
    macroBalanceScore,
    allergenPenalty,
    ageAppropriate,
    detectedGroups,
    allergenAlerts,
    rulesSummary,
  };
}

export function normalizeFoodLookup(foods: VietnameseFood[], nameOrId: string): VietnameseFood | undefined {
  const q = nameOrId.trim().toLowerCase();
  return (
    foods.find((f) => f.id.toLowerCase() === q) ||
    foods.find((f) => f.nameVi.toLowerCase() === q) ||
    foods.find((f) => f.nameVi.toLowerCase().includes(q) || q.includes(f.nameVi.toLowerCase()))
  );
}
