/**
 * Real-Time Chat Support - Electronics Repair Shop Floor Staff Portal
 * Core Client Controller
 */

// Application State
const state = {
  tickets: [],
  selectedTicketId: null,
  connectionMode: 'fast', // 'fast' | 'slow' | 'offline'
  offlineQueue: [],
  pingInterval: null,
  pingStartTime: null,
  reconnectTimeout: null,
  reconnectAttempts: 0
};

// WebSocket Reference
let socket = null;

// DOM Elements Cache
const elements = {
  wsBadge: document.getElementById('ws-badge'),
  connectionDot: document.getElementById('connection-dot'),
  wsPing: document.getElementById('ws-ping'),
  connectionBanner: document.getElementById('connection-banner'),

  simFast: document.getElementById('sim-fast'),
  simSlow: document.getElementById('sim-slow'),
  simOffline: document.getElementById('sim-offline'),

  chatSearch: document.getElementById('chat-search'),
  openNewTicketBtn: document.getElementById('open-new-ticket-btn'),
  chatsSkeleton: document.getElementById('chats-skeleton'),
  chatsList: document.getElementById('chats-list'),
  chatsEmptyState: document.getElementById('chats-empty-state'),

  activeDeviceName: document.getElementById('active-device-name'),
  activeTicketId: document.getElementById('active-ticket-id'),
  chatHeaderActions: document.getElementById('chat-header-actions'),
  activeStatusSelect: document.getElementById('active-status-select'),

  messagesContainer: document.getElementById('messages-container'),
  welcomeChatScreen: document.getElementById('welcome-chat-screen'),
  chatMessagesLog: document.getElementById('chat-messages-log'),
  asyncSpinner: document.getElementById('async-spinner'),

  chatInputPanel: document.getElementById('chat-input-panel'),
  chatInputForm: document.getElementById('chat-input-form'),
  chatTextarea: document.getElementById('chat-textarea'),
  chatSendBtn: document.getElementById('chat-send-btn'),
  inputValidationMsg: document.getElementById('input-validation-msg'),
  charCounter: document.getElementById('char-counter'),

  noContextCard: document.getElementById('no-context-card'),
  contextCard: document.getElementById('context-card'),
  metaCustomerName: document.getElementById('meta-customer-name'),
  metaTicketId: document.getElementById('meta-ticket-id'),
  metaCreatedDate: document.getElementById('meta-created-date'),
  chkVoltage: document.getElementById('chk-voltage'),
  chkSolder: document.getElementById('chk-solder'),
  chkBurnin: document.getElementById('chk-burnin'),

  telemetryLogs: document.getElementById('telemetry-logs'),
  clearTelemetryBtn: document.getElementById('clear-telemetry-btn'),

  newTicketModal: document.getElementById('new-ticket-modal'),
  newTicketForm: document.getElementById('new-ticket-form'),
  closeModalBtn: document.getElementById('close-modal-btn'),
  formCancelBtn: document.getElementById('form-cancel-btn')
};

/* ==========================================
 * 1. Security & Sanitization
 * ========================================== */

/**
 * Escapes characters that could lead to XSS injections.
 * @param {string} rawString 
 * @returns {string} Sanitized string
 */
function sanitize(rawString) {
  if (typeof rawString !== 'string') return '';
  return rawString
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/* ==========================================
 * 2. Telemetry & Analytics
 * ========================================== */

/**
 * Simulates a telemetry/analytics ping.
 * Logs to the browser console and updates the on-screen terminal.
 * @param {string} actionName 
 * @param {object} details 
 */
function logTelemetry(actionName, details = {}) {
  const logMessage = `[Analytics] User interacted with Real-Time Chat Support - ${actionName}`;
  console.log(logMessage, details);

  // Update on-screen terminal
  const entry = document.createElement('div');
  entry.className = 'log-entry interaction';

  const timestamp = new Date().toLocaleTimeString();
  entry.textContent = `[${timestamp}] ANALYTICS: ${actionName} ${JSON.stringify(details)}`;

  elements.telemetryLogs.appendChild(entry);
  elements.telemetryLogs.scrollTop = elements.telemetryLogs.scrollHeight;
}

/**
 * Prints system info to on-screen console logs.
 */
function logSystemConsole(message, type = 'system') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  const timestamp = new Date().toLocaleTimeString();
  entry.textContent = `[${timestamp}] ${message}`;
  elements.telemetryLogs.appendChild(entry);
  elements.telemetryLogs.scrollTop = elements.telemetryLogs.scrollHeight;
}

