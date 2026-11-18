import { UserProfile } from '../types/domain';
import { auth } from './firebase';
import { GovernanceService } from './services';

async function callAiEndpoint<T>(
  endpoint: string,
  body: Record<string, any>,
  profile: UserProfile
): Promise<{ data: T; usage: any }> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Bạn cần đăng nhập để sử dụng AI Engine.');
  }
  const idToken = await user.getIdToken();

  const startedAt = Date.now();
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });

  const payload = await resp.json().catch(() => ({}));
  const usage = payload?.usage || {
    endpoint,
    model: 'gemini-4-hydrogen',
    promptTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    latencyMs: Date.now() - startedAt,
  };

  if (!resp.ok) {
    const status =
      payload?.code === 'RATE_LIMITED'
        ? 'rate_limited'
        : payload?.code === 'TIMEOUT'
          ? 'timeout'
          : 'error';
    await GovernanceService.recordAiUsage({
      schoolId: profile.schoolId || '',
      userId: profile.uid,
      userRole: profile.role,
      endpoint,
      model: usage.model || 'gemini-4-hydrogen',
      promptTokens: usage.promptTokens || 0,
      outputTokens: usage.outputTokens || 0,
      totalTokens: usage.totalTokens || 0,
      estimatedCostUsd: usage.estimatedCostUsd || 0,
      latencyMs: usage.latencyMs || Date.now() - startedAt,
      status,
      errorMessage: String(payload?.error || resp.statusText).slice(0, 380),
    });
    throw new Error(payload?.error || `Lỗi máy chủ AI (${resp.status})`);
  }

  await GovernanceService.recordAiUsage({
    schoolId: profile.schoolId || '',
    userId: profile.uid,
    userRole: profile.role,
    endpoint,
    model: usage.model || 'gemini-4-hydrogen',
    promptTokens: usage.promptTokens || 0,
    outputTokens: usage.outputTokens || 0,
    totalTokens: usage.totalTokens || 0,
    estimatedCostUsd: usage.estimatedCostUsd || 0,
    latencyMs: usage.latencyMs || Date.now() - startedAt,
    status: 'success',
  });

  return { data: payload.data as T, usage };
}

export interface AnalyzedMealResponse {
  imageQuality: 'good' | 'blurry' | 'dark' | 'partial';
  qualityNote?: string;
  items: {
    nameVi: string;
    ingredients?: string[];
    foodGroup: string;
    estimatedGrams: number;
    confidence: number;
  }[];
}

export const AiEngineClient = {
  analyzeMeal(
    profile: UserProfile,
    input: { imageBase64: string; mimeType: string; mealType: string; catalogHints: string[] }
  ) {
    return callAiEndpoint<AnalyzedMealResponse>('/api/ai/analyze-meal', input, profile);
  },

  explainMeal(
    profile: UserProfile,
    input: {
      items: any[];
      nutritionTotals: any;
      scoreBreakdown: any;
      ageGroup: string;
      mealType: string;
      allergies: string[];
    }
  ) {
    return callAiEndpoint<{
      explanation: string;
      childFriendlyTips: string[];
      suggestedAdditions: string[];
      groupBenefits: { group: string; benefit: string }[];
    }>('/api/ai/explain-meal', input, profile);
  },

  estimatePortion(
    profile: UserProfile,
    input: { dishName?: string; description?: string; imageBase64?: string; mimeType?: string }
  ) {
    return callAiEndpoint<{
      estimatedGrams: number;
      householdUnit: string;
      confidence: number;
      rationale: string;
    }>('/api/ai/estimate-portion', input, profile);
  },

  generateMenu(
    profile: UserProfile,
    input: {
      periodType: 'daily' | 'weekly' | 'monthly';
      ageGroup: string;
      gradeLevel: string;
      budgetVndPerMeal: number;
      excludedAllergens: string[];
      foodSources: string[];
      availableFoods: any[];
    }
  ) {
    return callAiEndpoint<{
      title: string;
      days: {
        dayLabel: string;
        meals: {
          mealType: string;
          estimatedCostVnd: number;
          dishes: { foodId: string; nameVi: string; portionGrams: number }[];
        }[];
      }[];
    }>('/api/ai/generate-menu', input, profile);
  },

  analyzeMenu(
    profile: UserProfile,
    input: { menuTitle: string; ageGroup: string; nutritionSummary: any; excludedAllergens: string[] }
  ) {
    return callAiEndpoint<{
      overallAssessment: string;
      strengths: string[];
      improvements: string[];
      budgetEfficiencyNote?: string;
    }>('/api/ai/analyze-menu', input, profile);
  },

  replaceFood(
    profile: UserProfile,
    input: { currentDish: any; excludedAllergens: string[]; availableFoods: any[]; reason?: string }
  ) {
    return callAiEndpoint<{
      alternatives: { foodId: string; nameVi: string; recommendedGrams: number; reason: string }[];
    }>('/api/ai/replace-food', input, profile);
  },
};
