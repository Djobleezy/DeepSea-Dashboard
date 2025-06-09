(function() {
  const konami = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
  const matrix = ['m','a','t','r','i','x'];
  let index = 0;
  let matrixIndex = 0;
  let cursorClicks = [];
  const theme_quotes = {
    bitcoin: [
      'If you don\'t believe it or don\'t get it, I don\'t have the time to try to convince you, sorry.',
      'It\'s very attractive to the libertarian viewpoint if we can explain it properly. I\'m better with code than with words though.',
      'The root problem with conventional currency is all the trust that\'s required to make it work.',
      'The Times 03/Jan/2009 Chancellor on brink of second bailout for banks',
      'It might make sense just to get some in case it catches on.',
      'As a thought experiment, imagine there was a base metal as scarce as gold but with one magical property: it can be transported over a communications channel.',
      'We have proposed a system for electronic transactions without relying on trust.',
      'I\'m sure that in 20 years there will either be very large transaction volume or no volume.',
      'Running bitcoin.',
      'Bitcoin seems to be a very promising idea.',
      'Every day that goes by and Bitcoin hasn\'t collapsed due to legal or technical problems, that brings new information to the market.',
      'The computer can be used as a tool to liberate and protect people, rather than to control them.'
    ],
    deepsea: [
      'Dive deep and explore the unknown.',
      'Whales ahead! Stay sharp.',
      'The ocean whispers its secrets.',
      'The sea, once it casts its spell, holds one in its net of wonder forever.',
      'Below the surface is a whole new realm.',
      'Life is better down where it\'s wetter.',
      'In the heart of the sea lies endless mystery.',
      'Water is the driving force of all nature.',
      'Dive deep; the treasure you seek is near the seabed.',
      'Every wave tells a story.',
      'Even a single drop can make a wave.',
      'So long, and thanks for all the fish!'
    ],
    matrix: [
      'Welcome to the real world.',
      'There is no spoon.',
      'Follow the white rabbit.',
      'Unfortunately, no one can be told what the Matrix is. You have to see it for yourself.',
      'I can only show you the door. You\'re the one that has to walk through it.',
      'What is real? How do you define real?',
      'Choice is an illusion created between those with power and those without.',
      'Dodge this.',
      'Ignorance is bliss.',
      'The answer is out there, Neo, and it\'s looking for you.',
      'Never send a human to do a machine\'s job.',
      'Free your mind.',
      'I know kung fu.'
    ]
  };

  function get_theme_quote(use_deep_sea, use_matrix) {
    const key = use_matrix ? 'matrix' : (use_deep_sea ? 'deepsea' : 'bitcoin');
    const list = theme_quotes[key];
    return list[Math.floor(Math.random() * list.length)];
  }

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
    const useMatrix = document.documentElement.classList.contains('matrix-theme');
    const useDeepSea = localStorage.getItem('useDeepSeaTheme') === 'true';
    if (useMatrix) {
      overlay.classList.add('matrix');
    } else if (useDeepSea) {
      overlay.classList.add('deepsea');
    } else {
      overlay.classList.add('bitcoin');
    }

    const text = document.createElement('div');
    const active = localStorage.getItem('easterEggActive') === 'true';
    if (active) {
      text.textContent = 'Easter Egg Disabled!';
    } else if (useMatrix) {
      text.textContent = 'Entering the Matrix...';
    } else if (useDeepSea) {
      text.textContent = 'Plunging into DeepSea!';
    } else {
      text.textContent = 'Embracing Bitcoin vibes!';
    }
    overlay.appendChild(text);

    const fact = document.createElement('div');
    fact.className = 'fact';
    fact.textContent = get_theme_quote(useDeepSea, useMatrix);
    overlay.appendChild(fact);

    const iconCount = window.innerWidth < 600
      ? 10
      : Math.max(20, Math.floor(window.innerHeight / 30));
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
