import express, { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { getApp, getApps, initializeApp as initializeAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import {
  MAX_BASE64_IMAGE_CHARS,
  sanitizeAnalyzeMealResponse,
  sanitizeAnalyzeMenuResponse,
  sanitizeEstimatePortionResponse,
  sanitizeExplainMealResponse,
  sanitizeGenerateMenuResponse,
  sanitizeReplaceFoodResponse,
  VALID_IMAGE_MIMES,
} from './src/lib/aiValidation';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const firebaseConfigPath = path.join(__dirname, 'firebase-applet-config.json');
const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf-8'));

const adminApp = getApps().length
  ? getApp()
  : initializeAdminApp({ projectId: firebaseConfig.projectId });
const adminAuth = getAdminAuth(adminApp);

const MODEL_ID = 'gemini-4-hydrogen';
const REQUEST_TIMEOUT_MS = 30000;
const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MAX_REQ = 25;

interface VerifiedCaller {
  uid: string;
  email: string;
  role: string;
  schoolId: string;
  status: string;
  idToken: string;
}

interface AuthenticatedRequest extends Request {
  caller?: VerifiedCaller;
}

const rateBuckets = new Map<string, number[]>();

function checkRateLimit(uid: string): boolean {
  const now = Date.now();
  if (rateBuckets.size > 500) {
    for (const [k, timestamps] of rateBuckets.entries()) {
      const fresh = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
      if (fresh.length === 0) rateBuckets.delete(k);
      else rateBuckets.set(k, fresh);
    }
  }
  const prev = (rateBuckets.get(uid) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (prev.length >= RATE_LIMIT_MAX_REQ) {
    rateBuckets.set(uid, prev);
    return false;
  }
  prev.push(now);
  rateBuckets.set(uid, prev);
  return true;
}

function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY chưa được cấu hình trên máy chủ.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('TIMEOUT_EXCEEDED')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchUserProfileViaRest(uid: string, idToken: string): Promise<{ role: string; schoolId: string; status: string } | null> {
  const dbId = firebaseConfig.firestoreDatabaseId || '(default)';
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${dbId}/documents/users/${uid}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!resp.ok) return null;
  const docData: any = await resp.json();
  const fields = docData?.fields || {};
  return {
    role: fields.role?.stringValue || 'student',
    schoolId: fields.schoolId?.stringValue || '',
    status: fields.status?.stringValue || 'active',
  };
}

async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Thiếu token xác thực Firebase.' });
    }
    const idToken = authHeader.slice(7).trim();
    const decoded = await adminAuth.verifyIdToken(idToken);
    if (!decoded.email_verified) {
      return res.status(403).json({ error: 'Email tài khoản chưa được xác minh.' });
    }
    if (!checkRateLimit(decoded.uid)) {
      return res.status(429).json({
        error: 'Vượt quá giới hạn tần suất gọi AI (tối đa 25 lượt/phút). Vui lòng thử lại sau.',
        code: 'RATE_LIMITED',
      });
    }

    const profile = await fetchUserProfileViaRest(decoded.uid, idToken);
    const isBootstrapSuperAdmin = decoded.email?.toLowerCase() === 'vulin10000@gmail.com';
    if (!profile && !isBootstrapSuperAdmin) {
      return res.status(403).json({
        error: 'Hồ sơ người dùng chưa được khởi tạo trong Firestore.',
        code: 'PROFILE_REQUIRED',
      });
    }

    const role = profile?.role || 'super_admin';
    const status = profile?.status || 'active';
    const schoolId = profile?.schoolId || '';

    if (status === 'suspended' || status === 'deleted' || status === 'pending_verification') {
      return res.status(403).json({ error: 'Tài khoản đang bị khóa, chờ xác minh hoặc đã ngừng hoạt động.' });
    }

    req.caller = {
      uid: decoded.uid,
      email: decoded.email || '',
      role,
      schoolId,
      status,
      idToken,
    };
    return next();
  } catch (err: any) {
    return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' });
  }
}

