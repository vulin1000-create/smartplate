import React, { useState } from 'react';
import {
  ChevronRight,
  LogOut,
  Menu,
  ShieldCheck,
  UserX,
  X,
} from 'lucide-react';
import { UserProfile, UserRole } from '../types/domain';

export interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const ROLE_TITLES: Record<UserRole, string> = {
  student: 'Cổng Học sinh',
  parent: 'Cổng Phụ huynh',
  teacher: 'Cổng Giáo viên',
  school_admin: 'Quản trị Nhà trường',
  super_admin: 'Quản trị Hệ thống',
};

interface DashboardShellProps {
  user: UserProfile;
  schoolName: string;
  navItems: NavItem[];
  activeTab: string;
  onSelectTab: (id: string) => void;
  onLogout: () => void;
  onOpenPrivacyModal: () => void;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}

export function DashboardShell({
  user,
  schoolName,
  navItems,
  activeTab,
  onSelectTab,
  onLogout,
  onOpenPrivacyModal,
  headerAction,
  children,
}: DashboardShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const currentNav = navItems.find((n) => n.id === activeTab) || navItems[0];

  const SidebarContent = (
    <div className="flex flex-col h-full bg-white border-r border-slate-200 w-64">
      <div className="px-5 py-5 border-b border-slate-200">
        <div className="text-lg font-bold tracking-tight text-slate-900">SmartPlate VN 2.0</div>
        <div className="mt-1 text-xs text-slate-500 truncate">
          {ROLE_TITLES[user.role]} · {schoolName || 'Toàn hệ thống'}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === activeTab;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectTab(item.id);
                setMobileOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-transparent'
              }`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-emerald-700' : 'text-slate-400'}`} />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-200 space-y-3">
        <div className="flex items-center gap-3">
          {user.photoURL ? (
            <img
              src={user.photoURL}
              alt={user.displayName}
              referrerPolicy="no-referrer"
              className="w-9 h-9 rounded-lg object-cover border border-slate-200 shrink-0"
            />
          ) : (
            <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center text-sm font-semibold shrink-0">
              {user.displayName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900 truncate">{user.displayName}</div>
            <div className="text-xs text-slate-500 truncate">{user.email}</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenPrivacyModal}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Quyền riêng tư
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors whitespace-nowrap"
            title="Đăng xuất"
          >
            <LogOut className="w-3.5 h-3.5" />
            Thoát
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block shrink-0 no-print">{SidebarContent}</aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex no-print">
          <div className="fixed inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
          <div className="relative z-10 flex">
            {SidebarContent}
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Đóng menu"
              className="ml-2 mt-3 h-9 w-9 rounded-lg bg-white text-slate-700 flex items-center justify-center border border-slate-200"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200 px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Mở menu điều hướng"
              className="lg:hidden p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100"
            >
              <Menu className="w-5 h-5" />
            </button>
            <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-slate-500 min-w-0">
              <span className="hidden sm:inline whitespace-nowrap">SmartPlate VN 2.0</span>
              <ChevronRight className="hidden sm:inline w-4 h-4 text-slate-400 shrink-0" />
              <span className="whitespace-nowrap text-slate-600">{ROLE_TITLES[user.role]}</span>
              <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="font-semibold text-slate-900 truncate">{currentNav?.label}</span>
            </nav>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {headerAction}
            <button
              type="button"
              onClick={onOpenPrivacyModal}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-100 whitespace-nowrap"
            >
              <UserX className="w-3.5 h-3.5" />
              Dữ liệu & Đồng ý
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1320px] w-full mx-auto space-y-6">
          {children}
        </main>
      </div>
    </div>
  );
}
