/**
 * AgentDesk — Herdr Terminal Multiplexer Interface
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
  let audioCtx = null;

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
  const sessionSearchInput = document.getElementById('session-search-input');
  const agentFilterPills = document.getElementById('agent-filter-pills');
  const sessionsList = document.getElementById('sessions-list');
  const boardTasksList = document.getElementById('board-tasks-list');
  const btnAddFeedbackBtn = document.getElementById('btn-add-feedback-btn');
  const terminalModalOverlay = document.getElementById('terminal-modal-overlay');
  const terminalPaneTitle = document.getElementById('terminal-pane-title');
  const terminalStreamContent = document.getElementById('terminal-stream-content');
  const terminalCloseBtn = document.getElementById('terminal-close-btn');
  const tuiInputBox = document.getElementById('tui-input-box');
  const btnTuiSend = document.getElementById('btn-tui-send');
  const btnTuiScroll = document.getElementById('btn-tui-scroll');
  const sessionDetailOverlay = document.getElementById('session-detail-overlay');
  const sessionModalTitle = document.getElementById('session-modal-title');
  const sessionModalBody = document.getElementById('session-modal-body');
  const sessionCloseBtn = document.getElementById('session-close-btn');
  const btnTuiTransfer = document.getElementById('btn-tui-transfer');
  const tuiToast = document.getElementById('tui-toast');

  // Audio / Haptic alert
  function playAlert() {
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

  function showToast(text) {
    if (!tuiToast) return;
    tuiToast.textContent = text;
    tuiToast.classList.add('show');
    setTimeout(() => tuiToast.classList.remove('show'), 2000);
  }

  // API Client
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

  // Bottom Navigation Switching
  document.querySelectorAll('.tui-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tui-nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tui-view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      const targetId = btn.getAttribute('data-view');
      const targetView = document.getElementById(targetId);
      if (targetView) targetView.classList.add('active');

      if (targetId === 'sessions-view') loadSessions();
      if (targetId === 'board-view') loadBoard();
    });
  });

  // Render Workspace Filter Strip
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

  // Render Herdr Panes
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

    panesContainer.innerHTML = filteredPanes.map(p => {
      const pid = p.pane_id;
      const ag = (p.agent || p.display_agent || 'terminal').toLowerCase();
      const status = p.agent_status || 'unknown';
      const wsName = wsMap[p.workspace_id] || p.workspace_id || '';
      const title = p.terminal_title_stripped || p.terminal_title || `Pane ${pid}`;
      const cwd = (p.foreground_cwd || p.cwd || '~').replace('/home/ashish', '~');

      const isWorking = status === 'working';
      const isBlocked = status === 'blocked';

      // Status marker symbol
      const statusIcon = isWorking ? '●' : (isBlocked ? '▲' : (status === 'idle' ? '■' : '○'));

      return `
        <div class="pane-box ${isWorking ? 'is-working' : ''} ${isBlocked ? 'is-blocked' : ''}" data-pane-id="${pid}">
          <div class="pane-topbar">
            <div>
              <span class="pane-id-tag">${pid}</span>
              ${wsName ? `<span class="pane-ws-tag"> // ${escapeHtml(wsName)}</span>` : ''}
            </div>
            <span class="pane-agent-pill ${status}">
              ${statusIcon} ${ag}: ${status}
            </span>
          </div>
          <div class="pane-body">
            <div class="pane-title">${escapeHtml(title)}</div>
            <div class="pane-meta">cwd: ${escapeHtml(cwd)}</div>
          </div>
          <div class="pane-actions-bar">
            <button class="btn-tui-action primary" onclick="window.tuiPeek('${pid}', '${escapeHtml(ag)} // ${pid}')">&gt; PEEK</button>
            <button class="btn-tui-action approve" onclick="window.tuiApprove('${pid}')">&gt; APPROVE (y)</button>
            <button class="btn-tui-action abort" onclick="window.tuiInterrupt('${pid}')">&gt; ABORT (^C)</button>
          </div>
        </div>
      `;
    }).join('');
  }

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
      await api('/api/interact', {
        method: 'POST',
        body: { pane_id: pid, text: '\x03', submit: false }
      });
      showToast(`⛔ ^C SENT TO ${pid}`);
      setTimeout(refreshPanes, 500);
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  bannerApproveBtn.addEventListener('click', () => window.tuiApprove(blockedPaneId));
  bannerRejectBtn.addEventListener('click', () => window.tuiInterrupt(blockedPaneId));

  // Terminal Drawer
  window.tuiPeek = function(paneId, title = 'TERMINAL') {
    activeTerminalPaneId = paneId;
    terminalPaneTitle.textContent = title;
    terminalStreamContent.textContent = '> attaching to pane stream...';
    terminalModalOverlay.style.display = 'block';

    fetchPaneTerminal(paneId);
  };

  async function fetchPaneTerminal(paneId) {
    try {
      const res = await api(`/api/pane/${encodeURIComponent(paneId)}/read`, { params: { lines: 100 } });
      terminalStreamContent.textContent = res.output || '(empty buffer)';
      terminalStreamContent.scrollTop = terminalStreamContent.scrollHeight;
    } catch (err) {
      terminalStreamContent.textContent = `! Read error: ${err.message}`;
    }
  }

  terminalCloseBtn.addEventListener('click', () => {
    terminalModalOverlay.style.display = 'none';
    activeTerminalPaneId = null;
  });

  terminalModalOverlay.addEventListener('click', (e) => {
    if (e.target === terminalModalOverlay) {
      terminalModalOverlay.style.display = 'none';
      activeTerminalPaneId = null;
    }
  });

  btnTuiScroll.addEventListener('click', () => {
    terminalStreamContent.scrollTop = terminalStreamContent.scrollHeight;
  });

  // Macro Keys on keypad
  document.querySelectorAll('.keycap[data-key]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!activeTerminalPaneId) return;
      const k = btn.getAttribute('data-key');
      try {
        await api('/api/interact', {
          method: 'POST',
          body: { pane_id: activeTerminalPaneId, text: k, submit: false }
        });
        showToast('✓ KEY TRANSMITTED');
        setTimeout(() => fetchPaneTerminal(activeTerminalPaneId), 250);
      } catch (err) {
        alert('Send error: ' + err.message);
      }
    });
  });

  async function sendTuiCommand() {
    const txt = tuiInputBox.value;
    if (!txt || !activeTerminalPaneId) return;
    tuiInputBox.value = '';
    try {
      await api('/api/interact', {
        method: 'POST',
        body: { pane_id: activeTerminalPaneId, text: txt, submit: true }
      });
      showToast('✓ PROMPT TRANSMITTED');
      setTimeout(() => fetchPaneTerminal(activeTerminalPaneId), 400);
    } catch (err) {
      alert('Send failed: ' + err.message);
    }
  }

  btnTuiSend.addEventListener('click', sendTuiCommand);
  tuiInputBox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendTuiCommand();
  });

  // Sessions & AgentR Search
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

  // Session Log Modal
  async function openSessionLog(agent, cid) {
    selectedSession = { agent, cid };
    sessionModalTitle.textContent = `LOG // ${agent.toUpperCase()} // ${cid.slice(0, 12)}…`;
    sessionModalBody.innerHTML = '<div style="color:var(--text-muted); padding:16px;">[ parsing transcript... ]</div>';
    sessionDetailOverlay.style.display = 'block';

    try {
      const res = await api('/api/sessions/details', { params: { agent, cid } });
      const d = res.details || {};
      let html = `
        <div style="margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid var(--border);">
          <div style="color:var(--blue); font-size:14px; font-weight:700;">${escapeHtml(d.title)}</div>
          <div style="color:var(--text-muted); font-size:11px; margin-top:3px;">
            cwd: ${escapeHtml(d.workdir || '~')} | turns: ${d.turn_count || 0}
          </div>
        </div>
      `;

      const prompts = d.user_prompts || [];
      const msgs = d.assistant_msgs || [];
      const count = Math.max(prompts.length, msgs.length);

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
    } catch (err) {
      sessionModalBody.innerHTML = `<div style="color:var(--red); padding:16px;">! Error: ${err.message}</div>`;
    }
  }

  sessionCloseBtn.addEventListener('click', () => {
    sessionDetailOverlay.style.display = 'none';
    selectedSession = null;
  });

  sessionDetailOverlay.addEventListener('click', (e) => {
    if (e.target === sessionDetailOverlay) {
      sessionDetailOverlay.style.display = 'none';
      selectedSession = null;
    }
  });

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

  // Project Blackboard (Optional)
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
        html += '<div style="color:var(--text-muted); text-align:center; padding:14px;">(no active tasks)</div>';
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

  if (btnAddFeedbackBtn) {
    btnAddFeedbackBtn.addEventListener('click', async () => {
      const text = prompt('LOG AGENT FRICTION OR IDEA:');
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

  // Refresh
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

  // SSE Stream
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
          if (hasBlocked) playAlert();
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

  // PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // Startup
  refreshPanes();
  initSSE();

})();
