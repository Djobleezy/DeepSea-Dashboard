(function() {
  const konami = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
  let index = 0;
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
    for (let i = 0; i < count; i++) {
      const emoji = document.createElement('span');
      emoji.className = 'cursor-whale';
      emoji.textContent = '🐳';
      const angle = Math.random() * Math.PI * 2;
      const distance = 60 + Math.random() * 40;
      const xMove = Math.cos(angle) * distance;
      const yMove = Math.sin(angle) * distance;
      emoji.style.left = x + 'px';
      emoji.style.top = y + 'px';
      emoji.style.setProperty('--x', xMove + 'px');
      emoji.style.setProperty('--y', yMove + 'px');
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

    const seaIcons = ['🐳', '🐠', '🦀', '💰'];

    for (let i = 0; i < iconCount; i++) {
      const icon = document.createElement('div');
      if (useDeepSea) {
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
      if (useDeepSea) {
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
