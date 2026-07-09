// ======================================================
// db.js - إدارة قاعدة بيانات Firebase Firestore
// ======================================================

import { db } from './firebase-config.js';
import {
  collection, doc, addDoc, setDoc, getDoc, getDocs,
  updateDoc, deleteDoc, query, where, orderBy, limit,
  onSnapshot, serverTimestamp, writeBatch, increment,
  arrayUnion, arrayRemove, Timestamp, startAfter, getCountFromServer
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// ======================================================
// الثوابت - أسماء المجموعات
// ======================================================
export const COLLECTIONS = {
  USERS: 'users',
  PROJECTS: 'projects',
  MAIN_PROJECTS: 'mainProjects',
  BENEFICIARIES: 'beneficiaries',
  BENEFITS: 'benefits',
  DELETED_RECORDS: 'deletedRecords',
  AUDIT_LOG: 'auditLog'
};

// ======================================================
// المستفيدون - Beneficiaries
// ======================================================

export const BeneficiaryDB = {
  // إضافة مستفيد جديد
  async add(data) {
    const docRef = await addDoc(collection(db, COLLECTIONS.BENEFICIARIES), {
      ...data,
      benefitCount: 1,
      projectIds: data.projectIds || [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return docRef.id;
  },

  // إضافة مجموعة مستفيدين دفعة واحدة (باتش) لتسريع العملية
  async addBatch(records) {
    const batch = writeBatch(db);
    const results = [];
    records.forEach(record => {
      // إنشاء مرجع وثيقة جديدة برقم معرّف عشوائي
      const ref = doc(collection(db, COLLECTIONS.BENEFICIARIES));
      batch.set(ref, {
        ...record,
        benefitCount: 1,
        projectIds: record.projectIds || [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      results.push({ tempId: record.tempId, id: ref.id });
    });
    await batch.commit();
    return results;
  },

  // تحديث مستفيد
  async update(id, data) {
    await updateDoc(doc(db, COLLECTIONS.BENEFICIARIES, id), {
      ...data,
      updatedAt: serverTimestamp()
    });
  },

  // حذف مستفيد
  async delete(id) {
    await deleteDoc(doc(db, COLLECTIONS.BENEFICIARIES, id));
  },

  // جلب مستفيد واحد
  async getById(id) {
    const snap = await getDoc(doc(db, COLLECTIONS.BENEFICIARIES, id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },

  // جلب جميع المستفيدين
  async getAll() {
    const snap = await getDocs(
      query(collection(db, COLLECTIONS.BENEFICIARIES), orderBy('createdAt', 'desc'))
    );
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // البحث برقم الهوية
  async findByIdNumber(idNumber) {
    if (!idNumber) return null;
    const q = query(
      collection(db, COLLECTIONS.BENEFICIARIES),
      where('idNumber', '==', idNumber.trim()),
      limit(1)
    );
    const snap = await getDocs(q);
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
  },

  // البحث بالاسم ورقم الجوال
  async findByNameAndPhone(fullName, phone) {
    if (!fullName || !phone) return null;
    const q = query(
      collection(db, COLLECTIONS.BENEFICIARIES),
      where('fullName', '==', fullName.trim()),
      where('phone', '==', phone.trim()),
      limit(1)
    );
    const snap = await getDocs(q);
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
  },

  // البحث النصي المتعدد المعايير
  async search(term) {
    const all = await this.getAll();
    const t = term.toLowerCase().trim();
    return all.filter(b =>
      b.fullName?.toLowerCase().includes(t) ||
      b.idNumber?.includes(t) ||
      b.phone?.includes(t) ||
      b.campName?.toLowerCase().includes(t)
    );
  },

  // إضافة مشروع للمستفيد وتحديث العداد
  async addBenefit(beneficiaryId, projectId, projectName) {
    await updateDoc(doc(db, COLLECTIONS.BENEFICIARIES, beneficiaryId), {
      projectIds: arrayUnion(projectId),
      projectNames: arrayUnion(projectName),
      benefitCount: increment(1),
      lastBenefitDate: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  },

  // تحديث مجموعة مستفيدين بإضافة استفادات دفعة واحدة (باتش)
  async addBenefitBatch(benefitUpdates) {
    const batch = writeBatch(db);
    benefitUpdates.forEach(({ beneficiaryId, projectId, projectName }) => {
      const ref = doc(db, COLLECTIONS.BENEFICIARIES, beneficiaryId);
      batch.update(ref, {
        projectIds: arrayUnion(projectId),
        projectNames: arrayUnion(projectName),
        benefitCount: increment(1),
        lastBenefitDate: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    });
    await batch.commit();
  },

  // إجمالي عدد المستفيدين
  async getCount() {
    const snap = await getCountFromServer(collection(db, COLLECTIONS.BENEFICIARIES));
    return snap.data().count;
  },

  // مراقبة التغييرات في الوقت الفعلي
  onSnapshot(callback) {
    return onSnapshot(
      query(collection(db, COLLECTIONS.BENEFICIARIES), orderBy('createdAt', 'desc')),
      snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
  }
};

// ======================================================
// المشاريع - Projects
// ======================================================

export const ProjectDB = {
  async add(data) {
    const docRef = await addDoc(collection(db, COLLECTIONS.PROJECTS), {
      ...data,
      stats: {
        totalImported: 0,
        internalDuplicates: 0,
        crossProjectDuplicates: 0,
        finalCount: 0
      },
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return docRef.id;
  },

  async update(id, data) {
    await updateDoc(doc(db, COLLECTIONS.PROJECTS, id), {
      ...data,
      updatedAt: serverTimestamp()
    });
  },

  async updateStats(id, stats) {
    await updateDoc(doc(db, COLLECTIONS.PROJECTS, id), {
      stats,
      updatedAt: serverTimestamp()
    });
  },

  async delete(id) {
    // ═══════════════════════════════════════════════
    // حذف شامل: المشروع + الاستفادات + السجلات
    // المحذوفة + تحديث/حذف المستفيدين المرتبطين
    // ═══════════════════════════════════════════════

    // دالة مساعدة: تنفيذ batch بحد أقصى 500 عملية
    const commitChunked = async (ops) => {
      const CHUNK = 490;
      for (let i = 0; i < ops.length; i += CHUNK) {
        const b = writeBatch(db);
        ops.slice(i, i + CHUNK).forEach(fn => fn(b));
        await b.commit();
      }
    };

    // 1. جلب جميع الاستفادات المرتبطة بالمشروع
    const benefitsSnap = await getDocs(
      query(collection(db, COLLECTIONS.BENEFITS), where('projectId', '==', id))
    );

    // 2. جلب جميع السجلات المحذوفة المرتبطة بالمشروع
    const deletedSnap = await getDocs(
      query(collection(db, COLLECTIONS.DELETED_RECORDS), where('projectId', '==', id))
    );

    // 3. جلب جميع المستفيدين المرتبطين بالمشروع
    const beneficiariesSnap = await getDocs(
      query(collection(db, COLLECTIONS.BENEFICIARIES), where('projectIds', 'array-contains', id))
    );

    // تجميع كل العمليات
    const ops = [];

    // حذف سجلات الاستفادة
    benefitsSnap.docs.forEach(d => ops.push(b => b.delete(d.ref)));

    // حذف السجلات المحذوفة المرتبطة
    deletedSnap.docs.forEach(d => ops.push(b => b.delete(d.ref)));

    // معالجة المستفيدين
    beneficiariesSnap.docs.forEach(d => {
      const data = d.data();
      const otherProjectIds = (data.projectIds || []).filter(pid => pid !== id);

      if (otherProjectIds.length === 0) {
        // المستفيد خاص بهذا المشروع فقط → حذف نهائي
        ops.push(b => b.delete(d.ref));
      } else {
        // المستفيد له مشاريع أخرى → إزالة هذا المشروع من بياناته فقط
        const projectName = (data.projectNames || []).find(
          (_, idx) => (data.projectIds || [])[idx] === id
        );
        const updatedNames = (data.projectNames || []).filter(n => n !== projectName);
        ops.push(b => b.update(d.ref, {
          projectIds: otherProjectIds,
          projectNames: updatedNames,
          benefitCount: Math.max(1, (data.benefitCount || 1) - 1),
          updatedAt: serverTimestamp()
        }));
      }
    });

    // حذف وثيقة المشروع نفسه
    ops.push(b => b.delete(doc(db, COLLECTIONS.PROJECTS, id)));

    // تنفيذ جميع العمليات على دفعات
    await commitChunked(ops);
  },


  async getById(id) {
    const snap = await getDoc(doc(db, COLLECTIONS.PROJECTS, id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },

  async getAll() {
    const snap = await getDocs(
      query(collection(db, COLLECTIONS.PROJECTS), orderBy('createdAt', 'desc'))
    );
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async getCount() {
    const snap = await getCountFromServer(collection(db, COLLECTIONS.PROJECTS));
    return snap.data().count;
  },

  onSnapshot(callback) {
    return onSnapshot(
      query(collection(db, COLLECTIONS.PROJECTS), orderBy('createdAt', 'desc')),
      snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
  }
};

// ======================================================
// الاستفادات - Benefits
// ======================================================

export const BenefitDB = {
  async add(data) {
    const docRef = await addDoc(collection(db, COLLECTIONS.BENEFITS), {
      ...data,
      createdAt: serverTimestamp()
    });
    return docRef.id;
  },

  async addBatch(records) {
    const batch = writeBatch(db);
    const refs = [];
    records.forEach(record => {
      const ref = doc(collection(db, COLLECTIONS.BENEFITS));
      batch.set(ref, { ...record, createdAt: serverTimestamp() });
      refs.push(ref.id);
    });
    await batch.commit();
    return refs;
  },

  async getByBeneficiary(beneficiaryId) {
    const q = query(
      collection(db, COLLECTIONS.BENEFITS),
      where('beneficiaryId', '==', beneficiaryId)
    );
    const snap = await getDocs(q);
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Client-side sort to avoid Firestore index requirement
    return docs.sort((a, b) => {
      const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt || 0).getTime();
      const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt || 0).getTime();
      return timeB - timeA;
    });
  },

  async getByProject(projectId) {
    const q = query(
      collection(db, COLLECTIONS.BENEFITS),
      where('projectId', '==', projectId)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async getCount() {
    const snap = await getCountFromServer(collection(db, COLLECTIONS.BENEFITS));
    return snap.data().count;
  },

  async deleteByProject(projectId) {
    const snap = await getDocs(
      query(collection(db, COLLECTIONS.BENEFITS), where('projectId', '==', projectId))
    );
    const batch = writeBatch(db);
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  },

  async getBenefitAdditions() {
    const q = query(
      collection(db, COLLECTIONS.BENEFITS),
      where('isBenefitAddition', '==', true)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
};

// ======================================================
// السجلات المحذوفة - Deleted Records
// ======================================================

export const DeletedRecordDB = {
  async addBatch(records) {
    const batch = writeBatch(db);
    records.forEach(record => {
      const ref = doc(collection(db, COLLECTIONS.DELETED_RECORDS));
      batch.set(ref, { ...record, deletedAt: serverTimestamp() });
    });
    await batch.commit();
  },

  async getByProject(projectId) {
    const q = query(
      collection(db, COLLECTIONS.DELETED_RECORDS),
      where('projectId', '==', projectId)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async getAll() {
    const snap = await getDocs(
      query(collection(db, COLLECTIONS.DELETED_RECORDS), orderBy('deletedAt', 'desc'))
    );
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async getCount() {
    const snap = await getCountFromServer(collection(db, COLLECTIONS.DELETED_RECORDS));
    return snap.data().count;
  }
};

// ======================================================
// سجل العمليات - Audit Log
// ======================================================

export const AuditDB = {
  async log(action, entityType, entityId, userId, userEmail, details = {}) {
    await addDoc(collection(db, COLLECTIONS.AUDIT_LOG), {
      action,
      entityType,
      entityId,
      userId,
      userEmail,
      details,
      timestamp: serverTimestamp()
    });
  },

  async getAll(lim = 100) {
    const snap = await getDocs(
      query(collection(db, COLLECTIONS.AUDIT_LOG), orderBy('timestamp', 'desc'), limit(lim))
    );
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  onSnapshot(callback) {
    return onSnapshot(
      query(collection(db, COLLECTIONS.AUDIT_LOG), orderBy('timestamp', 'desc'), limit(50)),
      snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
  }
};

// ======================================================
// المستخدمون - Users
// ======================================================

export const UserDB = {
  async create(uid, data) {
    await setDoc(doc(db, COLLECTIONS.USERS, uid), {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  },

  async getById(uid) {
    const snap = await getDoc(doc(db, COLLECTIONS.USERS, uid));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },

  async getAll() {
    const snap = await getDocs(
      query(collection(db, COLLECTIONS.USERS), orderBy('createdAt', 'desc'))
    );
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async update(uid, data) {
    await updateDoc(doc(db, COLLECTIONS.USERS, uid), {
      ...data,
      updatedAt: serverTimestamp()
    });
  },

  async delete(uid) {
    await deleteDoc(doc(db, COLLECTIONS.USERS, uid));
  }
};

// ======================================================
// الإحصائيات العامة
// ======================================================

export const StatsDB = {
  async getDashboardStats() {
    const [beneficiariesCount, projectsCount, benefitsCount, deletedCount] = await Promise.all([
      BeneficiaryDB.getCount(),
      MainProjectDB.getCount(),
      BenefitDB.getCount(),
      DeletedRecordDB.getCount()
    ]);

    return {
      beneficiariesCount,
      projectsCount,
      benefitsCount,
      deletedCount
    };
  }
};

// ======================================================
// المشاريع الرئيسية - Main Projects (Parent)
// ======================================================
export const MainProjectDB = {
  async add(data) {
    const docRef = await addDoc(collection(db, COLLECTIONS.MAIN_PROJECTS), {
      name: data.name,
      description: data.description || '',
      createdBy: data.createdBy || 'unknown',
      createdByName: data.createdByName || 'غير معروف',
      subFilesCount: 0,
      totalBeneficiaries: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return docRef.id;
  },

  async update(id, data) {
    await updateDoc(doc(db, COLLECTIONS.MAIN_PROJECTS, id), {
      ...data,
      updatedAt: serverTimestamp()
    });
  },

  async delete(id) {
    // حذف المشروع الرئيسي فقط (الملفات الفرعية تُدار بشكل مستقل)
    await deleteDoc(doc(db, COLLECTIONS.MAIN_PROJECTS, id));
  },

  async getById(id) {
    const snap = await getDoc(doc(db, COLLECTIONS.MAIN_PROJECTS, id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },

  async getAll() {
    const snap = await getDocs(
      query(collection(db, COLLECTIONS.MAIN_PROJECTS), orderBy('createdAt', 'desc'))
    );
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async getCount() {
    const snap = await getCountFromServer(collection(db, COLLECTIONS.MAIN_PROJECTS));
    return snap.data().count;
  },

  // تحديث إحصائيات المشروع الرئيسي بعد رفع ملف فرعي
  async incrementStats(id, delta) {
    await updateDoc(doc(db, COLLECTIONS.MAIN_PROJECTS, id), {
      subFilesCount: increment(delta.subFilesCount || 0),
      totalBeneficiaries: increment(delta.totalBeneficiaries || 0),
      updatedAt: serverTimestamp()
    });
  }
};
