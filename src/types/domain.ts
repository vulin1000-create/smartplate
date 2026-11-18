export type UserRole = 'student' | 'parent' | 'teacher' | 'school_admin' | 'super_admin';

export type AccountStatus = 'active' | 'pending_verification' | 'suspended' | 'deleted';

export type AgeGroup = '6-8' | '9-11' | '12-14' | '15-18' | 'adult';

export type StudentAgeGroup = '6-8' | '9-11' | '12-14' | '15-18';

export type FoodCategory =
  | 'grains_starches'
  | 'meat'
  | 'seafood'
  | 'eggs'
  | 'dairy'
  | 'vegetables'
  | 'fruits'
  | 'legumes'
  | 'fats_oils'
  | 'traditional_dishes'
  | 'soups_broths'
  | 'boarding_meals';

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export type MenuStatus =
  | 'draft'
  | 'ai_suggested'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'published';

export type ConsentType =
  | 'ai_photo_analysis'
  | 'growth_tracking'
  | 'nutrition_reporting'
  | 'data_retention';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  role: UserRole;
  status: AccountStatus;
  schoolId: string;
  classIds?: string[];
  gradeLevel?: string;
  ageGroup?: AgeGroup;
  allergies?: string[];
  linkedChildIds?: string[];
  verifiedParentIds?: string[];
  createdAt: any;
  updatedAt: any;
}

export interface School {
  id: string;
  name: string;
  code: string;
  province: string;
  level: 'primary' | 'secondary' | 'high' | 'k12';
  boardingEnabled: boolean;
  status: 'active' | 'inactive';
  adminUid?: string;
  retentionDays: number;
  createdAt: any;
  updatedAt: any;
}

export interface AcademicYear {
  id: string;
  schoolId: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  createdAt: any;
  updatedAt: any;
}

export interface SchoolClass {
  id: string;
  schoolId: string;
  academicYearId: string;
  name: string;
  grade: string;
  ageGroup: StudentAgeGroup;
  teacherUid?: string;
  teacherName?: string;
  studentCount?: number;
  createdAt: any;
  updatedAt: any;
}

export interface ParentChildLink {
  id: string;
  schoolId: string;
  parentUid: string;
  parentEmail?: string;
  studentUid: string;
  studentName?: string;
  classId?: string;
  status: 'pending' | 'verified' | 'rejected' | 'revoked';
  verifiedByUid?: string;
  createdAt: any;
  updatedAt: any;
}

export interface Micronutrients {
  ironMg?: number;
  calciumMg?: number;
  vitaminAMcg?: number;
  vitaminCMg?: number;
  sodiumMg?: number;
}

export interface VietnameseFood {
  id: string;
  nameVi: string;
  nameEn?: string;
  category: FoodCategory;
  ingredients?: string[];
  standardServingG: number;
  servingLabel?: string;
  energyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  micronutrients?: Micronutrients;
  allergens?: string[];
  sourceRef: string;
  verified: boolean;
  updatedDate?: string;
  createdByUid?: string;
  createdAt?: any;
  updatedAt?: any;
}

export interface RecognizedMealItem {
  foodId: string;
  nameVi: string;
  foodGroup: FoodCategory;
  portionGrams: number;
  confidence: number;
  userConfirmed: boolean;
  energyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  allergens?: string[];
}

export interface NutritionTotals {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  ironMg?: number;
  calciumMg?: number;
  vitaminAMcg?: number;
  vitaminCMg?: number;
  sodiumMg?: number;
  targetKcal: number;
  targetCoveragePct: number;
}

export interface ScoreBreakdown {
  totalScore: number;
  diversityScore: number;
  groupCoverageScore: number;
  portionBalanceScore: number;
  macroBalanceScore: number;
  allergenPenalty: number;
  ageAppropriate: boolean;
  detectedGroups: FoodCategory[];
  allergenAlerts: string[];
  rulesSummary: string[];
}

export interface AiAdvice {
  explanation: string;
  childFriendlyTips: string[];
  suggestedAdditions: string[];
  groupBenefits: { group: string; benefit: string }[];
}

