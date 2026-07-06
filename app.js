// ======================================================
// app.js - منطق التطبيق الرئيسي + Router + UI
// ======================================================

import { initAuth, login, logout, hasPermission, currentUser, currentUserData, ROLE_LABELS, createUser } from './auth.js';
import { BeneficiaryDB, ProjectDB, BenefitDB, DeletedRecordDB, AuditDB, UserDB, StatsDB } from './db.js';
import { importProject, exportProjectErrors } from './import.js';
import { ExcelExport, PDFExport } from './reports.js';
import { renderProjectsChart, renderDuplicatesChart, renderTrendChart, destroyAllCharts } from './charts.js';

// ======================================================
// الحالة العامة
// ======================================================
let currentPage = 'dashboard';
let allBeneficiaries = [];
let allProjects = [];
let searchTimeout = null;
let importResultData = null;

// ======================================================
// Router - إدارة الصفحات
// ======================================================
function navigate(page, params = {}) {
  destroyAllCharts();
  currentPage = page;

  // تحديث قائمة التنقل
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.page === page);
  });

  // إخفاء جميع الصفحات
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

  // إظهار الصفحة المطلوبة
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');

  // تحميل محتوى الصفحة
  switch (page) {
    case 'dashboard': loadDashboard(); break;
    case 'projects': loadProjectsPage(); break;
    case 'beneficiaries': loadBeneficiariesPage(); break;
    case 'search': loadSearchPage(); break;
    case 'reports': loadReportsPage(); break;
    case 'users': loadUsersPage(); break;
    case 'audit': loadAuditPage(); break;
    case 'import': loadImportPage(params); break;
  }

  // إغلاق القائمة الجانبية في الجوال
  document.getElementById('sidebar')?.classList.remove('open');
}

// ======================================================
// تهيئة التطبيق
// ======================================================
window.addEventListener('DOMContentLoaded', () => {
  // تهيئة أيقونة الثيم
  const savedTheme = localStorage.getItem('theme') || 'dark';
  const useEl = document.querySelector('#theme-toggle use');
  if (useEl) {
    useEl.setAttribute('href', savedTheme === 'dark' ? '#i-sun' : '#i-moon');
  }

  initAuth(
    (user, userData) => {
      // بعد تسجيل الدخول
      document.getElementById('login-screen').style.display = 'none';
      document.getElementById('app-screen').style.display = 'flex';
      document.getElementById('user-name').textContent = userData?.name || user.email;
      document.getElementById('user-role').textContent = ROLE_LABELS[userData?.role] || '';
      document.getElementById('user-avatar-text').textContent = (userData?.name || 'م')[0];
      applyPermissions();
      navigate('dashboard');
    },
    () => {
      // بعد تسجيل الخروج
      document.getElementById('login-screen').style.display = 'flex';
      document.getElementById('app-screen').style.display = 'none';
    }
  );

  setupEventListeners();
});

// ======================================================
// إعداد مستمعي الأحداث
// ======================================================
function setupEventListeners() {
  // نموذج تسجيل الدخول
  document.getElementById('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-small"></span> جاري الدخول...';
    try {
      await login(email, password);
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false;
      btn.innerHTML = 'تسجيل الدخول';
    }
  });

  // أزرار التنقل
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(link.dataset.page);
    });
  });

  // زر تسجيل الخروج
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await logout();
  });

  // زر القائمة الجانبية (جوال)
  document.getElementById('menu-toggle')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.toggle('open');
  });

  // إغلاق القائمة عند النقر خارجها
  document.getElementById('sidebar-overlay')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.remove('open');
  });

  // بحث المستفيدين
  document.getElementById('beneficiaries-search')?.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => filterBeneficiaries(e.target.value), 300);
  });
}

// ======================================================
// تطبيق الصلاحيات على الواجهة
// ======================================================
function applyPermissions() {
  const canManageUsers = hasPermission('canManageUsers');
  const canImport = hasPermission('canImport');
  const canViewAudit = hasPermission('canViewAudit');

  document.getElementById('nav-users')?.classList.toggle('hidden', !canManageUsers);
  document.getElementById('nav-audit')?.classList.toggle('hidden', !canViewAudit);
  document.getElementById('nav-import')?.classList.toggle('hidden', !canImport);
}

// ======================================================
// صفحة لوحة التحكم
// ======================================================
async function loadDashboard() {
  showPageLoader('page-dashboard');
  try {
    const [stats, projects] = await Promise.all([
      StatsDB.getDashboardStats(),
      ProjectDB.getAll()
    ]);

    allProjects = projects;

    // تحديث البطاقات الإحصائية
    document.getElementById('stat-beneficiaries').textContent = stats.beneficiariesCount.toLocaleString('ar-SA');
    document.getElementById('stat-projects').textContent = stats.projectsCount.toLocaleString('ar-SA');
    document.getElementById('stat-benefits').textContent = stats.benefitsCount.toLocaleString('ar-SA');
    document.getElementById('stat-deleted').textContent = stats.deletedCount.toLocaleString('ar-SA');

    // رسم الرسوم البيانية
    renderProjectsChart(projects);
    renderDuplicatesChart(stats);
    renderTrendChart(projects);

    // آخر المشاريع
    renderRecentProjects(projects.slice(0, 5));

  } catch (err) {
    showToast('فشل تحميل لوحة التحكم: ' + err.message, 'error');
  } finally {
    hidePageLoader('page-dashboard');
  }
}

function renderRecentProjects(projects) {
  const container = document.getElementById('recent-projects-list');
  if (!container) return;
  if (projects.length === 0) {
    container.innerHTML = '<p class="empty-state">لا توجد مشاريع بعد</p>';
    return;
  }
  container.innerHTML = projects.map(p => `
    <div class="recent-project-item">
      <div class="recent-project-icon">📁</div>
      <div class="recent-project-info">
        <div class="recent-project-name">${escapeHtml(p.name)}</div>
        <div class="recent-project-date">${formatTimestamp(p.createdAt)}</div>
      </div>
      <div class="recent-project-count">
        <span class="badge badge-blue">${(p.stats?.finalCount || 0).toLocaleString('ar-SA')} مستفيد</span>
      </div>
    </div>
  `).join('');
}

