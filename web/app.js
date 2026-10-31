/**
 * AgentDesk — Herdr Terminal Multiplexer Interface
 * v0.3.0 — Phases 3, 4, 5 Complete
 */
(function() {
  'use strict';

  // Config & Secret
  const urlParams = new URLSearchParams(window.location.search);
  let secret = urlParams.get('secret') || localStorage.getItem('agentdesk_secret') || '';
  if (urlParams.get('secret')) {
    localStorage.setItem('agentdesk_secret', secret);
  }

  // App State
  let currentSnapshot = null;
  let activeWorkspaceFilter = '';
  let activeAgentFilter = '';
  let activeTerminalPaneId = null;
  let blockedPaneId = null;
  let selectedSession = null;
  let searchTimer = null;
  let eventSource = null;
  let terminalEventSource = null;
  let terminalPollTimer = null;
  let autoScrollEnabled = true;
  let terminalLastRevision = -1;
  let terminalLastOutput = '';
  let sessionPollTimer = null;
  let sessionLastSignature = '';
  let activeSortMode = localStorage.getItem('agentdesk_sort') || 'attention';
  let audioCtx = null;
  let alertsEnabled = localStorage.getItem('agentdesk_alerts') !== 'false';
  let speechRecognition = null;
  let isRecording = false;

  // DOM Elements
  const connDot = document.getElementById('conn-dot');
  const connLabel = document.getElementById('conn-label');
  const wsTabStrip = document.getElementById('ws-tab-strip');
  const wsBadgeAll = document.getElementById('ws-badge-all');
  const approvalBanner = document.getElementById('approval-banner');
  const bannerPaneId = document.getElementById('banner-pane-id');
  const bannerPrompt = document.getElementById('banner-prompt');
  const bannerApproveBtn = document.getElementById('banner-approve-btn');
  const bannerRejectBtn = document.getElementById('banner-reject-btn');
  const panesContainer = document.getElementById('panes-container');
  const btnRefresh = document.getElementById('btn-refresh');
  const selectPaneSort = document.getElementById('select-pane-sort');

  // Header Tools
  const btnToggleAlerts = document.getElementById('btn-toggle-alerts');
  const btnOpenLauncher = document.getElementById('btn-open-launcher');
  const btnToggleBoard = document.getElementById('btn-toggle-board');

  // Sessions View
  const sessionSearchInput = document.getElementById('session-search-input');
  const agentFilterPills = document.getElementById('agent-filter-pills');
  const sessionsList = document.getElementById('sessions-list');

  // Terminal Drawer Elements
  const terminalModalOverlay = document.getElementById('terminal-modal-overlay');
  const terminalPaneTitle = document.getElementById('terminal-pane-title');
  const terminalLiveBadge = document.getElementById('terminal-live-badge');
  const btnToggleAutoScroll = document.getElementById('btn-toggle-autoscroll');
  const terminalStreamContent = document.getElementById('terminal-stream-content');
  const terminalCloseBtn = document.getElementById('terminal-close-btn');
  const btnDrawerKill = document.getElementById('btn-drawer-kill');
  const btnDrawerClosePane = document.getElementById('btn-drawer-close-pane');
  const tuiPromptChips = document.querySelectorAll('#tui-prompt-chips .prompt-chip');
  const tuiInputBox = document.getElementById('tui-input-box');
  const btnVoiceDictate = document.getElementById('btn-voice-dictate');
  const btnTuiSend = document.getElementById('btn-tui-send');
  const btnTuiScroll = document.getElementById('btn-tui-scroll');

  // Launcher Modal Elements
  const launcherModalOverlay = document.getElementById('launcher-modal-overlay');
  const launcherCloseBtn = document.getElementById('launcher-close-btn');
  const launcherWorkdirSelect = document.getElementById('launcher-workdir-select');
  const launcherAgentSelect = document.getElementById('launcher-agent-select');
  const launcherLabelInput = document.getElementById('launcher-label-input');
  const launcherPromptInput = document.getElementById('launcher-prompt-input');
  const btnSubmitLaunch = document.getElementById('btn-submit-launch');

  // Board Modal Elements
  const boardModalOverlay = document.getElementById('board-modal-overlay');
  const boardCloseBtn = document.getElementById('board-close-btn');
  const btnBoardAddFeedback = document.getElementById('btn-board-add-feedback');
  const boardTasksList = document.getElementById('board-tasks-list');

  // Session Details Modal
  const sessionDetailOverlay = document.getElementById('session-detail-overlay');
  const sessionModalTitle = document.getElementById('session-modal-title');
  const sessionLiveBadge = document.getElementById('session-live-badge');
  const btnSessionRefresh = document.getElementById('btn-session-refresh');
  const sessionModalBody = document.getElementById('session-modal-body');
  const sessionCloseBtn = document.getElementById('session-close-btn');
  const btnTuiTransfer = document.getElementById('btn-tui-transfer');
  const tuiToast = document.getElementById('tui-toast');

  // -------------------------------------------------------------------------
  // Alert System (Web Audio chime, Vibration, Lock-screen Push)
  // -------------------------------------------------------------------------
  function updateAlertsUI() {
    if (!btnToggleAlerts) return;
    if (alertsEnabled) {
      btnToggleAlerts.textContent = '[ 🔔 ON ]';
      btnToggleAlerts.classList.add('active');
    } else {
      btnToggleAlerts.textContent = '[ 🔕 OFF ]';
      btnToggleAlerts.classList.remove('active');
    }
  }

  if (btnToggleAlerts) {
    updateAlertsUI();
    btnToggleAlerts.addEventListener('click', async () => {
      alertsEnabled = !alertsEnabled;
      localStorage.setItem('agentdesk_alerts', alertsEnabled ? 'true' : 'false');
      updateAlertsUI();
      if (alertsEnabled) {
        if ('Notification' in window && Notification.permission === 'default') {
          try {
            await Notification.requestPermission();
          } catch (e) {}
        }
        playAlert();
        showToast('✓ ALERTS ENABLED');
      } else {
        showToast('ALERTS MUTED');
      }
    });
  }

  function playAlert() {
    if (!alertsEnabled) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.31);
    } catch (e) {}

    if ('vibrate' in navigator) {
      try { navigator.vibrate([150, 80, 150]); } catch (e) {}
    }
  }

  function sendLockScreenNotification(title, body) {
    if (!alertsEnabled) return;
    playAlert();
    if ('Notification' in window && Notification.permission === 'granted') {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(reg => {
          reg.showNotification(title, {
            body: body,
            icon: './icon.svg',
            badge: './icon.svg',
            vibrate: [200, 100, 200],
            tag: 'agentdesk-alert',
            data: { url: window.location.href }
          });
        }).catch(() => {
          new Notification(title, { body, icon: './icon.svg' });
        });
      } else {
        new Notification(title, { body, icon: './icon.svg' });
      }
    }
  }

  function showToast(text) {
    if (!tuiToast) return;
    tuiToast.textContent = text;
    tuiToast.classList.add('show');
    setTimeout(() => tuiToast.classList.remove('show'), 2000);
  }

  // -------------------------------------------------------------------------
  // API Client
  // -------------------------------------------------------------------------
  function getUrl(path, params = {}) {
    const u = new URL(path, window.location.origin);
    if (secret) u.searchParams.set('secret', secret);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
    }
    return u.toString();
  }

  async function api(path, options = {}) {
    const u = getUrl(path, options.params);
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (secret) headers['Authorization'] = `Bearer ${secret}`;
    const res = await fetch(u, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  // -------------------------------------------------------------------------
  // View Navigation & Sorting Controls
  // -------------------------------------------------------------------------
  function switchToView(targetId) {
    document.querySelectorAll('.tui-nav-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-view') === targetId);
    });
    document.querySelectorAll('.tui-view').forEach(v => {
      v.classList.toggle('active', v.id === targetId);
    });
    if (targetId === 'sessions-view') loadSessions();
    if (targetId === 'swarm-view') loadSwarm();
  }

  document.querySelectorAll('.tui-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      switchToView(btn.getAttribute('data-view'));
    });
  });

  if (selectPaneSort) {
    selectPaneSort.value = activeSortMode;
    selectPaneSort.addEventListener('change', () => {
      activeSortMode = selectPaneSort.value;
      localStorage.setItem('agentdesk_sort', activeSortMode);
      if (currentSnapshot) renderSnapshot(currentSnapshot);
    });
  }

  // -------------------------------------------------------------------------
  // Render Workspace Filter Strip
  // -------------------------------------------------------------------------
  function renderWorkspaces(workspaces, panes) {
    if (!workspaces || !wsTabStrip) return;

    wsBadgeAll.textContent = panes.length;

    let html = `<button class="ws-tab ${activeWorkspaceFilter === '' ? 'active' : ''}" data-ws="">[ ALL <span class="badge">${panes.length}</span> ]</button>`;
    
    workspaces.forEach(w => {
      const wsPanes = panes.filter(p => p.workspace_id === w.workspace_id);
      const isAct = activeWorkspaceFilter === w.workspace_id;
      const wsName = w.label || `#${w.number}`;
      html += `
        <button class="ws-tab ${isAct ? 'active' : ''}" data-ws="${w.workspace_id}">
          [ ${w.number}: ${escapeHtml(wsName)} <span class="badge">${wsPanes.length}</span> ]
        </button>
      `;
    });

    wsTabStrip.innerHTML = html;

    wsTabStrip.querySelectorAll('.ws-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        activeWorkspaceFilter = tab.getAttribute('data-ws') || '';
        renderSnapshot(currentSnapshot);
      });
    });
  }

  // -------------------------------------------------------------------------
  // Render Herdr Panes & Telemetry Badges
  // -------------------------------------------------------------------------
  function renderSnapshot(snap) {
    if (!snap) return;
    currentSnapshot = snap;
    const panes = snap.panes || [];
    const workspaces = snap.workspaces || [];

    renderWorkspaces(workspaces, panes);

    // Filter panes by selected workspace
    const filteredPanes = activeWorkspaceFilter
      ? panes.filter(p => p.workspace_id === activeWorkspaceFilter)
      : panes;

    // Check for blocked agent
    const blocked = panes.find(p => p.agent_status === 'blocked');
    if (blocked) {
      blockedPaneId = blocked.pane_id;
      const ag = (blocked.agent || blocked.display_agent || 'agent').toUpperCase();
      bannerPaneId.textContent = `[${ag} • ${blocked.pane_id}]`;
      bannerPrompt.textContent = blocked.terminal_title_stripped || blocked.terminal_title || 'Waiting for tool execution permission';
      approvalBanner.style.display = 'block';
    } else {
      blockedPaneId = null;
      approvalBanner.style.display = 'none';
    }

    if (filteredPanes.length === 0) {
      panesContainer.innerHTML = `
        <div style="color:var(--text-muted); text-align:center; padding:30px 10px; border:1px dashed var(--border); border-radius:4px;">
          (no panes in selected workspace)
        </div>`;
      return;
    }

    // Map workspaces for easy lookup
    const wsMap = {};
    workspaces.forEach(w => { wsMap[w.workspace_id] = w.label || `#${w.number}`; });

    // Priority scoring for attention-first sorting (Blocked & Done on top)
    function getStatusPriority(status) {
      switch ((status || '').toLowerCase()) {
        case 'blocked': return 100;
        case 'done': return 80;
        case 'working': return 60;
        case 'idle': return 40;
        default: return 20;
      }
    }

    // Sort panes based on activeSortMode
    filteredPanes.sort((a, b) => {
      if (activeSortMode === 'attention') {
        const pDiff = getStatusPriority(b.agent_status) - getStatusPriority(a.agent_status);
        if (pDiff !== 0) return pDiff;
        return (b.revision || 0) - (a.revision || 0);
      } else if (activeSortMode === 'status') {
        const order = { 'working': 1, 'blocked': 2, 'done': 3, 'idle': 4 };
        const oA = order[(a.agent_status || '').toLowerCase()] || 9;
        const oB = order[(b.agent_status || '').toLowerCase()] || 9;
        return oA - oB;
      } else if (activeSortMode === 'workspace') {
        return (a.workspace_id || '').localeCompare(b.workspace_id || '');
      } else if (activeSortMode === 'name') {
        const nA = a.chat_title || a.terminal_title_stripped || a.pane_id;
        const nB = b.chat_title || b.terminal_title_stripped || b.pane_id;
        return nA.localeCompare(nB);
      }
      return 0;
    });

    panesContainer.innerHTML = filteredPanes.map(p => {
      const pid = p.pane_id;
      const ag = (p.agent || p.display_agent || 'terminal').toLowerCase();
      const status = p.agent_status || 'unknown';
      const wsName = wsMap[p.workspace_id] || p.workspace_id || '';
      const rawTitle = p.terminal_title_stripped || p.terminal_title || `Pane ${pid}`;
      const chatTitle = p.chat_title || rawTitle;
      const chatIcon = p.chat_title ? '💬' : '⚡';
      const cwd = (p.foreground_cwd || p.cwd || '~').replace('/home/ashish', '~');

      const isWorking = status === 'working';
      const isBlocked = status === 'blocked';

      // Status marker symbol
      const statusIcon = isWorking ? '●' : (isBlocked ? '▲' : (status === 'idle' ? '■' : '○'));
      const workingPulse = isWorking ? ' ⟳' : '';

      // Telemetry badge
      const tel = p.telemetry;
      const hasTel = tel && (tel.is_running || tel.turns > 0 || tel.duration_str);
      const telBadge = hasTel ? `
        <div class="pane-telemetry-badge">
          <span>⏱️ ${tel.duration_str || '0s'}</span>
          <span>• ${tel.turns || 0} turns</span>
          <span>• ~${Math.round((tel.estimated_tokens || 0) / 1000)}k tok</span>
        </div>
      ` : '';

      // Live context prompt/message
      const lastCtx = p.last_context || p.last_user_prompt || '';
      const contextSnippet = lastCtx ? `
        <div class="pane-context-msg">
          <span class="context-tag user">[PROMPT]:</span>
          <span class="context-text">${escapeHtml(lastCtx)}</span>
        </div>
      ` : '';

      // Live console ticker preview
      const previewLine = p.preview_line || '';
      const previewSnippet = previewLine ? `
        <div class="pane-console-preview">
          <span class="preview-prompt">&gt;</span>
          <span class="preview-text">${escapeHtml(previewLine)}</span>
          <span class="preview-cursor">_</span>
        </div>
      ` : '';

      return `
        <div class="pane-box ${isWorking ? 'is-working' : ''} ${isBlocked ? 'is-blocked' : ''}" data-pane-id="${pid}">
          <div class="pane-topbar">
            <div>
              <span class="pane-id-tag">${pid}</span>
              ${wsName ? `<span class="pane-ws-tag"> // ${escapeHtml(wsName)}</span>` : ''}
            </div>
            <span class="pane-agent-pill ${status}">
              ${statusIcon} ${ag}: ${status}${workingPulse}
            </span>
          </div>
          <div class="pane-body">
            <div class="pane-chat-title">
              <span class="chat-icon">${chatIcon}</span>
              <span>${escapeHtml(chatTitle)}</span>
            </div>
            ${chatTitle !== rawTitle && rawTitle ? `<div class="pane-meta" style="font-size:10px; opacity:0.8; margin-bottom:2px;">tty: ${escapeHtml(rawTitle)}</div>` : ''}
            <div class="pane-meta">cwd: ${escapeHtml(cwd)}</div>
            ${telBadge}
            ${contextSnippet}
            ${previewSnippet}
          </div>
          <div class="pane-actions-bar">
            <button class="btn-tui-action primary" onclick="window.tuiPeek('${pid}', '${escapeHtml(chatTitle)} // ${pid}')">&gt; PEEK</button>
            <button class="btn-tui-action approve" onclick="window.tuiApprove('${pid}')">&gt; APPROVE (y)</button>
            <button class="btn-tui-action abort" onclick="window.tuiInterrupt('${pid}')">&gt; ABORT (^C)</button>
            <button class="btn-tui-action close" onclick="window.tuiClosePane('${pid}')" title="Close Pane">&gt; CLOSE</button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Quick Action Triggers
  window.tuiClosePane = async function(paneId) {
    const pid = paneId || activeTerminalPaneId;
    if (!pid) return;
    if (!confirm(`Close terminal pane ${pid}? This will terminate the pane in Herdr.`)) return;
    try {
      await api('/api/pane/close', { method: 'POST', body: { pane_id: pid } });
      showToast(`✓ PANE ${pid} CLOSED`);
      if (activeTerminalPaneId === pid) {
        closeTerminalModal();
      }
      setTimeout(refreshPanes, 600);
    } catch (err) {
      alert('Close failed: ' + err.message);
    }
  };

  // Quick Action Triggers
  window.tuiApprove = async function(paneId) {
    const pid = paneId || blockedPaneId;
    if (!pid) return;
    try {
      await api('/api/approve', { method: 'POST', body: { pane_id: pid } });
      showToast(`✓ APPROVE SENT TO ${pid}`);
      approvalBanner.style.display = 'none';
      blockedPaneId = null;
      setTimeout(refreshPanes, 500);
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  window.tuiInterrupt = async function(paneId) {
    const pid = paneId || blockedPaneId;
    if (!pid) return;
    try {
      await api('/api/keys', {
        method: 'POST',
        body: { pane_id: pid, key: 'ctrl+c' }
      });
      showToast(`⛔ ^C SENT TO ${pid}`);
      setTimeout(refreshPanes, 500);
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  bannerApproveBtn.addEventListener('click', () => window.tuiApprove(blockedPaneId));
  bannerRejectBtn.addEventListener('click', () => window.tuiInterrupt(blockedPaneId));

  // -------------------------------------------------------------------------
  // Terminal Drawer & Live Streaming (Phase 3 & Live Streaming Delivery)
  // -------------------------------------------------------------------------
  function updateAutoScrollUI() {
    if (!btnToggleAutoScroll) return;
    if (autoScrollEnabled) {
      btnToggleAutoScroll.textContent = '[ ⚡ AUTO-SCROLL: ON ]';
      btnToggleAutoScroll.classList.remove('paused');
    } else {
      btnToggleAutoScroll.textContent = '[ ⚡ AUTO-SCROLL: PAUSED ]';
      btnToggleAutoScroll.classList.add('paused');
    }
  }

  if (btnToggleAutoScroll) {
    btnToggleAutoScroll.addEventListener('click', () => {
      autoScrollEnabled = !autoScrollEnabled;
      updateAutoScrollUI();
      if (autoScrollEnabled) {
        terminalStreamContent.scrollTop = terminalStreamContent.scrollHeight;
      }
    });
  }

  // Detect manual user scrolling in terminal box to pause/resume auto-scroll
  terminalStreamContent.addEventListener('scroll', () => {
    const fromBottom = terminalStreamContent.scrollHeight - terminalStreamContent.scrollTop - terminalStreamContent.clientHeight;
    if (fromBottom > 50) {
      if (autoScrollEnabled) {
        autoScrollEnabled = false;
        updateAutoScrollUI();
      }
    } else if (fromBottom <= 10) {
      if (!autoScrollEnabled) {
        autoScrollEnabled = true;
        updateAutoScrollUI();
      }
    }
  });

  function updateTerminalOutput(text, revision) {
    if (text === terminalLastOutput) return;
    terminalLastOutput = text;
    terminalLastRevision = revision !== undefined ? revision : terminalLastRevision;
    terminalStreamContent.textContent = text || '(empty buffer)';
    if (autoScrollEnabled) {
      terminalStreamContent.scrollTop = terminalStreamContent.scrollHeight;
    }
  }

  async function fetchPaneTerminal(paneId, silent = false) {
    try {
      const res = await api(`/api/pane/${encodeURIComponent(paneId)}/read`, { params: { lines: 120 } });
      if (res && res.output !== undefined) {
        updateTerminalOutput(res.output, res.revision);
      }
    } catch (err) {
      if (!silent) {
        terminalStreamContent.textContent = `! Read error: ${err.message}`;
      }
    }
  }

  function startTerminalLiveStream(paneId) {
    closeActiveTerminalStream();

    // 1. Initial fast read
    fetchPaneTerminal(paneId, false);

    // 2. Real-time Server-Sent Events stream
    try {
      const sseUrl = getUrl(`/api/pane/${encodeURIComponent(paneId)}/stream`);
      terminalEventSource = new EventSource(sseUrl);

      terminalEventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data && data.output !== undefined) {
            updateTerminalOutput(data.output, data.revision);
          }
        } catch (e) {}
      };

      terminalEventSource.onerror = () => {
        if (terminalEventSource) {
          try { terminalEventSource.close(); } catch (e) {}
          terminalEventSource = null;
        }
      };
    } catch (e) {
      console.warn('SSE terminal stream failed to init', e);
    }

    // 3. Fallback continuous polling interval (every 700ms)
    // Guarantees zero missed output even if network proxies buffer SSE
    terminalPollTimer = setInterval(() => {
      if (activeTerminalPaneId === paneId) {
        fetchPaneTerminal(paneId, true);
      }
    }, 700);
  }

  function closeActiveTerminalStream() {
    if (terminalEventSource) {
      try { terminalEventSource.close(); } catch (e) {}
      terminalEventSource = null;
    }
    if (terminalPollTimer) {
      clearInterval(terminalPollTimer);
      terminalPollTimer = null;
    }
  }

  window.tuiPeek = function(paneId, title = 'TERMINAL') {
    closeActiveTerminalStream();
    activeTerminalPaneId = paneId;
    terminalLastRevision = -1;
    terminalLastOutput = '';
    autoScrollEnabled = true;
    updateAutoScrollUI();

    terminalPaneTitle.textContent = title;
    terminalStreamContent.textContent = '> connecting live pane stream...';
    terminalModalOverlay.style.display = 'block';

    startTerminalLiveStream(paneId);
  };

  function closeTerminalModal() {
    terminalModalOverlay.style.display = 'none';
    closeActiveTerminalStream();
    activeTerminalPaneId = null;
  }

  terminalCloseBtn.addEventListener('click', closeTerminalModal);

  terminalModalOverlay.addEventListener('click', (e) => {
    if (e.target === terminalModalOverlay) {
      closeTerminalModal();
    }
  });

  btnTuiScroll.addEventListener('click', () => {
    autoScrollEnabled = true;
    updateAutoScrollUI();
    terminalStreamContent.scrollTop = terminalStreamContent.scrollHeight;
  });

  // Emergency Process Kill Button
  if (btnDrawerKill) {
    btnDrawerKill.addEventListener('click', async () => {
      if (!activeTerminalPaneId) return;
      if (!confirm(`Emergency kill active process in pane ${activeTerminalPaneId}?`)) return;
      try {
        await api(`/api/pane/${encodeURIComponent(activeTerminalPaneId)}/kill`, {
          method: 'POST',
          body: { force: true }
        });
        showToast(`⛔ PROCESS TERMINATED IN ${activeTerminalPaneId}`);
        setTimeout(() => fetchPaneTerminal(activeTerminalPaneId), 500);
        setTimeout(refreshPanes, 800);
      } catch (err) {
        alert('Kill failed: ' + err.message);
      }
    });
  }

  // Close Pane from Drawer Button
  if (btnDrawerClosePane) {
    btnDrawerClosePane.addEventListener('click', () => {
      if (activeTerminalPaneId) {
        window.tuiClosePane(activeTerminalPaneId);
      }
    });
  }

  // Keypad Actions
  document.querySelectorAll('.keycap').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!activeTerminalPaneId) return;
      const action = btn.getAttribute('data-action');
      const key = btn.getAttribute('data-key');
      if (!action && !key) return;

      try {
        if (action === 'y_enter') {
          await api('/api/interact', {
            method: 'POST',
            body: { pane_id: activeTerminalPaneId, text: 'y', submit: true }
          });
          showToast('✓ APPROVED (y+↵)');
        } else if (action === 'n_enter') {
          await api('/api/interact', {
            method: 'POST',
            body: { pane_id: activeTerminalPaneId, text: 'n', submit: true }
          });
          showToast('✓ REJECTED (n+↵)');
        } else if (key) {
          await api('/api/keys', {
            method: 'POST',
            body: { pane_id: activeTerminalPaneId, key: key }
          });
          showToast(`✓ KEY [${key.toUpperCase()}] TRANSMITTED`);
        }
        setTimeout(() => fetchPaneTerminal(activeTerminalPaneId), 300);
        setTimeout(() => fetchPaneTerminal(activeTerminalPaneId), 900);
      } catch (err) {
        alert('Send error: ' + err.message);
      }
    });
  });

  // Quick Prompt Chips
  tuiPromptChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const cmd = chip.getAttribute('data-cmd');
      if (!cmd || !activeTerminalPaneId) return;
      tuiInputBox.value = cmd;
      sendTuiCommand();
    });
  });

  // Voice Dictation
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRec && btnVoiceDictate) {
    speechRecognition = new SpeechRec();
    speechRecognition.continuous = false;
    speechRecognition.interimResults = false;
    speechRecognition.lang = 'en-US';

    speechRecognition.onstart = () => {
      isRecording = true;
      btnVoiceDictate.classList.add('recording');
      showToast('🎙️ LISTENING...');
    };

    speechRecognition.onresult = (evt) => {
      if (evt.results && evt.results[0] && evt.results[0][0]) {
        const transcript = evt.results[0][0].transcript;
        if (transcript) {
          tuiInputBox.value = tuiInputBox.value ? `${tuiInputBox.value} ${transcript}` : transcript;
          tuiInputBox.focus();
          showToast('✓ VOICE CAPTURED');
        }
      }
    };

    speechRecognition.onerror = (e) => {
      showToast(`! MIC ERROR: ${e.error || 'failed'}`);
      isRecording = false;
      btnVoiceDictate.classList.remove('recording');
    };

    speechRecognition.onend = () => {
      isRecording = false;
      btnVoiceDictate.classList.remove('recording');
    };

    btnVoiceDictate.addEventListener('click', () => {
      if (isRecording) {
        speechRecognition.stop();
      } else {
        try {
          speechRecognition.start();
        } catch (e) {
          console.warn(e);
        }
      }
    });
  } else if (btnVoiceDictate) {
    btnVoiceDictate.style.display = 'none';
  }

  // Prompt Send Command
  async function sendTuiCommand() {
    const txt = tuiInputBox.value.trim();
    if (!txt || !activeTerminalPaneId) return;
    tuiInputBox.value = '';
    try {
      await api('/api/interact', {
        method: 'POST',
        body: { pane_id: activeTerminalPaneId, text: txt, submit: true }
      });
      showToast('✓ PROMPT TRANSMITTED');
      setTimeout(() => fetchPaneTerminal(activeTerminalPaneId), 300);
      setTimeout(() => fetchPaneTerminal(activeTerminalPaneId), 900);
    } catch (err) {
      alert('Send failed: ' + err.message);
    }
  }

  btnTuiSend.addEventListener('click', sendTuiCommand);
  tuiInputBox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendTuiCommand();
  });

  // -------------------------------------------------------------------------
  // Remote Agent Launcher Modal (Phase 4)
  // -------------------------------------------------------------------------
  async function loadWorkdirs() {
    try {
      const res = await api('/api/workdirs');
      const dirs = res.workdirs || [];
      let opts = `<option value="~/Work">~/Work (Root)</option>`;
      dirs.forEach(d => {
        opts += `<option value="${escapeHtml(d.path)}">${escapeHtml(d.name)} (${escapeHtml(d.path.replace('/home/ashish', '~'))})</option>`;
      });
      launcherWorkdirSelect.innerHTML = opts;
    } catch (e) {
      console.warn('Failed to load workdirs', e);
    }
  }

  if (btnOpenLauncher) {
    btnOpenLauncher.addEventListener('click', () => {
      launcherModalOverlay.style.display = 'block';
      loadWorkdirs();
    });
  }

  if (launcherCloseBtn) {
    launcherCloseBtn.addEventListener('click', () => {
      launcherModalOverlay.style.display = 'none';
    });
  }

  if (launcherModalOverlay) {
    launcherModalOverlay.addEventListener('click', (e) => {
      if (e.target === launcherModalOverlay) {
        launcherModalOverlay.style.display = 'none';
      }
    });
  }

  if (btnSubmitLaunch) {
    btnSubmitLaunch.addEventListener('click', async () => {
      const cwd = launcherWorkdirSelect.value || '~/Work';
      const agent = launcherAgentSelect.value || 'agy';
      const label = launcherLabelInput.value.trim() || `Agent-${agent}`;
      const prompt = launcherPromptInput.value.trim();

      btnSubmitLaunch.disabled = true;
      btnSubmitLaunch.textContent = 'LAUNCHING...';
      try {
        await api('/api/agents/launch', {
          method: 'POST',
          body: { cwd, agent, label, prompt }
        });
        showToast(`✓ LAUNCHED ${label}`);
        launcherModalOverlay.style.display = 'none';
        launcherLabelInput.value = '';
        launcherPromptInput.value = '';
        setTimeout(refreshPanes, 800);
      } catch (err) {
        alert('Launch failed: ' + err.message);
      } finally {
        btnSubmitLaunch.disabled = false;
        btnSubmitLaunch.textContent = '> LAUNCH IN HERDR ↵';
      }
    });
  }

  // -------------------------------------------------------------------------
  // AgentR Blackboard Modal (Phase 5)
  // -------------------------------------------------------------------------
  async function loadBoard() {
    if (!boardTasksList) return;
    boardTasksList.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:20px;">[ loading blackboard... ]</div>';
    try {
      const res = await api('/api/board');
      const board = res.board || {};
      const tasks = board.tasks || [];
      const feedback = board.feedback || [];

      let html = '<div style="margin-bottom:14px;">';
      if (tasks.length === 0) {
        html += '<div style="color:var(--text-muted); text-align:center; padding:14px;">(no active tasks on board)</div>';
      } else {
        tasks.forEach(t => {
          html += `
            <div class="task-entry">
              <div class="task-entry-top">
                <span style="font-weight:700; color:var(--text); font-size:12px;">${escapeHtml(t.title)}</span>
                <select class="tui-select" onchange="window.tuiUpdateTask('${t.id}', this.value)">
                  <option value="todo" ${t.status === 'todo' ? 'selected' : ''}>TODO</option>
                  <option value="in_progress" ${t.status === 'in_progress' ? 'selected' : ''}>IN PROGRESS</option>
                  <option value="review" ${t.status === 'review' ? 'selected' : ''}>REVIEW</option>
                  <option value="done" ${t.status === 'done' ? 'selected' : ''}>DONE</option>
                </select>
              </div>
              <div style="font-size:10px; color:var(--text-muted);">
                id: ${t.id} | agent: <b style="color:var(--cyan);">${t.agent}</b> | reviewer: <b>${t.review_by || '—'}</b>
              </div>
            </div>
          `;
        });
      }
      html += '</div>';

      // Feedback section
      html += `
        <div class="tui-section-header" style="margin-top:16px;">
          <span>FEEDBACK &amp; FRICTION LOOP</span>
        </div>
      `;

      if (feedback.length === 0) {
        html += '<div style="color:var(--text-muted); text-align:center; padding:10px;">(no feedback logged)</div>';
      } else {
        feedback.forEach(fb => {
          html += `
            <div style="background:var(--bg-frame); border:1px solid var(--border); border-radius:4px; padding:8px 10px; margin-bottom:6px; font-size:11px;">
              <span style="color:var(--purple); font-weight:700;">[${escapeHtml(fb.agent)}]</span>
              <span style="color:var(--text-muted); font-size:10px;">${escapeHtml(fb.timestamp || '')}</span>
              <div style="margin-top:4px; color:#c9d1d9;">${escapeHtml(fb.text)}</div>
            </div>
          `;
        });
      }

      boardTasksList.innerHTML = html;
    } catch (err) {
      if (boardTasksList) boardTasksList.innerHTML = `<div style="color:var(--red); padding:16px;">! Error: ${err.message}</div>`;
    }
  }

  window.tuiUpdateTask = async function(taskId, status) {
    try {
      await api('/api/board/task/update', { method: 'POST', body: { id: taskId, status } });
      showToast(`✓ TASK ${taskId} -> ${status}`);
      loadBoard();
    } catch (err) {
      alert('Update error: ' + err.message);
    }
  };

  if (btnToggleBoard) {
    btnToggleBoard.addEventListener('click', () => {
      boardModalOverlay.style.display = 'block';
      loadBoard();
    });
  }

  if (boardCloseBtn) {
    boardCloseBtn.addEventListener('click', () => {
      boardModalOverlay.style.display = 'none';
    });
  }

  if (boardModalOverlay) {
    boardModalOverlay.addEventListener('click', (e) => {
      if (e.target === boardModalOverlay) boardModalOverlay.style.display = 'none';
    });
  }

  if (btnBoardAddFeedback) {
    btnBoardAddFeedback.addEventListener('click', async () => {
      const text = prompt('LOG AGENT FRICTION OR FEEDBACK:');
      if (!text) return;
      try {
        await api('/api/board/feedback', {
          method: 'POST',
          body: { text: text.trim(), agent: 'mobile' }
        });
        showToast('✓ FEEDBACK LOGGED');
        loadBoard();
      } catch (err) {
        alert('Failed: ' + err.message);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Swarm & Multi-Agent Radar View
  // -------------------------------------------------------------------------
  const swarmContainer = document.getElementById('swarm-container');
  const btnToggleSwarm = document.getElementById('btn-toggle-swarm');

  if (btnToggleSwarm) {
    btnToggleSwarm.addEventListener('click', () => {
      switchToView('swarm-view');
    });
  }

  async function loadSwarm() {
    if (!swarmContainer) return;
    try {
      const data = await api('/api/swarm');
      const swarm = data.swarm || {};

      let html = swarm.html_widget || '';

      // Tasks Matrix
      const tasks = swarm.tasks || [];
      if (tasks.length > 0) {
        html += `
          <div class="swarm-task-matrix">
            <div class="swarm-matrix-header">
              <span>PROJECT BLACKBOARD TASKS (${tasks.length})</span>
              <span style="color:#64748b;">AUTONOMOUS QUEUE</span>
            </div>
        `;
        tasks.slice().reverse().forEach(t => {
          const stClass = `task-st-${t.status || 'todo'}`;
          const stLabel = (t.status || 'todo').toUpperCase();
          let prLink = '';
          if (t.description && t.description.includes('PR #')) {
            const m = t.description.match(/PR #(\d+)/);
            if (m) {
              prLink = `<a href="https://github.com/tangency-labs/solidcraft/pull/${m[1]}" target="_blank" style="color:#38bdf8; text-decoration:underline; margin-left:6px;">PR #${m[1]}</a>`;
            }
          }
          html += `
            <div class="swarm-task-row">
              <span class="task-id-badge">${escapeHtml(t.id)}</span>
              <span class="${stClass}">[${stLabel}]</span>
              <span class="task-title-text">${escapeHtml(t.title)}${prLink}</span>
              <span class="task-agent-tag">@${escapeHtml(t.agent)}</span>
            </div>
          `;
        });
        html += '</div>';
      }

      swarmContainer.innerHTML = html;
    } catch (err) {
      swarmContainer.innerHTML = `<div class="tui-empty-state" style="color:var(--red);">! Failed to load Swarm Radar: ${escapeHtml(err.message)}</div>`;
    }
  }

  // Periodic swarm updater if swarm-view is open
  setInterval(() => {
    const sView = document.getElementById('swarm-view');
    if (sView && sView.classList.contains('active')) {
      loadSwarm();
    }
  }, 4000);

  // -------------------------------------------------------------------------
  // Sessions & AgentR Search
  // -------------------------------------------------------------------------
  async function loadSessions(query = '') {
    sessionsList.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:20px;">[ querying agentr engine... ]</div>';
    try {
      const endpoint = query ? '/api/search' : '/api/sessions';
      const params = query ? { q: query, agent: activeAgentFilter } : { agent: activeAgentFilter, limit: 40 };
      const res = await api(endpoint, { params });
      const items = res.sessions || res.results || [];

      if (items.length === 0) {
        sessionsList.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:20px;">(no sessions match)</div>';
        return;
      }

      sessionsList.innerHTML = items.map(s => {
        const ag = (s.agent || 'agy').toUpperCase();
        return `
          <div class="session-entry" data-agent="${s.agent}" data-cid="${s.cid}">
            <div class="session-top">
              <span style="color:var(--blue); font-weight:700;">[ ${ag} ]</span>
              <span>${s.dt_str || ''} • ${s.step_count || 0} turns</span>
            </div>
            <div class="session-title">${escapeHtml(s.title || 'Untitled Session')}</div>
            <div class="session-snip">${escapeHtml(s.snippet || '')}</div>
          </div>
        `;
      }).join('');

      sessionsList.querySelectorAll('.session-entry').forEach(card => {
        card.addEventListener('click', () => {
          openSessionLog(card.getAttribute('data-agent'), card.getAttribute('data-cid'));
        });
      });
    } catch (err) {
      sessionsList.innerHTML = `<div style="color:var(--red); padding:16px;">! Error: ${err.message}</div>`;
    }
  }

  agentFilterPills.querySelectorAll('.pill-opt').forEach(pill => {
    pill.addEventListener('click', () => {
      agentFilterPills.querySelectorAll('.pill-opt').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeAgentFilter = pill.getAttribute('data-agent') || '';
      loadSessions(sessionSearchInput.value.trim());
    });
  });

  sessionSearchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      loadSessions(e.target.value.trim());
    }, 280);
  });

  // -------------------------------------------------------------------------
  // Session Transcript Log & Live Chat Streaming (Phase 5 Delivery)
  // -------------------------------------------------------------------------
  function stopSessionLiveStream() {
    if (sessionPollTimer) {
      clearInterval(sessionPollTimer);
      sessionPollTimer = null;
    }
  }

  async function openSessionLog(agent, cid) {
    stopSessionLiveStream();
    selectedSession = { agent, cid };
    sessionLastSignature = '';
    sessionModalTitle.textContent = `LOG // ${agent.toUpperCase()} // ${cid.slice(0, 12)}…`;
    sessionModalBody.innerHTML = '<div style="color:var(--text-muted); padding:16px;">[ parsing transcript... ]</div>';
    sessionDetailOverlay.style.display = 'block';

    // 1. Initial immediate fetch
    await fetchSessionDetails(agent, cid, false);

    // 2. Real-time auto-streaming loop (polls every 1500ms)
    // Seamlessly detects newly added turns or streaming assistant tokens
    sessionPollTimer = setInterval(() => {
      if (selectedSession && selectedSession.agent === agent && selectedSession.cid === cid) {
        fetchSessionDetails(agent, cid, true);
      }
    }, 1500);
  }

  async function fetchSessionDetails(agent, cid, isLiveUpdate = false) {
    try {
      const res = await api('/api/sessions/details', { params: { agent, cid } });
      const d = res.details || {};
      const prompts = d.user_prompts || [];
      const msgs = d.assistant_msgs || [];
      const count = Math.max(prompts.length, msgs.length);
      const lastMsg = msgs[msgs.length - 1] || '';
      const sig = `${count}-${lastMsg.length}-${prompts.length}`;

      if (isLiveUpdate && sig === sessionLastSignature) {
        return; // No changes in transcript
      }
      sessionLastSignature = sig;

      let html = `
        <div style="margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid var(--border);">
          <div style="color:var(--blue); font-size:14px; font-weight:700;">${escapeHtml(d.title)}</div>
          <div style="color:var(--text-muted); font-size:11px; margin-top:3px;">
            cwd: ${escapeHtml(d.workdir || '~')} | turns: ${d.turn_count || 0}
          </div>
        </div>
      `;

      for (let i = 0; i < count; i++) {
        if (prompts[i]) {
          html += `
            <div style="background:#111827; border-left:2px solid var(--cyan); padding:8px 10px; margin-bottom:8px;">
              <span style="color:var(--cyan); font-weight:700; font-size:10px;">&gt; USER:</span>
              <div style="margin-top:2px; font-size:12px;">${escapeHtml(prompts[i])}</div>
            </div>
          `;
        }
        if (msgs[i]) {
          html += `
            <div style="background:#090d14; border:1px solid var(--border); padding:8px 10px; margin-bottom:10px; color:#cbd5e1;">
              <span style="color:var(--purple); font-weight:700; font-size:10px;">${agent.toUpperCase()}:</span>
              <div style="margin-top:2px; font-size:11.5px; white-space:pre-wrap;">${escapeHtml(msgs[i]).slice(0, 900)}${msgs[i].length > 900 ? '…' : ''}</div>
            </div>
          `;
        }
      }

      sessionModalBody.innerHTML = html;
      if (isLiveUpdate) {
        sessionModalBody.scrollTop = sessionModalBody.scrollHeight;
      }
    } catch (err) {
      if (!isLiveUpdate) {
        sessionModalBody.innerHTML = `<div style="color:var(--red); padding:16px;">! Error: ${err.message}</div>`;
      }
    }
  }

  function closeSessionModal() {
    sessionDetailOverlay.style.display = 'none';
    stopSessionLiveStream();
    selectedSession = null;
  }

  sessionCloseBtn.addEventListener('click', closeSessionModal);

  sessionDetailOverlay.addEventListener('click', (e) => {
    if (e.target === sessionDetailOverlay) {
      closeSessionModal();
    }
  });

  if (btnSessionRefresh) {
    btnSessionRefresh.addEventListener('click', () => {
      if (selectedSession) {
        fetchSessionDetails(selectedSession.agent, selectedSession.cid, false);
        showToast('✓ TRANSCRIPT SYNCED');
      }
    });
  }

  btnTuiTransfer.addEventListener('click', async () => {
    if (!selectedSession) return;
    const target = prompt('TRANSFER SESSION CONTEXT TO AGENT:\nOptions: agy, opencode, freebuff, grok, kimi, claude', 'freebuff');
    if (!target) return;
    try {
      const res = await api('/api/handoff', {
        method: 'POST',
        body: {
          agent: selectedSession.agent,
          cid: selectedSession.cid,
          target: target.trim().toLowerCase()
        }
      });
      showToast(`✓ HANDOFF -> ${res.target}`);
      sessionDetailOverlay.style.display = 'none';
    } catch (err) {
      alert('Transfer failed: ' + err.message);
    }
  });

  // -------------------------------------------------------------------------
  // Refresh & SSE Event Stream
  // -------------------------------------------------------------------------
  async function refreshPanes() {
    try {
      connDot.classList.remove('offline');
      connLabel.textContent = 'SYNCING';
      const res = await api('/api/status');
      if (res.snapshot) renderSnapshot(res.snapshot);
      connLabel.textContent = 'ONLINE';
    } catch (err) {
      connDot.classList.add('offline');
      connLabel.textContent = 'OFFLINE';
    }
  }

  btnRefresh.addEventListener('click', refreshPanes);

  function initSSE() {
    if (eventSource) {
      try { eventSource.close(); } catch (e) {}
    }
    const u = getUrl('/api/events');
    eventSource = new EventSource(u);

    eventSource.onopen = () => {
      connDot.classList.remove('offline');
      connLabel.textContent = 'ONLINE';
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'init' || data.type === 'sync') {
          if (data.snapshot) renderSnapshot(data.snapshot);
        } else if (data.type === 'state_change') {
          let hasBlocked = false;
          (data.changes || []).forEach(c => {
            if (c.to === 'blocked') hasBlocked = true;
          });
          if (hasBlocked) {
            sendLockScreenNotification('Agent Blocked', 'An agent is waiting for input or approval');
          }
          refreshPanes();
        } else if (data.type === 'agent.blocked') {
          sendLockScreenNotification('Agent Blocked', data.message || `Pane ${data.pane_id} is waiting for user input.`);
          refreshPanes();
        } else if (data.type === 'run.completed') {
          sendLockScreenNotification('Autonomous Run Complete', data.message || `Pane ${data.pane_id} completed execution.`);
          showToast(`🎉 RUN FINISHED: ${data.pane_id}`);
          refreshPanes();
        }
      } catch (err) {}
    };

    eventSource.onerror = () => {
      connDot.classList.add('offline');
      connLabel.textContent = 'RETRYING';
    };
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Live 1-second ticking duration for working pane badges (makes UI feel truly alive)
  setInterval(() => {
    document.querySelectorAll('.pane-box.is-working').forEach(box => {
      const telSpan = box.querySelector('.pane-telemetry-badge span:first-child');
      if (telSpan && telSpan.textContent.startsWith('⏱️')) {
        const text = telSpan.textContent.replace('⏱️', '').trim();
        const parts = text.split(' ');
        let totalSecs = 0;
        parts.forEach(p => {
          if (p.endsWith('m')) totalSecs += parseInt(p) * 60;
          if (p.endsWith('s')) totalSecs += parseInt(p);
        });
        totalSecs += 1;
        const mins = Math.floor(totalSecs / 60);
        const secs = totalSecs % 60;
        const durStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        telSpan.textContent = `⏱️ ${durStr}`;
      }
    });
  }, 1000);

  // -------------------------------------------------------------------------
  // Desktop Terminal Keyboard Navigation (Esc to close/return, shortcuts)
  // -------------------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    // Esc key: always closes the foremost modal or returns to main panes dashboard
    if (e.key === 'Escape') {
      let handled = false;
      if (terminalModalOverlay && terminalModalOverlay.style.display !== 'none' && terminalModalOverlay.style.display !== '') {
        closeTerminalModal();
        handled = true;
      } else if (sessionDetailOverlay && sessionDetailOverlay.style.display !== 'none' && sessionDetailOverlay.style.display !== '') {
        sessionDetailOverlay.style.display = 'none';
        handled = true;
      } else if (launcherModalOverlay && launcherModalOverlay.style.display !== 'none' && launcherModalOverlay.style.display !== '') {
        launcherModalOverlay.style.display = 'none';
        handled = true;
      } else if (boardModalOverlay && boardModalOverlay.style.display !== 'none' && boardModalOverlay.style.display !== '') {
        boardModalOverlay.style.display = 'none';
        handled = true;
      }

      if (handled) {
        e.preventDefault();
        e.stopPropagation();
        if (document.activeElement) document.activeElement.blur();
        return;
      }

      // If no modal is open, but an input is focused, blur it
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        document.activeElement.blur();
        e.preventDefault();
        return;
      }

      // If on sessions view, Esc returns to the main panes menu
      const sessionsView = document.getElementById('sessions-view');
      if (sessionsView && sessionsView.classList.contains('active')) {
        switchToView('panes-view');
        e.preventDefault();
        return;
      }
    }

    // Do not trigger single-key desktop shortcuts while typing in inputs
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
      return;
    }
    // Ignore if Ctrl / Meta / Alt is pressed
    if (e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }

    // Shortcuts
    if (e.key === '1') {
      switchToView('panes-view');
    } else if (e.key === '2') {
      switchToView('sessions-view');
    } else if (e.key === '3' || e.key === 's' || e.key === 'S') {
      switchToView('swarm-view');
    } else if (e.key === '+' || e.key === 'l' || e.key === 'L') {
      if (btnOpenLauncher) {
        e.preventDefault();
        btnOpenLauncher.click();
      }
    } else if (e.key === 'b' || e.key === 'B') {
      if (btnToggleBoard) {
        e.preventDefault();
        btnToggleBoard.click();
      }
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      refreshPanes();
    } else if (e.key === '/') {
      e.preventDefault();
      const sessionsView = document.getElementById('sessions-view');
      if (sessionsView && sessionsView.classList.contains('active')) {
        const sInput = document.getElementById('session-search-input');
        if (sInput) sInput.focus();
      } else {
        if (selectPaneSort) selectPaneSort.focus();
      }
    }
  });

  // Register PWA Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // Startup
  refreshPanes();
  initSSE();

})();
