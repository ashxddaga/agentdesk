// AgentDesk Mobile Cockpit Client
(function() {
  'use strict';

  // State
  let secret = new URLSearchParams(window.location.search).get('secret');
  if (secret) {
    localStorage.setItem('agentdesk_secret', secret);
  } else {
    secret = localStorage.getItem('agentdesk_secret') || '';
  }

  let eventSource = null;
  let currentSnapshot = null;
  let activeBlockedPaneId = null;
  let activeTerminalPaneId = null;
  let selectedSession = null;
  let searchTimeout = null;

  // Audio Chime Context
  let audioCtx = null;
  function playAlertChime() {
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15); // A5
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.36);
    } catch (e) {
      // Audio not permitted yet
    }
    if (navigator.vibrate) {
      navigator.vibrate([200, 100, 200]);
    }
  }

  // API helper
  function apiFetch(endpoint, options = {}) {
    const url = new URL(endpoint, window.location.origin);
    if (secret) {
      url.searchParams.set('secret', secret);
    }
    options.headers = options.headers || {};
    if (secret) {
      options.headers['Authorization'] = `Bearer ${secret}`;
    }
    return fetch(url.toString(), options).then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json();
    });
  }

  // DOM Elements
  const connDot = document.getElementById('conn-dot');
  const connLabel = document.getElementById('conn-label');
  const approvalBanner = document.getElementById('approval-banner');
  const bannerText = document.getElementById('banner-text');
  const bannerApproveBtn = document.getElementById('banner-approve-btn');
  const bannerRejectBtn = document.getElementById('banner-reject-btn');
  const agentCardsContainer = document.getElementById('agent-cards-container');
  const activeAgentsBadge = document.getElementById('active-agents-badge');
  const terminalBackdrop = document.getElementById('terminal-sheet-backdrop');
  const terminalTitle = document.getElementById('terminal-title');
  const terminalContent = document.getElementById('terminal-content');
  const terminalInput = document.getElementById('terminal-quick-input');
  const terminalSendBtn = document.getElementById('terminal-send-btn');
  const terminalCloseBtn = document.getElementById('terminal-close-btn');
  const sessionSearchInput = document.getElementById('session-search-input');
  const sessionsListContainer = document.getElementById('sessions-list-container');
  const sessionDetailBackdrop = document.getElementById('session-detail-backdrop');
  const sessionDetailTitle = document.getElementById('session-detail-title');
  const sessionDetailContent = document.getElementById('session-detail-content');
  const sessionDetailCloseBtn = document.getElementById('session-detail-close-btn');
  const btnHandoffSession = document.getElementById('btn-handoff-session');
  const boardTasksContainer = document.getElementById('board-tasks-container');
  const btnAddFeedback = document.getElementById('btn-add-feedback');

  // Navigation tab switcher
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      const viewId = btn.getAttribute('data-view');
      const targetView = document.getElementById(viewId);
      if (targetView) targetView.classList.add('active');

      if (viewId === 'sessions-view') {
        loadSessions();
      } else if (viewId === 'board-view') {
        loadBoard();
      }
    });
  });

  // Setup SSE Stream
  function connectSSE() {
    if (eventSource) {
      eventSource.close();
    }

    const sseUrl = new URL('/api/events', window.location.origin);
    if (secret) sseUrl.searchParams.set('secret', secret);

    eventSource = new EventSource(sseUrl.toString());

    eventSource.onopen = () => {
      connDot.classList.remove('offline');
      connLabel.textContent = 'Live';
    };

    eventSource.onerror = () => {
      connDot.classList.add('offline');
      connLabel.textContent = 'Reconnecting…';
      // EventSource auto retries, but we fallback polling
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'init' || data.type === 'sync') {
          if (data.snapshot) {
            renderSnapshot(data.snapshot);
          }
        } else if (data.type === 'state_change') {
          handleStateChanges(data.changes || []);
        }
      } catch (e) {
        console.error('SSE parse error', e);
      }
    };
  }

  function handleStateChanges(changes) {
    let hasBlocked = false;
    changes.forEach(c => {
      if (c.to === 'blocked') {
        hasBlocked = true;
        activeBlockedPaneId = c.pane_id;
        bannerText.textContent = `[${c.agent.toUpperCase()}] in ${c.pane_id} is waiting for approval!`;
      }
    });

    if (hasBlocked) {
      approvalBanner.style.display = 'block';
      playAlertChime();
    }
    // Refresh snapshot
    apiFetch('/api/status').then(res => {
      if (res.snapshot) renderSnapshot(res.snapshot);
    }).catch(() => {});
  }

  // Render Cockpit Panes & Agents
  function renderSnapshot(snapshot) {
    currentSnapshot = snapshot;
    const panes = snapshot.panes || [];
    const agents = snapshot.agents || [];

    // Check if any pane is blocked
    const blockedPane = panes.find(p => p.agent_status === 'blocked');
    if (blockedPane) {
      activeBlockedPaneId = blockedPane.pane_id;
      const agName = (blockedPane.agent || blockedPane.display_agent || 'Agent').toUpperCase();
      bannerText.textContent = `[${agName}] needs approval in ${blockedPane.pane_id}!`;
      approvalBanner.style.display = 'block';
    } else {
      activeBlockedPaneId = null;
      approvalBanner.style.display = 'none';
    }

    activeAgentsBadge.textContent = `${panes.length} pane${panes.length === 1 ? '' : 's'}`;

    if (panes.length === 0) {
      agentCardsContainer.innerHTML = `
        <div style="color: var(--text-muted); text-align: center; padding: 40px 0;">
          No active terminal panes running in Herdr.
        </div>`;
      return;
    }

    let html = '';
    panes.forEach(pane => {
      const pid = pane.pane_id;
      const agent = pane.agent || pane.display_agent || 'terminal';
      const status = pane.agent_status || 'unknown';
      const title = pane.terminal_title_stripped || pane.terminal_title || `Pane ${pid}`;
      const cwd = pane.foreground_cwd || pane.cwd || '~';

      html += `
        <div class="card" data-pane-id="${pid}">
          <div class="card-top">
            <span class="agent-tag">[${agent}]</span>
            <span class="status-pill ${status}">${status}</span>
          </div>
          <div class="card-title">${escapeHtml(title)}</div>
          <div class="card-meta">
            <span><b>Pane:</b> ${pid}</span>
            <span><b>Dir:</b> ${escapeHtml(cwd.replace('/home/ashish', '~'))}</span>
          </div>
          <div class="card-actions">
            <button class="btn-card btn-peek-pane" data-pane-id="${pid}">Terminal Peek</button>
            ${status === 'blocked' ? `
              <button class="btn-card" style="background:#22c55e; color:white; border-color:#22c55e;" onclick="window.sendApprove('${pid}')">Approve</button>
            ` : `
              <button class="btn-card btn-prompt-pane" data-pane-id="${pid}">Quick Input</button>
            `}
          </div>
        </div>`;
    });

    agentCardsContainer.innerHTML = html;

    // Attach card action listeners
    agentCardsContainer.querySelectorAll('.btn-peek-pane').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openTerminalSheet(btn.getAttribute('data-pane-id'));
      });
    });

    agentCardsContainer.querySelectorAll('.btn-prompt-pane').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openTerminalSheet(btn.getAttribute('data-pane-id'), true);
      });
    });
  }

  // Approval Banner Click Handlers
  window.sendApprove = function(paneId) {
    const pid = paneId || activeBlockedPaneId;
    if (!pid) return;
    apiFetch('/api/approve', {
      method: 'POST',
      body: JSON.stringify({ pane_id: pid })
    }).then(() => {
      approvalBanner.style.display = 'none';
      activeBlockedPaneId = null;
    }).catch(err => alert('Failed to approve: ' + err.message));
  };

  bannerApproveBtn.addEventListener('click', () => window.sendApprove(activeBlockedPaneId));

  bannerRejectBtn.addEventListener('click', () => {
    if (!activeBlockedPaneId) return;
    apiFetch('/api/interact', {
      method: 'POST',
      body: JSON.stringify({ pane_id: activeBlockedPaneId, text: '\x03', submit: false })
    }).then(() => {
      approvalBanner.style.display = 'none';
    }).catch(err => alert('Failed to interrupt: ' + err.message));
  });

  // Terminal Peek Bottom Sheet
  function openTerminalSheet(paneId, focusInput = false) {
    activeTerminalPaneId = paneId;
    terminalTitle.textContent = `Terminal Output — ${paneId}`;
    terminalContent.textContent = 'Loading latest output…';
    terminalBackdrop.style.display = 'block';

    apiFetch(`/api/pane/${encodeURIComponent(paneId)}/read?lines=100`)
      .then(res => {
        terminalContent.textContent = res.output || '(No terminal output available)';
        terminalContent.scrollTop = terminalContent.scrollHeight;
      })
      .catch(err => {
        terminalContent.textContent = 'Error reading output: ' + err.message;
      });

    if (focusInput) {
      setTimeout(() => terminalInput.focus(), 300);
    }
  }

  terminalCloseBtn.addEventListener('click', () => {
    terminalBackdrop.style.display = 'none';
    activeTerminalPaneId = null;
  });

  terminalBackdrop.addEventListener('click', (e) => {
    if (e.target === terminalBackdrop) {
      terminalBackdrop.style.display = 'none';
      activeTerminalPaneId = null;
    }
  });

  function sendTerminalInput() {
    const text = terminalInput.value;
    if (!text || !activeTerminalPaneId) return;
    terminalInput.value = '';
    apiFetch('/api/interact', {
      method: 'POST',
      body: JSON.stringify({ pane_id: activeTerminalPaneId, text: text, submit: true })
    }).then(() => {
      setTimeout(() => {
        if (activeTerminalPaneId) openTerminalSheet(activeTerminalPaneId);
      }, 500);
    }).catch(err => alert('Send failed: ' + err.message));
  }

  terminalSendBtn.addEventListener('click', sendTerminalInput);
  terminalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendTerminalInput();
  });

  // Sessions & AgentR Search
  function loadSessions(query = '') {
    sessionsListContainer.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:20px;">Searching sessions…</div>';
    const endpoint = query ? `/api/search?q=${encodeURIComponent(query)}` : '/api/sessions?limit=40';

    apiFetch(endpoint)
      .then(res => {
        const list = res.sessions || res.results || [];
        if (list.length === 0) {
          sessionsListContainer.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:30px;">No sessions found.</div>';
          return;
        }

        let html = '';
        list.forEach(s => {
          html += `
            <div class="session-item" data-agent="${s.agent}" data-cid="${s.cid}">
              <div class="session-header">
                <span class="agent-tag" style="font-size:11px;">[${s.agent}]</span>
                <span>${s.dt_str || ''}</span>
              </div>
              <div class="card-title" style="font-size:13px; margin:4px 0;">${escapeHtml(s.title || 'Untitled Session')}</div>
              <div class="session-snippet">${escapeHtml(s.snippet || '')}</div>
            </div>`;
        });
        sessionsListContainer.innerHTML = html;

        sessionsListContainer.querySelectorAll('.session-item').forEach(item => {
          item.addEventListener('click', () => {
            const ag = item.getAttribute('data-agent');
            const cid = item.getAttribute('data-cid');
            openSessionDetail(ag, cid);
          });
        });
      })
      .catch(err => {
        sessionsListContainer.innerHTML = `<div style="color:var(--bad);text-align:center;padding:20px;">${err.message}</div>`;
      });
  }

  sessionSearchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      loadSessions(e.target.value.trim());
    }, 350);
  });

  function openSessionDetail(agent, cid) {
    selectedSession = { agent, cid };
    sessionDetailTitle.textContent = `${agent.toUpperCase()} • ${cid.slice(0, 12)}…`;
    sessionDetailContent.innerHTML = 'Loading transcript…';
    sessionDetailBackdrop.style.display = 'block';

    apiFetch(`/api/sessions/details?agent=${encodeURIComponent(agent)}&cid=${encodeURIComponent(cid)}`)
      .then(res => {
        const d = res.details || {};
        let turnsHtml = `
          <div style="margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid var(--surface-border)">
            <h4 style="color:var(--accent-light); margin-bottom:4px;">${escapeHtml(d.title)}</h4>
            <div style="font-size:11px; color:var(--text-muted); font-family:var(--font-mono)">
              Dir: ${escapeHtml(d.workdir || '~')} • ${d.turn_count || 0} user turns
            </div>
          </div>`;

        const prompts = d.user_prompts || [];
        const msgs = d.assistant_msgs || [];
        const count = Math.max(prompts.length, msgs.length);

        for (let i = 0; i < count; i++) {
          if (prompts[i]) {
            turnsHtml += `
              <div style="background:#1e293b; border-radius:8px; padding:8px 12px; margin-bottom:8px; font-size:12px;">
                <b style="color:#38bdf8;">You:</b> ${escapeHtml(prompts[i])}
              </div>`;
          }
          if (msgs[i]) {
            turnsHtml += `
              <div style="background:#0f172a; border-radius:8px; padding:8px 12px; margin-bottom:12px; font-size:12px; color:#cbd5e1; border:1px solid #1e293b;">
                <b style="color:#a855f7;">${agent.toUpperCase()}:</b> ${escapeHtml(msgs[i]).slice(0, 800)}
                ${msgs[i].length > 800 ? '…' : ''}
              </div>`;
          }
        }

        sessionDetailContent.innerHTML = turnsHtml;
      })
      .catch(err => {
        sessionDetailContent.innerHTML = `<div style="color:var(--bad)">Error: ${err.message}</div>`;
      });
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

  // Handoff Button
  btnHandoffSession.addEventListener('click', () => {
    if (!selectedSession) return;
    const target = prompt('Transfer session to which agent? (agy, opencode, freebuff, grok, kimi, claude)', 'freebuff');
    if (!target) return;

    apiFetch('/api/handoff', {
      method: 'POST',
      body: JSON.stringify({
        agent: selectedSession.agent,
        cid: selectedSession.cid,
        target: target.trim().toLowerCase()
      })
    }).then(res => {
      alert(`✓ Handoff dispatched to ${res.target}!`);
      sessionDetailBackdrop.style.display = 'none';
    }).catch(err => alert('Handoff error: ' + err.message));
  });

  // AgentR Project Blackboard View
  function loadBoard() {
    boardTasksContainer.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:20px;">Loading board…</div>';
    apiFetch('/api/board')
      .then(res => {
        const board = res.board || {};
        const tasks = board.tasks || [];
        const feedback = board.feedback || [];

        let html = '<div style="margin-bottom:16px;">';
        if (tasks.length === 0) {
          html += '<div style="color:var(--text-muted); text-align:center; padding:16px;">No tasks on board.</div>';
        } else {
          tasks.forEach(t => {
            html += `
              <div class="task-row">
                <div class="task-info">
                  <span class="task-title">${escapeHtml(t.title)}</span>
                  <span class="task-meta">${t.id} • Assigned: <b>${t.agent}</b> • Reviewer: <b>${t.review_by || '—'}</b></span>
                </div>
                <select class="btn-card" style="flex:0 0 auto; padding:4px 8px; font-size:11px;" onchange="window.updateTaskStatus('${t.id}', this.value)">
                  <option value="todo" ${t.status === 'todo' ? 'selected' : ''}>⚪ To Do</option>
                  <option value="in_progress" ${t.status === 'in_progress' ? 'selected' : ''}>🟡 In Progress</option>
                  <option value="review" ${t.status === 'review' ? 'selected' : ''}>🔍 Review</option>
                  <option value="done" ${t.status === 'done' ? 'selected' : ''}>✅ Done</option>
                </select>
              </div>`;
          });
        }
        html += '</div>';

        // Feedback section
        html += `
          <div class="section-header" style="margin-top:20px;">
            <h2>Feedback &amp; Friction Loop</h2>
          </div>
          <div>`;
        if (feedback.length === 0) {
          html += '<div style="color:var(--text-muted); text-align:center; padding:12px;">No feedback logged yet.</div>';
        } else {
          feedback.forEach(fb => {
            html += `
              <div style="background:var(--surface); border:1px solid var(--surface-border); border-radius:8px; padding:8px 12px; margin-bottom:6px; font-size:12px;">
                <span class="agent-tag" style="font-size:10px; margin-right:6px;">[${escapeHtml(fb.agent)}]</span>
                <span style="color:var(--text-muted); font-size:11px;">${escapeHtml(fb.timestamp || '')}</span>
                <div style="margin-top:4px;">${escapeHtml(fb.text)}</div>
              </div>`;
          });
        }
        html += '</div>';

        boardTasksContainer.innerHTML = html;
      })
      .catch(err => {
        boardTasksContainer.innerHTML = `<div style="color:var(--bad);padding:20px;">${err.message}</div>`;
      });
  }

  window.updateTaskStatus = function(taskId, newStatus) {
    apiFetch('/api/board/task/update', {
      method: 'POST',
      body: JSON.stringify({ id: taskId, status: newStatus })
    }).then(() => {
      loadBoard();
    }).catch(err => alert('Update failed: ' + err.message));
  };

  btnAddFeedback.addEventListener('click', () => {
    const text = prompt('Log tool friction or improvement idea into AgentR loop:');
    if (!text) return;
    apiFetch('/api/board/feedback', {
      method: 'POST',
      body: JSON.stringify({ text: text, agent: 'mobile' })
    }).then(() => {
      loadBoard();
    }).catch(err => alert('Failed to log feedback: ' + err.message));
  });

  // Utility escapeHtml
  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Register Service Worker for PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // Initial Load
  connectSSE();
  apiFetch('/api/status').then(res => {
    if (res.snapshot) renderSnapshot(res.snapshot);
  }).catch(() => {});

})();
