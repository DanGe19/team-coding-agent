/* ===== WAA Chat - Client Script ===== */

(function () {
  'use strict';

  // ---- DOM References ----
  const messagesArea = document.getElementById('messagesArea');
  const messageCountEl = document.getElementById('messageCount');
  const refreshBtn = document.getElementById('refreshBtn');
  const postForm = document.getElementById('postForm');
  const usernameInput = document.getElementById('username');
  const messageInput = document.getElementById('message');
  const formError = document.getElementById('formError');

  // ---- Constants ----
  const API_MESSAGES = '/api/messages';
  const API_MESSAGE = '/api/message';
  const REFRESH_INTERVAL = 30000; // 30 seconds
  const LS_USERNAME_KEY = 'waa_chat_username';

  // ---- Restore last username from localStorage ----
  const savedUsername = localStorage.getItem(LS_USERNAME_KEY);
  if (savedUsername) {
    usernameInput.value = savedUsername;
  }

  // ---- Utility: format ISO timestamp to local time ----
  function formatTime(isoString) {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  // ---- Utility: get current username from input ----
  function getCurrentUsername() {
    return usernameInput.value.trim();
  }

  // ---- Build a message card DOM element ----
  function buildMessageCard(msg) {
    const currentUser = getCurrentUsername();
    const card = document.createElement('div');
    card.className = 'message-card ' + (msg.username === currentUser ? 'card-mine' : 'card-other');
    card.dataset.id = msg.id;

    const header = document.createElement('div');
    header.className = 'message-header';

    const usernameSpan = document.createElement('span');
    usernameSpan.className = 'message-username';
    usernameSpan.textContent = msg.username;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'message-time';
    timeSpan.textContent = formatTime(msg.timestamp);

    header.appendChild(usernameSpan);
    header.appendChild(timeSpan);

    const textSpan = document.createElement('span');
    textSpan.className = 'message-text';
    textSpan.textContent = msg.text;

    card.appendChild(header);
    card.appendChild(textSpan);

    return card;
  }

  // ---- Render messages into the messages area ----
  function renderMessages(messages) {
    messagesArea.innerHTML = '';

    if (!messages || messages.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = '<p>No messages yet. Be the first to say something! 🎉</p>';
      messagesArea.appendChild(empty);
    } else {
      messages.forEach(function (msg) {
        messagesArea.appendChild(buildMessageCard(msg));
      });
      // Scroll to bottom
      messagesArea.scrollTop = messagesArea.scrollHeight;
    }

    // Update count
    const count = messages ? messages.length : 0;
    messageCountEl.textContent = count + ' message' + (count !== 1 ? 's' : '');
  }

  // ---- Fetch messages from API ----
  function fetchMessages() {
    return fetch(API_MESSAGES)
      .then(function (res) {
        if (!res.ok) throw new Error('Failed to fetch messages');
        return res.json();
      })
      .then(function (messages) {
        renderMessages(messages);
      })
      .catch(function (err) {
        console.error('Error fetching messages:', err);
      });
  }

  // ---- Show inline error ----
  function showError(msg) {
    formError.textContent = msg;
  }

  function clearError() {
    formError.textContent = '';
  }

  // ---- Handle form submission ----
  postForm.addEventListener('submit', function (e) {
    e.preventDefault();
    clearError();

    const username = usernameInput.value.trim();
    const text = messageInput.value.trim();

    if (!username) {
      showError('Please enter your name.');
      usernameInput.focus();
      return;
    }

    if (!text) {
      showError('Please enter a message.');
      messageInput.focus();
      return;
    }

    // Save username to localStorage
    localStorage.setItem(LS_USERNAME_KEY, username);

    // Disable send button while posting
    const sendBtn = document.getElementById('sendBtn');
    sendBtn.disabled = true;

    fetch(API_MESSAGE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, text: text })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { status: res.status, data: data };
        });
      })
      .then(function (result) {
        if (result.status === 201) {
          // Clear message input and keep focus
          messageInput.value = '';
          messageInput.focus();
          // Refresh messages to show the new one
          return fetchMessages();
        } else {
          showError(result.data.error || 'Failed to send message.');
        }
      })
      .catch(function (err) {
        console.error('Error posting message:', err);
        showError('Network error. Please try again.');
      })
      .finally(function () {
        sendBtn.disabled = false;
      });
  });

  // ---- Enter key submits form (Shift+Enter for newline) ----
  messageInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      postForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }
  });

  // ---- Manual refresh button ----
  refreshBtn.addEventListener('click', function () {
    fetchMessages();
  });

  // ---- Auto-refresh every 30 seconds ----
  setInterval(fetchMessages, REFRESH_INTERVAL);

  // ---- Initial load: fetch messages via API to keep dynamic ----
  // (Messages are also server-rendered on initial load via Handlebars)
  fetchMessages();

})();
