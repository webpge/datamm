// ======================================================
// firebase-config.js - إعداد Firebase
// ======================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getFirestore, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-analytics.js";

const firebaseConfig = {
  apiKey: "AIzaSyC-01doMfQqMJDKePlWMBlFt77QXljuqjA",
  authDomain: "datamm-e36ea.firebaseapp.com",
  projectId: "datamm-e36ea",
  storageBucket: "datamm-e36ea.firebasestorage.app",
  messagingSenderId: "670913914393",
  appId: "1:670913914393:web:474e0139fd8386f408ec88",
  measurementId: "G-H9LQJRKQH6"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const analytics = getAnalytics(app);

// تفعيل العمل دون اتصال (Offline Persistence)
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === 'failed-precondition') {
    console.warn('Offline persistence: multiple tabs open');
  } else if (err.code === 'unimplemented') {
    console.warn('Offline persistence not supported');
  }
});

export default app;
