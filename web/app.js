/**
 * AgentDesk - Mobile Cockpit & Cross-Agent Remote Controller
 */

// Secret and API URL handling
const urlParams = new URLSearchParams(window.location.search);
let secretKey = urlParams.get('secret') || localStorage.getItem('agentdesk_secret') || '';
if (urlParams.get('secret')) {
  localStorage.setItem('agentdesk_secret', secretKey);
}

function getApiUrl(endpoint, params = {}) {
  const url = new URL(endpoint, window.location.origin);
  if (secretKey) {
    url.searchParams.set('secret', secretKey);
  }
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

async function apiFetch(endpoint, options = {}) {
  const url = getApiUrl(endpoint, options.params);
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (secretKey) {
    headers['Authorization'] = `Bearer ${secretKey}`;
  }
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

// Navigation & View switching
const navItems = document.querySelectorAll('.nav-item');
const viewSections = document.querySelectorAll('.view-section');

function switchView(targetViewId) {
  navItems.forEach(item => {
    item.classList.toggle('active', item.dataset.view === targetViewId);
  });
  viewSections.forEach(section => {
    section.classList.toggle('active', section.id === targetViewId);
  });

  if (targetViewId === 'sessions-view') {
    loadSessions();
  } else if (targetViewId === 'board-view') {
    loadBoard();
  }
}

navItems.forEach(item => {
  item.addEventListener('click', () => switchView(item.dataset.view));
});

// Sound / Haptic notification
function triggerAlert() {
  if ('vibrate' in navigator) {
    try { navigator.vibrate([150, 100, 150]); } catch (e) {}
  }
}

// State
let currentSnapshot = null;
let activePaneId = null;
let terminalInterval = null;
let currentDetailSession = null;
let blockedPaneId = null;

// Connection Status & Banner Elements
const connDot = document.getElementById('conn-dot');
const connLabel = document.getElementById('conn-label');
const activeAgentsBadge = document.getElementById('active-agents-badge');
const agentCardsContainer = document.getElementById('agent-cards-container');
const approvalBanner = document.getElementById('approval-banner');
const bannerText = document.getElementById('banner-text');
const bannerApproveBtn = document.getElementById('banner-approve-btn');
const bannerRejectBtn = document.getElementById('banner-reject-btn');

// SSE Stream Connection
let sseSource = null;

function connectSSE() {
  if (sseSource) {
    try { sseSource.close(); } catch (e) {}
  }

  connDot.classList.add('offline');
  connLabel.textContent = 'Connecting…';

  const sseUrl = getApiUrl('/api/events');
  sseSource = new EventSource(sseUrl);

  sseSource.onopen = () => {
    connDot.classList.remove('offline');
    connLabel.textContent = 'Live';
  };

  sseSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.snapshot) {
        currentSnapshot = data.snapshot;
        renderSnapshot(data.snapshot);
      }
      if (data.type === 'state_change' && data.changes) {
        for (const ch of data.changes) {
          if (ch.to === 'blocked') {
            triggerAlert();
          }
        }
      }
    } catch (err) {
      console.error('Error parsing SSE event', err);
    }
  };

  sseSource.onerror = () => {
    connDot.classList.add('offline');
    connLabel.textContent = 'Reconnecting…';
    sseSource.close();
    setTimeout(connectSSE, 3000);
  };
}