/* ==========================================
 * 3. WebSocket Manager & Network Simulator
 * ========================================== */

function connectWebSocket() {
  if (state.connectionMode === 'offline') return;

  // Clear any existing timeouts or intervals
  if (state.reconnectTimeout) clearTimeout(state.reconnectTimeout);
  clearInterval(state.pingInterval);

  // Update badge UI
  elements.wsBadge.textContent = 'CONNECTING...';
  elements.wsBadge.className = 'badge';
  elements.connectionDot.className = 'status-dot connecting';
  logSystemConsole('Initiating persistent WebSocket connection...', 'system');

  // Derive WS address from HTTP page load address
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}`;

  try {
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      state.reconnectAttempts = 0;
      elements.wsBadge.textContent = 'CONNECTED';
      elements.wsBadge.className = 'badge';
      elements.connectionDot.className = 'status-dot connected';
      elements.connectionBanner.classList.add('hidden');
      logSystemConsole('WebSocket Connected successfully.', 'success');
      logTelemetry('WebSocket Connection Opened', { host: wsUrl });

      // Start ping-pong latency check
      startPingPong();

      // Flush any messages queued while offline
      flushOfflineQueue();
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        handleServerPayload(payload);
      } catch (err) {
        logSystemConsole('Error parsing server message payload: ' + err.message, 'error');
      }
    };

    socket.onerror = (err) => {
      logSystemConsole('WebSocket error encountered.', 'error');
    };

    socket.onclose = (event) => {
      elements.wsBadge.textContent = 'DISCONNECTED';
      elements.wsBadge.className = 'badge';
      elements.connectionDot.className = 'status-dot disconnected';

      if (state.connectionMode !== 'offline') {
        elements.connectionBanner.classList.remove('hidden');
        triggerReconnection();
      }
      logSystemConsole('WebSocket closed. Clean: ' + event.wasClean, 'error');
    };

  } catch (err) {
    logSystemConsole('WebSocket creation failed: ' + err.message, 'error');
    triggerReconnection();
  }
}

function triggerReconnection() {
  if (state.connectionMode === 'offline') return;

  // Exponential backoff
  state.reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(1.5, state.reconnectAttempts), 15000);
  logSystemConsole(`Reconnecting in ${(delay / 1000).toFixed(1)}s (Attempt #${state.reconnectAttempts})...`, 'system');

  if (state.reconnectTimeout) clearTimeout(state.reconnectTimeout);
  state.reconnectTimeout = setTimeout(() => {
    connectWebSocket();
  }, delay);
}

function startPingPong() {
  state.pingInterval = setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      state.pingStartTime = Date.now();
      socket.send(JSON.stringify({ type: 'PING' }));
    }
  }, 5000);
}

function handleServerPayload(payload) {
  switch (payload.type) {
    case 'PONG': {
      const latency = Date.now() - state.pingStartTime;
      elements.wsPing.textContent = `${latency} ms`;
      break;
    }
    case 'INIT_DATA': {
      state.tickets = payload.tickets;
      renderChatsList();
      hideSkeletonLoaders();
      logSystemConsole('Received full tickets initialization bundle from server.', 'success');
      break;
    }
    case 'TICKET_CREATED': {
      state.tickets.unshift(payload.ticket);
      renderChatsList();

      // If we are looking for a newly created ticket, auto-select it if it's ours
      logSystemConsole(`Real-time update: Ticket ${payload.ticket.id} created.`, 'success');
      break;
    }
    case 'MESSAGE_ADDED': {
      const ticket = state.tickets.find(t => t.id === payload.ticketId);
      if (ticket) {
        // Prevent duplicate local messages (e.g. if we already rendered it locally as sending/delivered)
        // A simple check on timestamp/text helps filter
        const alreadyExists = ticket.messages.some(m =>
          m.timestamp === payload.message.timestamp &&
          m.text === payload.message.text
        );

        if (!alreadyExists) {
          ticket.messages.push(payload.message);
        }

        // If this is the active ticket view, render the message right now
        if (state.selectedTicketId === payload.ticketId) {
          renderMessages(payload.ticketId);
        }

        // Re-order or refresh lists
        renderChatsList();
      }
      break;
    }
    case 'STATUS_UPDATED': {
      const ticket = state.tickets.find(t => t.id === payload.ticketId);
      if (ticket) {
        ticket.status = payload.status;
        if (state.selectedTicketId === payload.ticketId) {
          elements.activeStatusSelect.value = payload.status;
        }
        renderChatsList();
        logSystemConsole(`Ticket ${payload.ticketId} status updated to ${payload.status}.`, 'system');
      }
      break;
    }
  }
}

