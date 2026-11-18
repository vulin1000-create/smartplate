import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  Check,
  Loader2,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  AgeGroup,
  AiAdvice,
  FoodCategory,
  MealLog,
  MealType,
  UserProfile,
  VietnameseFood,
} from '../types/domain';
import { AiEngineClient } from '../lib/aiClient';
import {
  calculateMealNutrition,
  normalizeFoodLookup,
  scoreMealDeterministically,
} from '../lib/nutritionEngine';
import { ConsentRepo } from '../lib/repositories';
import { FOOD_CATEGORY_LABELS } from '../lib/vietnameseFoods';
import { GovernanceService, makeId } from '../lib/services';

interface MealAnalyzerModuleProps {
  actor: UserProfile;
  targetStudent: UserProfile;
  foodsCatalog: VietnameseFood[];
  onSaved?: (log: MealLog) => void;
}

interface EditableDishRow {
  rowId: string;
  foodId: string;
  nameVi: string;
  foodGroup: FoodCategory;
  portionGrams: number;
  confidence: number;
  userConfirmed: boolean;
  ingredients?: string[];
}

function compressImageToDataUrl(fileOrDataUrl: File | string): Promise<{ dataUrl: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 960;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Không thể khởi tạo canvas xử lý ảnh.'));
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      resolve({ dataUrl, mimeType: 'image/jpeg' });
    };
    img.onerror = () => reject(new Error('Không thể đọc dữ liệu ảnh.'));
    if (typeof fileOrDataUrl === 'string') {
      img.src = fileOrDataUrl;
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        img.src = String(reader.result || '');
      };
      reader.onerror = () => reject(new Error('Lỗi đọc file ảnh.'));
      reader.readAsDataURL(fileOrDataUrl);
    }
  });
}

