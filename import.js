// ======================================================
// import.js - استيراد ملفات Excel ومعالجة البيانات
// ======================================================

import { cleanRecords, findInternalDuplicates, matchWithDatabase } from './matching.js';
import { BeneficiaryDB, BenefitDB, DeletedRecordDB, ProjectDB, AuditDB } from './db.js';
import { currentUser, currentUserData } from './auth.js';

// ======================================================
// قراءة ملف Excel وتحويله إلى مصفوفة
// ======================================================
export async function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet, {
          header: 0,
          defval: '',
          blankrows: false
        });
        resolve(jsonData);
      } catch (err) {
        reject(new Error('فشل في قراءة ملف Excel. تأكد من صيغة الملف (xlsx, xls)'));
      }
    };
    reader.onerror = () => reject(new Error('فشل في قراءة الملف'));
    reader.readAsArrayBuffer(file);
  });
}

// ======================================================
// الخطوة 1: تنظيف البيانات
// ======================================================
export async function processStep1_Clean(rawRecords) {
  const { cleaned, emptyRows } = cleanRecords(rawRecords);
  return {
    cleaned,
    stats: {
      total: rawRecords.length,
      emptyRows,
      afterClean: cleaned.length
    }
  };
}

// ======================================================
// الخطوة 2: اكتشاف التكرار الداخلي
// ======================================================
export async function processStep2_InternalDuplicates(cleanedRecords) {
  const { unique, duplicates } = findInternalDuplicates(cleanedRecords);
  return {
    unique,
    internalDuplicates: duplicates,
    stats: {
      total: cleanedRecords.length,
      duplicates: duplicates.length,
      unique: unique.length
    }
  };
}

// ======================================================
// الخطوة 3: المطابقة مع قاعدة البيانات
// selectedProjectIds: قائمة المشاريع المحددة للمقارنة
// إذا كانت فارغة → لا مطابقة، فقط إضافة استفادات للموجودين
// ======================================================
export async function processStep3_CrossMatch(uniqueRecords, selectedProjectIds = []) {
  const { newRecords, matchedRecords, benefitAdditions } =
    await matchWithDatabase(uniqueRecords, selectedProjectIds);

  return {
    newRecords,
    crossDuplicates: matchedRecords,
    benefitAdditions,
    stats: {
      total: uniqueRecords.length,
      crossDuplicates: matchedRecords.length,
      benefitAdditions: benefitAdditions.length,
      newRecords: newRecords.length
    }
  };
}