/**
 * Sends a message via WebSocket, taking connection simulations into account.
 */
function transmitWSMessage(payload) {
  if (state.connectionMode === 'offline') {
    // Queue the message
    state.offlineQueue.push(payload);
    logSystemConsole('Offline Mode: Message buffered in queue.', 'system');

    // Add dummy queued message to local UI so floor staff sees it immediately
    if (payload.type === 'NEW_MESSAGE') {
      const localMsg = {
        sender: payload.sender,
        senderName: payload.senderName,
        text: payload.text,
        timestamp: new Date().toISOString(),
        queued: true // Custom flag for visual rendering
      };

      const ticket = state.tickets.find(t => t.id === payload.ticketId);
      if (ticket) {
        ticket.messages.push(localMsg);
        renderMessages(payload.ticketId);
      }
    }
    return;
  }

  if (state.connectionMode === 'slow') {
    // Artificial 2 seconds delay
    logSystemConsole('Slow 3G Simulation: Delaying transmission by 2000ms...', 'system');

    // Inject a pending loading state in local UI
    if (payload.type === 'NEW_MESSAGE') {
      const tempMsg = {
        sender: payload.sender,
        senderName: payload.senderName,
        text: payload.text,
        timestamp: new Date().toISOString(),
        pending: true
      };

      const ticket = state.tickets.find(t => t.id === payload.ticketId);
      if (ticket) {
        ticket.messages.push(tempMsg);
        renderMessages(payload.ticketId);
      }

      setTimeout(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          // Remove the temp pending message, send the actual message
          if (ticket) {
            ticket.messages = ticket.messages.filter(m => !m.pending);
          }
          socket.send(JSON.stringify(payload));
          logTelemetry('Delayed Message Transmitted', { ticketId: payload.ticketId });
        }
      }, 2000);
    } else {
      // For general non-message events
      setTimeout(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(payload));
        }
      }, 2000);
    }
  } else {
    // Fast standard delivery
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
      logTelemetry('Message Transmitted Immediately', { type: payload.type });
    } else {
      // Socket died just as we tried to send; buffer it
      state.offlineQueue.push(payload);
      logSystemConsole('WebSocket closed unexpectedly. Message queued.', 'error');
    }
  }
}

function flushOfflineQueue() {
  if (state.offlineQueue.length === 0) return;

  logSystemConsole(`Reconnected! Flushing ${state.offlineQueue.length} queued messages...`, 'success');

  // Send each buffered item in sequence
  state.offlineQueue.forEach((payload) => {
    // Remove local queued instances of messages to prevent visual duplicates
    if (payload.type === 'NEW_MESSAGE') {
      const ticket = state.tickets.find(t => t.id === payload.ticketId);
      if (ticket) {
        ticket.messages = ticket.messages.filter(m => !m.queued);
      }
    }

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
  });

  state.offlineQueue = [];
  logTelemetry('Flushed Offline Message Buffer Queue', { count: state.offlineQueue.length });
}

/* ==========================================
 * 4. Forms, Validation & Composers
 * ========================================== */

