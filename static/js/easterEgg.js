(function() {
  const konami = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
  let index = 0;

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
    if (localStorage.getItem('useDeepSeaTheme') === 'true') {
      overlay.classList.add('deepsea');
    }

    const text = document.createElement('div');
    text.textContent = 'DeepSea Discovery!';
    overlay.appendChild(text);

    const whaleCount = Math.max(20, Math.floor(window.innerHeight / 30));
    for (let i = 0; i < whaleCount; i++) {
      const whale = document.createElement('div');
      whale.className = 'whale';
      whale.style.top = Math.random() * 100 + '%';
      whale.style.left = '-10%';
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
})();