// ======================================================
// الخطوة 4: حفظ البيانات في Firebase
// ======================================================
export async function processStep4_Save(
  projectId, projectName,
  newRecords, internalDuplicates, crossDuplicates, benefitAdditions,
  totalStats,
  onProgress,
  mainProjectId = null,
  mainProjectName = null
) {
  // ─── 4.1 حفظ السجلات المحذوفة (داخلية + متقاطعة) ───
  const allDeleted = [
    ...internalDuplicates.map(r => ({
      ...r,
      projectId,
      projectName,
      mainProjectId,
      mainProjectName,
      deletionType: 'internal',
      importedBy: currentUser?.uid || 'unknown',
      importedByName: currentUserData?.name || 'غير معروف'
    })),
    ...crossDuplicates.map(r => ({
      ...r,
      projectId,
      projectName,
      mainProjectId,
      mainProjectName,
      deletionType: 'cross',
      importedBy: currentUser?.uid || 'unknown',
      importedByName: currentUserData?.name || 'غير معروف'
    }))
  ];

  const BATCH_LIMIT = 400;

  if (allDeleted.length > 0) {
    onProgress?.({ step: 5, message: `جاري حفظ السجلات المستبعدة (${allDeleted.length})...`, percent: 82 });
    for (let i = 0; i < allDeleted.length; i += BATCH_LIMIT) {
      await DeletedRecordDB.addBatch(allDeleted.slice(i, i + BATCH_LIMIT));
      // السماح للمتصفح بالتحديث ومنع التعليق
      await new Promise(r => setTimeout(r, 10));
    }
  }

  // ─── 4.2 إضافة استفادات للمستفيدين الموجودين (معالجة بالـ Batch) ───
  const addedBenefitRecords = [];
  const benefitUpdates = [];

  for (const { record, existingBeneficiary, matchReason } of benefitAdditions) {
    benefitUpdates.push({
      beneficiaryId: existingBeneficiary.id,
      projectId,
      projectName,
      mainProjectId,
      mainProjectName
    });

    addedBenefitRecords.push({
      beneficiaryId: existingBeneficiary.id,
      projectId,
      projectName,
      mainProjectId,
      mainProjectName,
      record,
      matchReason,
      previousProjects: existingBeneficiary.projectNames || [],
      isBenefitAddition: true,
      importedBy: currentUser?.uid || 'unknown',
      importedByName: currentUserData?.name || 'غير معروف'
    });
  }

  // تحديث المستفيدين الموجودين على دفعات متتالية مع تحديث مؤشر الحفظ
  if (benefitUpdates.length > 0) {
    for (let i = 0; i < benefitUpdates.length; i += BATCH_LIMIT) {
      const pct = Math.floor(82 + (i / benefitUpdates.length) * 8);
      onProgress?.({
        step: 5,
        message: `جاري ربط المستفيدين السابقين بالمشروع (${i}/${benefitUpdates.length})...`,
        percent: pct
      });
      await BeneficiaryDB.addBenefitBatch(benefitUpdates.slice(i, i + BATCH_LIMIT));
      await new Promise(r => setTimeout(r, 10));
    }
  }

  // حفظ سجلات الاستفادة للمستفيدين المحدّثين
  if (addedBenefitRecords.length > 0) {
    for (let i = 0; i < addedBenefitRecords.length; i += BATCH_LIMIT) {
      await BenefitDB.addBatch(addedBenefitRecords.slice(i, i + BATCH_LIMIT));
      await new Promise(r => setTimeout(r, 10));
    }
  }

  // ─── 4.3 حفظ المستفيدين الجدد وسجلات استفاداتهم ───
  let savedCount = 0;
  const benefitRecords = [];

  if (newRecords.length > 0) {
    const newRecordsWithTempId = newRecords.map((r, index) => ({
      ...r,
      tempId: `temp_${index}`,
      projectIds: [projectId],
      projectNames: [projectName],
      mainProjectIds: mainProjectId ? [mainProjectId] : [],
      mainProjectNames: mainProjectName ? [mainProjectName] : [],
      firstBenefitDate: new Date(),
      lastBenefitDate: new Date(),
      importedBy: currentUser?.uid || 'unknown',
      importedByName: currentUserData?.name || 'غير معروف'
    }));

    // إضافة المستفيدين الجدد على دفعات متتابعة مع إتاحة المجال للمتصفح للتنفس وتحديث شريط المعالجة
    const results = [];
    for (let i = 0; i < newRecordsWithTempId.length; i += BATCH_LIMIT) {
      const pct = Math.floor(90 + (i / newRecordsWithTempId.length) * 8);
      onProgress?.({
        step: 5,
        message: `جاري حفظ المستفيدين الجدد (${i}/${newRecordsWithTempId.length})...`,
        percent: pct
      });
      const batchRes = await BeneficiaryDB.addBatch(newRecordsWithTempId.slice(i, i + BATCH_LIMIT));
      results.push(...batchRes);
      await new Promise(r => setTimeout(r, 10));
    }
    
    const idMap = new Map(results.map(res => [res.tempId, res.id]));

    // بناء سجلات الاستفادة
    newRecordsWithTempId.forEach(record => {
      const beneficiaryId = idMap.get(record.tempId);
      benefitRecords.push({
        beneficiaryId,
        projectId,
        projectName,
        mainProjectId,
        mainProjectName,
        record,
        importedBy: currentUser?.uid || 'unknown',
        importedByName: currentUserData?.name || 'غير معروف'
      });
      savedCount++;
    });

    // حفظ سجلات الاستفادة
    if (benefitRecords.length > 0) {
      for (let i = 0; i < benefitRecords.length; i += BATCH_LIMIT) {
        await BenefitDB.addBatch(benefitRecords.slice(i, i + BATCH_LIMIT));
        await new Promise(r => setTimeout(r, 10));
      }
    }
  }

  // ─── 4.4 تحديث إحصائيات المشروع ───
  await ProjectDB.updateStats(projectId, {
    totalImported: totalStats.totalImported,
    emptyRows: totalStats.emptyRows,
    internalDuplicates: totalStats.internalDuplicates,
    crossProjectDuplicates: totalStats.crossProjectDuplicates,
    benefitAdditions: totalStats.benefitAdditions,
    finalCount: savedCount
  });

  // ─── 4.5 تسجيل في سجل العمليات ───
  await AuditDB.log('IMPORT_PROJECT', 'project', projectId,
    currentUser?.uid, currentUser?.email, {
      projectName,
      totalImported: totalStats.totalImported,
      savedCount,
      benefitAdditions: benefitAdditions.length,
      deletedCount: allDeleted.length
    }
  );

  return {
    savedCount,
    deletedCount: allDeleted.length,
    benefitAdditionsCount: benefitAdditions.length
  };
}