// Render Herdr snapshot
function renderSnapshot(snap) {
  if (!snap) return;
  const panes = snap.panes || [];
  const agents = snap.agents || [];
  const workspaces = snap.workspaces || [];

  // Count active agents
  const activeCount = panes.filter(p => p.agent_status === 'working').length;
  activeAgentsBadge.textContent = `${panes.length} panes (${activeCount} active)`;

  // Check for blocked/waiting pane
  const blocked = panes.find(p => p.agent_status === 'blocked');
  if (blocked) {
    blockedPaneId = blocked.pane_id;
    approvalBanner.style.display = 'block';
    bannerText.textContent = `${blocked.agent || blocked.display_agent || 'Agent'} is waiting for approval in [${blocked.pane_id}]!`;
  } else {
    blockedPaneId = null;
    approvalBanner.style.display = 'none';
  }

  if (panes.length === 0) {
    agentCardsContainer.innerHTML = `
      <div style="color: var(--text-muted); text-align: center; padding: 40px 10px;">
        No active Herdr panes detected.<br>
        <span style="font-size: 11px;">Make sure Herdr is running on the workstation.</span>
      </div>
    `;
    return;
  }

  agentCardsContainer.innerHTML = panes.map(p => {
    const agentName = p.agent || p.display_agent || 'terminal';
    const status = p.agent_status || 'idle';
    const wsName = p.workspace_name || p.workspace_id || '';
    const title = p.terminal_title_stripped || p.terminal_title || `Pane ${p.pane_id}`;
    const pid = p.pid || '';

    return `
      <div class="card" data-pane-id="${p.pane_id}">
        <div class="card-top">
          <span class="agent-tag">⚡ ${agentName}</span>
          <span class="status-pill ${status}">${status}</span>
        </div>
        <div class="card-title">${escapeHtml(title)}</div>
        <div class="card-meta">
          <span>#${p.pane_id}</span>
          ${wsName ? `<span>📁 ${escapeHtml(wsName)}</span>` : ''}
          ${pid ? `<span>PID ${pid}</span>` : ''}
        </div>
        <div class="card-actions">
          <button class="btn-card" onclick="openTerminalSheet('${p.pane_id}', '${escapeHtml(agentName)}: ${escapeHtml(title)}')">Peek Terminal</button>
          <button class="btn-card" onclick="quickApprove('${p.pane_id}')">Approve (y)</button>
          <button class="btn-card" style="color: #ef4444;" onclick="quickInterrupt('${p.pane_id}')">Interrupt</button>
        </div>
      </div>
    `;
  }).join('');
}

// Banner quick approval actions
bannerApproveBtn.addEventListener('click', async () => {
  if (blockedPaneId) {
    await quickApprove(blockedPaneId);
    approvalBanner.style.display = 'none';
  }
});

bannerRejectBtn.addEventListener('click', async () => {
  if (blockedPaneId) {
    await quickInterrupt(blockedPaneId);
    approvalBanner.style.display = 'none';
  }
});

async function quickApprove(paneId) {
  try {
    await apiFetch('/api/approve', {
      method: 'POST',
      body: { pane_id: paneId }
    });
    connLabel.textContent = `Approved ${paneId}`;
    setTimeout(() => { connLabel.textContent = 'Live'; }, 2000);
  } catch (err) {
    alert(`Approval failed: ${err.message}`);
  }
}

async function quickInterrupt(paneId) {
  try {
    await apiFetch('/api/interact', {
      method: 'POST',
      body: { pane_id: paneId, text: '\x03', submit: false }
    });
    connLabel.textContent = `Interrupted ${paneId}`;
    setTimeout(() => { connLabel.textContent = 'Live'; }, 2000);
  } catch (err) {
    alert(`Interrupt failed: ${err.message}`);
  }
}

// Terminal Sheet Modal
const terminalBackdrop = document.getElementById('terminal-sheet-backdrop');
const terminalTitle = document.getElementById('terminal-title');
const terminalContent = document.getElementById('terminal-content');
const terminalQuickInput = document.getElementById('terminal-quick-input');
const terminalSendBtn = document.getElementById('terminal-send-btn');
const terminalCloseBtn = document.getElementById('terminal-close-btn');

async function openTerminalSheet(paneId, title) {
  activePaneId = paneId;
  terminalTitle.textContent = title || `Pane ${paneId}`;
  terminalContent.textContent = 'Fetching terminal stream…';
  terminalBackdrop.style.display = 'block';

  await refreshTerminalOutput();
  if (terminalInterval) clearInterval(terminalInterval);
  terminalInterval = setInterval(refreshTerminalOutput, 2000);
}

function closeTerminalSheet() {
  terminalBackdrop.style.display = 'none';
  if (terminalInterval) {
    clearInterval(terminalInterval);
    terminalInterval = null;
  }
  activePaneId = null;
}

terminalCloseBtn.addEventListener('click', closeTerminalSheet);
terminalBackdrop.addEventListener('click', (e) => {
  if (e.target === terminalBackdrop) closeTerminalSheet();
});