export interface MealLog {
  id: string;
  schoolId: string;
  classId?: string;
  studentUid: string;
  studentName?: string;
  verifiedParentIds?: string[];
  mealType: MealType;
  dateStr: string;
  imagePreviewUrl?: string;
  imageQuality?: 'good' | 'blurry' | 'dark' | 'partial' | 'manual';
  items: RecognizedMealItem[];
  nutritionTotals: NutritionTotals;
  scoreBreakdown: ScoreBreakdown;
  aiAdvice?: AiAdvice;
  teacherReviewed?: boolean;
  createdAt: any;
  updatedAt: any;
}

export interface MenuMealSlot {
  mealType: MealType;
  dishes: {
    foodId: string;
    nameVi: string;
    category: FoodCategory;
    portionGrams: number;
    kcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number;
  }[];
  slotKcal: number;
  estimatedCostVnd: number;
}

export interface MenuDay {
  dayLabel: string;
  dateStr?: string;
  meals: MenuMealSlot[];
  dayKcal: number;
  dayCostVnd: number;
}

export interface MenuPlan {
  id: string;
  schoolId: string;
  classId?: string;
  title: string;
  periodType: 'daily' | 'weekly' | 'monthly';
  startDate?: string;
  endDate?: string;
  gradeLevel?: string;
  ageGroup: StudentAgeGroup;
  budgetVndPerMeal?: number;
  excludedAllergens?: string[];
  foodSources?: string[];
  status: MenuStatus;
  days: MenuDay[];
  nutritionSummary?: {
    avgKcal: number;
    avgProteinG: number;
    avgCarbsG: number;
    avgFatG: number;
    avgFiberG: number;
    diversityAvg: number;
  };
  createdByUid: string;
  approvedByUid?: string;
  createdAt: any;
  updatedAt: any;
}

export interface TeacherComment {
  id: string;
  schoolId: string;
  classId: string;
  teacherUid: string;
  teacherName?: string;
  studentUid: string;
  studentName?: string;
  verifiedParentIds?: string[];
  category: 'praise' | 'attention' | 'allergy_note' | 'home_activity';
  content: string;
  homeSuggestion?: string;
  createdAt: any;
  updatedAt: any;
}

export interface StudentTask {
  id: string;
  schoolId: string;
  classId: string;
  teacherUid: string;
  title: string;
  description?: string;
  targetCategory?: string;
  points: number;
  dueDate?: string;
  createdAt: any;
  updatedAt: any;
}

export interface GrowthRecord {
  dateStr: string;
  heightCm: number;
  weightKg: number;
  note?: string;
}

export interface QuizAttempt {
  quizId: string;
  score: number;
  total: number;
  completedAt: string;
}

export interface StudentProgress {
  studentUid: string;
  schoolId: string;
  classId?: string;
  verifiedParentIds?: string[];
  points: number;
  streakDays: number;
  completedTaskIds?: string[];
  quizHistory?: QuizAttempt[];
  badges?: string[];
  growthRecords?: GrowthRecord[];
  updatedAt: any;
}

export interface ConsentRecord {
  id: string;
  schoolId: string;
  userId: string;
  subjectStudentUid: string;
  consentType: ConsentType;
  granted: boolean;
  policyVersion: string;
  createdAt: any;
  updatedAt: any;
}

export interface AuditLog {
  id: string;
  schoolId?: string;
  actorUid: string;
  actorEmail?: string;
  actorRole: string;
  action: string;
  targetCollection: string;
  targetId: string;
  details?: string;
  createdAt: any;
}

export interface AiUsageLog {
  id: string;
  schoolId?: string;
  userId: string;
  userRole: string;
  endpoint: string;
  model: string;
  promptTokens?: number;
  outputTokens?: number;
  totalTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  status: 'success' | 'error' | 'rate_limited' | 'timeout';
  errorMessage?: string;
  createdAt: any;
}

export interface SystemConfig {
  configId: string;
  aiRateLimitPerMinute: number;
  aiTimeoutMs: number;
  defaultRetentionDays: number;
  backupSchedule?: string;
  lastBackupExportAt?: string;
  maintenanceMode: boolean;
  updatedByUid: string;
  updatedAt: any;
}

export interface NotificationItem {
  id: string;
  schoolId?: string;
  recipientUid: string;
  title: string;
  body: string;
  type: 'menu' | 'comment' | 'allergy' | 'task' | 'system';
  read: boolean;
  createdAt: any;
}

export interface PaginatedResult<T> {
  items: T[];
  lastCursor: any | null;
  hasMore: boolean;
}