// Message send event
elements.chatInputForm.addEventListener('submit', (e) => {
  e.preventDefault();

  const text = elements.chatTextarea.value.trim();
  elements.chatTextarea.classList.remove('invalid');
  elements.inputValidationMsg.classList.remove('active');
  elements.inputValidationMsg.textContent = '';

  // 1. Validation
  if (!text) {
    elements.chatTextarea.classList.add('invalid');
    elements.inputValidationMsg.textContent = 'Message input cannot be empty.';
    elements.inputValidationMsg.classList.add('active');
    elements.chatTextarea.focus();
    logTelemetry('Chat Send Attempt Failed (Empty Body)');
    return;
  }

  if (text.length > 500) {
    elements.chatTextarea.classList.add('invalid');
    elements.inputValidationMsg.textContent = 'Message exceeds the 500 character limit.';
    elements.inputValidationMsg.classList.add('active');
    elements.chatTextarea.focus();
    logTelemetry('Chat Send Attempt Failed (Char Limit)');
    return;
  }

  // 2. Sanitization (XSS Defense)
  const sanitizedText = sanitize(text);

  // 3. Send
  const msgPayload = {
    type: 'NEW_MESSAGE',
    ticketId: state.selectedTicketId,
    sender: 'staff',
    senderName: 'Floor Staff (Alex)',
    text: sanitizedText
  };

  transmitWSMessage(msgPayload);

  logTelemetry('Chat Message Submitted', { ticketId: state.selectedTicketId, length: text.length });

  // Reset textarea
  elements.chatTextarea.value = '';
  updateCharCounter();
  elements.chatTextarea.focus();
});

// Real-time Character Counter & Input state clear
elements.chatTextarea.addEventListener('input', () => {
  updateCharCounter();
  if (elements.chatTextarea.value.trim()) {
    elements.chatTextarea.classList.remove('invalid');
    elements.inputValidationMsg.classList.remove('active');
  }
});

function updateCharCounter() {
  const len = elements.chatTextarea.value.length;
  elements.charCounter.textContent = `${len} / 500 characters`;

  if (len > 500) {
    elements.charCounter.style.color = 'var(--danger-color)';
  } else {
    elements.charCounter.style.color = 'var(--text-muted)';
  }
}

// Support key combos: Enter to send, Shift+Enter for newline
elements.chatTextarea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    elements.chatInputForm.requestSubmit();
  }
});

// Search functionality
elements.chatSearch.addEventListener('input', () => {
  renderChatsList();
});

// Modal Logic
elements.openNewTicketBtn.addEventListener('click', () => {
  elements.newTicketModal.classList.remove('hidden');
  document.getElementById('form-customer-name').focus();
  logTelemetry('Opened Create Ticket Modal');
  trapFocus(elements.newTicketModal);
});

function closeModal() {
  elements.newTicketModal.classList.add('hidden');
  elements.newTicketForm.reset();

  // Clear all modal errors and red highlighting
  const inputs = elements.newTicketForm.querySelectorAll('input, textarea, select');
  inputs.forEach(input => {
    input.classList.remove('invalid');
  });
  const errorContainers = elements.newTicketForm.querySelectorAll('.form-error-msg');
  errorContainers.forEach(container => {
    container.textContent = '';
  });

  elements.openNewTicketBtn.focus();
  logTelemetry('Closed Create Ticket Modal');
}

elements.closeModalBtn.addEventListener('click', closeModal);
elements.formCancelBtn.addEventListener('click', closeModal);

elements.newTicketModal.addEventListener('click', (e) => {
  if (e.target === elements.newTicketModal) closeModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !elements.newTicketModal.classList.contains('hidden')) {
    closeModal();
  }
});