// ======================================================
// صفحة المشاريع
// ======================================================
async function loadProjectsPage() {
  showPageLoader('page-projects');
  try {
    const projects = await ProjectDB.getAll();
    allProjects = projects;
    renderProjectsTable(projects);
  } catch (err) {
    showToast('فشل تحميل المشاريع: ' + err.message, 'error');
  } finally {
    hidePageLoader('page-projects');
  }
}

function renderProjectsTable(projects) {
  const tbody = document.getElementById('projects-tbody');
  if (!tbody) return;

  if (projects.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">لا توجد مشاريع. ابدأ بإنشاء مشروع جديد.</td></tr>`;
    return;
  }

  const svgEye = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const svgEdit = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  const svgExcel = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M8 3v18"/><path d="M2 9h20"/><path d="M2 15h20"/><path d="M14 12l-3 4"/><path d="M11 12l3 4"/></svg>`;
  const svgTrash = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
  const svgAlert = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
  const svgLink = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;

  tbody.innerHTML = projects.map(p => `
    <tr class="table-row-animate">
      <td><strong>${escapeHtml(p.name)}</strong></td>
      <td>${formatTimestamp(p.createdAt)}</td>
      <td class="text-center"><span class="badge badge-gray">${(p.stats?.totalImported || 0).toLocaleString('ar-SA')}</span></td>
      <td class="text-center"><span class="badge badge-red">${(p.stats?.internalDuplicates || 0).toLocaleString('ar-SA')}</span></td>
      <td class="text-center"><span class="badge badge-orange">${(p.stats?.crossProjectDuplicates || 0).toLocaleString('ar-SA')}</span></td>
      <td class="text-center"><span class="badge badge-green">${(p.stats?.finalCount || 0).toLocaleString('ar-SA')}</span></td>
      <td>
        <div class="action-btns">
          <button class="btn-icon btn-view" onclick="viewProject('${p.id}')" title="عرض تفاصيل المشروع">${svgEye}</button>
          ${hasPermission('canEdit') ? `<button class="btn-icon btn-edit" onclick="editProject('${p.id}')" title="تعديل اسم المشروع">${svgEdit}</button>` : ''}
          ${hasPermission('canExport') ? `<button class="btn-icon btn-export" onclick="exportProjectExcel('${p.id}','${escapeHtml(p.name)}')" title="تنزيل نسخة المشروع Excel">${svgExcel}</button>` : ''}
          ${(p.stats?.internalDuplicates || 0) + (p.stats?.crossProjectDuplicates || 0) > 0 ? `
            <button class="btn-icon btn-delete" onclick="downloadProjectErrorsById('${p.id}','${escapeHtml(p.name)}')" title="تنزيل ملف الأخطاء والاستبعادات (تكرار/سابق)">${svgAlert}</button>
          ` : ''}
          ${(p.stats?.benefitAdditions || 0) > 0 ? `
            <button class="btn-icon btn-view" onclick="downloadProjectPreviousBenefitsById('${p.id}','${escapeHtml(p.name)}')" title="تنزيل المستفيدين السابقين المضاف لهم استفادة" style="color:var(--accent-cyan);">${svgLink}</button>
          ` : ''}
          ${hasPermission('canDelete') ? `<button class="btn-icon btn-delete" onclick="deleteProject('${p.id}')" title="حذف المشروع">${svgTrash}</button>` : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

// تنزيل ملف الأخطاء من جدول المشاريع مباشرة
window.downloadProjectErrorsById = async function(projectId, projectName) {
  try {
    showToast('جاري استرجاع السجلات المستبعدة...', 'info');
    const records = await DeletedRecordDB.getByProject(projectId);
    
    const internalDups = records.filter(r => r.deletionType === 'internal');
    const crossDups = records.filter(r => r.deletionType === 'cross');

    const ok = exportProjectErrors(projectName, internalDups, crossDups);
    if (ok) {
      showToast('تم تصدير ملف الأخطاء والاستبعادات بنجاح', 'success');
    } else {
      showToast('لا توجد سجلات مستبعدة لتصديرها لهذا المشروع', 'warning');
    }
  } catch (err) {
    showToast('فشل التصدير: ' + err.message, 'error');
  }
};

// تنزيل المستفيدين السابقين الذين حصلوا على استفادة إضافية بالمشروع
window.downloadProjectPreviousBenefitsById = async function(projectId, projectName) {
  try {
    showToast('جاري استرجاع مستفيدي الاستفادات الإضافية...', 'info');
    const benefits = await BenefitDB.getByProject(projectId);
    const additionBenefits = benefits.filter(b => b.isBenefitAddition === true);

    if (additionBenefits.length === 0) {
      showToast('لا توجد استفادات إضافية لتصديرها في هذا المشروع', 'warning');
      return;
    }

    // إحضار المشاريع السابقة من قاعدة البيانات في حال لم تكن مسجلة مسبقاً (للتوافق الرجعي)
    const beneficiariesToFetch = additionBenefits.filter(b => !b.previousProjects);
    if (beneficiariesToFetch.length > 0) {
      const promises = beneficiariesToFetch.map(async (b) => {
        if (b.beneficiaryId) {
          const benData = await BeneficiaryDB.getById(b.beneficiaryId);
          b.previousProjects = benData && benData.projectNames ? benData.projectNames.filter(p => p !== projectName) : [];
        }
      });
      await Promise.all(promises);
    }

    const rows = additionBenefits.map((b, i) => ({
      '#': i + 1,
      'الاسم الرباعي': b.record?.fullName || '',
      'رقم الهوية': b.record?.idNumber || '',
      'رقم الجوال': b.record?.phone || '',
      'عدد أفراد الأسرة': b.record?.familySize || '',
      'اسم المخيم': b.record?.campName || '',
      'سبب المطابقة': b.matchReason || 'مستفيد سابق',
      'المشاريع السابقة': (b.previousProjects || []).join(' | ') || 'غير متوفر',
      'تاريخ الاستفادة': b.createdAt?.toDate ? b.createdAt.toDate().toLocaleDateString('ar-SA') : new Date(b.createdAt).toLocaleDateString('ar-SA')
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'استفادات إضافية');

    ws['!cols'] = [
      { wch: 8 }, { wch: 30 }, { wch: 18 }, { wch: 18 }, { wch: 15 }, { wch: 20 }, { wch: 25 }, { wch: 20 }
    ];

    const safeName = projectName.replace(/[\\/:*?"<>|]/g, '_');
    XLSX.writeFile(wb, `استفادات_اضافية_${safeName}.xlsx`);
    showToast('تم تصدير ملف المستفيدين السابقين بنجاح', 'success');
  } catch (err) {
    showToast('فشل التصدير: ' + err.message, 'error');
  }
};

// ======================================================
// صفحة الاستيراد
// ======================================================
async function loadImportPage(params = {}) {
  const form = document.getElementById('import-form');
  const resultSection = document.getElementById('import-result');
  const progressSection = document.getElementById('import-progress');
  if (resultSection) resultSection.classList.add('hidden');
  if (progressSection) progressSection.classList.add('hidden');
  if (form) form.reset();
  renderFilePreview(null);

  // تحميل وعرض المشاريع السابقة للمقارنة
  try {
    const projects = await ProjectDB.getAll();
    allProjects = projects;
    renderPreviousProjectsForImport(projects);
  } catch (err) {
    console.warn('لم يتم تحميل المشاريع السابقة:', err.message);
  }
}

// عرض المشاريع السابقة في صفحة الاستيراد
function renderPreviousProjectsForImport(projects) {
  const container = document.getElementById('prev-projects-list');
  if (!container) return;

  if (projects.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted);font-size:0.85rem;padding:12px 0;">لا توجد مشاريع سابقة بعد</p>`;
    return;
  }

  container.innerHTML = projects.map(p => `
    <div class="prev-project-item" id="prev-${p.id}">
      <label class="prev-project-checkbox-label">
        <input type="checkbox" class="prev-project-cb" value="${p.id}" data-name="${escapeHtml(p.name)}" onchange="updateCompareSelection()">
        <span class="prev-project-check-icon">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20,6 9,17 4,12"/></svg>
        </span>
      </label>
      <div class="prev-project-info">
        <div class="prev-project-name">${escapeHtml(p.name)}</div>
        <div class="prev-project-meta">
          <span class="badge badge-green" style="font-size:0.72rem;">${(p.stats?.finalCount || 0).toLocaleString('ar-SA')} مستفيد</span>
          <span style="font-size:0.72rem;color:var(--text-muted);">${formatTimestamp(p.createdAt)}</span>
        </div>
      </div>
      <button class="btn-icon btn-view" onclick="viewProject('${p.id}')" title="عرض تفاصيل المشروع" style="flex-shrink:0;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
      </button>
    </div>
  `).join('');
}

