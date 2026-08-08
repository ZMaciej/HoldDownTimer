(() => {
  'use strict';

  const MEDALS = ['🥇', '🥈', '🥉'];

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function formatMs(ms) {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    const centis = Math.floor((ms % 1000) / 10);

    if (min > 0) {
      return `${min}:${pad2(sec)}.${pad2(centis)}`;
    }
    return `${sec}.${pad2(centis)}s`;
  }

  function createWakeLockManager() {
    const activeTimers = new Set();
    const isSupported = 'wakeLock' in navigator;
    let lock = null;
    let requesting = false;
    let noSleep = null;
    let fallbackEnabled = false;

    if (window.NoSleep) {
      noSleep = new window.NoSleep();
    }

    function enableFallback() {
      if (!noSleep || fallbackEnabled) {
        return;
      }
      try {
        noSleep.enable();
        fallbackEnabled = true;
      } catch (_) {}
    }

    function disableFallback() {
      if (!noSleep || !fallbackEnabled) {
        return;
      }
      try {
        noSleep.disable();
      } catch (_) {
      } finally {
        fallbackEnabled = false;
      }
    }

    async function requestLock() {
      if (!isSupported || document.visibilityState !== 'visible' || lock || requesting) {
        return;
      }
      if (activeTimers.size === 0) {
        return;
      }

      try {
        requesting = true;
        lock = await navigator.wakeLock.request('screen');
        disableFallback();
        lock.addEventListener('release', () => {
          lock = null;
          if (activeTimers.size > 0) {
            void requestLock();
            enableFallback();
          }
        });
      } catch (_) {
        lock = null;
        enableFallback();
      } finally {
        requesting = false;
      }
    }

    async function releaseLock() {
      if (!lock) {
        return;
      }

      try {
        await lock.release();
      } catch (_) {
      } finally {
        lock = null;
      }
    }

    function setActive(id, active) {
      if (active) {
        activeTimers.add(id);
      } else {
        activeTimers.delete(id);
      }

      if (activeTimers.size > 0) {
        enableFallback();
        void requestLock();
      } else {
        void releaseLock();
        disableFallback();
      }
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && activeTimers.size > 0) {
        enableFallback();
        void requestLock();
      }
    });

    return { setActive };
  }

  function createStopwatch(options) {
    const {
      storageKey,
      delayMs,
      triggerMode,
      idleHint,
      wakeLockManager,
      holdBtn,
      btnLabel,
      btnSub,
      resetBtn,
      topList,
      timeTotal,
      timeList
    } = options;

    let times = [];
    let startTs = null;
    let rafId = null;
    let pendingStart = false;
    let pendingRafId = null;
    let delayTimerId = null;
    let delayEndTs = null;

    function syncWakeLockState() {
      if (!wakeLockManager) {
        return;
      }
      wakeLockManager.setActive(storageKey, startTs !== null || pendingStart);
    }

    function load() {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          times = JSON.parse(raw);
        }
      } catch (_) {
        times = [];
      }
    }

    function save() {
      try {
        localStorage.setItem(storageKey, JSON.stringify(times));
      } catch (_) {}
    }

    function showIdleLabel() {
      const best = times.length > 0 ? Math.max(...times) : null;
      btnLabel.textContent = best !== null ? formatMs(best) : '—';
      btnSub.textContent = best !== null ? `Best · ${idleHint}` : idleHint;
    }

    function showLiveLabel(ms) {
      btnLabel.textContent = formatMs(ms);
      btnSub.textContent = triggerMode === 'click'
        ? 'Click again to stop'
        : 'Release to save';
    }

    function showPendingLabel(remainingMs) {
      const remaining = Math.max(0, remainingMs);
      btnLabel.textContent = `${(remaining / 1000).toFixed(2)}s`;
      btnSub.textContent = triggerMode === 'click'
        ? 'Starting stopwatch... click to cancel'
        : 'Keep holding to start timer';
    }

    function clearPendingStart() {
      pendingStart = false;
      delayEndTs = null;
      holdBtn.classList.remove('armed');
      if (delayTimerId !== null) {
        clearTimeout(delayTimerId);
        delayTimerId = null;
      }
      if (pendingRafId !== null) {
        cancelAnimationFrame(pendingRafId);
        pendingRafId = null;
      }
      syncWakeLockState();
    }

    function tick() {
      if (startTs === null) {
        return;
      }
      showLiveLabel(Date.now() - startTs);
      rafId = requestAnimationFrame(tick);
    }

    function pendingTick() {
      if (!pendingStart || delayEndTs === null) {
        return;
      }
      showPendingLabel(delayEndTs - Date.now());
      pendingRafId = requestAnimationFrame(pendingTick);
    }

    function beginTimingNow() {
      clearPendingStart();
      startTs = Date.now();
      holdBtn.classList.add('pressing');
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(tick);
      syncWakeLockState();
    }

    function onHoldStart(e) {
      e.preventDefault();
      if (startTs !== null || pendingStart) {
        return;
      }

      if (delayMs > 0) {
        pendingStart = true;
        delayEndTs = Date.now() + delayMs;
        holdBtn.classList.add('armed');
        pendingTick();
        syncWakeLockState();
        delayTimerId = setTimeout(() => {
          if (pendingStart) {
            beginTimingNow();
          }
        }, delayMs);
        return;
      }

      beginTimingNow();
    }

    function onHoldEnd(e) {
      if (startTs === null && !pendingStart) {
        return;
      }

      e.preventDefault();

      if (pendingStart) {
        clearPendingStart();
        showIdleLabel();
        return;
      }

      const elapsed = Date.now() - startTs;
      startTs = null;
      cancelAnimationFrame(rafId);
      holdBtn.classList.remove('pressing');
      syncWakeLockState();

      if (elapsed >= 50) {
        times.push(elapsed);
        save();
        renderTotalTime();
        renderList();
        renderTopList();
      }

      showIdleLabel();
    }

    function onClickToggle(e) {
      e.preventDefault();

      if (startTs !== null) {
        const elapsed = Date.now() - startTs;
        startTs = null;
        cancelAnimationFrame(rafId);
        holdBtn.classList.remove('pressing');
        syncWakeLockState();

        if (elapsed >= 50) {
          times.push(elapsed);
          save();
          renderTotalTime();
          renderList();
          renderTopList();
        }

        showIdleLabel();
        return;
      }

      if (pendingStart) {
        clearPendingStart();
        showIdleLabel();
        return;
      }

      if (delayMs > 0) {
        pendingStart = true;
        delayEndTs = Date.now() + delayMs;
        holdBtn.classList.add('armed');
        pendingTick();
        syncWakeLockState();
        delayTimerId = setTimeout(() => {
          if (pendingStart) {
            beginTimingNow();
          }
        }, delayMs);
        return;
      }

      beginTimingNow();
    }

    function renderTopList() {
      topList.innerHTML = '';

      if (times.length === 0) {
        const li = document.createElement('li');
        li.className = 'top-list-empty';
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
        medal.className = 'medal';
        medal.textContent = MEDALS[i];

        const dur = document.createElement('span');
        dur.className = 't-dur';
        dur.textContent = formatMs(ms);

        li.appendChild(medal);
        li.appendChild(dur);
        topList.appendChild(li);
      });
    }

    function renderTotalTime() {
      const totalMs = times.reduce((sum, value) => sum + value, 0);
      timeTotal.textContent = totalMs > 0 ? `Total: ${formatMs(totalMs)}` : 'Total: —';
    }

    function renderList() {
      timeList.innerHTML = '';

      if (times.length === 0) {
        const li = document.createElement('li');
        li.className = 'empty-msg';
        li.textContent = 'No times recorded yet.';
        timeList.appendChild(li);
        return;
      }

      const sorted = [...times]
        .map((ms, idx) => ({ ms, idx }))
        .sort((a, b) => b.ms - a.ms);

      const rankMap = new Map();
      sorted.forEach((item, pos) => rankMap.set(item.idx, pos + 1));

      [...times].reverse().forEach((ms, revIdx) => {
        const origIdx = times.length - 1 - revIdx;
        const rank = rankMap.get(origIdx);

        const li = document.createElement('li');
        if (rank === 1) {
          li.classList.add('top-1');
        } else if (rank === 2) {
          li.classList.add('top-2');
        } else if (rank === 3) {
          li.classList.add('top-3');
        }

        const rankSpan = document.createElement('span');
        rankSpan.className = 'rank';
        rankSpan.textContent = `#${rank}`;

        const durSpan = document.createElement('span');
        durSpan.className = 'duration';
        durSpan.textContent = formatMs(ms);

        li.appendChild(rankSpan);
        li.appendChild(durSpan);
        timeList.appendChild(li);
      });
    }

    function resetAll() {
      if (times.length === 0) {
        return;
      }

      if (confirm('Delete all saved times? This cannot be undone.')) {
        times = [];
        save();
        renderTotalTime();
        renderList();
        renderTopList();
        showIdleLabel();
      }
    }

    resetBtn.addEventListener('click', resetAll);
    resetBtn.addEventListener('touchend', (e) => {
      e.preventDefault();
      resetAll();
    }, { passive: false });

    if (triggerMode === 'click') {
      holdBtn.addEventListener('click', onClickToggle);
    } else {
      holdBtn.addEventListener('mousedown', onHoldStart);
      holdBtn.addEventListener('touchstart', onHoldStart, { passive: false });
      document.addEventListener('mouseup', onHoldEnd);
      document.addEventListener('touchend', onHoldEnd, { passive: false });
      document.addEventListener('touchcancel', onHoldEnd, { passive: false });

      holdBtn.addEventListener('keydown', (e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          onHoldStart(e);
        }
      });

      holdBtn.addEventListener('keyup', (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          onHoldEnd(e);
        }
      });
    }

    load();
    renderTotalTime();
    renderList();
    renderTopList();
    showIdleLabel();
    syncWakeLockState();
  }

  function initTabs() {
    const tabButtons = [...document.querySelectorAll('.tab-btn')];
    const panels = [...document.querySelectorAll('.tab-panel')];

    function setActiveTab(tabName) {
      tabButtons.forEach((btn) => {
        const isActive = btn.dataset.tab === tabName;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });

      panels.forEach((panel) => {
        const isActive = panel.dataset.panel === tabName;
        panel.classList.toggle('active', isActive);
      });
    }

    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
    });

    setActiveTab('classic');
  }

  const wakeLockManager = createWakeLockManager();

  createStopwatch({
    storageKey: 'holdDownTimer_times',
    delayMs: 0,
    triggerMode: 'hold',
    idleHint: 'Hold to start',
    wakeLockManager,
    holdBtn: document.getElementById('holdBtn'),
    btnLabel: document.getElementById('btnLabel'),
    btnSub: document.getElementById('btnSub'),
    resetBtn: document.getElementById('resetBtn'),
    topList: document.getElementById('topList'),
    timeTotal: document.getElementById('timeTotal'),
    timeList: document.getElementById('timeList')
  });

  createStopwatch({
    storageKey: 'holdDownTimer_times_delay5',
    delayMs: 5000,
    triggerMode: 'click',
    idleHint: 'Click to start (5s delay)',
    wakeLockManager,
    holdBtn: document.getElementById('holdBtnDelay'),
    btnLabel: document.getElementById('btnLabelDelay'),
    btnSub: document.getElementById('btnSubDelay'),
    resetBtn: document.getElementById('resetBtnDelay'),
    topList: document.getElementById('topListDelay'),
    timeTotal: document.getElementById('timeTotalDelay'),
    timeList: document.getElementById('timeListDelay')
  });

  initTabs();
})();
