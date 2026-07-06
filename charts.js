// ======================================================
// charts.js - الرسوم البيانية للوحة التحكم
// ======================================================

let projectsChartInstance = null;
let benefitsChartInstance = null;
let trendChartInstance = null;

// دالة مساعدة للحصول على الألوان المناسبة للثيم النشط
function getThemeColors() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  return {
    textColor: isLight ? '#475569' : '#e2e8f0',
    gridColor: isLight ? 'rgba(15, 23, 42, 0.06)' : 'rgba(255, 255, 255, 0.05)',
    tickColor: isLight ? '#64748b' : '#94a3b8'
  };
}

// ======================================================
// رسم بياني: المستفيدون لكل مشروع
// ======================================================
export function renderProjectsChart(projects) {
  const canvas = document.getElementById('projectsChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  if (projectsChartInstance) projectsChartInstance.destroy();

  const labels = projects.map(p => p.name || 'بدون اسم');
  const data = projects.map(p => p.stats?.finalCount || 0);

  const colors = getThemeColors();

  const gradient = ctx.createLinearGradient(0, 0, 0, 300);
  gradient.addColorStop(0, 'rgba(59, 130, 246, 0.8)');
  gradient.addColorStop(1, 'rgba(59, 130, 246, 0.1)');

  projectsChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'عدد المستفيدين',
        data,
        backgroundColor: gradient,
        borderColor: 'rgba(59, 130, 246, 1)',
        borderWidth: 2,
        borderRadius: 8,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: colors.textColor, font: { family: 'Cairo', size: 12 } }
        },
        tooltip: {
          callbacks: {
            label: ctx => `المستفيدون: ${ctx.raw.toLocaleString('ar-SA')}`
          }
        }
      },
      scales: {
        y: {
          grid: { color: colors.gridColor },
          ticks: { color: colors.tickColor, font: { family: 'Cairo' } }
        },
        x: {
          grid: { display: false },
          ticks: { color: colors.tickColor, font: { family: 'Cairo' }, maxRotation: 30 }
        }
      }
    }
  });
}

// ======================================================
// رسم بياني: توزيع التكرار (دائري)
// ======================================================
export function renderDuplicatesChart(stats) {
  const canvas = document.getElementById('duplicatesChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  if (benefitsChartInstance) benefitsChartInstance.destroy();

  const finalCount = stats.beneficiariesCount || 0;
  const deleted = stats.deletedCount || 0;
  const colors = getThemeColors();

  benefitsChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['مستفيدون فريدون', 'سجلات محذوفة (تكرار)'],
      datasets: [{
        data: [finalCount, deleted],
        backgroundColor: ['rgba(34, 197, 94, 0.8)', 'rgba(239, 68, 68, 0.8)'],
        borderColor: ['rgba(34, 197, 94, 1)', 'rgba(239, 68, 68, 1)'],
        borderWidth: 2,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: colors.textColor, font: { family: 'Cairo', size: 12 }, padding: 20 }
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${ctx.raw.toLocaleString('ar-SA')}`
          }
        }
      },
      cutout: '65%'
    }
  });
}

// ======================================================
// رسم بياني: اتجاه الاستيراد عبر الوقت
// ======================================================
export function renderTrendChart(projects) {
  const canvas = document.getElementById('trendChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  if (trendChartInstance) trendChartInstance.destroy();

  const sorted = [...projects].sort((a, b) => {
    const da = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
    const db2 = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
    return da - db2;
  });

  const labels = sorted.map(p => {
    const d = p.createdAt?.toDate ? p.createdAt.toDate() : new Date(p.createdAt || 0);
    return d.toLocaleDateString('ar-SA', { month: 'short', year: 'numeric' });
  });
  const data = sorted.map(p => p.stats?.finalCount || 0);
  const colors = getThemeColors();

  const gradient = ctx.createLinearGradient(0, 0, 0, 250);
  gradient.addColorStop(0, 'rgba(168, 85, 247, 0.4)');
  gradient.addColorStop(1, 'rgba(168, 85, 247, 0.0)');

  trendChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'المستفيدون المقبولون',
        data,
        fill: true,
        backgroundColor: gradient,
        borderColor: 'rgba(168, 85, 247, 1)',
        borderWidth: 2.5,
        pointBackgroundColor: 'rgba(168, 85, 247, 1)',
        pointRadius: 5,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: colors.textColor, font: { family: 'Cairo', size: 12 } }
        }
      },
      scales: {
        y: {
          grid: { color: colors.gridColor },
          ticks: { color: colors.tickColor, font: { family: 'Cairo' } }
        },
        x: {
          grid: { display: false },
          ticks: { color: colors.tickColor, font: { family: 'Cairo' } }
        }
      }
    }
  });
}

// ======================================================
// تدمير جميع الرسوم عند تغيير الصفحة
// ======================================================
export function destroyAllCharts() {
  if (projectsChartInstance) { projectsChartInstance.destroy(); projectsChartInstance = null; }
  if (benefitsChartInstance) { benefitsChartInstance.destroy(); benefitsChartInstance = null; }
  if (trendChartInstance) { trendChartInstance.destroy(); trendChartInstance = null; }
}
