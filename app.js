// WebSocket client logic extracted from the original inline script
// Keeps behavior consistent while enhancing the UI and structure

var wsUri = "ws://127.0.0.1:8080/";
var output;
var websocket;

function getServerIpElem() {
  return document.getElementById("server-ip");
}

function init() {
  output = document.getElementById("output");

  document.getElementById("connect-bt").addEventListener("click", function () {
    output.innerHTML = "";
    testWebSocket();
  });

  var messageInput = document.getElementById("message");

  document.getElementById("send-message").addEventListener("click", function () {
    doSend(messageInput.value);
  });

  document
    .getElementById("send-message-binary")
    .addEventListener("click", function () {
      doSendBinary(messageInput.value);
    });

  // Optional UX: press Enter to send text
  messageInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend(messageInput.value);
    }
  });

  // Pre-fill server URI
  getServerIpElem().value = wsUri;

  // Wire copy buttons for samples
  var copyButtons = document.querySelectorAll('[data-copy]');
  copyButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var sampleEl = btn.previousElementSibling; // .sample-code
      if (!sampleEl) return;
      var text = sampleEl.getAttribute('data-text') || sampleEl.textContent || '';
      copyTextToClipboard(text.trim());
      flashCopied(btn);
    });
  });
}

function testWebSocket() {
  wsUri = getServerIpElem().value;

  writeToScreen("CONNECTING...");

  websocket = new WebSocket(wsUri);
  websocket.onopen = function (evt) {
    onOpen(evt);
  };
  websocket.onclose = function (evt) {
    onClose(evt);
  };
  websocket.onmessage = function (evt) {
    onMessage(evt);
  };
  websocket.onerror = function (evt) {
    onError(evt);
  };
}

function onOpen(evt) {
  writeToScreen("CONNECTED");
}

function onClose(evt) {
  writeToScreen("DISCONNECTED");
}

function onMessage(evt) {
  if (evt.data instanceof Blob) {
    evt.data.text().then(function (txt) {
      writeToScreen('<span style="color: #33D3FF;">RESPONSE (BINARY): ' + escapeHtml(txt) + '</span>');
    });
  } else {
    writeToScreen('<span style="color: #5b8cff;">RESPONSE: ' + escapeHtml(evt.data) + '</span>');
  }
}

function onError(evt) {
  try {
    writeToScreen('<span style="color: #ef4444;">ERROR:</span> ' + escapeHtml(JSON.stringify(evt)));
  } catch (_) {
    writeToScreen('<span style="color: #ef4444;">ERROR</span>');
  }
}

function doSend(message) {
  writeToScreen("SENT: " + escapeHtml(String(message)));
  websocket.send(message);
}

function doSendBinary(message) {
  writeToScreen("SENT (BINARY): " + escapeHtml(String(message)));
  websocket.send(new Blob([message]));
}

function writeToScreen(message) {
  var p = document.createElement("p");
  p.style.wordWrap = "break-word";
  p.innerHTML = message;
  output.appendChild(p);
  output.scrollTop = output.scrollHeight;
}

function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).catch(function () {});
  } else {
    // Fallback for non-secure contexts
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
  }
}

function flashCopied(btn) {
  var original = btn.textContent;
  btn.textContent = 'Copied!';
  btn.disabled = true;
  setTimeout(function () {
    btn.textContent = original;
    btn.disabled = false;
  }, 900);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

window.addEventListener("load", init, false);

