import assert from 'node:assert/strict';
import { calculateMealNutrition, getMealTarget, scoreMealDeterministically } from '../src/lib/nutritionEngine';
import { FOOD_CATEGORY_LABELS, SEED_VIETNAMESE_FOODS } from '../src/lib/vietnameseFoods';
import { FoodCategory } from '../src/types/domain';
import {
  sanitizeAnalyzeMealResponse,
  sanitizeEstimatePortionResponse,
  sanitizeGenerateMenuResponse,
} from '../src/lib/aiValidation';

// 1. Verify all 12 Vietnamese food categories are covered
const allCategories = Object.keys(FOOD_CATEGORY_LABELS) as FoodCategory[];
assert.equal(allCategories.length, 12, 'Phải có đủ 12 nhóm thực phẩm Việt Nam');
for (const cat of allCategories) {
  const found = SEED_VIETNAMESE_FOODS.some((f) => f.category === cat);
  assert.equal(found, true, `Thiếu món mẫu cho nhóm ${cat}`);
}
for (const food of SEED_VIETNAMESE_FOODS) {
  assert.equal(food.verified, true, `${food.nameVi} phải được đánh dấu verified`);
  assert.ok(food.sourceRef.length > 10, `${food.nameVi} phải có nguồn tham khảo`);
}

// 2. Verify age-specific targets differ (no single calorie target for all ages)
const target6to8 = getMealTarget('6-8', 'lunch');
const target15to18 = getMealTarget('15-18', 'lunch');
assert.ok(target15to18.kcal > target6to8.kcal, 'Mục tiêu kcal tuổi 15-18 phải lớn hơn 6-8');

// 3. Verify nutrition calculation + deterministic scoring + allergen penalty
const rice = SEED_VIETNAMESE_FOODS.find((f) => f.id === 'food_com_trang')!;
const pork = SEED_VIETNAMESE_FOODS.find((f) => f.id === 'food_thit_kho_trung')!;
const veg = SEED_VIETNAMESE_FOODS.find((f) => f.id === 'food_cai_thia_xao_toi')!;
const fruit = SEED_VIETNAMESE_FOODS.find((f) => f.id === 'food_dua_hau')!;

const { items, totals } = calculateMealNutrition(
  [
    { food: rice, portionGrams: 180 },
    { food: pork, portionGrams: 120 },
    { food: veg, portionGrams: 100 },
    { food: fruit, portionGrams: 120 },
  ],
  '9-11',
  'lunch'
);

assert.equal(items.length, 4);
assert.ok(totals.kcal > 500 && totals.kcal < 750, `Tổng kcal phải hợp lý: ${totals.kcal}`);

const cleanScore = scoreMealDeterministically(items, totals, '9-11', 'lunch', []);
assert.ok(cleanScore.totalScore >= 75, `Bữa cân đối phải đạt >=75đ, nhận ${cleanScore.totalScore}`);
assert.equal(cleanScore.allergenAlerts.length, 0);

const allergyScore = scoreMealDeterministically(items, totals, '9-11', 'lunch', ['trứng']);
assert.ok(allergyScore.allergenAlerts.length > 0, 'Phải phát hiện cảnh báo dị ứng trứng');
assert.ok(allergyScore.totalScore < cleanScore.totalScore, 'Điểm phải bị trừ khi có dị ứng');

// 4. Verify AI response validation & clamping
const badVision = sanitizeAnalyzeMealResponse({
  imageQuality: 'unknown_quality',
  items: [
    { nameVi: 'Cơm tấm', foodGroup: 'not_a_real_group', estimatedGrams: 99999, confidence: 4.2 },
    { nameVi: 'Rau luộc', foodGroup: 'vegetables', estimatedGrams: -10, confidence: -0.5 },
  ],
});
assert.equal(badVision.imageQuality, 'good');
assert.equal(badVision.items[0].foodGroup, 'traditional_dishes');
assert.equal(badVision.items[0].estimatedGrams, 3000);
assert.equal(badVision.items[0].confidence, 1);
assert.equal(badVision.items[1].estimatedGrams, 5);
assert.equal(badVision.items[1].confidence, 0);

const badPortion = sanitizeEstimatePortionResponse({ estimatedGrams: 'NaN', confidence: 2 });
assert.equal(badPortion.estimatedGrams, 100);
assert.equal(badPortion.confidence, 1);

const badMenu = sanitizeGenerateMenuResponse({
  title: '  Thực đơn mẫu  ',
  days: [{ dayLabel: 'Thứ 2', meals: [{ mealType: 'invalid_slot', estimatedCostVnd: -50, dishes: [{ foodId: 'x', nameVi: 'Phở', portionGrams: 5000 }] }] }],
});
assert.equal(badMenu.days[0].meals[0].mealType, 'lunch');
assert.equal(badMenu.days[0].meals[0].estimatedCostVnd, 0);
assert.equal(badMenu.days[0].meals[0].dishes[0].portionGrams, 2000);

console.log('ALL NUTRITION ENGINE & AI VALIDATION CHECKS PASSED:', {
  foodsCount: SEED_VIETNAMESE_FOODS.length,
  lunchTarget6to8: target6to8.kcal,
  lunchTarget15to18: target15to18.kcal,
  sampleMealKcal: totals.kcal,
  cleanScore: cleanScore.totalScore,
  allergyScore: allergyScore.totalScore,
});