// تحديث نص عداد المشاريع المحددة للمقارنة
window.updateCompareSelection = function() {
  const selected = document.querySelectorAll('.prev-project-cb:checked');
  const countEl = document.getElementById('compare-selected-count');
  if (countEl) {
    if (selected.length === 0) {
      countEl.textContent = 'لم يتم تحديد مشاريع للمقارنة';
      countEl.style.color = 'var(--text-muted)';
    } else {
      const names = Array.from(selected).map(cb => cb.dataset.name).join('، ');
      countEl.textContent = `سيتم المقارنة مع: ${names}`;
      countEl.style.color = 'var(--accent-blue)';
    }
  }
};

// معالج رفع الملف
window.handleFileChange = function (input) {
  const file = input.files[0];
  if (!file) return;

  const allowed = ['.xlsx', '.xls', '.csv'];
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
  if (!allowed.includes(ext)) {
    showToast('يُسمح فقط بملفات Excel (.xlsx, .xls)', 'error');
    input.value = '';
    return;
  }

  const label = document.getElementById('file-label');
  if (label) label.textContent = file.name;
  renderFilePreview(file);
};

async function renderFilePreview(file) {
  const preview = document.getElementById('file-preview');
  if (!preview) return;
  if (!file) { preview.innerHTML = ''; return; }

  preview.innerHTML = `
    <div class="file-info-card">
      <span class="file-icon">📄</span>
      <div>
        <div class="file-name">${escapeHtml(file.name)}</div>
        <div class="file-size">${(file.size / 1024).toFixed(1)} كيلوبايت</div>
      </div>
    </div>
  `;
}

// بدء الاستيراد
window.startImport = async function () {
  if (!hasPermission('canImport')) {
    showToast('ليس لديك صلاحية الاستيراد', 'error'); return;
  }

  const projectName = document.getElementById('project-name')?.value?.trim();
  const fileInput = document.getElementById('project-file');
  const file = fileInput?.files[0];

  if (!projectName) { showToast('يرجى إدخال اسم المشروع', 'error'); return; }
  if (!file) { showToast('يرجى اختيار ملف Excel', 'error'); return; }

  // جمع المشاريع المحددة للمقارنة
  const selectedCbs = document.querySelectorAll('.prev-project-cb:checked');
  const selectedProjectIds = Array.from(selectedCbs).map(cb => cb.value);

  const progressSection = document.getElementById('import-progress');
  const resultSection = document.getElementById('import-result');
  const submitBtn = document.getElementById('import-submit-btn');

  progressSection?.classList.remove('hidden');
  resultSection?.classList.add('hidden');
  if (submitBtn) submitBtn.disabled = true;

  try {
    // إنشاء المشروع أولاً
    const projectId = await ProjectDB.add({
      name: projectName,
      createdBy: currentUser?.uid || 'unknown',
      createdByName: currentUserData?.name || 'غير معروف'
    });

    // بدء الاستيراد مع تمرير المشاريع المحددة
    const result = await importProject(
      projectId, projectName, file,
      (progress) => updateImportProgress(progress),
      selectedProjectIds
    );

    importResultData = {
      ...result,
      projectId,
      projectName,
      // حفظ القوائم الكاملة للأخطاء (وليس فقط العيّنة)
      _internalDuplicatesFull: result.samples._internalDuplicatesFull || result.samples.internalDuplicates,
      _crossDuplicatesFull: result.samples._crossDuplicatesFull || result.samples.crossDuplicates
    };
    renderImportResult(result, selectedProjectIds);
    resultSection?.classList.remove('hidden');
    showToast('تم الاستيراد بنجاح!', 'success');

  } catch (err) {
    showToast('فشل الاستيراد: ' + err.message, 'error');
  } finally {
    progressSection?.classList.add('hidden');
    if (submitBtn) submitBtn.disabled = false;
  }
};

