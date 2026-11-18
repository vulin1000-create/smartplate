import React, { useEffect, useState } from 'react';
import { ShieldCheck, Trash2, X } from 'lucide-react';
import { ConsentRecord, ConsentType, UserProfile } from '../types/domain';
import { ConsentRepo } from '../lib/repositories';
import { AuthService, GovernanceService } from '../lib/services';

interface PrivacyConsentModalProps {
  user: UserProfile;
  open: boolean;
  onClose: () => void;
}

const CONSENT_ITEMS: { type: ConsentType; title: string; desc: string }[] = [
  {
    type: 'ai_photo_analysis',
    title: 'Phân tích ảnh bữa ăn bằng Gemini Vision',
    desc: 'Cho phép xử lý ảnh bữa ăn qua máy chủ AI bảo mật để nhận diện món ăn và ước lượng khẩu phần.',
  },
  {
    type: 'growth_tracking',
    title: 'Theo dõi chỉ số phát triển (Chiều cao / Cân nặng)',
    desc: 'Cho phép hiển thị và cập nhật biểu đồ phát triển thể chất của học sinh cho phụ huynh đã xác minh.',
  },
  {
    type: 'nutrition_reporting',
    title: 'Tổng hợp báo cáo dinh dưỡng lớp & trường',
    desc: 'Cho phép tổng hợp dữ liệu dinh dưỡng vào báo cáo thống kê giáo dục của giáo viên và nhà trường.',
  },
  {
    type: 'data_retention',
    title: 'Lưu trữ dữ liệu theo chính sách nhà trường',
    desc: 'Đồng ý lưu trữ lịch sử dinh dưỡng trong thời hạn lưu giữ dữ liệu (mặc định 730 ngày).',
  },
];

export function PrivacyConsentModal({ user, open, onClose }: PrivacyConsentModalProps) {
  const [consents, setConsents] = useState<ConsentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const subjectUid = user.role === 'parent' && user.linkedChildIds?.[0] ? user.linkedChildIds[0] : user.uid;

  const loadConsents = async () => {
    setLoading(true);
    try {
      const list = await ConsentRepo.listForUser(user.uid);
      setConsents(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      void loadConsents();
    }
  }, [open]);

  if (!open) return null;

  const isGranted = (type: ConsentType) => {
    const rec = consents.find((c) => c.consentType === type && c.subjectStudentUid === subjectUid);
    return rec ? rec.granted : false;
  };

  const handleToggle = async (type: ConsentType) => {
    const next = !isGranted(type);
    await GovernanceService.setConsent(user, subjectUid, type, next);
    await loadConsents();
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      await GovernanceService.deleteAccountAndOwnData(user);
      await AuthService.logout();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl max-w-xl w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2 text-slate-900">
            <ShieldCheck className="w-5 h-5 text-emerald-700" />
            <h3 className="text-base font-semibold">Quản lý Đồng ý, Lưu trữ & Xóa dữ liệu</h3>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div className="text-xs text-slate-500">
            Hồ sơ áp dụng: <span className="font-mono text-slate-800">{subjectUid}</span> · Lưu trữ trong Firestore với bản ghi kiểm toán.
          </div>

          {loading ? (
            <div className="py-4 text-xs text-slate-500">Đang tải hồ sơ đồng ý...</div>
          ) : (
            CONSENT_ITEMS.map((item) => {
              const active = isGranted(item.type);
              return (
                <div
                  key={item.type}
                  className="p-3.5 border border-slate-200 rounded-lg flex items-start justify-between gap-4"
                >
                  <div>
                    <div className="text-sm font-medium text-slate-900">{item.title}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{item.desc}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggle(item.type)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg shrink-0 whitespace-nowrap ${
                      active
                        ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {active ? 'Đã đồng ý' : 'Chưa đồng ý'}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="pt-4 border-t border-slate-200 space-y-3">
          <div className="text-sm font-semibold text-rose-800">Xóa tài khoản & Dữ liệu cá nhân</div>
          <p className="text-xs text-slate-600">
            Thao tác này sẽ xóa toàn bộ nhật ký bữa ăn cá nhân, thu hồi đồng ý và xóa hồ sơ người dùng khỏi Firestore.
          </p>
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200 rounded-lg hover:bg-rose-100"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Yêu cầu xóa tài khoản & dữ liệu
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={handleDeleteAccount}
                className="px-3.5 py-2 text-xs font-medium bg-rose-700 text-white rounded-lg hover:bg-rose-800 disabled:opacity-50"
              >
                {deleting ? 'Đang xóa...' : 'Xác nhận xóa vĩnh viễn'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="px-3.5 py-2 text-xs font-medium bg-slate-100 text-slate-700 rounded-lg"
              >
                Hủy
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
