// ======================================================
// security.js - نظام الأمان والصلاحيات والحماية
// ======================================================

import { hasPermission, currentUser, currentUserData } from './auth.js';

// ======================================================
// حالة الاتصال بالإنترنت
// ======================================================

/**
 * حالة الشبكة:
 *  - 'online'   → الاتصال سليم ← الكتابة مسموحة
 *  - 'offline'  → انقطع الاتصال ← الكتابة محظورة
 *  - 'locked'   → عاد الاتصال لكن يجب التحقق اليدوي أولاً
 */
let networkState = navigator.onLine ? 'online' : 'offline';

// علامة: هل تم اكتشاف HTML injection في هذه الجلسة؟
let htmlInjectionDetected = false;

// ======================================================
// رصد الشبكة
// ======================================================
window.addEventListener('offline', () => {
  networkState = 'offline';
  showNetworkBanner('offline');
  disableWriteButtons();
});

window.addEventListener('online', () => {
  // عاد الإنترنت لكن لا نفتح الكتابة تلقائياً حتى يتحقق المستخدم
  networkState = 'locked';
  showNetworkBanner('locked');
  disableWriteButtons();
});

// ======================================================
// التحقق اليدوي بعد عودة الإنترنت
// ======================================================
window.confirmNetworkRestore = function () {
  if (networkState !== 'locked') return;
  networkState = 'online';
  hideNetworkBanner();
  enableWriteButtons();
  showSecurityToast('تم استئناف الاتصال. يمكنك الآن الكتابة والحفظ.', 'success');
};