function updateImportProgress(progress) {
  const bar = document.getElementById('progress-bar');
  const msg = document.getElementById('progress-message');
  if (bar) bar.style.width = progress.percent + '%';
  if (msg) msg.textContent = progress.message;
}

function renderImportResult(result, selectedProjectIds = []) {
  const { stats, samples } = result;
  const container = document.getElementById('import-result-content');
  if (!container) return;

  const hasCrossMatch = selectedProjectIds.length > 0;
  const hasErrors = (stats.internalDuplicates > 0) || (stats.crossDuplicates > 0);

  container.innerHTML = `
    <div class="result-stats-grid">
      <div class="result-stat">
        <div class="result-stat-value">${stats.totalImported.toLocaleString('ar-SA')}</div>
        <div class="result-stat-label">إجمالي السجلات</div>
      </div>
      <div class="result-stat red">
        <div class="result-stat-value">${stats.emptyRows.toLocaleString('ar-SA')}</div>
        <div class="result-stat-label">صفوف فارغة</div>
      </div>
      <div class="result-stat orange">
        <div class="result-stat-value">${stats.internalDuplicates.toLocaleString('ar-SA')}</div>
        <div class="result-stat-label">تكرار داخلي في الملف</div>
      </div>
      ${hasCrossMatch ? `
      <div class="result-stat yellow">
        <div class="result-stat-value">${stats.crossDuplicates.toLocaleString('ar-SA')}</div>
        <div class="result-stat-label">مكرر مع المشاريع المحددة</div>
      </div>` : ''}
      <div class="result-stat blue" style="background:rgba(59,130,246,0.08);border-color:rgba(59,130,246,0.25);">
        <div class="result-stat-value" style="color:var(--accent-blue);">${(stats.benefitAdditions||0).toLocaleString('ar-SA')}</div>
        <div class="result-stat-label">مستفيد موجود + استفادة جديدة</div>
      </div>
      <div class="result-stat green">
        <div class="result-stat-value">${stats.finalCount.toLocaleString('ar-SA')}</div>
        <div class="result-stat-label">مستفيدون جدد مقبولون ✓</div>
      </div>
    </div>

    ${hasErrors ? `
    <div style="margin:16px 0;">
      <button class="btn btn-danger btn-sm" onclick="downloadImportErrors()">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        تنزيل ملف أخطاء هذا المشروع (${stats.internalDuplicates + stats.crossDuplicates} سجل)
      </button>
    </div>` : `
    <div style="margin:12px 0;padding:12px 16px;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:var(--radius-md);font-size:0.85rem;color:var(--accent-green);">
      ✅ لا توجد سجلات مستبعدة في هذا المشروع
    </div>`}

    ${samples.internalDuplicates.length > 0 ? `
    <div class="result-section">
      <h4 class="result-section-title">🔴 عينة من التكرارات الداخلية (${stats.internalDuplicates} سجل)</h4>
      <table class="mini-table">
        <thead><tr><th>الاسم</th><th>رقم الهوية</th><th>رقم الجوال</th><th>السبب</th></tr></thead>
        <tbody>
          ${samples.internalDuplicates.map(r => `
            <tr>
              <td>${escapeHtml(r.fullName)}</td>
              <td>${escapeHtml(r.idNumber)}</td>
              <td>${escapeHtml(r.phone)}</td>
              <td><span class="badge badge-red">${escapeHtml(r.reason)}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>` : ''}

    ${samples.crossDuplicates.length > 0 ? `
    <div class="result-section">
      <h4 class="result-section-title">🟡 عينة من المكررين مع المشاريع المحددة (${stats.crossDuplicates} سجل)</h4>
      <table class="mini-table">
        <thead><tr><th>الاسم</th><th>رقم الهوية</th><th>سبب الاستبعاد</th><th>مستفيد من</th></tr></thead>
        <tbody>
          ${samples.crossDuplicates.map(r => `
            <tr>
              <td>${escapeHtml(r.fullName)}</td>
              <td>${escapeHtml(r.idNumber)}</td>
              <td>${escapeHtml(r.matchReason)}</td>
              <td>${(r.previousProjects || []).map(p => `<span class="badge badge-orange">${escapeHtml(p)}</span>`).join(' ')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>` : ''}

    ${(samples.benefitAdditions || []).length > 0 ? `
    <div class="result-section">
      <h4 class="result-section-title">🔵 مستفيدون موجودون — تمت إضافة استفادة جديدة لهم (${stats.benefitAdditions} سجل)</h4>
      <table class="mini-table">
        <thead><tr><th>الاسم</th><th>رقم الهوية</th><th>سبب التطابق</th></tr></thead>
        <tbody>
          ${(samples.benefitAdditions || []).map(r => `
            <tr>
              <td>${escapeHtml(r.record?.fullName || r.fullName || '')}</td>
              <td>${escapeHtml(r.record?.idNumber || r.idNumber || '')}</td>
              <td><span class="badge badge-blue">${escapeHtml(r.matchReason || '')}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>` : ''}
  `;
}

// تنزيل ملف الأخطاء الخاص بهذا المشروع
window.downloadImportErrors = function () {
  if (!importResultData) return;
  const { samples, projectName } = importResultData;
  const internalDups = importResultData._internalDuplicatesFull || samples.internalDuplicates;
  const crossDups = importResultData._crossDuplicatesFull || samples.crossDuplicates;
  const ok = exportProjectErrors(projectName, internalDups, crossDups);
  if (ok) {
    showToast(`تم تنزيل ملف أخطاء مشروع "${projectName}"`, 'success');
  } else {
    showToast('لا توجد أخطاء لتنزيلها', 'info');
  }
};

// ======================================================
// صفحة المستفيدين
// ======================================================
async function loadBeneficiariesPage() {
  showPageLoader('page-beneficiaries');
  try {
    allBeneficiaries = await BeneficiaryDB.getAll();
    renderBeneficiariesTable(allBeneficiaries);
  } catch (err) {
    showToast('فشل تحميل المستفيدين: ' + err.message, 'error');
  } finally {
    hidePageLoader('page-beneficiaries');
  }
}

function renderBeneficiariesTable(beneficiaries) {
  const tbody = document.getElementById('beneficiaries-tbody');
  if (!tbody) return;

  if (beneficiaries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-cell">لا توجد بيانات مستفيدين</td></tr>`;
    return;
  }

  const svgEye = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const svgEdit = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  const svgTrash = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;

  tbody.innerHTML = beneficiaries.map(b => `
    <tr class="table-row-animate">
      <td><strong>${escapeHtml(b.fullName || '')}</strong></td>
      <td>${escapeHtml(b.idNumber || '-')}</td>
      <td>${escapeHtml(b.phone || '-')}</td>
      <td class="text-center">${b.familySize || '-'}</td>
      <td>${escapeHtml(b.campName || '-')}</td>
      <td class="text-center">
        <span class="badge ${b.benefitCount > 1 ? 'badge-orange' : 'badge-green'}">${b.benefitCount || 1}</span>
      </td>
      <td>
        <div class="projects-tags">
          ${(b.projectNames || []).slice(0, 2).map(p => `<span class="tag">${escapeHtml(p)}</span>`).join('')}
          ${(b.projectNames || []).length > 2 ? `<span class="tag tag-more">+${b.projectNames.length - 2}</span>` : ''}
        </div>
      </td>
      <td>
        <div class="action-btns">
          <button class="btn-icon btn-view" onclick="viewBeneficiary('${b.id}')" title="عرض تفاصيل المستفيد">${svgEye}</button>
          ${hasPermission('canEdit') ? `<button class="btn-icon btn-edit" onclick="editBeneficiary('${b.id}')" title="تعديل بيانات المستفيد">${svgEdit}</button>` : ''}
          ${hasPermission('canDelete') ? `<button class="btn-icon btn-delete" onclick="deleteBeneficiary('${b.id}')" title="حذف المستفيد">${svgTrash}</button>` : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

function filterBeneficiaries(term) {
  if (!term.trim()) {
    renderBeneficiariesTable(allBeneficiaries);
    return;
  }
  const t = term.toLowerCase().trim();
  const filtered = allBeneficiaries.filter(b =>
    b.fullName?.toLowerCase().includes(t) ||
    b.idNumber?.includes(t) ||
    b.phone?.includes(t) ||
    b.campName?.toLowerCase().includes(t) ||
    (b.projectNames || []).some(p => p.toLowerCase().includes(t))
  );
  renderBeneficiariesTable(filtered);
}

// ======================================================
// عرض تفاصيل مستفيد
// ======================================================
window.viewBeneficiary = async function (id) {
  const b = await BeneficiaryDB.getById(id);
  if (!b) { showToast('لم يتم العثور على المستفيد', 'error'); return; }

  const benefits = await BenefitDB.getByBeneficiary(id);

  // تحديث عنوان المودال وتفعيل الـ overlay
  const titleEl = document.getElementById('modal-title');
  if (titleEl) titleEl.textContent = 'بيانات المستفيد وسجل الاستفادات';

  showModal('modal-view-beneficiary', `
    <div class="beneficiary-detail">
      <div class="detail-header">
        <div class="detail-avatar">${(b.fullName || 'م')[0]}</div>
        <div>
          <h2 class="detail-name">${escapeHtml(b.fullName || '')}</h2>
          <p class="detail-sub">مستفيد ${b.benefitCount > 1 ? 'متعدد الاستفادات' : 'فريد'}</p>
        </div>
      </div>
      <div class="detail-grid">
        <div class="detail-field"><label>الاسم الرباعي</label><span>${escapeHtml(b.fullName || '')}</span></div>
        <div class="detail-field"><label>رقم الهوية</label><span>${escapeHtml(b.idNumber || '-')}</span></div>
        <div class="detail-field"><label>رقم الجوال</label><span>${escapeHtml(b.phone || '-')}</span></div>
        <div class="detail-field"><label>عدد أفراد الأسرة</label><span>${b.familySize || '-'}</span></div>
        <div class="detail-field"><label>اسم المخيم</label><span>${escapeHtml(b.campName || '-')}</span></div>
        <div class="detail-field"><label>عدد مرات الاستفادة</label><span><strong>${b.benefitCount || 1}</strong></span></div>
        <div class="detail-field"><label>تاريخ أول استفادة</label><span>${formatTimestamp(b.firstBenefitDate)}</span></div>
        <div class="detail-field"><label>تاريخ آخر استفادة</label><span>${formatTimestamp(b.lastBenefitDate)}</span></div>
      </div>
      <div class="detail-section">
        <h3>📋 سجل الاستفادات (${benefits.length})</h3>
        <div class="benefits-list">
          ${benefits.length === 0 ? '<p class="empty-state">لا توجد استفادات</p>' :
      benefits.map(ben => `
              <div class="benefit-item">
                <div class="benefit-icon">🎁</div>
                <div class="benefit-info">
                  <div class="benefit-project">${escapeHtml(ben.projectName || '')}</div>
                  <div class="benefit-date">${formatTimestamp(ben.createdAt)}</div>
                  ${ben.matchReason ? `<div style="font-size:0.75rem;color:var(--accent-blue);margin-top:2px;">سبب التطابق: ${escapeHtml(ben.matchReason)}</div>` : ''}
                </div>
              </div>
            `).join('')
    }
        </div>
      </div>
    </div>
  `);
};

// ======================================================
// تعديل مستفيد
// ======================================================
window.editBeneficiary = async function (id) {
  if (!hasPermission('canEdit')) { showToast('ليس لديك صلاحية التعديل', 'error'); return; }
  const b = await BeneficiaryDB.getById(id);
  if (!b) { showToast('لم يتم العثور على المستفيد', 'error'); return; }

  showModal('modal-edit-beneficiary', `
    <form id="edit-beneficiary-form" onsubmit="saveEditBeneficiary(event, '${id}')">
      <div class="form-grid">
        <div class="form-group">
          <label>الاسم الرباعي</label>
          <input type="text" id="edit-fullName" value="${escapeHtml(b.fullName || '')}" required class="form-input">
        </div>
        <div class="form-group">
          <label>رقم الجوال</label>
          <input type="text" id="edit-phone" value="${escapeHtml(b.phone || '')}" class="form-input">
        </div>
        <div class="form-group">
          <label>عدد أفراد الأسرة</label>
          <input type="number" id="edit-familySize" value="${b.familySize || ''}" min="1" class="form-input">
        </div>
        <div class="form-group">
          <label>اسم المخيم</label>
          <input type="text" id="edit-campName" value="${escapeHtml(b.campName || '')}" class="form-input">
        </div>
      </div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">💾 حفظ التعديلات</button>
        <button type="button" class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
      </div>
    </form>
  `);
};

window.saveEditBeneficiary = async function (e, id) {
  e.preventDefault();
  try {
    const data = {
      fullName: document.getElementById('edit-fullName').value.trim(),
      phone: document.getElementById('edit-phone').value.trim(),
      familySize: parseInt(document.getElementById('edit-familySize').value) || 0,
      campName: document.getElementById('edit-campName').value.trim()
    };
    await BeneficiaryDB.update(id, data);
    await AuditDB.log('EDIT_BENEFICIARY', 'beneficiary', id, currentUser?.uid, currentUser?.email, data);
    showToast('تم تحديث بيانات المستفيد', 'success');
    closeModal();
    loadBeneficiariesPage();
  } catch (err) {
    showToast('فشل التحديث: ' + err.message, 'error');
  }
};

// ======================================================
// حذف مستفيد
// ======================================================
window.deleteBeneficiary = async function (id) {
  if (!hasPermission('canDelete')) { showToast('ليس لديك صلاحية الحذف', 'error'); return; }
  const confirmed = await showConfirm('هل أنت متأكد من حذف هذا المستفيد؟ لا يمكن التراجع عن هذه العملية.');
  if (!confirmed) return;
  try {
    await BeneficiaryDB.delete(id);
    await AuditDB.log('DELETE_BENEFICIARY', 'beneficiary', id, currentUser?.uid, currentUser?.email, {});
    showToast('تم حذف المستفيد', 'success');
    loadBeneficiariesPage();
  } catch (err) {
    showToast('فشل الحذف: ' + err.message, 'error');
  }
};

// ======================================================
// عمليات المشاريع
// ======================================================
window.viewProject = async function (id) {
  const p = await ProjectDB.getById(id);
  if (!p) return;
  const benefits = await BenefitDB.getByProject(id);

  showModal('modal-view-project', `
    <div class="project-detail">
      <h2 class="detail-name">📁 ${escapeHtml(p.name)}</h2>
      <p class="detail-sub">تاريخ الإنشاء: ${formatTimestamp(p.createdAt)}</p>
      <div class="result-stats-grid">
        <div class="result-stat"><div class="result-stat-value">${(p.stats?.totalImported || 0).toLocaleString('ar-SA')}</div><div class="result-stat-label">إجمالي الاستيراد</div></div>
        <div class="result-stat red"><div class="result-stat-value">${(p.stats?.internalDuplicates || 0).toLocaleString('ar-SA')}</div><div class="result-stat-label">تكرار داخلي</div></div>
        <div class="result-stat orange"><div class="result-stat-value">${(p.stats?.crossProjectDuplicates || 0).toLocaleString('ar-SA')}</div><div class="result-stat-label">مستفيد سابق</div></div>
        <div class="result-stat green"><div class="result-stat-value">${(p.stats?.finalCount || 0).toLocaleString('ar-SA')}</div><div class="result-stat-label">مقبولون</div></div>
      </div>
      <div class="detail-section">
        <h3>قائمة المستفيدين المقبولين (${benefits.length})</h3>
        <table class="mini-table">
          <thead><tr><th>#</th><th>الاسم</th><th>رقم الهوية</th><th>رقم الجوال</th><th>المخيم</th></tr></thead>
          <tbody>
            ${benefits.slice(0, 50).map((b, i) => `
              <tr>
                <td>${i + 1}</td>
                <td>${escapeHtml(b.record?.fullName || '')}</td>
                <td>${escapeHtml(b.record?.idNumber || '-')}</td>
                <td>${escapeHtml(b.record?.phone || '-')}</td>
                <td>${escapeHtml(b.record?.campName || '-')}</td>
              </tr>
            `).join('')}
            ${benefits.length > 50 ? `<tr><td colspan="5" style="text-align:center;opacity:0.6">... و${benefits.length - 50} سجل آخر</td></tr>` : ''}
          </tbody>
        </table>
      </div>
    </div>
  `);
};

window.editProject = async function (id) {
  if (!hasPermission('canEdit')) { showToast('ليس لديك صلاحية التعديل', 'error'); return; }
  const p = await ProjectDB.getById(id);
  if (!p) return;
  showModal('modal-edit-project', `
    <form onsubmit="saveEditProject(event, '${id}')">
      <div class="form-group">
        <label>اسم المشروع</label>
        <input type="text" id="edit-project-name" value="${escapeHtml(p.name)}" required class="form-input">
      </div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">💾 حفظ</button>
        <button type="button" class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
      </div>
    </form>
  `);
};

window.saveEditProject = async function (e, id) {
  e.preventDefault();
  const name = document.getElementById('edit-project-name').value.trim();
  try {
    await ProjectDB.update(id, { name });
    await AuditDB.log('EDIT_PROJECT', 'project', id, currentUser?.uid, currentUser?.email, { name });
    showToast('تم تحديث المشروع', 'success');
    closeModal();
    loadProjectsPage();
  } catch (err) {
    showToast('فشل التحديث: ' + err.message, 'error');
  }
};

window.deleteProject = async function (id) {
  if (!hasPermission('canDelete')) { showToast('ليس لديك صلاحية الحذف', 'error'); return; }

  const p = await ProjectDB.getById(id);
  if (!p) { showToast('المشروع غير موجود', 'error'); return; }

  const beneficiaryCount = p.stats?.finalCount || 0;
  const confirmed = await showConfirm(
    `⚠️ تحذير: حذف نهائي لا يمكن التراجع عنه!\n\n` +
    `سيتم حذف مشروع "${p.name}" وجميع ما يرتبط به:\n` +
    `• ${beneficiaryCount.toLocaleString('ar-SA')} مستفيد مقبول (إذا كانوا حصراً في هذا المشروع)\n` +
    `• جميع سجلات الاستفادة\n` +
    `• جميع السجلات المرتبطة\n\n` +
    `هل أنت متأكد من الحذف النهائي؟`
  );
  if (!confirmed) return;

  // إظهار مؤشر تحميل
  showToast('جاري حذف المشروع وجميع بياناته...', 'info');

  try {
    await ProjectDB.delete(id);
    await AuditDB.log('DELETE_PROJECT', 'project', id, currentUser?.uid, currentUser?.email, {
      projectName: p.name,
      finalCount: beneficiaryCount
    });
    showToast(`تم حذف مشروع "${p.name}" وجميع بياناته بنجاح`, 'success');
    loadProjectsPage();
  } catch (err) {
    showToast('فشل الحذف: ' + err.message, 'error');
  }
};


window.exportProjectExcel = async function (id, name) {
  try {
    await ExcelExport.exportProject(id, name);
    showToast('تم تصدير الملف بنجاح', 'success');
  } catch (err) {
    showToast('فشل التصدير: ' + err.message, 'error');
  }
};

// ======================================================
// صفحة البحث
// ======================================================
async function loadSearchPage() {
  const input = document.getElementById('search-input');
  if (input) input.value = '';
  document.getElementById('search-results-tbody').innerHTML = '';
  document.getElementById('search-count').textContent = '';
}

window.performSearch = async function () {
  const term = document.getElementById('search-input')?.value?.trim();
  if (!term) { showToast('يرجى إدخال نص للبحث', 'warning'); return; }

  const tbody = document.getElementById('search-results-tbody');
  const countEl = document.getElementById('search-count');

  tbody.innerHTML = `<tr><td colspan="7" class="empty-cell"><span class="spinner-small"></span> جاري البحث...</td></tr>`;

  try {
    const results = await BeneficiaryDB.search(term);
    countEl.textContent = `${results.length} نتيجة`;

    if (results.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">لا توجد نتائج للبحث عن "${escapeHtml(term)}"</td></tr>`;
      return;
    }

    const svgEyeSm = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
    tbody.innerHTML = results.map(b => `
      <tr>
        <td><strong>${escapeHtml(b.fullName || '')}</strong></td>
        <td>${escapeHtml(b.idNumber || '-')}</td>
        <td>${escapeHtml(b.phone || '-')}</td>
        <td>${b.familySize || '-'}</td>
        <td>${escapeHtml(b.campName || '-')}</td>
        <td><span class="badge ${b.benefitCount > 1 ? 'badge-orange' : 'badge-green'}">${b.benefitCount || 1}</span></td>
        <td>
          <button class="btn-icon btn-view" onclick="viewBeneficiary('${b.id}')" title="عرض تفاصيل المستفيد">${svgEyeSm}</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    showToast('فشل البحث: ' + err.message, 'error');
  }
};

// ======================================================
// صفحة التقارير
// ======================================================
function loadReportsPage() { }

window.exportReport = async function (type) {
  try {
    switch (type) {
      case 'all-excel': await ExcelExport.exportAllBeneficiaries(); break;
      case 'all-pdf': await PDFExport.exportAllBeneficiaries(); break;
      case 'deleted-excel': await ExcelExport.exportDeleted(); break;
      case 'benefits-excel': await ExcelExport.exportBenefitsSummary(); break;
    }
    showToast('تم تصدير التقرير بنجاح', 'success');
  } catch (err) {
    showToast('فشل التصدير: ' + err.message, 'error');
  }
};

// ======================================================
// صفحة المستخدمين
// ======================================================
async function loadUsersPage() {
  if (!hasPermission('canManageUsers')) {
    showToast('ليس لديك صلاحية إدارة المستخدمين', 'error'); return;
  }
  showPageLoader('page-users');
  try {
    const users = await UserDB.getAll();
    renderUsersTable(users);
  } catch (err) {
    showToast('فشل تحميل المستخدمين: ' + err.message, 'error');
  } finally {
    hidePageLoader('page-users');
  }
}

function renderUsersTable(users) {
  const tbody = document.getElementById('users-tbody');
  if (!tbody) return;
  const roleColors = { admin: 'badge-red', supervisor: 'badge-orange', user: 'badge-blue' };

  tbody.innerHTML = users.map(u => `
    <tr>
      <td>${escapeHtml(u.name || '')}</td>
      <td>${escapeHtml(u.email || '')}</td>
      <td><span class="badge ${roleColors[u.role] || 'badge-gray'}">${ROLE_LABELS[u.role] || u.role}</span></td>
      <td><span class="badge ${u.isActive ? 'badge-green' : 'badge-red'}">${u.isActive ? 'نشط' : 'معطل'}</span></td>
      <td>${formatTimestamp(u.createdAt)}</td>
      <td>
        <div class="action-btns">
          <button class="btn-icon btn-edit" onclick="editUser('${u.id}')" title="تعديل">✏️</button>
          <button class="btn-icon btn-delete" onclick="toggleUserStatus('${u.id}', ${u.isActive})" title="${u.isActive ? 'تعطيل' : 'تفعيل'}">${u.isActive ? '🔒' : '🔓'}</button>
        </div>
      </td>
    </tr>
  `).join('');
}

window.showAddUserForm = function () {
  showModal('modal-add-user', `
    <form onsubmit="submitAddUser(event)">
      <div class="form-grid">
        <div class="form-group"><label>الاسم الكامل</label><input type="text" id="new-user-name" required class="form-input"></div>
        <div class="form-group"><label>البريد الإلكتروني</label><input type="email" id="new-user-email" required class="form-input"></div>
        <div class="form-group"><label>كلمة المرور</label><input type="password" id="new-user-password" required minlength="6" class="form-input"></div>
        <div class="form-group">
          <label>الدور</label>
          <select id="new-user-role" class="form-input">
            <option value="user">مستخدم عادي</option>
            <option value="supervisor">مشرف المشاريع</option>
            <option value="admin">مدير النظام</option>
          </select>
        </div>
      </div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">➕ إضافة المستخدم</button>
        <button type="button" class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
      </div>
    </form>
  `);
};

window.submitAddUser = async function (e) {
  e.preventDefault();
  try {
    const name = document.getElementById('new-user-name').value.trim();
    const email = document.getElementById('new-user-email').value.trim();
    const password = document.getElementById('new-user-password').value;
    const role = document.getElementById('new-user-role').value;
    await createUser(email, password, name, role);
    showToast('تم إضافة المستخدم بنجاح', 'success');
    closeModal();
    loadUsersPage();
  } catch (err) {
    showToast('فشل إضافة المستخدم: ' + err.message, 'error');
  }
};

window.toggleUserStatus = async function (id, isActive) {
  try {
    await UserDB.update(id, { isActive: !isActive });
    showToast(isActive ? 'تم تعطيل الحساب' : 'تم تفعيل الحساب', 'success');
    loadUsersPage();
  } catch (err) {
    showToast('فشل تغيير الحالة: ' + err.message, 'error');
  }
};

// ======================================================
// صفحة سجل العمليات
// ======================================================
async function loadAuditPage() {
  if (!hasPermission('canViewAudit')) return;
  showPageLoader('page-audit');
  try {
    const logs = await AuditDB.getAll(200);
    const tbody = document.getElementById('audit-tbody');
    if (!tbody) return;

    const actionLabels = {
      LOGIN: '🔑 تسجيل دخول', LOGOUT: '🚪 تسجيل خروج',
      IMPORT_PROJECT: '📥 استيراد مشروع', CREATE_USER: '👤 إضافة مستخدم',
      EDIT_BENEFICIARY: '✏️ تعديل مستفيد', DELETE_BENEFICIARY: '🗑 حذف مستفيد',
      EDIT_PROJECT: '✏️ تعديل مشروع', DELETE_PROJECT: '🗑 حذف مشروع',
      CHANGE_PASSWORD: '🔐 تغيير كلمة مرور'
    };

    tbody.innerHTML = logs.map(log => `
      <tr>
        <td>${formatTimestamp(log.timestamp)}</td>
        <td><span class="badge badge-blue">${actionLabels[log.action] || log.action}</span></td>
        <td>${escapeHtml(log.userEmail || '-')}</td>
        <td>${escapeHtml(log.entityType || '-')}</td>
        <td class="text-small">${JSON.stringify(log.details || {}).slice(0, 80)}</td>
      </tr>
    `).join('');
  } catch (err) {
    showToast('فشل تحميل السجل: ' + err.message, 'error');
  } finally {
    hidePageLoader('page-audit');
  }
}

// ======================================================
// المودال العام
// ======================================================
function showModal(id, content) {
  const overlay = document.getElementById('modal-overlay');
  const body = document.getElementById('modal-body');
  if (overlay) overlay.classList.add('active');
  if (body) body.innerHTML = content;
}

window.closeModal = function () {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.classList.remove('active');
};

document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'modal-overlay') closeModal();
});

// ======================================================
// تأكيد العمليات
// ======================================================
function showConfirm(message) {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirm-overlay');
    const msg = document.getElementById('confirm-message');
    const btnOk = document.getElementById('confirm-ok');
    const btnCancel = document.getElementById('confirm-cancel');
    if (msg) msg.textContent = message;
    if (overlay) overlay.classList.add('active');
    const cleanup = (result) => {
      overlay?.classList.remove('active');
      btnOk?.removeEventListener('click', okHandler);
      btnCancel?.removeEventListener('click', cancelHandler);
      resolve(result);
    };
    const okHandler = () => cleanup(true);
    const cancelHandler = () => cleanup(false);
    btnOk?.addEventListener('click', okHandler);
    btnCancel?.addEventListener('click', cancelHandler);
  });
}

// ======================================================
// إشعارات Toast
// ======================================================
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  toast.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ======================================================
// دوال مساعدة
// ======================================================
function showPageLoader(pageId) {
  const page = document.getElementById(pageId);
  const loader = page?.querySelector('.page-loader');
  if (loader) loader.style.display = 'flex';
}

function hidePageLoader(pageId) {
  const page = document.getElementById(pageId);
  const loader = page?.querySelector('.page-loader');
  if (loader) loader.style.display = 'none';
}

function formatTimestamp(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d)) return '-';
  return d.toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

// تصدير ROLE_LABELS محلياً
const ROLE_LABELS_LOCAL = { admin: 'مدير النظام', supervisor: 'مشرف المشاريع', user: 'مستخدم عادي' };

// ======================================================
// جعل الدوال المستخدمة في HTML متاحة عالمياً
// ======================================================
window.navigate = navigate;
window.showToast = showToast;
window.showConfirm = showConfirm;

// تبديل الثيم داكن / نهاري
window.toggleTheme = function () {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);

  const useEl = document.querySelector('#theme-toggle use');
  if (useEl) {
    useEl.setAttribute('href', newTheme === 'dark' ? '#i-sun' : '#i-moon');
  }

  if (currentPage === 'dashboard') {
    loadDashboard();
  }

  showToast(newTheme === 'dark' ? "تم تفعيل الوضع الداكن" : "تم تفعيل الوضع النهاري", "success");
};

// تحميل نموذج Excel المعتمد
window.downloadTemplate = function () {
  const data = [
    ["الاسم الرباعي", "رقم الهوية", "رقم الجوال", "عدد أفراد الأسرة", "اسم المخيم"],
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "نموذج الاستيراد");

  // ضبط عرض الأعمدة
  ws['!cols'] = [
    { wch: 30 },
    { wch: 18 },
    { wch: 18 },
    { wch: 15 },
    { wch: 20 }
  ];

  XLSX.writeFile(wb, "نموذج_استيراد_المستفيدين.xlsx");
  showToast("تم تحميل نموذج Excel بنجاح", "success");
};

// فتح/إغلاق قسم المشاريع السابقة
window.togglePrevProjects = function () {
  const body = document.getElementById('prev-projects-body');
  const arrow = document.querySelector('.prev-projects-arrow');
  if (!body) return;
  const isOpen = body.classList.toggle('open');
  if (arrow) arrow.style.transform = isOpen ? 'rotate(180deg)' : 'rotate(0deg)';
};

// تصدير دالة عرض تفاصيل المستفيد لتكون متاحة عالمياً
window.viewBeneficiary = viewBeneficiary;


