(function() {
  const konami = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
  let index = 0;
  let cursorClicks = [];

  function applyEmojiMode() {
    const useDeepSea = localStorage.getItem('useDeepSeaTheme') === 'true';
    const emoji = useDeepSea ? '🐳' : '₿';
    document.body.classList.add('easterEggActive');
    document.body.style.setProperty('--egg-emoji', '"' + emoji + '"');
  }

  function removeEmojiMode() {
    document.body.classList.remove('easterEggActive');
    document.body.style.removeProperty('--egg-emoji');
  }

  function handleKey(e) {
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

    const iconCount = window.innerWidth < 600
      ? 10
      : Math.max(20, Math.floor(window.innerHeight / 30));

    for (let i = 0; i < iconCount; i++) {
      const icon = document.createElement('div');
      if (useDeepSea) {
        icon.className = 'whale';
        icon.textContent = '🐳';
      } else {
        icon.className = 'btc';
        icon.textContent = '₿';
      }
      icon.style.top = Math.random() * 100 + '%';
      icon.style.left = '-150px';
      icon.style.animationDuration = 8 + Math.random() * 4 + 's';
      icon.style.animationDelay = Math.random() * 6 + 's';
      icon.style.fontSize = 2 + Math.random() * 2 + 'rem';
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
    setTimeout(() => overlay.remove(), 3000);
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
