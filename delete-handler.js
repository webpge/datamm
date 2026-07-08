/**
 * معالج حذف المشاريع مع جميع البيانات المرتبطة
 */

async function deleteProject(projectId) {
  const confirmed = await showConfirmDialog(
    'حذف المشروع',
    'هل تريد حذف هذا المشروع بشكل نهائي؟<br/><strong style="color:var(--accent-red)">سيتم حذف جميع المستفيدين والاستفادات المرتبطة بهذا المشروع من قاعدة البيانات.</strong>',
    'حذف نهائي',
    'إلغاء'
  );

  if (!confirmed) return false;

  try {
    const db = await getDatabase();
    const tx = db.transaction(['projects', 'beneficiaries', 'benefits', 'deletedRecords'], 'readwrite');

    // 1. جلب المشروع
    const projectStore = tx.objectStore('projects');
    const projectRequest = projectStore.get(projectId);

    projectRequest.onsuccess = () => {
      const project = projectRequest.result;
      if (!project) return;

      // 2. جلب جميع مستفيدي المشروع
      const beneficiaryStore = tx.objectStore('beneficiaries');
      const beneficiaryIndex = beneficiaryStore.index('projects');
      const beneficiariesRequest = beneficiaryIndex.getAll(projectId);

      beneficiariesRequest.onsuccess = () => {
        const beneficiaries = beneficiariesRequest.result;

        // 3. حذف الاستفادات المرتبطة
        const benefitStore = tx.objectStore('benefits');
        beneficiaries.forEach(beneficiary => {
          const benefitIndex = benefitStore.index('beneficiaryId');
          const benefitsRequest = benefitIndex.getAll(beneficiary.id);
          
          benefitsRequest.onsuccess = () => {
            benefitsRequest.result.forEach(benefit => {
              benefitStore.delete(benefit.id);
            });
          };
        });

        // 4. تحديث/حذف السجلات المحذوفة المرتبطة
        const deletedStore = tx.objectStore('deletedRecords');
        const deletedIndex = deletedStore.index('projectId');
        const deletedRequest = deletedIndex.getAll(projectId);

        deletedRequest.onsuccess = () => {
          deletedRequest.result.forEach(record => {
            deletedStore.delete(record.id);
          });
        };

        // 5. حذف المستفيدين الذين لا ينتمون لأي مشروع آخر
        beneficiaries.forEach(beneficiary => {
          const updatedProjects = beneficiary.projects.filter(p => p !== projectId);
          
          if (updatedProjects.length === 0) {
            // المستفيد لا ينتمي لأي مشروع آخر — حذفه نهائياً
            beneficiaryStore.delete(beneficiary.id);
          } else {
            // تحديث قائمة المشاريع فقط
            beneficiary.projects = updatedProjects;
            beneficiaryStore.put(beneficiary);
          }
        });

        // 6. حذف المشروع نفسه
        projectStore.delete(projectId);
      };
    };

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });

    showToast('تم حذف المشروع وجميع بياناته بنجاح', 'success');
    return true;
  } catch (error) {
    console.error('خطأ في حذف المشروع:', error);
    showToast('حدث خطأ في حذف المشروع', 'error');
    return false;
  }
}

/**
 * حذف مشروع رئيسي مع جميع المشاريع الفرعية
 */
async function deleteMainProject(mainProjectId) {
  const confirmed = await showConfirmDialog(
    'حذف المشروع الرئيسي',
    '<strong style="color:var(--accent-red)">تحذير: هذا سيحذف المشروع الرئيسي وجميع المشاريع الفرعية المرتبطة به!</strong><br/>سيتم حذف:<br/>• جميع المشاريع الفرعية<br/>• جميع المستفيدين والاستفادات<br/>• جميع السجلات المحذوفة',
    'حذف نهائي',
    'إلغاء'
  );

  if (!confirmed) return false;

  try {
    const db = await getDatabase();
    const tx = db.transaction(['projects', 'mainProjects', 'beneficiaries', 'benefits', 'deletedRecords'], 'readwrite');

    // 1. جلب جميع المشاريع الفرعية للمشروع الرئيسي
    const projectStore = tx.objectStore('projects');
    const mainProjectIndex = projectStore.index('mainProjectId');
    const subProjectsRequest = mainProjectIndex.getAll(mainProjectId);

    subProjectsRequest.onsuccess = () => {
      const subProjects = subProjectsRequest.result;

      // 2. حذف جميع المشاريع الفرعية وبياناتها
      subProjects.forEach(subProject => {
        deleteProjectDataCascade(tx, subProject.id);
        projectStore.delete(subProject.id);
      });

      // 3. حذف المشروع الرئيسي
      const mainProjectStore = tx.objectStore('mainProjects');
      mainProjectStore.delete(mainProjectId);
    };

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });

    showToast('تم حذف المشروع الرئيسي وجميع مشاريعه الفرعية بنجاح', 'success');
    return true;
  } catch (error) {
    console.error('خطأ في حذف المشروع الرئيسي:', error);
    showToast('حدث خطأ في حذف المشروع الرئيسي', 'error');
    return false;
  }
}

/**
 * دالة مساعدة: حذف جميع بيانات مشروع (Cascade)
 */
function deleteProjectDataCascade(tx, projectId) {
  const beneficiaryStore = tx.objectStore('beneficiaries');
  const benefitStore = tx.objectStore('benefits');
  const deletedStore = tx.objectStore('deletedRecords');

  // جلب جميع مستفيدي المشروع
  const beneficiaryIndex = beneficiaryStore.index('projects');
  const beneficiariesRequest = beneficiaryIndex.getAll(projectId);

  beneficiariesRequest.onsuccess = () => {
    beneficiariesRequest.result.forEach(beneficiary => {
      // حذف الاستفادات
      const benefitIndex = benefitStore.index('beneficiaryId');
      const benefitsRequest = benefitIndex.getAll(beneficiary.id);
      
      benefitsRequest.onsuccess = () => {
        benefitsRequest.result.forEach(benefit => {
          if (benefit.projectId === projectId) {
            benefitStore.delete(benefit.id);
          }
        });
      };

      // تحديث المستفيد (حذف المشروع من قائمته)
      const updatedProjects = beneficiary.projects.filter(p => p !== projectId);
      if (updatedProjects.length === 0) {
        beneficiaryStore.delete(beneficiary.id);
      } else {
        beneficiary.projects = updatedProjects;
        beneficiaryStore.put(beneficiary);
      }
    });
  };

  // حذف السجلات المحذوفة المرتبطة
  const deletedIndex = deletedStore.index('projectId');
  const deletedRequest = deletedIndex.getAll(projectId);
  
  deletedRequest.onsuccess = () => {
    deletedRequest.result.forEach(record => {
      deletedStore.delete(record.id);
    });
  };
}

/**
 * دالة مساعدة: عرض مربع تأكيد مخصص
 */
async function showConfirmDialog(title, message, okText, cancelText) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('confirm-overlay');
    const confirmTitle = overlay.querySelector('.confirm-message');
    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');

    confirmTitle.innerHTML = `<strong>${title}</strong><br/>${message}`;
    okBtn.textContent = okText;
    cancelBtn.textContent = cancelText;

    okBtn.onclick = () => {
      overlay.style.display = 'none';
      resolve(true);
    };

    cancelBtn.onclick = () => {
      overlay.style.display = 'none';
      resolve(false);
    };

    overlay.style.display = 'flex';
  });
}
