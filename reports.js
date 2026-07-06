// ======================================================
// reports.js - تصدير التقارير (Excel + PDF)
// ======================================================

import { BeneficiaryDB, ProjectDB, BenefitDB, DeletedRecordDB } from './db.js';

// ======================================================
// تصدير Excel
// ======================================================
export const ExcelExport = {

  // تصدير جميع المستفيدين
  async exportAllBeneficiaries() {
    const data = await BeneficiaryDB.getAll();
    const rows = data.map((b, i) => ({
      '#': i + 1,
      'الاسم الرباعي': b.fullName || '',
      'رقم الهوية': b.idNumber || '',
      'رقم الجوال': b.phone || '',
      'عدد أفراد الأسرة': b.familySize || '',
      'اسم المخيم': b.campName || '',
      'عدد مرات الاستفادة': b.benefitCount || 0,
      'المشاريع': (b.projectNames || []).join(' | '),
      'تاريخ أول استفادة': formatDate(b.firstBenefitDate),
      'تاريخ آخر استفادة': formatDate(b.lastBenefitDate)
    }));
    downloadExcel(rows, 'جميع_المستفيدين');
  },

  // تصدير بيانات مشروع
  async exportProject(projectId, projectName) {
    const benefits = await BenefitDB.getByProject(projectId);
    
    // فرز البيانات في المتصفح لتجنب الحاجة لفهرس مركب
    benefits.sort((a, b) => {
      const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt);
      const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
      return dateB - dateA;
    });

    const rows = benefits.map((b, i) => ({
      '#': i + 1,
      'الاسم الرباعي': b.record?.fullName || '',
      'رقم الهوية': b.record?.idNumber || '',
      'رقم الجوال': b.record?.phone || '',
      'عدد أفراد الأسرة': b.record?.familySize || '',
      'اسم المخيم': b.record?.campName || '',
      'تاريخ الاستفادة': formatDate(b.createdAt)
    }));
    downloadExcel(rows, `مشروع_${projectName}`);
  },

  // تصدير السجلات المحذوفة لمشروع محدد أو لجميع المشاريع
  async exportDeleted(projectId = null) {
    const data = projectId
      ? await DeletedRecordDB.getByProject(projectId)
      : await DeletedRecordDB.getAll();

    // فرز برمجياً لتجنب الحاجة لفهرس مركب
    data.sort((a, b) => {
      const dateA = a.deletedAt?.toDate ? a.deletedAt.toDate() : new Date(a.deletedAt);
      const dateB = b.deletedAt?.toDate ? b.deletedAt.toDate() : new Date(b.deletedAt);
      return dateB - dateA;
    });

    const rows = data.map((r, i) => ({
      '#': i + 1,
      'الاسم': r.fullName || '',
      'رقم الهوية': r.idNumber || '',
      'رقم الجوال': r.phone || '',
      'المشروع': r.projectName || '',
      'سبب الحذف': r.reason || '',
      'المشاريع السابقة': (r.previousProjects || []).join(' | '),
      'تاريخ الحذف': formatDate(r.deletedAt)
    }));
    downloadExcel(rows, 'السجلات_المحذوفة');
  },

  // تقرير الاستفادات لكل مستفيد
  async exportBenefitsSummary() {
    const data = await BeneficiaryDB.getAll();
    const rows = data
      .filter(b => b.benefitCount > 1)
      .sort((a, b) => (b.benefitCount || 0) - (a.benefitCount || 0))
      .map((b, i) => ({
        '#': i + 1,
        'الاسم': b.fullName || '',
        'رقم الهوية': b.idNumber || '',
        'عدد الاستفادات': b.benefitCount || 0,
        'المشاريع': (b.projectNames || []).join(' | ')
      }));
    downloadExcel(rows, 'تقرير_الاستفادات');
  }
};

// ======================================================
// تصدير PDF
// ======================================================
export const PDFExport = {

  async exportAllBeneficiaries() {
    const data = await BeneficiaryDB.getAll();
    const columns = [
      { header: '#', dataKey: 'index' },
      { header: 'الاسم', dataKey: 'fullName' },
      { header: 'رقم الهوية', dataKey: 'idNumber' },
      { header: 'رقم الجوال', dataKey: 'phone' },
      { header: 'المخيم', dataKey: 'campName' },
      { header: 'الاستفادات', dataKey: 'benefitCount' },
    ];
    const rows = data.map((b, i) => ({
      index: i + 1,
      fullName: b.fullName || '',
      idNumber: b.idNumber || '',
      phone: b.phone || '',
      campName: b.campName || '',
      benefitCount: b.benefitCount || 0
    }));
    downloadPDF('جميع المستفيدين', columns, rows);
  },

  async exportProject(projectId, projectName) {
    const benefits = await BenefitDB.getByProject(projectId);
    const columns = [
      { header: '#', dataKey: 'index' },
      { header: 'الاسم', dataKey: 'fullName' },
      { header: 'رقم الهوية', dataKey: 'idNumber' },
      { header: 'رقم الجوال', dataKey: 'phone' },
      { header: 'المخيم', dataKey: 'campName' },
    ];
    const rows = benefits.map((b, i) => ({
      index: i + 1,
      fullName: b.record?.fullName || '',
      idNumber: b.record?.idNumber || '',
      phone: b.record?.phone || '',
      campName: b.record?.campName || ''
    }));
    downloadPDF(`مشروع: ${projectName}`, columns, rows);
  }
};

// ======================================================
// دوال مساعدة
// ======================================================
function downloadExcel(rows, filename) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'البيانات');

  // ضبط عرض الأعمدة تلقائياً
  const colWidths = Object.keys(rows[0] || {}).map(key => ({
    wch: Math.max(key.length, ...rows.slice(0, 100).map(r => String(r[key] || '').length))
  }));
  ws['!cols'] = colWidths;

  XLSX.writeFile(wb, `${filename}_${formatDateFilename()}.xlsx`);
}

function downloadPDF(title, columns, rows) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  doc.setFont('helvetica');
  doc.text(title, doc.internal.pageSize.width / 2, 15, { align: 'center' });
  doc.text(`تاريخ التقرير: ${new Date().toLocaleDateString('ar-SA')}`, 10, 25);

  doc.autoTable({
    columns,
    body: rows,
    startY: 30,
    styles: { font: 'helvetica', fontSize: 9, halign: 'right' },
    headStyles: { fillColor: [30, 58, 138], textColor: 255 },
    alternateRowStyles: { fillColor: [241, 245, 249] }
  });

  doc.save(`${title}_${formatDateFilename()}.pdf`);
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return d.toLocaleDateString('ar-SA');
}

function formatDateFilename() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
}
