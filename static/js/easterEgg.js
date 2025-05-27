(function() {
  const konami = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
  const matrix = ['m','a','t','r','i','x'];
  let index = 0;
  let matrixIndex = 0;
  let cursorClicks = [];
  const funFacts = [
    'Did you know dolphins sleep with one eye open?',
    'The ocean covers over 70% of the Earth.',
    'Some crabs can grow back lost claws!',
    'There will only ever be 21 million Bitcoin.',
    'Whales can hold their breath for more than an hour!'
  ];

  let lastWhaleTime = 0;

  function spawnWhales(x, y) {
    const count = 8;
    const useDeepSea = document.documentElement.classList.contains('deepsea-theme');
    const useMatrix = document.documentElement.classList.contains('matrix-theme');
    let symbol;
    if (useMatrix) {
      symbol = '💲';
    } else if (useDeepSea) {
      symbol = '🐳';
    } else {
      symbol = '₿';
    }
    for (let i = 0; i < count; i++) {
      const emoji = document.createElement('span');
      emoji.className = 'cursor-whale';
      emoji.textContent = symbol;
      const angle = Math.random() * Math.PI * 2;
      const distance = 60 + Math.random() * 40;
      const xMove = Math.cos(angle) * distance;
      const yMove = Math.sin(angle) * distance;
      emoji.style.left = x + 'px';
      emoji.style.top = y + 'px';
      emoji.style.setProperty('--x', xMove + 'px');
      emoji.style.setProperty('--y', yMove + 'px');
      if (useMatrix) {
        emoji.style.color = '#39ff14';
      } else if (!useDeepSea) {
        emoji.style.color = '#f7931a';
      }
      document.body.appendChild(emoji);
      emoji.addEventListener('animationend', () => emoji.remove());
    }
  }

  function handleMove(e) {
    const now = Date.now();
    if (now - lastWhaleTime > 50) {
      lastWhaleTime = now;
      spawnWhales(e.clientX, e.clientY);
    }
  }

  function handleTouch(e) {
    const t = e.touches[0];
    if (t) {
      spawnWhales(t.clientX, t.clientY);
    }
  }

  function addWhaleListeners() {
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('touchstart', handleTouch);
  }

  function removeWhaleListeners() {
    window.removeEventListener('mousemove', handleMove);
    window.removeEventListener('touchstart', handleTouch);
  }

  function applyEmojiMode() {
    document.body.classList.add('easterEggActive');
    addWhaleListeners();
  }

  function removeEmojiMode() {
    document.body.classList.remove('easterEggActive');
    removeWhaleListeners();
  }

  function handleKey(e) {
    if (document.body.classList.contains('easterEggActive')) {
      if (e.key.toLowerCase() === matrix[matrixIndex]) {
        matrixIndex++;
        if (matrixIndex === matrix.length) {
          matrixIndex = 0;
          activateMatrixTheme();
          return;
        }
      } else {
        matrixIndex = 0;
      }
    }

    if (e.key === konami[index]) {
      index++;
      if (index === konami.length) {
        index = 0;
        trigger();
      }
    } else {
      index = 0;
    }
  }

  function trigger() {
    if (document.getElementById('easterEggOverlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'easterEggOverlay';
    const useDeepSea = localStorage.getItem('useDeepSeaTheme') === 'true';
    if (useDeepSea) {
      overlay.classList.add('deepsea');
    } else {
      overlay.classList.add('bitcoin');
    }

    const text = document.createElement('div');
    const active = localStorage.getItem('easterEggActive') === 'true';
    text.textContent = active ? 'Easter Egg Disabled!' : (useDeepSea ? 'DeepSea Discovery!' : 'Bitcoin Surprise!');
    overlay.appendChild(text);

    const fact = document.createElement('div');
    fact.className = 'fact';
    fact.textContent = funFacts[Math.floor(Math.random() * funFacts.length)];
    overlay.appendChild(fact);

    const iconCount = window.innerWidth < 600
      ? 10
      : Math.max(20, Math.floor(window.innerHeight / 30));

    const useMatrix = document.documentElement.classList.contains('matrix-theme');
    const seaIcons = ['🐳', '🐠', '🦀', '💰'];
    const matrixIcons = ['💻', '🖥️', '⌨️'];

    for (let i = 0; i < iconCount; i++) {
      const icon = document.createElement('div');
      if (useMatrix) {
        icon.className = 'matrix-icon';
        icon.textContent = matrixIcons[Math.floor(Math.random() * matrixIcons.length)];
      } else if (useDeepSea) {
        icon.className = 'sea-icon';
        icon.textContent = seaIcons[Math.floor(Math.random() * seaIcons.length)];
      } else {
        icon.className = 'btc';
        icon.textContent = '₿';
      }
      icon.style.top = Math.random() * 100 + '%';
      icon.style.left = '-150px';
      icon.style.animationDuration = 8 + Math.random() * 4 + 's';
      icon.style.animationDelay = Math.random() * 6 + 's';
      if (useMatrix) {
        icon.style.fontSize = 3 + Math.random() * 1.5 + 'rem';
        icon.style.color = '#39ff14';
      } else if (useDeepSea) {
        icon.style.fontSize = 2 + Math.random() * 2 + 'rem';
      } else {
        icon.style.fontSize = 4 + Math.random() * 2 + 'rem';
        icon.style.color = '#f7931a';
      }
      overlay.appendChild(icon);
    }

    if (active) {
      removeEmojiMode();
      localStorage.setItem('easterEggActive', 'false');
    } else {
      applyEmojiMode();
      localStorage.setItem('easterEggActive', 'true');
    }

    document.body.appendChild(overlay);
    setTimeout(() => overlay.remove(), 15000);
  }

  function activateMatrixTheme() {
    if (window.applyMatrixTheme) {
      localStorage.setItem('useMatrixTheme', 'true');
      localStorage.setItem('useDeepSeaTheme', 'true');
      window.applyMatrixTheme();

      // Refresh the main chart with new theme colors
      try {
        if (typeof trendChart !== 'undefined' && trendChart &&
            typeof initializeChart === 'function' &&
            typeof updateChartWithNormalizedData === 'function' &&
            typeof updateBlockAnnotations === 'function') {
          const fontConfig = {
            xTicks: { ...trendChart.options.scales.x.ticks.font },
            yTicks: { ...trendChart.options.scales.y.ticks.font },
            yTitle: { ...trendChart.options.scales.y.title.font },
            tooltip: {
              title: { ...trendChart.options.plugins.tooltip.titleFont },
              body: { ...trendChart.options.plugins.tooltip.bodyFont }
            }
          };
          const isMobile = window.innerWidth < 768;
          trendChart.destroy();
          trendChart = initializeChart();
          if (isMobile) {
            trendChart.options.scales.x.ticks.font = { ...fontConfig.xTicks };
            trendChart.options.scales.y.ticks.font = { ...fontConfig.yTicks };
            trendChart.options.scales.y.title.font = { ...fontConfig.yTitle };
            trendChart.options.plugins.tooltip.titleFont = { ...fontConfig.tooltip.title };
            trendChart.options.plugins.tooltip.bodyFont = { ...fontConfig.tooltip.body };
          } else {
            trendChart.options.scales.x.ticks.font = fontConfig.xTicks;
            trendChart.options.scales.y.ticks.font = fontConfig.yTicks;
            trendChart.options.scales.y.title.font = fontConfig.yTitle;
            trendChart.options.plugins.tooltip.titleFont = fontConfig.tooltip.title;
            trendChart.options.plugins.tooltip.bodyFont = fontConfig.tooltip.body;
          }
          const metrics = (typeof latestMetrics !== 'undefined') ? latestMetrics : null;
          updateChartWithNormalizedData(trendChart, metrics);
          updateBlockAnnotations(trendChart);
          trendChart.update('none');
        }
      } catch (e) {
        console.error('Error refreshing chart for Matrix theme:', e);
      }

      // Notify listeners of theme change
      if (window.jQuery) {
        window.jQuery(document).trigger('themeChanged');
      }

      const overlay = document.createElement('div');
      overlay.id = 'matrixOverlay';
      overlay.classList.add('matrix');
      overlay.textContent = 'Welcome to the Matrix!';
      document.body.appendChild(overlay);
      setTimeout(() => overlay.remove(), 5000);
    }
  }

  window.addEventListener('keydown', handleKey);

  function handleCursorClick() {
    const now = Date.now();
    cursorClicks.push(now);
    cursorClicks = cursorClicks.filter(t => now - t < 2000);
    if (cursorClicks.length >= 10) {
      trigger();
      cursorClicks = [];
    }
  }

  function cursorListener(e) {
    const target = e.target;
    if (target.id === 'terminal-cursor' || target.classList.contains('terminal-cursor')) {
      handleCursorClick();
    }
  }

  window.addEventListener('click', cursorListener);
  window.addEventListener('touchstart', cursorListener);

  if (localStorage.getItem('easterEggActive') === 'true') {
    applyEmojiMode();
  }
})();
