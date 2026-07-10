(() => {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  const STORAGE_KEY = 'holdDownTimer_times';
  let times = [];       // array of milliseconds, newest first
  let startTs = null;   // Date.now() when hold began
  let rafId = null;     // requestAnimationFrame id during hold

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const holdBtn  = document.getElementById('holdBtn');
  const btnLabel = document.getElementById('btnLabel');
  const btnSub   = document.getElementById('btnSub');
  const resetBtn = document.getElementById('resetBtn');
  const topList  = document.getElementById('topList');
  const timeList = document.getElementById('timeList');

  // ── Persistence ────────────────────────────────────────────────────────────
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) times = JSON.parse(raw);
    } catch (_) { times = []; }
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(times)); } catch (_) {}
  }

  // ── Formatting ─────────────────────────────────────────────────────────────
  function formatMs(ms) {
    const totalSec = Math.floor(ms / 1000);
    const min      = Math.floor(totalSec / 60);
    const sec      = totalSec % 60;
    const centis   = Math.floor((ms % 1000) / 10);
    if (min > 0) {
      return `${min}:${pad2(sec)}.${pad2(centis)}`;
    }
    return `${sec}.${pad2(centis)}s`;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  // ── Button label helpers ────────────────────────────────────────────────────
  function showIdleLabel() {
    const best = times.length > 0 ? Math.max(...times) : null;
    btnLabel.textContent = best !== null ? formatMs(best) : '—';
    btnSub.textContent   = best !== null ? 'Best · Hold to start' : 'Hold to start';
  }

  function showLiveLabel(ms) {
    btnLabel.textContent = formatMs(ms);
    btnSub.textContent   = 'Release to save';
  }

  // ── Live ticker ────────────────────────────────────────────────────────────
  function tick() {
    if (startTs === null) return;
    showLiveLabel(Date.now() - startTs);
    rafId = requestAnimationFrame(tick);
  }

  // ── Hold start ─────────────────────────────────────────────────────────────
  function onHoldStart(e) {
    e.preventDefault();             // prevent ghost clicks / scroll on mobile
    if (startTs !== null) return;   // already timing
    startTs = Date.now();
    holdBtn.classList.add('pressing');
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  }

  // ── Hold end ───────────────────────────────────────────────────────────────
  function onHoldEnd(e) {
    // Guard first – if we weren't timing, don't interfere with other elements
    // (calling e.preventDefault() here would swallow taps on the reset button)
    if (startTs === null) return;
    e.preventDefault();
    const elapsed = Date.now() - startTs;
    startTs = null;
    cancelAnimationFrame(rafId);
    holdBtn.classList.remove('pressing');

    if (elapsed >= 50) {            // ignore accidental taps < 50 ms
      times.push(elapsed);
      save();
      renderList();
      renderTopList();
    }
    showIdleLabel();
  }

  // ── Render top-3 panel ─────────────────────────────────────────────────────
  const MEDALS = ['🥇', '🥈', '🥉'];

  function renderTopList() {
    topList.innerHTML = '';

    if (times.length === 0) {
      const li = document.createElement('li');
      li.className   = 'top-list-empty';
      li.textContent = 'No times yet';
      topList.appendChild(li);
      return;
    }

    const top3 = [...times]
      .sort((a, b) => b - a)
      .slice(0, 3);

    top3.forEach((ms, i) => {
      const li = document.createElement('li');
      li.classList.add(`rank-${i + 1}`);

      const medal = document.createElement('span');
      medal.className   = 'medal';
      medal.textContent = MEDALS[i];

      const dur = document.createElement('span');
      dur.className   = 't-dur';
      dur.textContent = formatMs(ms);

      li.appendChild(medal);
      li.appendChild(dur);
      topList.appendChild(li);
    });
  }

  // ── Render full list ────────────────────────────────────────────────────────
  function renderList() {
    timeList.innerHTML = '';

    if (times.length === 0) {
      const li = document.createElement('li');
      li.className   = 'empty-msg';
      li.textContent = 'No times recorded yet.';
      timeList.appendChild(li);
      return;
    }

    // Build sorted index: highest time gets rank 1
    const sorted = [...times]
      .map((ms, idx) => ({ ms, idx }))
      .sort((a, b) => b.ms - a.ms);

    const rankMap = new Map();
    sorted.forEach((item, pos) => rankMap.set(item.idx, pos + 1));

    // Display newest first
    [...times].reverse().forEach((ms, revIdx) => {
      const origIdx = times.length - 1 - revIdx;
      const rank    = rankMap.get(origIdx);

      const li = document.createElement('li');
      if (rank === 1) li.classList.add('top-1');
      else if (rank === 2) li.classList.add('top-2');
      else if (rank === 3) li.classList.add('top-3');

      const rankSpan = document.createElement('span');
      rankSpan.className   = 'rank';
      rankSpan.textContent = `#${rank}`;

      const durSpan = document.createElement('span');
      durSpan.className   = 'duration';
      durSpan.textContent = formatMs(ms);

      li.appendChild(rankSpan);
      li.appendChild(durSpan);

      timeList.appendChild(li);
    });
  }

  // ── Reset ──────────────────────────────────────────────────────────────────
  resetBtn.addEventListener('click', () => {
    if (times.length === 0) return;
    if (confirm('Delete all saved times? This cannot be undone.')) {
      times = [];
      save();
      renderList();
      renderTopList();
      showIdleLabel();
    }
  });

  // ── Event wiring ───────────────────────────────────────────────────────────
  // Mouse
  holdBtn.addEventListener('mousedown',  onHoldStart);
  document.addEventListener('mouseup',   onHoldEnd);

  // Touch (primary finger only)
  holdBtn.addEventListener('touchstart', onHoldStart, { passive: false });
  document.addEventListener('touchend',  onHoldEnd,   { passive: false });
  document.addEventListener('touchcancel', onHoldEnd, { passive: false });

  // Keyboard (Space / Enter for accessibility)
  holdBtn.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) onHoldStart(e);
  });
  holdBtn.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Enter') onHoldEnd(e);
  });

  // ── Init ───────────────────────────────────────────────────────────────────
  load();
  renderList();
  renderTopList();
  showIdleLabel();
})();
