// ======================================================
// matching.js - خوارزميات مكافحة التكرار والمطابقة
// ======================================================

import { BeneficiaryDB } from './db.js';

// ======================================================
// تنظيف وتوحيد البيانات
// ======================================================
export function cleanRecord(record) {
  return {
    fullName: normalizeArabicText(record.fullName || record['الاسم الرباعي'] || record['الاسم'] || ''),
    idNumber: normalizeId(record.idNumber || record['رقم الهوية'] || record['الهوية'] || ''),
    phone: normalizePhone(record.phone || record['رقم الجوال'] || record['الجوال'] || ''),
    familySize: parseInt(record.familySize || record['عدد أفراد الأسرة'] || record['الأسرة'] || 0) || 0,
    campName: normalizeArabicText(record.campName || record['اسم المخيم'] || record['المخيم'] || ''),
  };
}

// تطبيع النص العربي
function normalizeArabicText(text) {
  if (!text) return '';
  return text.toString()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/أ|إ|آ/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\u064B-\u065F]/g, ''); // إزالة التشكيل
}

// تطبيع رقم الهوية
function normalizeId(id) {
  if (!id) return '';
  return id.toString().trim().replace(/[\s\-_.]/g, '');
}

// تطبيع رقم الجوال
function normalizePhone(phone) {
  if (!phone) return '';
  let p = phone.toString().trim().replace(/[\s\-_.+]/g, '');
  // إزالة رمز الدولة السوري +963 أو 00963
  p = p.replace(/^(00963|963|\+963)/, '0');
  // إذا بدأ بـ 9 أضف صفر
  if (/^9\d{8}$/.test(p)) p = '0' + p;
  return p;
}

// ======================================================
// تنظيف مجموعة السجلات
// ======================================================
export function cleanRecords(rawRecords) {
  const result = {
    cleaned: [],
    emptyRows: 0
  };

  rawRecords.forEach(row => {
    const cleaned = cleanRecord(row);
    // تخطي الصفوف الفارغة تماماً
    if (!cleaned.fullName && !cleaned.idNumber && !cleaned.phone) {
      result.emptyRows++;
      return;
    }
    result.cleaned.push(cleaned);
  });

  return result;
}

// ======================================================
// اكتشاف التكرار الداخلي (داخل نفس الملف)
// ======================================================
export function findInternalDuplicates(records) {
  const unique = [];
  const duplicates = [];
  const seenIds = new Map();

  records.forEach((record, idx) => {
    let isDuplicate = false;
    let duplicateOf = null;

    // مطابقة رقم الهوية فقط داخلياً
    if (record.idNumber) {
      if (seenIds.has(record.idNumber)) {
        isDuplicate = true;
        duplicateOf = seenIds.get(record.idNumber);
        duplicates.push({
          ...record,
          reason: 'تكرار داخلي - رقم الهوية',
          duplicateOfIndex: duplicateOf,
          matchField: 'idNumber'
        });
      } else {
        seenIds.set(record.idNumber, idx);
      }
    }

    if (!isDuplicate) {
      unique.push(record);
    }
  });

  return { unique, duplicates };
}

// ======================================================
// المطابقة مع قاعدة البيانات
// المنطق الجديد:
//   - إذا selectedProjectIds فارغة → لا مطابقة مع مشاريع سابقة
//     ولكن إذا كان رقم الهوية موجوداً → أضف استفادة فقط (لا حذف)
//   - إذا selectedProjectIds محددة → تحقق فقط من المستفيدين في تلك المشاريع
// ======================================================
export async function matchWithDatabase(records, selectedProjectIds = []) {
  const newRecords = [];          // سجلات جديدة تُضاف لأول مرة
  const matchedRecords = [];      // سجلات مكررة تُستبعد
  const benefitAdditions = [];    // مستفيدون موجودون → أضف لهم استفادة فقط

  // جلب جميع المستفيدين مرة واحدة
  const allBeneficiaries = await BeneficiaryDB.getAll();

  // بناء خرائط للبحث السريع
  const idMap = new Map();
  const namePhoneMap = new Map();

  allBeneficiaries.forEach(b => {
    if (b.idNumber) idMap.set(b.idNumber, b);
    if (b.fullName && b.phone) {
      namePhoneMap.set(`${b.fullName}__${b.phone}`, b);
    }
  });

  const doCrossMatch = selectedProjectIds.length > 0;

  for (const record of records) {
    let existingBeneficiary = null;
    let matchReason = '';

    // ── مرحلة 1: هل المستفيد موجود أصلاً في قاعدة البيانات؟ ──
    if (record.idNumber && idMap.has(record.idNumber)) {
      existingBeneficiary = idMap.get(record.idNumber);
      matchReason = 'تطابق رقم الهوية';
    } else if (record.fullName && record.phone) {
      const key = `${record.fullName}__${record.phone}`;
      if (namePhoneMap.has(key)) {
        existingBeneficiary = namePhoneMap.get(key);
        matchReason = 'تطابق الاسم ورقم الجوال';
      }
    }

    if (existingBeneficiary) {
      // ── المستفيد موجود ──
      if (doCrossMatch) {
        // هل هو في أحد المشاريع المحددة للمقارنة؟
        const inSelectedProject = (existingBeneficiary.projectIds || [])
          .some(pid => selectedProjectIds.includes(pid));

        if (inSelectedProject) {
          // مكرر حقيقي → استبعاد
          matchedRecords.push({
            ...record,
            existingBeneficiary,
            matchReason,
            reason: `مستفيد سابق - ${matchReason}`,
            previousProjects: existingBeneficiary.projectNames || []
          });
        } else {
          // موجود لكن ليس في المشاريع المحددة → أضف استفادة
          benefitAdditions.push({
            record,
            existingBeneficiary,
            matchReason
          });
        }
      } else {
        // لا مطابقة مع مشاريع سابقة → أضف استفادة للمستفيد الموجود
        benefitAdditions.push({
          record,
          existingBeneficiary,
          matchReason
        });
      }
    } else {
      // مستفيد جديد تماماً
      newRecords.push(record);
    }
  }

  return {
    newRecords,
    matchedRecords,
    benefitAdditions,
    existingBeneficiaries: allBeneficiaries
  };
}

// ======================================================
// Fuzzy Matching (للمستقبل)
// ======================================================
export function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  if (s1 === s2) return 1;

  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  const longerLength = longer.length;

  if (longerLength === 0) return 1;
  return (longerLength - editDistance(longer, shorter)) / longerLength;
}

function editDistance(s1, s2) {
  const costs = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  return costs[s2.length];
}
