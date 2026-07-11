(function () {
  'use strict';

  const canvas = document.getElementById('pointer-canvas');
  const ctx = canvas.getContext('2d');

  function setupCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
  }

  // Draw target cursor and label bubble
  function drawPointer(x, y, label) {
    setupCanvas();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const txt = label || 'right here';

    // 1. Draw animated pulsing halo under the arrow tip
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(59, 130, 246, 0.4)';
    ctx.fill();
    ctx.restore();

    // 2. Draw pointer triangle (arrow)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 10, y + 26);
    ctx.lineTo(x + 12, y + 20);
    ctx.closePath();
    ctx.fillStyle = 'rgb(59, 130, 246)'; // Clean premium blue
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 2;
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // 3. Draw premium bubble text label
    const bubbleWidth = 200;
    const bubbleHeight = 36;
    
    // Draw bubble on left of pointer if tip is far right to prevent clipping
    const bubbleX = (x > 110) ? (x - bubbleWidth - 12) : (x + 18);
    const bubbleY = y - 6;

    ctx.save();
    // Glassmorphic background
    ctx.beginPath();
    roundRect(ctx, bubbleX, bubbleY, bubbleWidth, bubbleHeight, 8);
    ctx.fillStyle = 'rgba(30, 41, 59, 0.9)'; // Dark slate semi-transparent
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 4;
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Text content
    ctx.save();
    ctx.fillStyle = '#f8fafc'; // White slate text
    ctx.font = '500 11.5px "Inter", -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    
    // Text truncation if too long
    let textToDraw = txt;
    const maxTextWidth = bubbleWidth - 20;
    if (ctx.measureText(textToDraw).width > maxTextWidth) {
      while (textToDraw.length > 0 && ctx.measureText(textToDraw + '...').width > maxTextWidth) {
        textToDraw = textToDraw.substring(0, textToDraw.length - 1);
      }
      textToDraw += '...';
    }

    ctx.fillText(textToDraw, bubbleX + 10, bubbleY + (bubbleHeight / 2));
    ctx.restore();
  }

  // Helper to draw rounded rectangle
  function roundRect(ctx, x, y, width, height, radius) {
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  // Bind to copilotAPI
  if (window.copilotAPI && window.copilotAPI.onDrawPointer) {
    window.copilotAPI.onDrawPointer((data) => {
      if (data && data.coordinate) {
        const [x, y] = data.coordinate;
        drawPointer(x, y, data.label);
      }
    });
  }

  // Setup initial canvas dimensions
  window.addEventListener('resize', setupCanvas);
  setupCanvas();
})();