// New Ticket Submit Handler with validation
elements.newTicketForm.addEventListener('submit', (e) => {
  e.preventDefault();

  let isValid = true;

  const customerName = document.getElementById('form-customer-name');
  const deviceModel = document.getElementById('form-device-model');
  const issueDescription = document.getElementById('form-issue-desc');
  const priority = document.getElementById('form-priority');

  // Helper validation clear
  const fields = [customerName, deviceModel, issueDescription, priority];
  fields.forEach(f => {
    f.classList.remove('invalid');
    const err = document.getElementById(`err-${f.name || f.id.replace('form-', '')}`);
    if (err) err.textContent = '';
    f.setAttribute('aria-invalid', 'false');
  });

  // Name Validation
  if (!customerName.value.trim()) {
    customerName.classList.add('invalid');
    customerName.setAttribute('aria-invalid', 'true');
    document.getElementById('err-customer-name').textContent = 'Customer name is required.';
    isValid = false;
  }

  // Device Model Validation
  if (!deviceModel.value.trim()) {
    deviceModel.classList.add('invalid');
    deviceModel.setAttribute('aria-invalid', 'true');
    document.getElementById('err-device-model').textContent = 'Device model/serial is required.';
    isValid = false;
  }

  // Issue Description Validation
  if (!issueDescription.value.trim()) {
    issueDescription.classList.add('invalid');
    issueDescription.setAttribute('aria-invalid', 'true');
    document.getElementById('err-issue-desc').textContent = 'Diagnostics issue details are required.';
    isValid = false;
  }

  // Priority Validation
  if (!priority.value) {
    priority.classList.add('invalid');
    priority.setAttribute('aria-invalid', 'true');
    document.getElementById('err-priority').textContent = 'A diagnostic priority level is required.';
    isValid = false;
  }

  if (!isValid) {
    logTelemetry('Ticket Creation Attempt Failed (Validation Errors)');
    return;
  }

  // Construct Payload
  const ticketPayload = {
    type: 'CREATE_TICKET',
    customerName: sanitize(customerName.value.trim()),
    deviceModel: sanitize(deviceModel.value.trim()),
    issueDescription: sanitize(issueDescription.value.trim()),
    priority: priority.value
  };

  // If Connection Mode is Slow 3G, simulate modal spinner overlay first
  if (state.connectionMode === 'slow') {
    const btn = elements.newTicketForm.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner" style="width: 16px; height: 16px; border-width: 2px;"></span> Simulating...`;

    setTimeout(() => {
      transmitWSMessage(ticketPayload);
      btn.disabled = false;
      btn.innerHTML = originalText;
      closeModal();
      logTelemetry('Created Ticket (Slow 3G Simulated)', { customer: ticketPayload.customerName });
    }, 2000);
  } else {
    transmitWSMessage(ticketPayload);
    closeModal();
    logTelemetry('Created Ticket Immediately', { customer: ticketPayload.customerName });
  }
});

/* ==========================================
 * 5. Rendering & Dom Utilities
 * ========================================== */

function hideSkeletonLoaders() {
  elements.chatsSkeleton.classList.add('hidden');
  elements.chatsList.classList.remove('hidden');
}

function renderChatsList() {
  const searchQuery = elements.chatSearch.value.trim().toLowerCase();

  // Filter tickets list based on query
  const filtered = state.tickets.filter((t) => {
    return (
      t.customerName.toLowerCase().includes(searchQuery) ||
      t.deviceModel.toLowerCase().includes(searchQuery) ||
      t.id.toLowerCase().includes(searchQuery)
    );
  });

  // Toggle empty states
  if (filtered.length === 0) {
    elements.chatsList.classList.add('hidden');
    elements.chatsEmptyState.classList.remove('hidden');
  } else {
    elements.chatsList.classList.remove('hidden');
    elements.chatsEmptyState.classList.add('hidden');
  }

  elements.chatsList.innerHTML = '';

  filtered.forEach((ticket) => {
    const li = document.createElement('li');
    li.style.width = '100%';

    // Create button element for strict accessibility
    const btn = document.createElement('button');
    btn.className = `chat-item ${state.selectedTicketId === ticket.id ? 'active' : ''}`;
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', state.selectedTicketId === ticket.id ? 'true' : 'false');
    btn.setAttribute('aria-label', `Ticket ${ticket.id} for ${ticket.deviceModel}, customer ${ticket.customerName}. Status: ${ticket.status}`);

    // Get last message text
    let lastMsg = 'No communications logged yet.';
    if (ticket.messages && ticket.messages.length > 0) {
      const validMsgs = ticket.messages.filter(m => m.sender !== 'system');
      if (validMsgs.length > 0) {
        lastMsg = validMsgs[validMsgs.length - 1].text;
      }
    }

    btn.innerHTML = `
      <div class="chat-item-header">
        <span class="device-name">${sanitize(ticket.deviceModel)}</span>
        <span class="ticket-id-tag">${ticket.id}</span>
      </div>
      <div class="chat-item-desc">${sanitize(lastMsg)}</div>
      <div class="chat-item-footer">
        <span class="customer-name">${sanitize(ticket.customerName)}</span>
        <div class="meta-tags">
          <span class="tag tag-${ticket.priority.toLowerCase()}">${ticket.priority}</span>
          <span class="tag tag-status">${ticket.status}</span>
        </div>
      </div>
    `;

    btn.addEventListener('click', () => {
      selectTicket(ticket.id);
    });

    li.appendChild(btn);
    elements.chatsList.appendChild(li);
  });
}