async function refreshTerminalOutput() {
  if (!activePaneId) return;
  try {
    const res = await apiFetch(`/api/pane/${activePaneId}/read`, { params: { lines: 100 } });
    if (res && res.output !== undefined) {
      terminalContent.textContent = res.output || '(no output in buffer)';
      terminalContent.scrollTop = terminalContent.scrollHeight;
    }
  } catch (err) {
    terminalContent.textContent = `Error reading pane: ${err.message}`;
  }
}

async function sendTerminalInput() {
  const text = terminalQuickInput.value;
  if (!text || !activePaneId) return;
  terminalQuickInput.value = '';
  try {
    await apiFetch('/api/interact', {
      method: 'POST',
      body: { pane_id: activePaneId, text, submit: true }
    });
    setTimeout(refreshTerminalOutput, 300);
  } catch (err) {
    alert(`Send failed: ${err.message}`);
  }
}

terminalSendBtn.addEventListener('click', sendTerminalInput);
terminalQuickInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendTerminalInput();
  }
});

// View 2: Sessions & Search
const sessionSearchInput = document.getElementById('session-search-input');
const sessionsListContainer = document.getElementById('sessions-list-container');
let searchDebounce = null;

async function loadSessions(query = '') {
  sessionsListContainer.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 20px;">Loading sessions…</div>';
  try {
    const endpoint = query ? '/api/search' : '/api/sessions';
    const params = query ? { q: query } : { limit: 40 };
    const res = await apiFetch(endpoint, { params });
    const list = res.results || res.sessions || [];

    if (list.length === 0) {
      sessionsListContainer.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 30px;">No sessions found.</div>';
      return;
    }

    sessionsListContainer.innerHTML = list.map(s => `
      <div class="session-item" onclick="openSessionDetail('${s.agent}', '${s.cid}')">
        <div class="session-header">
          <span class="agent-tag">⚡ ${s.agent}</span>
          <span>${s.dt_str || ''}</span>
        </div>
        <div class="card-title" style="margin: 4px 0;">${escapeHtml(s.title || s.cid)}</div>
        <div class="session-snippet">${escapeHtml(s.snippet || '')}</div>
      </div>
    `).join('');
  } catch (err) {
    sessionsListContainer.innerHTML = `<div style="color: #ef4444; text-align: center; padding: 20px;">Failed to load sessions: ${err.message}</div>`;
  }
}

sessionSearchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    loadSessions(sessionSearchInput.value.trim());
  }, 350);
});

// Session Detail Modal & Handoff
const sessionDetailBackdrop = document.getElementById('session-detail-backdrop');
const sessionDetailTitle = document.getElementById('session-detail-title');
const sessionDetailContent = document.getElementById('session-detail-content');
const sessionDetailCloseBtn = document.getElementById('session-detail-close-btn');
const btnHandoffSession = document.getElementById('btn-handoff-session');

async function openSessionDetail(agent, cid) {
  currentDetailSession = { agent, cid };
  sessionDetailBackdrop.style.display = 'block';
  sessionDetailTitle.textContent = `${agent.toUpperCase()} Session`;
  sessionDetailContent.innerHTML = 'Loading transcript summary…';

  try {
    const res = await apiFetch('/api/sessions/details', { params: { agent, cid } });
    const d = res.details;
    sessionDetailTitle.textContent = `${d.agent.toUpperCase()}: ${d.title}`;

    sessionDetailContent.innerHTML = `
      <div style="margin-bottom: 12px; font-weight: 600; color: var(--accent-light);">
        📁 ${escapeHtml(d.workdir || 'workspace')} &bull; ${d.turn_count} turns
      </div>
      <div style="background: rgba(255,255,255,0.03); border-radius: 8px; padding: 10px; margin-bottom: 12px; font-family: var(--font-mono); font-size: 11px; white-space: pre-wrap;">
        ${escapeHtml(d.briefing || '(No briefing available)')}
      </div>
    `;
  } catch (err) {
    sessionDetailContent.innerHTML = `<span style="color: #ef4444;">Failed to load: ${err.message}</span>`;
  }
}

