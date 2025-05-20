(function() {
  const konami = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
  let index = 0;
  let cursorClicks = [];

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
    text.textContent = useDeepSea ? 'DeepSea Discovery!' : 'Bitcoin Surprise!';
    overlay.appendChild(text);

    const whaleCount = window.innerWidth < 600
      ? 10
      : Math.max(20, Math.floor(window.innerHeight / 30));
    for (let i = 0; i < whaleCount; i++) {
      const whale = document.createElement('div');
      whale.className = 'whale';
      whale.style.top = Math.random() * 100 + '%';
      whale.style.left = '-150px';
      whale.style.animationDuration = 8 + Math.random() * 4 + 's';
      whale.style.animationDelay = Math.random() * 6 + 's';
      whale.style.fontSize = 2 + Math.random() * 2 + 'rem';
      whale.textContent = '🐳';
      overlay.appendChild(whale);
    }

    document.body.appendChild(overlay);
    setTimeout(() => overlay.remove(), 10000);
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
})();