// ======================================================
// الشريط التحذيري للشبكة
// ======================================================
function showNetworkBanner(state) {
  let banner = document.getElementById('network-security-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'network-security-banner';
    banner.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0;
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 12px 20px;
      font-size: 0.9rem;
      font-weight: 600;
      font-family: 'Cairo', 'Tajawal', sans-serif;
      direction: rtl;
      box-shadow: 0 2px 12px rgba(0,0,0,0.3);
      transition: all 0.3s ease;
    `;
    document.body.prepend(banner);
  }

  if (state === 'offline') {
    banner.style.background = 'linear-gradient(135deg, #dc2626, #b91c1c)';
    banner.style.color = '#fff';
    banner.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.56 9"/>
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
        <line x1="12" y1="20" x2="12.01" y2="20"/>
      </svg>
      <span>⛔ انقطع الاتصال بالإنترنت — الكتابة والحفظ محظوران حتى عودة الاتصال</span>
    `;
  } else if (state === 'locked') {
    banner.style.background = 'linear-gradient(135deg, #d97706, #b45309)';
    banner.style.color = '#fff';
    banner.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
      <span>⚠️ عاد الاتصال — للحماية، يجب التأكيد اليدوي قبل استئناف العمليات</span>
      <button onclick="confirmNetworkRestore()" style="
        background: rgba(255,255,255,0.25);
        border: 1px solid rgba(255,255,255,0.5);
        color: #fff;
        padding: 5px 14px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 0.82rem;
        font-weight: 700;
        white-space: nowrap;
      ">✔ تأكيد واستئناف</button>
    `;
  }

  banner.style.display = 'flex';
}

function hideNetworkBanner() {
  const banner = document.getElementById('network-security-banner');
  if (banner) banner.style.display = 'none';
}

// ======================================================
// تعطيل / تفعيل أزرار الكتابة والحفظ
// ======================================================
const WRITE_BUTTON_SELECTORS = [
  '#import-submit-btn',
  '#add-ben-submit-btn',
  'button[onclick*="startImport"]',
  'button[onclick*="submitAddBeneficiary"]',
  'button[onclick*="saveEditProject"]',
  'button[onclick*="saveEditBeneficiary"]',
  'button[onclick*="deleteProject"]',
  'button[onclick*="deleteBeneficiary"]',
  'button[onclick*="submitAddUser"]',
  'button[onclick*="toggleUserStatus"]',
  'button[onclick*="saveMainProject"]',
  'button[onclick*="deleteMainProject"]',
  'button[type="submit"]',
];

function disableWriteButtons() {
  WRITE_BUTTON_SELECTORS.forEach(sel => {
    document.querySelectorAll(sel).forEach(btn => {
      btn.setAttribute('data-security-disabled', 'true');
      btn.disabled = true;
      btn.title = '⛔ الكتابة محظورة: تحقق من الاتصال أولاً';
    });
  });
}

function enableWriteButtons() {
  document.querySelectorAll('[data-security-disabled="true"]').forEach(btn => {
    btn.removeAttribute('data-security-disabled');
    btn.disabled = false;
    btn.title = '';
  });
}

// ======================================================
// الحارس المركزي لكل عمليات الكتابة
// يُستدعى قبل أي حفظ أو إنشاء أو حذف
// ======================================================

/**
 * @param {string} permission - الصلاحية المطلوبة (مثل 'canImport', 'canAdd', 'canEdit', 'canDelete')
 * @param {object} [inputsToCheck={}] - كائن يحتوي fieldName → value للفحص من HTML injection
 * @returns {{ allowed: boolean, reason: string }}
 */
export function securityGuard(permission, inputsToCheck = {}) {
  // 1. فحص تسجيل الدخول
  if (!currentUser || !currentUserData) {
    return { allowed: false, reason: 'يجب تسجيل الدخول أولاً للقيام بهذه العملية' };
  }

  // 2. فحص أن الحساب نشط
  if (currentUserData.isActive === false) {
    return { allowed: false, reason: 'حسابك معطل. تواصل مع مدير النظام' };
  }

  // 3. فحص الصلاحية
  if (!hasPermission(permission)) {
    const permLabels = {
      canAdd: 'إضافة بيانات',
      canEdit: 'تعديل البيانات',
      canDelete: 'حذف البيانات',
      canImport: 'استيراد المشاريع',
      canExport: 'تصدير التقارير',
      canManageUsers: 'إدارة المستخدمين',
      canBackup: 'النسخ الاحتياطي',
    };
    const label = permLabels[permission] || permission;
    return { allowed: false, reason: `ليس لديك صلاحية "${label}". دورك الحالي: ${currentUserData.role}` };
  }

  // 4. فحص الاتصال بالإنترنت
  if (networkState === 'offline') {
    return { allowed: false, reason: 'الاتصال بالإنترنت منقطع. لا يمكن الحفظ حالياً' };
  }
  if (networkState === 'locked') {
    return { allowed: false, reason: 'عاد الاتصال لكن يجب التأكيد اليدوي أولاً (اضغط "تأكيد واستئناف" في الشريط الأعلى)' };
  }

  // 5. فحص HTML injection في المدخلات
  const htmlPattern = /<[a-zA-Z\/!][^>]*>/;
  const injectedFields = [];
  for (const [fieldName, value] of Object.entries(inputsToCheck)) {
    if (typeof value === 'string' && htmlPattern.test(value)) {
      injectedFields.push(fieldName);
      htmlInjectionDetected = true;
    }
  }
  if (injectedFields.length > 0) {
    // تسجيل محاولة الحقن في المنسوخة المحلية
    console.error('[SECURITY] HTML Injection detected in fields:', injectedFields, 'by user:', currentUser?.email);
    return {
      allowed: false,
      reason: `⛔ تم رصد أكواد HTML غير مسموح بها في الحقول: (${injectedFields.join(', ')}). تم رفض الحفظ لحماية النظام.`
    };
  }

  return { allowed: true, reason: '' };
}

// ======================================================
// دالة مساعدة: فحص مدخل واحد أو مجموعة مدخلات
// ترجع true إذا كانت المدخلات نظيفة
// ======================================================
export function validateInputs(inputs = {}) {
  const htmlPattern = /<[a-zA-Z\/!][^>]*>/;
  for (const [field, value] of Object.entries(inputs)) {
    if (typeof value === 'string' && htmlPattern.test(value)) {
      return { clean: false, field };
    }
  }
  return { clean: true, field: null };
}

// ======================================================
// Toast أمني مستقل (لا يعتمد على showToast الرئيسي)
// ======================================================
function showSecurityToast(message, type = 'warning') {
  const colors = {
    warning: { bg: '#d97706', icon: '⚠️' },
    error:   { bg: '#dc2626', icon: '⛔' },
    success: { bg: '#16a34a', icon: '✅' },
    info:    { bg: '#2563eb', icon: 'ℹ️' },
  };
  const c = colors[type] || colors.info;

  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%) translateY(20px);
    background: ${c.bg};
    color: #fff;
    padding: 12px 24px;
    border-radius: 10px;
    font-size: 0.88rem;
    font-weight: 600;
    font-family: 'Cairo', 'Tajawal', sans-serif;
    direction: rtl;
    z-index: 99998;
    box-shadow: 0 4px 20px rgba(0,0,0,0.35);
    display: flex;
    align-items: center;
    gap: 8px;
    opacity: 0;
    transition: opacity 0.3s, transform 0.3s;
    max-width: 90vw;
    text-align: center;
  `;
  toast.innerHTML = `<span>${c.icon}</span><span>${message}</span>`;
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(20px)';
    setTimeout(() => toast.remove(), 400);
  }, 5000);
}

// ======================================================
// تصدير الحالة للقراءة من الخارج
// ======================================================
export function getNetworkState() { return networkState; }
export function isHtmlInjectionDetected() { return htmlInjectionDetected; }

// ======================================================
// إعداد عند تحميل الصفحة
// ======================================================
if (!navigator.onLine) {
  // الصفحة تحمّلت وهي أصلاً بدون إنترنت
  networkState = 'offline';
  // أخّر الشريط قليلاً حتى يتحمّل الـ DOM
  document.addEventListener('DOMContentLoaded', () => {
    showNetworkBanner('offline');
    disableWriteButtons();
  });
}