function closeSessionDetail() {
  sessionDetailBackdrop.style.display = 'none';
  currentDetailSession = null;
}

sessionDetailCloseBtn.addEventListener('click', closeSessionDetail);
sessionDetailBackdrop.addEventListener('click', (e) => {
  if (e.target === sessionDetailBackdrop) closeSessionDetail();
});

btnHandoffSession.addEventListener('click', async () => {
  if (!currentDetailSession) return;
  const target = prompt('Enter target agent for handoff (opencode, grok, agy, freebuff):', 'grok');
  if (!target) return;

  try {
    const res = await apiFetch('/api/handoff', {
      method: 'POST',
      body: {
        agent: currentDetailSession.agent,
        cid: currentDetailSession.cid,
        target: target.trim().toLowerCase(),
      }
    });
    alert(`Handoff briefing dispatched to ${res.target || target}!`);
    closeSessionDetail();
  } catch (err) {
    alert(`Handoff failed: ${err.message}`);
  }
});

// View 3: Project Blackboard
const boardTasksContainer = document.getElementById('board-tasks-container');
const btnAddFeedback = document.getElementById('btn-add-feedback');

async function loadBoard() {
  boardTasksContainer.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 20px;">Loading blackboard…</div>';
  try {
    const res = await apiFetch('/api/board');
    const b = res.board || {};
    const tasks = b.tasks || [];
    const feedback = b.feedback || [];

    if (tasks.length === 0) {
      boardTasksContainer.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 20px;">No blackboard tasks registered yet.</div>';
      return;
    }

    let html = '';
    html += '<div style="margin-bottom: 16px;">';
    for (const t of tasks) {
      const nextStatus = t.status === 'todo' ? 'in_progress' : t.status === 'in_progress' ? 'review' : t.status === 'review' ? 'done' : 'todo';
      html += `
        <div class="task-row">
          <div class="task-info">
            <span class="task-title">${escapeHtml(t.title)}</span>
            <span class="task-meta">Agent: <b>${t.agent}</b> &bull; Review: <b>${t.review_by}</b> (${t.review_status})</span>
          </div>
          <button class="status-pill ${t.status}" style="border: none; cursor: pointer;" onclick="toggleTaskStatus('${t.id}', '${nextStatus}')">
            ${t.status}
          </button>
        </div>
      `;
    }
    html += '</div>';

    if (feedback.length > 0) {
      html += '<h3 style="font-size: 13px; color: var(--text-muted); margin: 16px 0 8px 0; text-transform: uppercase;">Agent Feedback & Observations</h3>';
      for (const fb of feedback) {
        html += `
          <div style="background: var(--surface); border: 1px solid var(--surface-border); border-radius: 8px; padding: 10px; margin-bottom: 8px; font-size: 12px;">
            <div style="color: var(--accent-light); font-weight: 600; font-size: 11px; margin-bottom: 4px;">[${escapeHtml(fb.agent)}] ${escapeHtml(fb.timestamp || '')}</div>
            <div>${escapeHtml(fb.text)}</div>
          </div>
        `;
      }
    }

    boardTasksContainer.innerHTML = html;
  } catch (err) {
    boardTasksContainer.innerHTML = `<div style="color: #ef4444; text-align: center; padding: 20px;">Failed to load board: ${err.message}</div>`;
  }
}

async function toggleTaskStatus(taskId, nextStatus) {
  try {
    await apiFetch('/api/board/task/update', {
      method: 'POST',
      body: { id: taskId, status: nextStatus }
    });
    loadBoard();
  } catch (err) {
    alert(`Failed to update task: ${err.message}`);
  }
}

btnAddFeedback.addEventListener('click', async () => {
  const text = prompt('Enter observation or issue for the multi-agent fleet:');
  if (!text) return;
  try {
    await apiFetch('/api/board/feedback', {
      method: 'POST',
      body: { text: text.trim(), agent: 'mobile-cockpit' }
    });
    loadBoard();
  } catch (err) {
    alert(`Failed to add feedback: ${err.message}`);
  }
});

// Helper: Escape HTML
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Service Worker Registration for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

// Initialize
window.addEventListener('DOMContentLoaded', () => {
  connectSSE();
});