function selectTicket(ticketId) {
  if (state.selectedTicketId === ticketId) return;

  state.selectedTicketId = ticketId;
  logTelemetry('Selected Chat Ticket', { ticketId });

  // Update URL hash or elements class active
  const items = elements.chatsList.querySelectorAll('.chat-item');
  items.forEach(item => {
    const isSelected = item.querySelector('.ticket-id-tag').textContent === ticketId;
    item.classList.toggle('active', isSelected);
    item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
  });

  // Handle visual loading indicator if Slow 3G is enabled
  if (state.connectionMode === 'slow') {
    elements.asyncSpinner.classList.remove('hidden');
    elements.chatMessagesLog.classList.add('hidden');
    elements.chatInputPanel.classList.add('hidden');
    elements.welcomeChatScreen.classList.add('hidden');

    setTimeout(() => {
      elements.asyncSpinner.classList.add('hidden');
      elements.chatMessagesLog.classList.remove('hidden');
      elements.chatInputPanel.classList.remove('hidden');
      renderChatWindow(ticketId);
    }, 1500); // 1.5 seconds loading state for Slow 3G simulation
  } else {
    elements.welcomeChatScreen.classList.add('hidden');
    elements.chatMessagesLog.classList.remove('hidden');
    elements.chatInputPanel.classList.remove('hidden');
    renderChatWindow(ticketId);
  }
}

function renderChatWindow(ticketId) {
  const ticket = state.tickets.find(t => t.id === ticketId);
  if (!ticket) return;

  // Header info
  elements.activeDeviceName.textContent = ticket.deviceModel;
  elements.activeTicketId.textContent = ticket.id;
  elements.chatHeaderActions.classList.remove('hidden');
  elements.activeStatusSelect.value = ticket.status;

  // Sidebar details context
  elements.noContextCard.classList.add('hidden');
  elements.contextCard.classList.remove('hidden');
  elements.metaCustomerName.textContent = ticket.customerName;
  elements.metaTicketId.textContent = ticket.id;

  // Format Date nicely
  const d = new Date(ticket.createdAt);
  elements.metaCreatedDate.textContent = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  // Setup diagnostic checkboxes simulation
  elements.chkVoltage.checked = ticket.status === 'In Progress' || ticket.status === 'Ready for Pickup';
  elements.chkSolder.checked = ticket.status === 'Ready for Pickup';
  elements.chkBurnin.checked = ticket.status === 'Ready for Pickup';

  renderMessages(ticketId);
}

