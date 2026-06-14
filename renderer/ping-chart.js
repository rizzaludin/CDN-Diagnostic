'use strict';

class PingChart {
  constructor(canvasEl, options = {}) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.data = [];
    this.maxPoints = options.maxPoints || 300;
    this.threshold = options.threshold || 100;
    this.padding = { top: 20, right: 16, bottom: 28, left: 48 };
    this._resizeObserver = null;
    this._setupResize();
    this.render();
  }

  _setupResize() {
    const ro = new ResizeObserver(() => {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      this.canvas.width = rect.width;
      this.canvas.height = rect.height;
      this.render();
    });
    ro.observe(this.canvas.parentElement);
  }

  setThreshold(val) {
    this.threshold = val;
    this.render();
  }

  addPoint(latency) {
    this.data.push(latency);
    if (this.data.length > this.maxPoints) this.data.shift();
    this.render();
  }

  clear() {
    this.data = [];
    this.render();
  }

  render() {
    const { ctx, canvas, data, threshold, padding } = this;
    const w = canvas.width || 300;
    const h = canvas.height || 160;
    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;

    ctx.clearRect(0, 0, w, h);
    if (plotW < 10 || plotH < 10) return;

    // Scale
    const validData = data.filter((d) => d >= 0);
    const maxVal = Math.max(threshold + 20, ...(validData.length ? validData : [100])) * 1.15;
    const minVal = 0;

    const toX = (i) => padding.left + (data.length <= 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
    const toY = (v) => padding.top + plotH - ((v - minVal) / (maxVal - minVal)) * plotH;

    // Background
    ctx.fillStyle = '#0A1224';
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = 'rgba(26,39,68,0.6)';
    ctx.lineWidth = 0.5;
    const gridCount = 5;
    for (let i = 0; i <= gridCount; i++) {
      const y = padding.top + (plotH / gridCount) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();

      // Y labels
      const val = Math.round(maxVal - (maxVal / gridCount) * i);
      ctx.fillStyle = '#64748B';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(val + 'ms', padding.left - 6, y + 3);
    }

    // Threshold line
    if (threshold > 0 && threshold < maxVal) {
      const ty = toY(threshold);
      ctx.strokeStyle = 'rgba(248,113,113,0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(padding.left, ty);
      ctx.lineTo(w - padding.right, ty);
      ctx.stroke();
      ctx.setLineDash([]);

      // Threshold label
      ctx.fillStyle = 'rgba(248,113,113,0.7)';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('threshold ' + threshold + 'ms', padding.left + 4, ty - 4);
    }

    // Data line
    if (data.length > 1) {
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';

      // Gradient fill under line
      const gradient = ctx.createLinearGradient(0, padding.top, 0, h - padding.bottom);
      gradient.addColorStop(0, 'rgba(74,143,231,0.15)');
      gradient.addColorStop(1, 'rgba(74,143,231,0.01)');

      ctx.beginPath();
      let started = false;
      for (let i = 0; i < data.length; i++) {
        if (data[i] < 0) continue;
        const x = toX(i);
        const y = toY(data[i]);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }

      // Stroke
      ctx.strokeStyle = '#4A8FE7';
      ctx.stroke();

      // Fill
      const lastValidIdx = data.length - 1;
      ctx.lineTo(toX(lastValidIdx), h - padding.bottom);
      ctx.lineTo(toX(0), h - padding.bottom);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();

      // Dots for last point and points above threshold
      for (let i = 0; i < data.length; i++) {
        if (data[i] < 0) continue;
        const x = toX(i);
        const y = toY(data[i]);
        const isAbove = data[i] >= threshold;
        const isLast = i === data.length - 1;

        if (isAbove || isLast) {
          ctx.beginPath();
          ctx.arc(x, y, isLast ? 3.5 : 2.5, 0, Math.PI * 2);
          ctx.fillStyle = isAbove ? '#F87171' : '#4A8FE7';
          ctx.fill();
          if (isLast) {
            ctx.strokeStyle = isAbove ? '#F87171' : '#4A8FE7';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }

      // Time labels on X axis
      ctx.fillStyle = '#64748B';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      const step = Math.max(1, Math.floor(data.length / 6));
      for (let i = 0; i < data.length; i += step) {
        ctx.fillText(i + 1, toX(i), h - padding.bottom + 14);
      }
    } else {
      // No data message
      ctx.fillStyle = '#64748B';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for data...', w / 2, h / 2);
    }
  }
}

// Export for renderer use
if (typeof window !== 'undefined') window.PingChart = PingChart;