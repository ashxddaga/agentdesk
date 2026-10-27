/**
 * AgentDesk - Mobile Cockpit & Cross-Agent Remote Controller
 */
(function() {
  'use strict';

  // State & Config
  const urlParams = new URLSearchParams(window.location.search);
  let secretKey = urlParams.get('secret') || localStorage.getItem('agentdesk_secret') || '';
  if (urlParams.get('secret')) {
    localStorage.setItem('agentdesk_secret', secretKey);
  }

  let activePaneId = null;
  let blockedPaneId = null;
  let activeFilterAgent = '';
  let selectedSession = null;
  let searchDebounceTimer = null;
  let audioCtx = null;
  let sseSource = null;

  // DOM Elements
  const connDot = document.getElementById('conn-dot');
  const connLabel = document.getElementById('conn-label');
  const statPanesVal = document.getElementById('stat-panes-val');
  const statWorkingVal = document.getElementById('stat-working-val');
  const statWorkspacesVal = document.getElementById('stat-workspaces-val');
  const approvalBanner = document.getElementById('approval-banner');
  const bannerAgentName = document.getElementById('banner-agent-name');
  const bannerText = document.getElementById('banner-text');
  const bannerApproveBtn = document.getElementById('banner-approve-btn');
  const bannerRejectBtn = document.getElementById('banner-reject-btn');
  const agentCardsContainer = document.getElementById('agent-cards-container');
  const btnRefreshCockpit = document.getElementById('btn-refresh-cockpit');
  const sessionSearchInput = document.getElementById('session-search-input');
  const agentFilterStrip = document.getElementById('agent-filter-strip');
  const sessionsListContainer = document.getElementById('sessions-list-container');
  const boardTasksContainer = document.getElementById('board-tasks-container');
  const btnAddFeedbackTop = document.getElementById('btn-add-feedback-top');
  const terminalModalBackdrop = document.getElementById('terminal-modal-backdrop');
  const terminalTitle = document.getElementById('terminal-title');
  const terminalContent = document.getElementById('terminal-content');
  const terminalInputField = document.getElementById('terminal-input-field');
  const btnSendTerminal = document.getElementById('btn-send-terminal');
  const terminalCloseBtn = document.getElementById('terminal-close-btn');
  const btnScrollBottom = document.getElementById('btn-scroll-bottom');
  const sessionDetailBackdrop = document.getElementById('session-detail-backdrop');
  const sessionDetailTitle = document.getElementById('session-detail-title');
  const sessionDetailBody = document.getElementById('session-detail-body');
  const sessionDetailCloseBtn = document.getElementById('session-detail-close-btn');
  const btnTransferSession = document.getElementById('btn-transfer-session');
  const toastMsg = document.getElementById('toast-msg');

  // Toast helper
  function showToast(text, duration = 2200) {
    if (!toastMsg) return;
    toastMsg.textContent = text;
    toastMsg.classList.add('show');
    setTimeout(() => toastMsg.classList.remove('show'), duration);
  }

  // Audio & Haptic Chime
  function playAlertChime() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.14);
      gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.36);
    } catch (e) {}
    if ('vibrate' in navigator) {
      try { navigator.vibrate([160, 100, 160]); } catch (e) {}
    }
  }

  // API Helper
  function getApiUrl(endpoint, params = {}) {
    const url = new URL(endpoint, window.location.origin);
    if (secretKey) url.searchParams.set('secret', secretKey);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    }
    return url.toString();
  }

  async function apiFetch(endpoint, options = {}) {
    const url = getApiUrl(endpoint, options.params);
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (secretKey) headers['Authorization'] = `Bearer ${secretKey}`;
    const res = await fetch(url, {
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

  // View Switching
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view-panel').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      const targetId = btn.getAttribute('data-view');
      const targetView = document.getElementById(targetId);
      if (targetView) targetView.classList.add('active');

      if (targetId === 'sessions-view') loadSessions();
      if (targetId === 'board-view') loadBoard();
    });
  });

  // Render Cockpit Panes & Stats
  function renderSnapshot(snap) {
    if (!snap) return;
    const panes = snap.panes || [];
    const workspaces = snap.workspaces || [];

    // Update Stats
    const workingCount = panes.filter(p => p.agent_status === 'working').length;
    statPanesVal.textContent = panes.length;
    statWorkingVal.textContent = workingCount;
    statWorkspacesVal.textContent = workspaces.length;

    // Check for blocked pane
    const blocked = panes.find(p => p.agent_status === 'blocked');
    if (blocked) {
      blockedPaneId = blocked.pane_id;
      const ag = (blocked.agent || blocked.display_agent || 'Agent').toUpperCase();
      bannerAgentName.textContent = `[${ag}] • Pane ${blocked.pane_id}`;
      bannerText.textContent = blocked.terminal_title_stripped || blocked.terminal_title || 'Waiting for tool approval';
      approvalBanner.style.display = 'block';
    } else {
      blockedPaneId = null;
      approvalBanner.style.display = 'none';
    }

    if (panes.length === 0) {
      agentCardsContainer.innerHTML = `
        <div style="color:var(--text-muted); text-align:center; padding:50px 10px; background:var(--bg-card); border-radius:var(--radius-lg); border:1px solid var(--border-subtle);">
          No active Herdr panes detected.
        </div>`;
      return;
    }

    // Build Workspace Map
    const wsMap = {};
    workspaces.forEach(w => {
      wsMap[w.workspace_id] = w.label || `#${w.number}`;
    });

    agentCardsContainer.innerHTML = panes.map(p => {
      const pid = p.pane_id;
      const agentRaw = (p.agent || p.display_agent || 'terminal').toLowerCase();
      const status = p.agent_status || 'idle';
      const wsLabel = wsMap[p.workspace_id] || p.workspace_id || '';
      const title = p.terminal_title_stripped || p.terminal_title || `Pane ${pid}`;
      const cwd = (p.foreground_cwd || p.cwd || '~').replace('/home/ashish', '~');

      // Style variant
      const isBlocked = status === 'blocked';
      const isWorking = status === 'working';

      return `
        <div class="pane-card ${isBlocked ? 'is-blocked' : (isWorking ? 'is-working' : '')}" data-pane-id="${pid}">
          <div class="card-header">
            <span class="agent-chip ${agentRaw}">⚡ ${agentRaw}</span>
            <span class="status-badge ${status}">${status}</span>
          </div>
          <div class="card-body-title">${escapeHtml(title)}</div>
          <div class="card-meta-row">
            <span>🏷️ <b>${pid}</b></span>
            ${wsLabel ? `<span>📁 <b>${escapeHtml(wsLabel)}</b></span>` : ''}
            <span>📂 <b>${escapeHtml(cwd)}</b></span>
          </div>
          <div class="card-actions-grid">
            <button class="btn-card-action" onclick="window.openTerminal('${pid}', '${escapeHtml(agentRaw)} • ${pid}')">
              🖥️ Peek
            </button>
            <button class="btn-card-action approve-btn" onclick="window.sendApprove('${pid}')">
              ✅ Approve (y)
            </button>
            <button class="btn-card-action" style="color:#ef4444;" onclick="window.sendInterrupt('${pid}')">
              ⛔ Interrupt
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Quick Action Handlers
  window.sendApprove = async function(paneId) {
    const pid = paneId || blockedPaneId;
    if (!pid) return;
    try {
      await apiFetch('/api/approve', { method: 'POST', body: { pane_id: pid } });
      showToast(`✓ Approved pane ${pid}`);
      approvalBanner.style.display = 'none';
      blockedPaneId = null;
      setTimeout(refreshCockpit, 500);
    } catch (err) {
      alert('Approval failed: ' + err.message);
    }
  };

  window.sendInterrupt = async function(paneId) {
    const pid = paneId || blockedPaneId;
    if (!pid) return;
    try {
      await apiFetch('/api/interact', {
        method: 'POST',
        body: { pane_id: pid, text: '\x03', submit: false }
      });
      showToast(`⛔ Sent Ctrl+C to ${pid}`);
      setTimeout(refreshCockpit, 500);
    } catch (err) {
      alert('Interrupt failed: ' + err.message);
    }
  };

  bannerApproveBtn.addEventListener('click', () => window.sendApprove(blockedPaneId));
  bannerRejectBtn.addEventListener('click', () => window.sendInterrupt(blockedPaneId));

  // Terminal Modal
  window.openTerminal = function(paneId, title = 'Terminal') {
    activePaneId = paneId;
    terminalTitle.textContent = title;
    terminalContent.textContent = 'Loading latest output…';
    terminalModalBackdrop.style.display = 'block';

    fetchTerminalOutput(paneId);
  };

  async function fetchTerminalOutput(paneId) {
    try {
      const res = await apiFetch(`/api/pane/${encodeURIComponent(paneId)}/read`, { params: { lines: 100 } });
      terminalContent.textContent = res.output || '(No terminal output available)';
      terminalContent.scrollTop = terminalContent.scrollHeight;
    } catch (err) {
      terminalContent.textContent = `Error reading terminal: ${err.message}`;
    }
  }

  terminalCloseBtn.addEventListener('click', () => {
    terminalModalBackdrop.style.display = 'none';
    activePaneId = null;
  });

  terminalModalBackdrop.addEventListener('click', (e) => {
    if (e.target === terminalModalBackdrop) {
      terminalModalBackdrop.style.display = 'none';
      activePaneId = null;
    }
  });

  // Quick Macro Keys
  document.querySelectorAll('.key-pill[data-key]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!activePaneId) return;
      const keyVal = btn.getAttribute('data-key');
      try {
        await apiFetch('/api/interact', {
          method: 'POST',
          body: { pane_id: activePaneId, text: keyVal, submit: false }
        });
        showToast(`Sent key`);
        setTimeout(() => fetchTerminalOutput(activePaneId), 300);
      } catch (err) {
        alert('Key send failed: ' + err.message);
      }
    });
  });

  if (btnScrollBottom) {
    btnScrollBottom.addEventListener('click', () => {
      terminalContent.scrollTop = terminalContent.scrollHeight;
    });
  }

  // Send Custom Terminal Input
  async function sendTerminalInput() {
    const text = terminalInputField.value;
    if (!text || !activePaneId) return;
    terminalInputField.value = '';
    try {
      await apiFetch('/api/interact', {
        method: 'POST',
        body: { pane_id: activePaneId, text: text, submit: true }
      });
      showToast('Sent input');
      setTimeout(() => fetchTerminalOutput(activePaneId), 400);
    } catch (err) {
      alert('Send failed: ' + err.message);
    }
  }

  btnSendTerminal.addEventListener('click', sendTerminalInput);
  terminalInputField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendTerminalInput();
  });

  // Sessions & AgentR Search
  async function loadSessions(query = '') {
    sessionsListContainer.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:24px;">Loading sessions…</div>';
    try {
      const endpoint = query ? '/api/search' : '/api/sessions';
      const params = query ? { q: query, agent: activeFilterAgent } : { agent: activeFilterAgent, limit: 40 };
      const res = await apiFetch(endpoint, { params });
      const items = res.sessions || res.results || [];

      if (items.length === 0) {
        sessionsListContainer.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:30px;">No sessions found.</div>';
        return;
      }

      sessionsListContainer.innerHTML = items.map(s => {
        const ag = (s.agent || 'agy').toLowerCase();
        return `
          <div class="session-card" data-agent="${s.agent}" data-cid="${s.cid}">
            <div class="session-card-header">
              <span class="agent-chip ${ag}">⚡ ${ag}</span>
              <span>${s.dt_str || ''} • ${s.step_count || 0} turns</span>
            </div>
            <div class="session-card-title">${escapeHtml(s.title || 'Untitled Session')}</div>
            <div class="session-card-snippet">${escapeHtml(s.snippet || '')}</div>
          </div>
        `;
      }).join('');

      sessionsListContainer.querySelectorAll('.session-card').forEach(card => {
        card.addEventListener('click', () => {
          openSessionDetail(card.getAttribute('data-agent'), card.getAttribute('data-cid'));
        });
      });
    } catch (err) {
      sessionsListContainer.innerHTML = `<div style="color:var(--color-blocked); padding:20px; text-align:center;">${err.message}</div>`;
    }
  }

  // Filter Pill clicks
  agentFilterStrip.querySelectorAll('.filter-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      agentFilterStrip.querySelectorAll('.filter-tag').forEach(t => t.classList.remove('active'));
      tag.classList.add('active');
      activeFilterAgent = tag.getAttribute('data-filter') || '';
      loadSessions(sessionSearchInput.value.trim());
    });
  });

  sessionSearchInput.addEventListener('input', (e) => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      loadSessions(e.target.value.trim());
    }, 300);
  });

  // Session Detail Modal
  async function openSessionDetail(agent, cid) {
    selectedSession = { agent, cid };
    sessionDetailTitle.textContent = `${agent.toUpperCase()} • ${cid.slice(0, 10)}…`;
    sessionDetailBody.innerHTML = '<div style="color:var(--text-muted); padding:20px; text-align:center;">Loading transcript…</div>';
    sessionDetailBackdrop.style.display = 'block';

    try {
      const res = await apiFetch('/api/sessions/details', { params: { agent, cid } });
      const d = res.details || {};
      let html = `
        <div style="margin-bottom:14px; padding-bottom:10px; border-bottom:1px solid var(--border-subtle);">
          <h3 style="color:#60a5fa; margin-bottom:4px; font-size:16px;">${escapeHtml(d.title)}</h3>
          <div style="font-size:11px; color:var(--text-muted); font-family:var(--font-mono);">
            Directory: <b>${escapeHtml(d.workdir || '~')}</b> • ${d.turn_count || 0} user turns
          </div>
        </div>
      `;

      const prompts = d.user_prompts || [];
      const msgs = d.assistant_msgs || [];
      const count = Math.max(prompts.length, msgs.length);

      for (let i = 0; i < count; i++) {
        if (prompts[i]) {
          html += `
            <div style="background:rgba(59, 130, 246, 0.12); border-left:3px solid #3b82f6; border-radius:6px; padding:10px 12px; margin-bottom:8px;">
              <b style="color:#60a5fa; font-size:11px; text-transform:uppercase;">User:</b>
              <div style="margin-top:2px; font-size:13px;">${escapeHtml(prompts[i])}</div>
            </div>
          `;
        }
        if (msgs[i]) {
          html += `
            <div style="background:rgba(255, 255, 255, 0.03); border:1px solid var(--border-subtle); border-radius:6px; padding:10px 12px; margin-bottom:12px; color:#cbd5e1;">
              <b style="color:#c084fc; font-size:11px; text-transform:uppercase;">${agent}:</b>
              <div style="margin-top:2px; font-size:12.5px; white-space:pre-wrap;">${escapeHtml(msgs[i]).slice(0, 900)}${msgs[i].length > 900 ? '…' : ''}</div>
            </div>
          `;
        }
      }

      sessionDetailBody.innerHTML = html;
    } catch (err) {
      sessionDetailBody.innerHTML = `<div style="color:var(--color-blocked); padding:20px;">Error: ${err.message}</div>`;
    }
  }

  sessionDetailCloseBtn.addEventListener('click', () => {
    sessionDetailBackdrop.style.display = 'none';
    selectedSession = null;
  });

  sessionDetailBackdrop.addEventListener('click', (e) => {
    if (e.target === sessionDetailBackdrop) {
      sessionDetailBackdrop.style.display = 'none';
      selectedSession = null;
    }
  });

  // Handoff Trigger
  btnTransferSession.addEventListener('click', async () => {
    if (!selectedSession) return;
    const target = prompt('Transfer this session to which agent?\nOptions: agy, opencode, freebuff, grok, kimi, claude', 'freebuff');
    if (!target) return;
    try {
      const res = await apiFetch('/api/handoff', {
        method: 'POST',
        body: {
          agent: selectedSession.agent,
          cid: selectedSession.cid,
          target: target.trim().toLowerCase()
        }
      });
      showToast(`✓ Dispatched to ${res.target}`);
      sessionDetailBackdrop.style.display = 'none';
    } catch (err) {
      alert('Transfer failed: ' + err.message);
    }
  });

  // Project Board
  async function loadBoard() {
    boardTasksContainer.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:24px;">Loading project board…</div>';
    try {
      const res = await apiFetch('/api/board');
      const board = res.board || {};
      const tasks = board.tasks || [];
      const feedback = board.feedback || [];

      let html = '<div style="margin-bottom:18px;">';
      if (tasks.length === 0) {
        html += '<div style="color:var(--text-muted); text-align:center; padding:16px;">No tasks on board.</div>';
      } else {
        tasks.forEach(t => {
          html += `
            <div class="board-task-item">
              <div class="board-task-head">
                <span class="board-task-title">${escapeHtml(t.title)}</span>
                <select class="status-dropdown" onchange="window.updateBoardTask('${t.id}', this.value)">
                  <option value="todo" ${t.status === 'todo' ? 'selected' : ''}>⚪ To Do</option>
                  <option value="in_progress" ${t.status === 'in_progress' ? 'selected' : ''}>🟡 In Progress</option>
                  <option value="review" ${t.status === 'review' ? 'selected' : ''}>🔍 In Review</option>
                  <option value="done" ${t.status === 'done' ? 'selected' : ''}>✅ Done</option>
                </select>
              </div>
              <div class="board-task-footer">
                <span>Task <b>${t.id}</b></span>
                <span>Assigned: <b>${t.agent}</b></span>
                <span>Reviewer: <b>${t.review_by || '—'}</b></span>
              </div>
            </div>
          `;
        });
      }
      html += '</div>';

      // Feedback Loop section
      html += `
        <div class="section-title-row" style="margin-top:20px;">
          <h2>Agent Feedback Loop</h2>
        </div>
      `;

      if (feedback.length === 0) {
        html += '<div style="color:var(--text-muted); text-align:center; padding:12px;">No feedback logged.</div>';
      } else {
        feedback.forEach(fb => {
          html += `
            <div style="background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:10px 14px; margin-bottom:8px; font-size:12px;">
              <span class="agent-chip ${fb.agent || 'terminal'}" style="font-size:10px; margin-right:6px;">${escapeHtml(fb.agent)}</span>
              <span style="color:var(--text-muted); font-size:11px;">${escapeHtml(fb.timestamp || '')}</span>
              <div style="margin-top:6px; color:#e2e8f0; line-height:1.4;">${escapeHtml(fb.text)}</div>
            </div>
          `;
        });
      }

      boardTasksContainer.innerHTML = html;
    } catch (err) {
      boardTasksContainer.innerHTML = `<div style="color:var(--color-blocked); padding:20px;">${err.message}</div>`;
    }
  }

  window.updateBoardTask = async function(taskId, status) {
    try {
      await apiFetch('/api/board/task/update', { method: 'POST', body: { id: taskId, status } });
      showToast(`Updated ${taskId} ➔ ${status}`);
      loadBoard();
    } catch (err) {
      alert('Update failed: ' + err.message);
    }
  };

  btnAddFeedbackTop.addEventListener('click', async () => {
    const text = prompt('Log tool friction or improvement idea into AgentR loop:');
    if (!text) return;
    try {
      await apiFetch('/api/board/feedback', {
        method: 'POST',
        body: { text: text.trim(), agent: 'mobile' }
      });
      showToast('✓ Feedback recorded');
      loadBoard();
    } catch (err) {
      alert('Failed to log feedback: ' + err.message);
    }
  });

  // Cockpit Refresh
  async function refreshCockpit() {
    try {
      connDot.classList.remove('offline');
      connLabel.textContent = 'Syncing…';
      const res = await apiFetch('/api/status');
      if (res.snapshot) renderSnapshot(res.snapshot);
      connLabel.textContent = 'Live';
    } catch (err) {
      connDot.classList.add('offline');
      connLabel.textContent = 'Error';
    }
  }

  btnRefreshCockpit.addEventListener('click', refreshCockpit);

  // Connect SSE
  function connectSSE() {
    if (sseSource) {
      try { sseSource.close(); } catch (e) {}
    }
    const sseUrl = getApiUrl('/api/events');
    sseSource = new EventSource(sseUrl);

    sseSource.onopen = () => {
      connDot.classList.remove('offline');
      connLabel.textContent = 'Live';
    };

    sseSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'init' || data.type === 'sync') {
          if (data.snapshot) renderSnapshot(data.snapshot);
        } else if (data.type === 'state_change') {
          let hasBlocked = false;
          (data.changes || []).forEach(c => {
            if (c.to === 'blocked') hasBlocked = true;
          });
          if (hasBlocked) playAlertChime();
          refreshCockpit();
        }
      } catch (err) {}
    };

    sseSource.onerror = () => {
      connDot.classList.add('offline');
      connLabel.textContent = 'Reconnecting…';
    };
  }

  // Escape HTML helper
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // PWA Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // Initial Load: immediately fetch status AND connect SSE!
  refreshCockpit();
  connectSSE();

})();