function renderMessages(ticketId) {
  const ticket = state.tickets.find(t => t.id === ticketId);
  if (!ticket) return;

  elements.chatMessagesLog.innerHTML = '';

  ticket.messages.forEach((msg) => {
    const bubble = document.createElement('div');

    // Setup class hierarchy
    let bubbleClass = 'message-bubble ';
    if (msg.sender === 'staff') bubbleClass += 'staff';
    else if (msg.sender === 'customer') bubbleClass += 'customer';
    else bubbleClass += 'system';

    bubble.className = bubbleClass;

    // Check delivery badge status for current staff member's outgoing messages
    let statusHTML = '';
    if (msg.sender === 'staff') {
      if (msg.pending) {
        statusHTML = `<span class="bubble-status sending" aria-label="Sending message"><span class="spinner" style="width:10px;height:10px;border-width:1.5px;"></span> Sending...</span>`;
      } else if (msg.queued) {
        statusHTML = `<span class="bubble-status failed" aria-label="Failed to send. Message is queued offline.">⚠ Queued (Offline)</span>`;
      } else {
        statusHTML = `<span class="bubble-status delivered" aria-label="Delivered to customer">✓ Delivered</span>`;
      }
    }

    const tString = new Date(msg.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

    bubble.innerHTML = `
      <span class="bubble-text">${sanitize(msg.text)}</span>
      <div class="bubble-meta">
        <span class="bubble-sender">${sanitize(msg.senderName)}</span>
        <span class="bubble-time">${tString}</span>
        ${statusHTML}
      </div>
    `;

    elements.chatMessagesLog.appendChild(bubble);
  });

  // Autoscroll to bottom
  elements.chatMessagesLog.scrollTop = elements.chatMessagesLog.scrollHeight;
}

// Canned reply button inserts
document.querySelectorAll('.btn-template').forEach((btn) => {
  btn.addEventListener('click', () => {
    const templateText = btn.getAttribute('data-text');

    // Standard professional workflow: insert template in composer textbox and focus
    elements.chatTextarea.value = templateText;
    updateCharCounter();
    elements.chatTextarea.focus();

    logTelemetry('Selected Template Reply', { length: templateText.length });
  });
});

// Update ticket status
elements.activeStatusSelect.addEventListener('change', () => {
  const newStatus = elements.activeStatusSelect.value;
  const payload = {
    type: 'UPDATE_STATUS',
    ticketId: state.selectedTicketId,
    status: newStatus
  };

  transmitWSMessage(payload);
  logTelemetry('Changed Ticket Status', { ticketId: state.selectedTicketId, newStatus });
});

// Clear telemetry display
elements.clearTelemetryBtn.addEventListener('click', () => {
  elements.telemetryLogs.innerHTML = `<div class="log-entry system">[System] Telemetry cleared by user.</div>`;
});

/* ==========================================
 * 6. Accessibility Helpers
 * ========================================== */

/**
 * Traps focus inside the modal element for keyboard navigation.
 */
function trapFocus(modalEl) {
  const focusableElements = modalEl.querySelectorAll('input, select, textarea, button, [tabindex="0"]');
  const firstFocusable = focusableElements[0];
  const lastFocusable = focusableElements[focusableElements.length - 1];

  modalEl.addEventListener('keydown', function (e) {
    if (e.key === 'Tab') {
      if (e.shiftKey) { // Shift + Tab
        if (document.activeElement === firstFocusable) {
          lastFocusable.focus();
          e.preventDefault();
        }
      } else { // Tab
        if (document.activeElement === lastFocusable) {
          firstFocusable.focus();
          e.preventDefault();
        }
      }
    }
  });
}

/* ==========================================
 * 7. Network Link Simulation Toggles
 * ========================================== */

function updateNetworkSimulation(mode) {
  state.connectionMode = mode;
  logTelemetry('Switched Simulated Link State', { mode });

  if (mode === 'offline') {
    // Explicitly disconnect WS
    if (socket) {
      socket.close();
    }
    elements.connectionBanner.classList.remove('hidden');
    elements.wsBadge.textContent = 'OFFLINE';
    elements.wsBadge.className = 'badge';
    elements.connectionDot.className = 'status-dot disconnected';
    elements.wsPing.textContent = '-- ms';
    logSystemConsole('Network offline. Disconnecting WebSocket.', 'error');
  } else {
    // Mode is Fast or Slow 3G
    elements.connectionBanner.classList.add('hidden');

    // Re-establish connection if closed
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      connectWebSocket();
    } else {
      // Socket is already open, just switch indicator color back
      elements.wsBadge.textContent = 'CONNECTED';
      elements.wsBadge.className = 'badge';
      elements.connectionDot.className = 'status-dot connected';
      flushOfflineQueue();
    }
  }
}

elements.simFast.addEventListener('change', () => updateNetworkSimulation('fast'));
elements.simSlow.addEventListener('change', () => updateNetworkSimulation('slow'));
elements.simOffline.addEventListener('change', () => updateNetworkSimulation('offline'));

/* ==========================================
 * 8. Initialization
 * ========================================== */

// Start connection
connectWebSocket();
logSystemConsole('Electronics Repair Chat Portal initialized.', 'system');
