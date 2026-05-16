const Charts = (() => {

  function ratioChart(canvas, weeks, large, small) {
    return new Chart(canvas, {
      type: 'line',
      data: {
        labels: weeks,
        datasets: [
          {
            label: '大戶持股比 (%)',
            data: large,
            borderColor: '#FF453A',
            backgroundColor: 'rgba(255,69,58,0.15)',
            tension: 0.25,
            yAxisID: 'y',
          },
          {
            label: '散戶持股比 (%)',
            data: small,
            borderColor: '#64D2FF',
            backgroundColor: 'rgba(100,210,255,0.15)',
            tension: 0.25,
            yAxisID: 'y',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: '#e5e5ea' } },
        },
        scales: {
          x: { ticks: { color: '#98989D' }, grid: { color: 'rgba(255,255,255,0.06)' } },
          y: { ticks: { color: '#98989D' }, grid: { color: 'rgba(255,255,255,0.06)' } },
        },
      },
    });
  }

  function priceChart(canvas, weeks, prices) {
    return new Chart(canvas, {
      type: 'line',
      data: {
        labels: weeks,
        datasets: [{
          label: '週收盤 (元)',
          data: prices,
          borderColor: '#30D158',
          backgroundColor: 'rgba(48,209,88,0.15)',
          tension: 0.25,
          fill: true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#e5e5ea' } } },
        scales: {
          x: { ticks: { color: '#98989D' }, grid: { color: 'rgba(255,255,255,0.06)' } },
          y: { ticks: { color: '#98989D' }, grid: { color: 'rgba(255,255,255,0.06)' } },
        },
      },
    });
  }

  return { ratioChart, priceChart };
})();
