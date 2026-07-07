// تطبيق الثيم المحفوظ فوراً لتجنب الوميض وتحديد التاريخ
(function () {
  const t = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', t);
  
  // ننتظر حتى يتم تحميل المستند بالكامل لتعيين التاريخ لتفادي مشاكل التحميل المبكر
  document.addEventListener('DOMContentLoaded', () => {
    const dateEl = document.getElementById('top-date');
    if (dateEl) {
      dateEl.textContent = new Date().toLocaleDateString('ar-SA', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    }
  });
})();