export function MealAnalyzerModule({
  actor,
  targetStudent,
  foodsCatalog,
  onSaved,
}: MealAnalyzerModuleProps) {
  const [mealType, setMealType] = useState<MealType>('lunch');
  const [dateStr, setDateStr] = useState<string>(new Date().toISOString().slice(0, 10));
  const [imagePreview, setImagePreview] = useState<string>('');
  const [imageMime, setImageMime] = useState<string>('image/jpeg');
  const [imageQuality, setImageQuality] = useState<'good' | 'blurry' | 'dark' | 'partial' | 'manual'>('manual');
  const [qualityNote, setQualityNote] = useState<string>('');

  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [analyzing, setAnalyzing] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');

  const [rows, setRows] = useState<EditableDishRow[]>([]);
  const [selectedFoodToAdd, setSelectedFoodToAdd] = useState<string>(foodsCatalog[0]?.id || '');
  const [addGrams, setAddGrams] = useState<number>(150);
  const [aiAdvice, setAiAdvice] = useState<AiAdvice | undefined>(undefined);
  const [photoConsented, setPhotoConsented] = useState<boolean>(false);
  const [checkingConsent, setCheckingConsent] = useState<boolean>(true);
  const [grantingConsent, setGrantingConsent] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    setCheckingConsent(true);
    ConsentRepo.listForUser(actor.uid)
      .then((records) => {
        if (!active) return;
        const ok = records.some(
          (r) =>
            r.subjectStudentUid === targetStudent.uid &&
            r.consentType === 'ai_photo_analysis' &&
            r.granted
        );
        setPhotoConsented(ok);
      })
      .catch(() => {
        if (active) setPhotoConsented(false);
      })
      .finally(() => {
        if (active) setCheckingConsent(false);
      });
    return () => {
      active = false;
    };
  }, [actor.uid, targetStudent.uid]);

  const handleGrantPhotoConsent = async () => {
    setGrantingConsent(true);
    setErrorMsg('');
    try {
      await GovernanceService.setConsent(actor, targetStudent.uid, 'ai_photo_analysis', true);
      setPhotoConsented(true);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể lưu xác nhận đồng ý phân tích ảnh.');
    } finally {
      setGrantingConsent(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
  };

  const handleOpenCamera = async () => {
    setErrorMsg('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      setCameraOpen(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      }, 60);
    } catch (err: any) {
      setErrorMsg(`Không thể mở camera: ${err?.message || 'Vui lòng cấp quyền camera hoặc tải ảnh lên.'}`);
    }
  };

  const handleCaptureSnapshot = async () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 800;
    canvas.height = videoRef.current.videoHeight || 600;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const rawDataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const compressed = await compressImageToDataUrl(rawDataUrl);
    setImagePreview(compressed.dataUrl);
    setImageMime(compressed.mimeType);
    stopCamera();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg('');
    try {
      const compressed = await compressImageToDataUrl(file);
      setImagePreview(compressed.dataUrl);
      setImageMime(compressed.mimeType);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Lỗi xử lý ảnh tải lên.');
    }
  };

  const handleAnalyzePhoto = async () => {
    if (!photoConsented) {
      setErrorMsg('Cần xác nhận đồng ý bảo vệ dữ liệu ảnh trẻ em (ai_photo_analysis) trước khi gửi ảnh tới Gemini Vision.');
      return;
    }
    if (!imagePreview) {
      setErrorMsg('Vui lòng chụp ảnh hoặc tải ảnh bữa ăn trước khi phân tích AI.');
      return;
    }
    setErrorMsg('');
    setSuccessMsg('');
    setAnalyzing(true);
    setAiAdvice(undefined);
    try {
      const hints = foodsCatalog.map((f) => f.nameVi);
      const { data } = await AiEngineClient.analyzeMeal(actor, {
        imageBase64: imagePreview,
        mimeType: imageMime,
        mealType,
        catalogHints: hints,
      });

      setImageQuality(data.imageQuality || 'good');
      setQualityNote(data.qualityNote || '');

      const mappedRows: EditableDishRow[] = (data.items || []).map((item, idx) => {
        const matched = normalizeFoodLookup(foodsCatalog, item.nameVi);
        return {
          rowId: `${Date.now()}_${idx}`,
          foodId: matched ? matched.id : `unverified_${idx}`,
          nameVi: matched ? matched.nameVi : item.nameVi,
          foodGroup: (matched?.category || item.foodGroup || 'traditional_dishes') as FoodCategory,
          portionGrams: Math.max(10, Math.round(item.estimatedGrams || matched?.standardServingG || 100)),
          confidence: Number((item.confidence ?? 0.75).toFixed(2)),
          userConfirmed: Boolean(matched),
          ingredients: item.ingredients || matched?.ingredients || [],
        };
      });

      setRows(mappedRows);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể phân tích ảnh bữa ăn.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleAddManualDish = () => {
    const food = foodsCatalog.find((f) => f.id === selectedFoodToAdd);
    if (!food) return;
    setRows((prev) => [
      ...prev,
      {
        rowId: `${Date.now()}_${prev.length}`,
        foodId: food.id,
        nameVi: food.nameVi,
        foodGroup: food.category,
        portionGrams: Math.max(10, addGrams || food.standardServingG),
        confidence: 1,
        userConfirmed: true,
        ingredients: food.ingredients || [],
      },
    ]);
  };

  const calculation = useMemo(() => {
    const inputs = rows.map((row) => {
      const found = foodsCatalog.find((f) => f.id === row.foodId);
      // Unmatched foods without source reference are explicitly marked unverified with 0 hallucinated nutrients
      const safeFood: VietnameseFood = found || {
        id: row.foodId,
        nameVi: row.nameVi,
        category: row.foodGroup,
        standardServingG: 100,
        energyKcal: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        fiberG: 0,
        sourceRef: '',
        verified: false,
      };
      return {
        food: safeFood,
        portionGrams: row.portionGrams,
        confidence: row.confidence,
        userConfirmed: row.userConfirmed,
      };
    });

    const ageGroup: AgeGroup = targetStudent.ageGroup || '9-11';
    const { items, totals } = calculateMealNutrition(inputs, ageGroup, mealType);
    const score = scoreMealDeterministically(
      items,
      totals,
      ageGroup,
      mealType,
      targetStudent.allergies || []
    );

    return { items, totals, score, ageGroup };
  }, [rows, foodsCatalog, targetStudent.ageGroup, targetStudent.allergies, mealType]);

  const handleRequestAdvice = async () => {
    if (rows.length === 0) return;
    setErrorMsg('');
    setExplaining(true);
    try {
      const { data } = await AiEngineClient.explainMeal(actor, {
        items: calculation.items,
        nutritionTotals: calculation.totals,
        scoreBreakdown: calculation.score,
        ageGroup: calculation.ageGroup,
        mealType,
        allergies: targetStudent.allergies || [],
      });
      setAiAdvice(data);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể tạo lời khuyên dinh dưỡng từ Gemini.');
    } finally {
      setExplaining(false);
    }
  };

  const handleSaveMealLog = async () => {
    if (rows.length === 0) {
      setErrorMsg('Cần ít nhất 1 món ăn đã xác nhận để lưu nhật ký.');
      return;
    }
    setSaving(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const verifiedParentIds = Array.from(
        new Set([
          ...(targetStudent.verifiedParentIds || []),
          ...(actor.role === 'parent' ? [actor.uid] : []),
        ])
      );
      const logPayload: Omit<MealLog, 'createdAt' | 'updatedAt'> = {
        id: makeId('meal'),
        schoolId: targetStudent.schoolId || actor.schoolId || 'school_th_chu_van_an',
        classId: targetStudent.classIds?.[0] || '',
        studentUid: targetStudent.uid,
        studentName: targetStudent.displayName,
        verifiedParentIds,
        mealType,
        dateStr,
        imagePreviewUrl: imagePreview.length <= 180000 ? imagePreview : '',
        imageQuality,
        items: calculation.items,
        nutritionTotals: calculation.totals,
        scoreBreakdown: calculation.score,
        ...(aiAdvice ? { aiAdvice } : {}),
        teacherReviewed: false,
      };

      await GovernanceService.logMealAndUpdateProgress(targetStudent, logPayload, actor);
      setSuccessMsg('Đã lưu nhật ký bữa ăn vào Firestore và cập nhật điểm rèn luyện.');
      if (onSaved) {
        onSaved({ ...logPayload, createdAt: new Date(), updatedAt: new Date() });
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể lưu nhật ký bữa ăn.');
    } finally {
      setSaving(false);
    }
  };

  const hasUnverified = rows.some((r) => !foodsCatalog.some((f) => f.id === r.foodId));

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">AI Nhận diện & Đánh giá Bữa ăn</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Đối tượng: <span className="font-medium text-slate-700">{targetStudent.displayName}</span> · Nhóm tuổi{' '}
              <span className="font-mono">{targetStudent.ageGroup || '9-11'}</span> · Dị ứng:{' '}
              {(targetStudent.allergies || []).length > 0 ? targetStudent.allergies?.join(', ') : 'Không ghi nhận'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={mealType}
              onChange={(e) => setMealType(e.target.value as MealType)}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
            >
              <option value="breakfast">Bữa sáng</option>
              <option value="lunch">Bữa trưa</option>
              <option value="dinner">Bữa tối</option>
              <option value="snack">Bữa phụ</option>
            </select>
            <input
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
          </div>
        </div>

        {/* Camera & Upload Controls */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={cameraOpen ? stopCamera : handleOpenCamera}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 whitespace-nowrap"
              >
                <Camera className="w-4 h-4" />
                {cameraOpen ? 'Đóng camera' : 'Chụp ảnh bữa ăn'}
              </button>
              <label className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap">
                <Upload className="w-4 h-4" />
                Tải ảnh lên
                <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
              </label>
              {imagePreview && (
                <button
                  type="button"
                  onClick={handleAnalyzePhoto}
                  disabled={analyzing || !photoConsented || checkingConsent}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap"
                >
                  {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {analyzing ? 'Đang nhận diện...' : 'Phân tích bằng Gemini Vision'}
                </button>
              )}
            </div>

            {!checkingConsent && !photoConsented && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
                  <span>
                    Bảo vệ dữ liệu trẻ em: Cần xác nhận đồng ý <span className="font-mono">ai_photo_analysis</span> trước khi gửi ảnh bữa ăn cho AI. Chọn món thủ công bên phải vẫn hoạt động bình thường.
                  </span>
                </div>
                <button
                  type="button"
                  disabled={grantingConsent}
                  onClick={handleGrantPhotoConsent}
                  className="px-3 py-1.5 bg-slate-900 text-white font-medium rounded-md hover:bg-slate-800 whitespace-nowrap shrink-0 disabled:opacity-50"
                >
                  {grantingConsent ? 'Đang lưu...' : 'Đồng ý phân tích ảnh'}
                </button>
              </div>
            )}

            {cameraOpen && (
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-900 space-y-2 p-2">
                <video ref={videoRef} className="w-full max-h-64 object-contain rounded-lg" playsInline muted />
                <button
                  type="button"
                  onClick={handleCaptureSnapshot}
                  className="w-full py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700"
                >
                  Chụp khung hình hiện tại
                </button>
              </div>
            )}

            {imagePreview ? (
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50">
                <img
                  src={imagePreview}
                  alt="Ảnh bữa ăn cần phân tích"
                  className="w-full max-h-64 object-cover"
                />
                <div className="px-3 py-2 text-xs text-slate-600 border-t border-slate-200 flex items-center justify-between">
                  <span>Chất lượng ảnh: {imageQuality}</span>
                  {qualityNote && <span className="text-slate-500 truncate ml-2">{qualityNote}</span>}
                </div>
              </div>
            ) : (
              <div className="border border-dashed border-slate-300 rounded-xl p-8 text-center text-xs text-slate-500">
                Chụp trực tiếp hoặc tải ảnh khay cơm/bát ăn, hoặc chọn món thủ công bên phải.
              </div>
            )}
          </div>

          {/* Manual Add from Vietnamese Food Database */}
          <div className="space-y-4">
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
              <div className="text-sm font-semibold text-slate-900">Bổ sung món từ CSDL Thực phẩm Việt Nam</div>
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  value={selectedFoodToAdd}
                  onChange={(e) => setSelectedFoodToAdd(e.target.value)}
                  className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                >
                  {foodsCatalog.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nameVi} ({f.standardServingG}g · {f.energyKcal} kcal)
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={10}
                  max={2000}
                  value={addGrams}
                  onChange={(e) => setAddGrams(Number(e.target.value))}
                  className="w-24 px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white font-mono tabular-nums"
                  placeholder="gram"
                />
                <button
                  type="button"
                  onClick={handleAddManualDish}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  Thêm món
                </button>
              </div>
            </div>

            {/* Deterministic Score Preview */}
            <div className="p-4 border border-slate-200 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900">Kết quả tính toán & Chấm điểm quy tắc</span>
                <span className="text-lg font-bold font-mono tabular-nums text-emerald-700">
                  {calculation.score.totalScore}/100
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <div className="text-slate-500">Năng lượng</div>
                  <div className="font-mono tabular-nums font-semibold text-slate-900">
                    {calculation.totals.kcal} / {calculation.totals.targetKcal} kcal
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Đạm / Bột / Béo</div>
                  <div className="font-mono tabular-nums font-semibold text-slate-900">
                    {calculation.totals.proteinG} / {calculation.totals.carbsG} / {calculation.totals.fatG}g
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Chất xơ</div>
                  <div className="font-mono tabular-nums font-semibold text-slate-900">
                    {calculation.totals.fiberG}g
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Đạt nhu cầu bữa</div>
                  <div className="font-mono tabular-nums font-semibold text-slate-900">
                    {calculation.totals.targetCoveragePct}%
                  </div>
                </div>
              </div>

              {calculation.score.allergenAlerts.length > 0 && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">Cảnh báo dị ứng phát hiện</div>
                    <div>{calculation.score.allergenAlerts.join('; ')}</div>
                  </div>
                </div>
              )}

              <ul className="text-xs text-slate-600 space-y-1">
                {calculation.score.rulesSummary.map((line, i) => (
                  <li key={i}>· {line}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-800 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
        {successMsg && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800 flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Recognized / Confirmed Items Table */}
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-900">Xác nhận & Điều chỉnh món ăn</span>
            {hasUnverified && (
              <span className="text-xs text-amber-700 font-medium">
                Có món chưa khớp CSDL nguồn — vui lòng chọn món chuẩn để tính dinh dưỡng chính xác
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-2.5 px-3">Món ăn</th>
                  <th className="py-2.5 px-3">Ánh xạ CSDL chuẩn</th>
                  <th className="py-2.5 px-3">Nhóm thực phẩm</th>
                  <th className="py-2.5 px-3 text-right">Khẩu phần (g)</th>
                  <th className="py-2.5 px-3 text-right">Tin cậy</th>
                  <th className="py-2.5 px-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-xs text-slate-500">
                      Chưa có món ăn nào. Hãy phân tích ảnh hoặc thêm món thủ công.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.rowId}>
                      <td className="py-2.5 px-3 font-medium text-slate-900">
                        <div>{row.nameVi}</div>
                        {row.ingredients && row.ingredients.length > 0 && (
                          <div className="text-xs text-slate-500">{row.ingredients.join(', ')}</div>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <select
                          value={foodsCatalog.some((f) => f.id === row.foodId) ? row.foodId : ''}
                          onChange={(e) => {
                            const f = foodsCatalog.find((x) => x.id === e.target.value);
                            if (!f) return;
                            setRows((prev) =>
                              prev.map((r) =>
                                r.rowId === row.rowId
                                  ? {
                                      ...r,
                                      foodId: f.id,
                                      nameVi: f.nameVi,
                                      foodGroup: f.category,
                                      userConfirmed: true,
                                    }
                                  : r
                              )
                            );
                          }}
                          className="w-full max-w-[220px] px-2 py-1.5 text-xs border border-slate-200 rounded-md bg-white"
                        >
                          <option value="">-- Chưa xác minh (chọn món) --</option>
                          {foodsCatalog.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.nameVi}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2.5 px-3 text-xs text-slate-600">
                        {FOOD_CATEGORY_LABELS[row.foodGroup] || row.foodGroup}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <input
                          type="number"
                          min={5}
                          max={2000}
                          value={row.portionGrams}
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((r) =>
                                r.rowId === row.rowId ? { ...r, portionGrams: Number(e.target.value) || 0 } : r
                              )
                            )
                          }
                          className="w-20 px-2 py-1 text-right text-xs font-mono tabular-nums border border-slate-200 rounded-md"
                        />
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-xs text-slate-600">
                        {Math.round(row.confidence * 100)}%
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => setRows((prev) => prev.filter((r) => r.rowId !== row.rowId))}
                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-md"
                          title="Xóa món"
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
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={handleRequestAdvice}
            disabled={rows.length === 0 || explaining}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-white border border-slate-200 text-slate-800 rounded-lg hover:bg-slate-50 disabled:opacity-50"
          >
            {explaining ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-emerald-700" />}
            Giải thích & Lời khuyên AI
          </button>
          <button
            type="button"
            onClick={handleSaveMealLog}
            disabled={rows.length === 0 || saving}
            className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Lưu nhật ký bữa ăn
          </button>
        </div>

        {aiAdvice && (
          <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-3">
            <div className="text-sm font-semibold text-emerald-950">Lời khuyên dinh dưỡng từ Cố vấn AI</div>
            <p className="text-sm text-slate-800 leading-relaxed">{aiAdvice.explanation}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <div className="font-semibold text-slate-900 mb-1">Mẹo dễ nhớ cho học sinh</div>
                <ul className="space-y-1 text-slate-700">
                  {aiAdvice.childFriendlyTips.map((tip, idx) => (
                    <li key={idx}>· {tip}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="font-semibold text-slate-900 mb-1">Gợi ý bổ sung cân bằng</div>
                <ul className="space-y-1 text-slate-700">
                  {aiAdvice.suggestedAdditions.map((add, idx) => (
                    <li key={idx}>· {add}</li>
                  ))}
                </ul>
              </div>
            </div>
            {aiAdvice.groupBenefits?.length > 0 && (
              <div className="pt-2 border-t border-emerald-200 text-xs text-slate-700 space-y-1">
                {aiAdvice.groupBenefits.map((gb, idx) => (
                  <div key={idx}>
                    <span className="font-semibold text-emerald-900">{gb.group}:</span> {gb.benefit}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