function requireRoles(allowed: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const role = req.caller?.role || '';
    if (!allowed.includes(role)) {
      return res.status(403).json({
        error: `Vai trò "${role}" không có quyền truy cập chức năng AI này.`,
      });
    }
    return next();
  };
}

function computeUsageMeta(response: any, startedAt: number, endpoint: string) {
  const latencyMs = Date.now() - startedAt;
  const meta = response?.usageMetadata || {};
  const promptTokens = Number(meta.promptTokenCount || 0);
  const outputTokens = Number(meta.candidatesTokenCount || 0);
  const totalTokens = Number(meta.totalTokenCount || promptTokens + outputTokens);
  // Reference estimate USD per 1M tokens for reporting telemetry
  const estimatedCostUsd = Number(((promptTokens * 0.00015 + outputTokens * 0.0006) / 1000).toFixed(6));
  return {
    endpoint,
    model: MODEL_ID,
    promptTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd,
    latencyMs,
  };
}

function handleAiError(res: Response, err: any, startedAt: number, endpoint: string) {
  const latencyMs = Date.now() - startedAt;
  const msg = err instanceof Error ? err.message : String(err);
  if (msg === 'TIMEOUT_EXCEEDED') {
    return res.status(504).json({
      error: 'Yêu cầu phân tích AI vượt quá thời gian chờ (30 giây). Vui lòng thử lại với ảnh gọn hơn.',
      code: 'TIMEOUT',
      usage: { endpoint, model: MODEL_ID, totalTokens: 0, estimatedCostUsd: 0, latencyMs },
    });
  }
  const statusCode = msg.includes('GEMINI_API_KEY') ? 500 : 502;
  return res.status(statusCode).json({
    error: `Lỗi dịch vụ Gemini AI: ${msg}`,
    code: 'AI_UPSTREAM_ERROR',
    usage: { endpoint, model: MODEL_ID, totalTokens: 0, estimatedCostUsd: 0, latencyMs },
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '8mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'SmartPlate VN 2.0 AI Engine', model: MODEL_ID });
  });

  // 1. POST /api/ai/analyze-meal (Vision Food Recognition)
  app.post('/api/ai/analyze-meal', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const startedAt = Date.now();
    const endpoint = '/api/ai/analyze-meal';
    try {
      const { imageBase64, mimeType, mealType, catalogHints } = req.body || {};
      if (!imageBase64 || typeof imageBase64 !== 'string') {
        return res.status(400).json({ error: 'Thiếu dữ liệu ảnh base64 hợp lệ.' });
      }
      const cleanBase64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
      if (!cleanBase64 || cleanBase64.length > MAX_BASE64_IMAGE_CHARS) {
        return res.status(413).json({ error: 'Kích thước ảnh vượt quá giới hạn cho phép (tối đa 5MB).' });
      }
      const safeMime =
        typeof mimeType === 'string' && (VALID_IMAGE_MIMES as readonly string[]).includes(mimeType)
          ? mimeType
          : 'image/jpeg';

      const ai = getGenAIClient();
      const hintsText = Array.isArray(catalogHints) && catalogHints.length > 0
        ? `Danh sách món Việt Nam tham khảo trong CSDL: ${catalogHints.slice(0, 30).join(', ')}.`
        : '';

      const prompt = `Bạn là chuyên gia nhận diện ẩm thực học đường Việt Nam. Hãy phân tích bức ảnh bữa ăn (${mealType || 'lunch'}).
${hintsText}
Yêu cầu:
1. Đánh giá chất lượng ảnh ('good', 'blurry', 'dark', hoặc 'partial').
2. Liệt kê từng món ăn nhận diện được trên khay/bát.
3. Với mỗi món, chỉ định: tên tiếng Việt (nameVi), thành phần chính (ingredients), nhóm thực phẩm (foodGroup thuộc một trong: grains_starches, meat, seafood, eggs, dairy, vegetables, fruits, legumes, fats_oils, traditional_dishes, soups_broths, boarding_meals), ước lượng khẩu phần theo gram (estimatedGrams), và độ tin cậy từ 0 đến 1 (confidence).
Không bịa số liệu dinh dưỡng; chỉ nhận diện món, thành phần và ước lượng khối lượng.`;

      const response = await withTimeout(
        ai.models.generateContent({
          model: MODEL_ID,
          contents: {
            parts: [
              { inlineData: { mimeType: safeMime, data: cleanBase64 } },
              { text: prompt },
            ],
          },
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                imageQuality: { type: Type.STRING, description: 'good | blurry | dark | partial' },
                qualityNote: { type: Type.STRING },
                items: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      nameVi: { type: Type.STRING },
                      ingredients: { type: Type.ARRAY, items: { type: Type.STRING } },
                      foodGroup: { type: Type.STRING },
                      estimatedGrams: { type: Type.NUMBER },
                      confidence: { type: Type.NUMBER },
                    },
                    required: ['nameVi', 'foodGroup', 'estimatedGrams', 'confidence'],
                  },
                },
              },
              required: ['imageQuality', 'items'],
            },
          },
        }),
        REQUEST_TIMEOUT_MS
      );

      const parsed = sanitizeAnalyzeMealResponse(JSON.parse((response.text || '{}').trim()));
      return res.json({
        data: parsed,
        usage: computeUsageMeta(response, startedAt, endpoint),
      });
    } catch (err) {
      return handleAiError(res, err, startedAt, endpoint);
    }
  });

  // 2. POST /api/ai/explain-meal (AI Nutrition Advisor — explains pre-calculated metrics)
  app.post('/api/ai/explain-meal', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const startedAt = Date.now();
    const endpoint = '/api/ai/explain-meal';
    try {
      const { items, nutritionTotals, scoreBreakdown, ageGroup, mealType, allergies } = req.body || {};
      if (!Array.isArray(items) || !nutritionTotals || !scoreBreakdown) {
        return res.status(400).json({ error: 'Thiếu dữ liệu dinh dưỡng và điểm số đã tính toán.' });
      }

      const ai = getGenAIClient();
      const prompt = `Bạn là cố vấn dinh dưỡng học đường thân thiện. Dựa trên KẾT QUẢ ĐÃ TÍNH TOÁN SẴN dưới đây (tuyệt đối không tự ý thay đổi điểm số hoặc chẩn đoán bệnh/kê đơn điều trị):
- Nhóm tuổi học sinh: ${ageGroup || '9-11'}
- Bữa ăn: ${mealType || 'lunch'}
- Dị ứng đã khai báo: ${Array.isArray(allergies) && allergies.length ? allergies.join(', ') : 'Không có'}
- Danh sách món: ${JSON.stringify(items.map((i: any) => ({ name: i.nameVi, grams: i.portionGrams, group: i.foodGroup })))}
- Tổng dinh dưỡng đã tính: ${JSON.stringify(nutritionTotals)}
- Điểm đánh giá theo quy tắc: ${JSON.stringify(scoreBreakdown)}

Hãy giải thích kết quả bằng tiếng Việt dễ hiểu, tích cực, phù hợp với học sinh và phụ huynh:
- explanation: Giải thích ngắn gọn vì sao bữa ăn đạt mức điểm và năng lượng đó.
- childFriendlyTips: 3 mẹo nhỏ dễ thực hiện cho học sinh.
- suggestedAdditions: 2-3 món hoặc nhóm thực phẩm nên bổ sung thêm nếu thiếu.
- groupBenefits: Lợi ích của các nhóm thực phẩm có trong bữa ăn.`;

      const response = await withTimeout(
        ai.models.generateContent({
          model: MODEL_ID,
          contents: prompt,
          config: {
            systemInstruction: 'Không chẩn đoán bệnh lý, không đưa ra lời khuyên điều trị y khoa. Chỉ giải thích giáo dục dinh dưỡng lành mạnh.',
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                explanation: { type: Type.STRING },
                childFriendlyTips: { type: Type.ARRAY, items: { type: Type.STRING } },
                suggestedAdditions: { type: Type.ARRAY, items: { type: Type.STRING } },
                groupBenefits: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      group: { type: Type.STRING },
                      benefit: { type: Type.STRING },
                    },
                    required: ['group', 'benefit'],
                  },
                },
              },
              required: ['explanation', 'childFriendlyTips', 'suggestedAdditions', 'groupBenefits'],
            },
          },
        }),
        REQUEST_TIMEOUT_MS
      );

      const parsed = sanitizeExplainMealResponse(JSON.parse((response.text || '{}').trim()));
      return res.json({
        data: parsed,
        usage: computeUsageMeta(response, startedAt, endpoint),
      });
    } catch (err) {
      return handleAiError(res, err, startedAt, endpoint);
    }
  });

  // 3. POST /api/ai/estimate-portion
  app.post('/api/ai/estimate-portion', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const startedAt = Date.now();
    const endpoint = '/api/ai/estimate-portion';
    try {
      const { dishName, description, imageBase64, mimeType } = req.body || {};
      if (!dishName && !description && !imageBase64) {
        return res.status(400).json({ error: 'Cần cung cấp tên món hoặc ảnh để ước lượng khẩu phần.' });
      }

      const ai = getGenAIClient();
      const parts: any[] = [];
      if (imageBase64 && typeof imageBase64 === 'string') {
        const cleanBase64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
        if (cleanBase64.length > MAX_BASE64_IMAGE_CHARS) {
          return res.status(413).json({ error: 'Kích thước ảnh vượt quá giới hạn cho phép (tối đa 5MB).' });
        }
        const safeMime =
          typeof mimeType === 'string' && (VALID_IMAGE_MIMES as readonly string[]).includes(mimeType)
            ? mimeType
            : 'image/jpeg';
        parts.push({ inlineData: { mimeType: safeMime, data: cleanBase64 } });
      }
      parts.push({
        text: `Ước lượng khẩu phần bằng gram cho món Việt Nam "${dishName || 'món ăn'}" (${description || 'khẩu phần học đường tiêu chuẩn'}). Trả về JSON gồm estimatedGrams, householdUnit (ví dụ: 1 chén vừa, 1 đĩa nhỏ), confidence (0..1), rationale.`,
      });

      const response = await withTimeout(
        ai.models.generateContent({
          model: MODEL_ID,
          contents: { parts },
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                estimatedGrams: { type: Type.NUMBER },
                householdUnit: { type: Type.STRING },
                confidence: { type: Type.NUMBER },
                rationale: { type: Type.STRING },
              },
              required: ['estimatedGrams', 'householdUnit', 'confidence', 'rationale'],
            },
          },
        }),
        REQUEST_TIMEOUT_MS
      );

      const parsed = sanitizeEstimatePortionResponse(JSON.parse((response.text || '{}').trim()));
      return res.json({
        data: parsed,
        usage: computeUsageMeta(response, startedAt, endpoint),
      });
    } catch (err) {
      return handleAiError(res, err, startedAt, endpoint);
    }
  });

  // 4. POST /api/ai/generate-menu
  app.post(
    '/api/ai/generate-menu',
    requireAuth,
    requireRoles(['teacher', 'school_admin', 'super_admin']),
    async (req: AuthenticatedRequest, res: Response) => {
      const startedAt = Date.now();
      const endpoint = '/api/ai/generate-menu';
      try {
        const {
          periodType = 'weekly',
          ageGroup = '9-11',
          gradeLevel = 'Tiểu học',
          budgetVndPerMeal = 32000,
          excludedAllergens = [],
          foodSources = [],
          availableFoods = [],
        } = req.body || {};

        const safePeriod = ['daily', 'weekly', 'monthly'].includes(periodType) ? periodType : 'weekly';
        const safeAgeGroup = ['6-8', '9-11', '12-14', '15-18'].includes(ageGroup) ? ageGroup : '9-11';
        const safeBudget = Math.min(500000, Math.max(5000, Number(budgetVndPerMeal) || 32000));
        const dayCount = safePeriod === 'daily' ? 1 : safePeriod === 'monthly' ? 10 : 5;
        const catalogText = Array.isArray(availableFoods)
          ? availableFoods
              .slice(0, 30)
              .map((f: any) => `${String(f.id || '').slice(0, 80)}|${String(f.nameVi || '').slice(0, 120)}|${String(f.category || '')}|${Number(f.standardServingG || 100)}g|${Number(f.energyKcal || 0)}kcal`)
              .join('\n')
          : '';

        const ai = getGenAIClient();
        const prompt = `Lập kế hoạch thực đơn bán trú Việt Nam (${safePeriod}, ${dayCount} ngày học) cho nhóm tuổi ${safeAgeGroup} (${String(gradeLevel).slice(0, 60)}).
Ngân sách tối đa mỗi bữa chính: ${safeBudget} VND.
Loại trừ hoàn toàn dị ứng: ${Array.isArray(excludedAllergens) && excludedAllergens.length ? excludedAllergens.slice(0, 15).join(', ') : 'Không'}.
Nguồn thực phẩm ưu tiên: ${Array.isArray(foodSources) && foodSources.length ? foodSources.slice(0, 10).join(', ') : 'Nguồn cung ứng địa phương an toàn'}.
Danh mục thực phẩm hiện có (foodId|nameVi|category|standardServingG|kcal):
${catalogText}

Hãy tạo ${dayCount} ngày thực đơn cân đối, ưu tiên chọn đúng foodId từ danh mục trên. Mỗi ngày có bữa trưa (lunch) gồm 3-4 món (tinh bột, món mặn, rau/canh, tráng miệng) và bữa phụ (snack) gồm 1 món.`;

        const response = await withTimeout(
          ai.models.generateContent({
            model: MODEL_ID,
            contents: prompt,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  days: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        dayLabel: { type: Type.STRING },
                        meals: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              mealType: { type: Type.STRING },
                              estimatedCostVnd: { type: Type.NUMBER },
                              dishes: {
                                type: Type.ARRAY,
                                items: {
                                  type: Type.OBJECT,
                                  properties: {
                                    foodId: { type: Type.STRING },
                                    nameVi: { type: Type.STRING },
                                    portionGrams: { type: Type.NUMBER },
                                  },
                                  required: ['foodId', 'nameVi', 'portionGrams'],
                                },
                              },
                            },
                            required: ['mealType', 'estimatedCostVnd', 'dishes'],
                          },
                        },
                      },
                      required: ['dayLabel', 'meals'],
                    },
                  },
                },
                required: ['title', 'days'],
              },
            },
          }),
          REQUEST_TIMEOUT_MS
        );

        const parsed = sanitizeGenerateMenuResponse(JSON.parse((response.text || '{}').trim()), safeBudget);
        return res.json({
          data: parsed,
          usage: computeUsageMeta(response, startedAt, endpoint),
        });
      } catch (err) {
        return handleAiError(res, err, startedAt, endpoint);
      }
    }
  );

  // 5. POST /api/ai/analyze-menu
  app.post(
    '/api/ai/analyze-menu',
    requireAuth,
    requireRoles(['teacher', 'school_admin', 'super_admin']),
    async (req: AuthenticatedRequest, res: Response) => {
      const startedAt = Date.now();
      const endpoint = '/api/ai/analyze-menu';
      try {
        const { menuTitle, ageGroup, nutritionSummary, excludedAllergens } = req.body || {};
        if (!nutritionSummary) {
          return res.status(400).json({ error: 'Thiếu dữ liệu tổng hợp dinh dưỡng của thực đơn.' });
        }

        const ai = getGenAIClient();
        const prompt = `Đánh giá thực đơn trường học "${menuTitle || 'Thực đơn bán trú'}" cho nhóm tuổi ${ageGroup || '9-11'}.
Số liệu đã tính toán: ${JSON.stringify(nutritionSummary)}.
Dị ứng cần tránh: ${JSON.stringify(excludedAllergens || [])}.
Hãy nhận xét điểm mạnh, điểm cần điều chỉnh về cân đối nhóm chất/vi chất/đa dạng món ăn, và gợi ý cải thiện cụ thể cho bếp ăn trường học.`;

        const response = await withTimeout(
          ai.models.generateContent({
            model: MODEL_ID,
            contents: prompt,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  overallAssessment: { type: Type.STRING },
                  strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
                  improvements: { type: Type.ARRAY, items: { type: Type.STRING } },
                  budgetEfficiencyNote: { type: Type.STRING },
                },
                required: ['overallAssessment', 'strengths', 'improvements'],
              },
            },
          }),
          REQUEST_TIMEOUT_MS
        );

        const parsed = sanitizeAnalyzeMenuResponse(JSON.parse((response.text || '{}').trim()));
        return res.json({
          data: parsed,
          usage: computeUsageMeta(response, startedAt, endpoint),
        });
      } catch (err) {
        return handleAiError(res, err, startedAt, endpoint);
      }
    }
  );

  // 6. POST /api/ai/replace-food
  app.post(
    '/api/ai/replace-food',
    requireAuth,
    requireRoles(['teacher', 'school_admin', 'super_admin']),
    async (req: AuthenticatedRequest, res: Response) => {
      const startedAt = Date.now();
      const endpoint = '/api/ai/replace-food';
      try {
        const { currentDish, excludedAllergens = [], availableFoods = [], reason = '' } = req.body || {};
        if (!currentDish) {
          return res.status(400).json({ error: 'Thiếu thông tin món cần thay thế.' });
        }
        const catalogText = Array.isArray(availableFoods)
          ? availableFoods
              .slice(0, 30)
              .map((f: any) => `${f.id}|${f.nameVi}|${f.category}|${f.standardServingG}g|${f.energyKcal}kcal`)
              .join('\n')
          : '';

        const ai = getGenAIClient();
        const prompt = `Gợi ý 3 món Việt Nam thay thế phù hợp cho món "${currentDish.nameVi}" (${currentDish.portionGrams || 100}g).
Lý do đổi món: ${reason || 'Đa dạng thực đơn bán trú'}.
Tránh dị ứng: ${Array.isArray(excludedAllergens) && excludedAllergens.length ? excludedAllergens.join(', ') : 'Không'}.
Danh mục hiện có:
${catalogText}
Hãy ưu tiên chọn foodId từ danh mục trên.`;

        const response = await withTimeout(
          ai.models.generateContent({
            model: MODEL_ID,
            contents: prompt,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  alternatives: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        foodId: { type: Type.STRING },
                        nameVi: { type: Type.STRING },
                        recommendedGrams: { type: Type.NUMBER },
                        reason: { type: Type.STRING },
                      },
                      required: ['foodId', 'nameVi', 'recommendedGrams', 'reason'],
                    },
                  },
                },
                required: ['alternatives'],
              },
            },
          }),
          REQUEST_TIMEOUT_MS
        );

        const parsed = sanitizeReplaceFoodResponse(JSON.parse((response.text || '{}').trim()));
        return res.json({
          data: parsed,
          usage: computeUsageMeta(response, startedAt, endpoint),
        });
      } catch (err) {
        return handleAiError(res, err, startedAt, endpoint);
      }
    }
  );

  // Vite integration in dev vs static dist in production
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`SmartPlate VN 2.0 server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
