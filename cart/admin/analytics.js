(() => {
  const period = document.querySelector('.an-period');
  period?.querySelectorAll('input[type=date]').forEach(input => input.addEventListener('change', () => {
    const range = period.querySelector('[name=range]');
    range.value = 'custom';
    range.dispatchEvent(new Event('change', { bubbles: true }));
  }));
  document.querySelectorAll('[data-analytics-chart]').forEach(chart => {
    let points;
    try { points = JSON.parse(chart.dataset.points); } catch { return; }
    const slider = chart.querySelector('input[type=range]');
    const output = chart.querySelector('output');
    const show = index => {
      const point = points[index];
      if (!point) return;
      slider.value = index;
      output.replaceChildren();
      const current = document.createElement('span');
      current.textContent = `${point.label}: ${point.currentText}`;
      output.append(current);
      if (point.previousLabel) {
        const previous = document.createElement('small');
        previous.textContent = `Previous (${point.previousLabel}): ${point.previousText}`;
        output.append(previous);
      }
      slider.setAttribute('aria-valuetext', `${point.label}: ${point.currentText}`);
      chart.querySelectorAll('[data-point]').forEach(dot => dot.classList.toggle('active', Number(dot.dataset.point) === Number(index)));
    };
    slider.addEventListener('input', () => show(Number(slider.value)));
    chart.querySelectorAll('[data-point]').forEach(dot => dot.addEventListener('pointerenter', () => show(Number(dot.dataset.point))));
    show(points.length - 1);
  });
})();
