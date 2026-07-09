// ======================================================
// auth.js - نظام المصادقة والصلاحيات
// ======================================================

import { auth } from './firebase-config.js';
import { UserDB, AuditDB } from './db.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

// ======================================================
// الأدوار والصلاحيات
// ======================================================
export const ROLES = {
  ADMIN: 'admin',
  SUPERVISOR: 'supervisor',
  USER: 'user'
};

export const ROLE_LABELS = {
  admin: 'مدير النظام',
  supervisor: 'مشرف المشاريع',
  user: 'مستخدم عادي'
};

export const PERMISSIONS = {
  admin: {
    canAdd: true, canEdit: true, canDelete: true,
    canExport: true, canManageUsers: true, canImport: true,
    canViewAudit: true, canBackup: true
  },
  supervisor: {
    canAdd: true, canEdit: true, canDelete: false,
    canExport: true, canManageUsers: false, canImport: true,
    canViewAudit: true, canBackup: false
  },
  user: {
    canAdd: false, canEdit: false, canDelete: false,
    canExport: true, canManageUsers: false, canImport: false,
    canViewAudit: false, canBackup: false
  }
};

// ======================================================
// حالة المستخدم الحالي
// ======================================================
export let currentUser = null;
export let currentUserData = null;

// ======================================================
// تسجيل الدخول
// ======================================================
export async function login(email, password) {
  try {
    const userCred = await signInWithEmailAndPassword(auth, email, password);
    let userData = await UserDB.getById(userCred.user.uid);
    
    // إذا نجح تسجيل الدخول ولم يكن هناك مستند في Firestore، يعتبر هذا هو مدير النظام الرئيسي
    // لأنه تم تسجيله فقط من داخل Firebase Authentication Console.
    if (!userData) {
      try {
        await UserDB.create(userCred.user.uid, {
          name: 'مدير النظام الرئيسي',
          email: email,
          role: 'admin',
          isActive: true,
          createdBy: 'firebase-console'
        });
        userData = await UserDB.getById(userCred.user.uid);
      } catch (err) {
        console.warn('Failed to auto-create Firestore user doc for Super Admin:', err);
        // Fallback في الذاكرة لتجنب التوقف
        userData = {
          name: 'مدير النظام الرئيسي',
          email: email,
          role: 'admin',
          isActive: true,
          isSuperAdmin: true
        };
      }
    }
    
    if (!userData.isActive) throw new Error('هذا الحساب معطل. تواصل مع مدير النظام');
    currentUser = userCred.user;
    currentUserData = userData;

    await AuditDB.log('LOGIN', 'user', userCred.user.uid, userCred.user.uid, email, {
      message: 'تسجيل دخول ناجح'
    });

    return { user: userCred.user, userData };
  } catch (error) {
    throw translateAuthError(error);
  }
}

// ======================================================
// تسجيل الخروج
// ======================================================
export async function logout() {
  if (currentUser) {
    await AuditDB.log('LOGOUT', 'user', currentUser.uid, currentUser.uid,
      currentUser.email, { message: 'تسجيل خروج' });
  }
  await signOut(auth);
  currentUser = null;
  currentUserData = null;
}

// ======================================================
// إنشاء مستخدم جديد
// ======================================================
export async function createUser(email, password, name, role) {
  if (!hasPermission('canManageUsers')) throw new Error('ليس لديك صلاحية إضافة مستخدمين');
  try {
    const userCred = await createUserWithEmailAndPassword(auth, email, password);
    await UserDB.create(userCred.user.uid, {
      name, email, role, isActive: true,
      createdBy: currentUser?.uid || 'system'
    });
    await AuditDB.log('CREATE_USER', 'user', userCred.user.uid,
      currentUser?.uid, currentUser?.email, { name, email, role });
    return userCred.user;
  } catch (error) {
    throw translateAuthError(error);
  }
}

// ======================================================
// مراقبة حالة المصادقة
// ======================================================
export function initAuth(onLogin, onLogout) {
  return onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      let userData = await UserDB.getById(user.uid);
      if (!userData) {
        try {
          await UserDB.create(user.uid, {
            name: 'مدير النظام الرئيسي',
            email: user.email,
            role: 'admin',
            isActive: true,
            createdBy: 'firebase-console'
          });
          userData = await UserDB.getById(user.uid);
        } catch (err) {
          console.warn('Failed to auto-create user doc in initAuth:', err);
          userData = {
            name: 'مدير النظام الرئيسي',
            email: user.email,
            role: 'admin',
            isActive: true,
            isSuperAdmin: true
          };
        }
      }
      currentUserData = userData;
      onLogin(user, currentUserData);
    } else {
      currentUser = null;
      currentUserData = null;
      onLogout();
    }
  });
}

// ======================================================
// التحقق من الصلاحيات
// ======================================================
export function hasPermission(permission) {
  if (!currentUserData) return false;
  const role = currentUserData.role || ROLES.USER;
  return PERMISSIONS[role]?.[permission] || false;
}

export function requirePermission(permission) {
  if (!hasPermission(permission)) {
    throw new Error('ليس لديك صلاحية للقيام بهذه العملية');
  }
}

// ======================================================
// تغيير كلمة المرور
// ======================================================
export async function changePassword(currentPassword, newPassword) {
  if (!currentUser) throw new Error('يجب تسجيل الدخول أولاً');
  const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
  await reauthenticateWithCredential(currentUser, credential);
  await updatePassword(currentUser, newPassword);
  await AuditDB.log('CHANGE_PASSWORD', 'user', currentUser.uid,
    currentUser.uid, currentUser.email, {});
}

// ======================================================
// ترجمة أخطاء Firebase Auth
// ======================================================
function translateAuthError(error) {
  const messages = {
    'auth/user-not-found': 'البريد الإلكتروني غير مسجل',
    'auth/wrong-password': 'كلمة المرور غير صحيحة',
    'auth/invalid-credential': 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
    'auth/email-already-in-use': 'البريد الإلكتروني مستخدم مسبقاً',
    'auth/weak-password': 'كلمة المرور ضعيفة (6 أحرف على الأقل)',
    'auth/invalid-email': 'صيغة البريد الإلكتروني غير صحيحة',
    'auth/too-many-requests': 'تم تجاوز عدد المحاولات المسموح. حاول لاحقاً'
  };
  const msg = messages[error.code] || error.message;
  return new Error(msg);
}