// ======================================================
// الدالة الرئيسية للاستيراد الكامل
// selectedProjectIds: المشاريع المحددة للمقارنة (فارغة = لا مقارنة)
// ======================================================
export async function importProject(projectId, projectName, file, onProgress, selectedProjectIds = [], mainProjectId = null, mainProjectName = null) {
  onProgress?.({ step: 1, message: 'جاري قراءة ملف Excel...', percent: 10 });

  // 1. قراءة الملف
  const rawRecords = await parseExcelFile(file);

  onProgress?.({ step: 2, message: 'جاري تنظيف البيانات...', percent: 25 });

  // 2. تنظيف البيانات
  const step1 = await processStep1_Clean(rawRecords);

  onProgress?.({ step: 3, message: 'جاري اكتشاف التكرارات الداخلية...', percent: 40 });

  // 3. اكتشاف التكرار الداخلي
  const step2 = await processStep2_InternalDuplicates(step1.cleaned);

  const crossMatchMsg = selectedProjectIds.length > 0
    ? `جاري المطابقة مع ${selectedProjectIds.length} مشروع محدد...`
    : 'جاري التحقق من المستفيدين الموجودين...';
  onProgress?.({ step: 4, message: crossMatchMsg, percent: 60 });

  // 4. المطابقة مع قاعدة البيانات (بحسب المشاريع المحددة)
  const step3 = await processStep3_CrossMatch(step2.unique, selectedProjectIds);

  onProgress?.({ step: 5, message: 'جاري حفظ البيانات...', percent: 80 });

  // 5. حفظ البيانات
  const totalStats = {
    totalImported: rawRecords.length,
    emptyRows: step1.stats.emptyRows,
    internalDuplicates: step2.stats.duplicates,
    crossProjectDuplicates: step3.stats.crossDuplicates,
    benefitAdditions: step3.stats.benefitAdditions,
    finalCount: step3.stats.newRecords
  };

  const result = await processStep4_Save(
    projectId, projectName,
    step3.newRecords,
    step2.internalDuplicates,
    step3.crossDuplicates,
    step3.benefitAdditions,
    totalStats,
    onProgress,
    mainProjectId,
    mainProjectName
  );

  onProgress?.({ step: 6, message: 'اكتمل الاستيراد بنجاح!', percent: 100 });

  return {
    success: true,
    stats: {
      totalImported: rawRecords.length,
      emptyRows: step1.stats.emptyRows,
      afterClean: step1.stats.afterClean,
      internalDuplicates: step2.stats.duplicates,
      afterDedup: step2.stats.unique,
      crossDuplicates: step3.stats.crossDuplicates,
      benefitAdditions: step3.stats.benefitAdditions,
      finalCount: result.savedCount
    },
    samples: {
      internalDuplicates: step2.internalDuplicates.slice(0, 10),
      crossDuplicates: step3.crossDuplicates.slice(0, 10),
      benefitAdditions: step3.benefitAdditions.slice(0, 5),
      newRecords: step3.newRecords.slice(0, 5),
      // القوائم الكاملة للأخطاء (لتنزيل ملف أخطاء المشروع)
      _internalDuplicatesFull: step2.internalDuplicates,
      _crossDuplicatesFull: step3.crossDuplicates
    },
    projectId,
    projectName
  };
}

// ======================================================
// تصدير ملف أخطاء مخصص لهذا المشروع
// ======================================================
export function exportProjectErrors(projectName, internalDuplicates, crossDuplicates) {
  const allErrors = [
    ...internalDuplicates.map(r => ({
      'الاسم الرباعي': r.fullName || '',
      'رقم الهوية': r.idNumber || '',
      'رقم الجوال': r.phone || '',
      'عدد أفراد الأسرة': r.familySize || '',
      'اسم المخيم': r.campName || '',
      'نوع الخطأ': 'تكرار داخلي في الملف',
      'سبب الحذف': r.reason || 'تكرار داخلي',
      'مكان التكرار/المشاريع السابقة': r.duplicateOfIndex !== undefined ? `مكرر مع الصف رقم ${r.duplicateOfIndex + 2}` : 'داخل نفس الملف'
    })),
    ...crossDuplicates.map(r => ({
      'الاسم الرباعي': r.fullName || '',
      'رقم الهوية': r.idNumber || '',
      'رقم الجوال': r.phone || '',
      'عدد أفراد الأسرة': r.familySize || '',
      'اسم المخيم': r.campName || '',
      'نوع الخطأ': 'مستفيد موجود في مشاريع سابقة',
      'سبب الحذف': r.reason || r.matchReason || 'تطابق مع مشروع سابق',
      'مكان التكرار/المشاريع السابقة': (r.previousProjects || []).join(' | ') || 'غير متوفر'
    }))
  ];

  if (allErrors.length === 0) {
    return false; // لا توجد أخطاء
  }

  const ws = XLSX.utils.json_to_sheet(allErrors);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'السجلات المستبعدة');

  // ضبط عرض الأعمدة
  ws['!cols'] = [
    { wch: 30 }, { wch: 18 }, { wch: 18 },
    { wch: 15 }, { wch: 20 }, { wch: 28 },
    { wch: 35 }, { wch: 35 }
  ];

  const date = new Date();
  const dateStr = `${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()}`;
  const safeName = projectName.replace(/[\\/:*?"<>|]/g, '_');
  XLSX.writeFile(wb, `أخطاء_${safeName}_${dateStr}.xlsx`);

  return true;
}
