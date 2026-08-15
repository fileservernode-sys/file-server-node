/* ==========================================================================
   SERVER DISCOVERY & DEVICE STATUS SERVICE - FRONTEND MOCK DATA & UI CONTROLLER
   Clean API boundary preparing for Phase 2 HTTP API integration.
   ========================================================================== */

/**
 * 1. Centralized Mock Repository (Demo Data Only - Zero Sensitive Production Keys)
 */
const MOCK_DEVICE_DATABASE = {
  // Scenario 1: Standard account with multiple devices in various online/offline/connecting states
  "demo@remotenode.io": [
    {
      id: "dev-01",
      name: "Pixel 6a (Primary Storage Host)",
      status: "online",
      serverStatus: "Available",
      lastSeen: "Just now",
      endpoint: "https://pixel6a-home.remotenode.net",
      canAccess: true,
      storageStats: "128 GB Total • 42 GB Free"
    },
    {
      id: "dev-02",
      name: "Galaxy S10 (Backup Media Server)",
      status: "offline",
      serverStatus: "Unavailable",
      lastSeen: "2 hours ago",
      endpoint: "https://galaxys10-media.remotenode.net",
      canAccess: false,
      storageStats: "256 GB Total • 110 GB Free"
    },
    {
      id: "dev-03",
      name: "OnePlus 7 (Archive Node)",
      status: "connecting",
      serverStatus: "Establishing Tunnel...",
      lastSeen: "Connecting...",
      endpoint: "https://oneplus7-archive.remotenode.net",
      canAccess: false,
      storageStats: "64 GB Total • 18 GB Free"
    }
  ],

  // Scenario 2: Account exists but no devices have been linked yet
  "nodevices@remotenode.io": []
};

/**
 * 2. Service Boundary Function (Will be swapped with fetch() / Axios in Phase 2)
 */
function findDevicesByEmail(email) {
  return new Promise((resolve, reject) => {
    const normalizedEmail = email.trim().toLowerCase();

    // Simulated network delay (600ms) for realistic loading state preview
    setTimeout(() => {
      if (normalizedEmail === "error@remotenode.io") {
        reject(new Error("NETWORK_TIMEOUT"));
        return;
      }

      if (Object.prototype.hasOwnProperty.call(MOCK_DEVICE_DATABASE, normalizedEmail)) {
        resolve({
          found: true,
          email: normalizedEmail,
          devices: MOCK_DEVICE_DATABASE[normalizedEmail]
        });
      } else {
        // Generic response for unknown email to prevent account enumeration
        resolve({
          found: false,
          email: normalizedEmail,
          devices: []
        });
      }
    }, 650);
  });
}

/**
 * 3. Frontend State Controller & Event Registration
 */
document.addEventListener('DOMContentLoaded', () => {
  initServerDiscoveryUI();
});

function initServerDiscoveryUI() {
  const form = document.getElementById('server-lookup-form');
  const emailInput = document.getElementById('lookup-email-input');
  
  // Containers
  const containerInitial = document.getElementById('state-initial');
  const containerLoading = document.getElementById('state-loading');
  const containerNotFound = document.getElementById('state-not-found');
  const containerNoDevices = document.getElementById('state-no-devices');
  const containerDevicesFound = document.getElementById('state-devices-found');
  const containerError = document.getElementById('state-error');

  const deviceGrid = document.getElementById('device-list-grid');

  if (!form || !emailInput) return;

  // Helper to switch visible state panel
  const showState = (targetState) => {
    [containerInitial, containerLoading, containerNotFound, containerNoDevices, containerDevicesFound, containerError].forEach(el => {
      if (el) el.style.display = 'none';
    });
    if (targetState) targetState.style.display = 'block';
  };

  // Form Submit Handler
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const emailValue = emailInput.value.trim();

    if (!emailValue) return;

    showState(containerLoading);

    try {
      const response = await findDevicesByEmail(emailValue);

      if (!response.found) {
        showState(containerNotFound);
      } else if (response.devices.length === 0) {
        showState(containerNoDevices);
      } else {
        renderDeviceCards(response.devices, deviceGrid);
        showState(containerDevicesFound);
      }
    } catch (err) {
      showState(containerError);
    }
  });

  // Reset / Retry Buttons
  document.querySelectorAll('[data-action="reset-lookup"]').forEach(btn => {
    btn.addEventListener('click', () => {
      emailInput.value = '';
      showState(containerInitial);
      emailInput.focus();
    });
  });

  document.querySelectorAll('[data-action="retry-lookup"]').forEach(btn => {
    btn.addEventListener('click', () => {
      form.dispatchEvent(new Event('submit'));
    });
  });
}

/**
 * 4. Device Cards Renderer
 */
function renderDeviceCards(devices, container) {
  if (!container) return;

  container.innerHTML = devices.map(device => {
    const statusMap = {
      online: { badgeClass: 'status-online', text: 'Online', dotColor: 'var(--color-online)' },
      offline: { badgeClass: 'status-offline', text: 'Offline', dotColor: 'var(--color-offline)' },
      connecting: { badgeClass: 'status-connecting', text: 'Connecting...', dotColor: 'var(--color-connecting)' }
    };

    const currentStatus = statusMap[device.status] || statusMap.offline;

    let ctaButtonHtml = '';
    if (device.status === 'online') {
      ctaButtonHtml = `<a href="${device.endpoint}" target="_blank" rel="noopener noreferrer" class="btn btn-primary" style="width: 100%;">Open File Server</a>`;
    } else if (device.status === 'connecting') {
      ctaButtonHtml = `<button class="btn btn-secondary" disabled style="width: 100%;"><span class="spinner"></span> Connecting Server...</button>`;
    } else {
      ctaButtonHtml = `<button class="btn btn-secondary" disabled style="width: 100%;">Server Offline</button>`;
    }

    return `
      <div class="card card-hover" style="display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          <!-- Header Row -->
          <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-md); margin-bottom: var(--space-md);">
            <div>
              <h3 class="card-title" style="margin-bottom: 2px;">${escapeHtml(device.name)}</h3>
              <span style="font-size: var(--font-size-xs); color: var(--color-text-muted);">${escapeHtml(device.storageStats)}</span>
            </div>
            <span class="status-indicator ${currentStatus.badgeClass}">
              <span class="status-dot"></span>
              ${currentStatus.text}
            </span>
          </div>

          <!-- Metadata -->
          <div style="margin-bottom: var(--space-lg); font-size: var(--font-size-xs); color: var(--color-text-secondary); display: flex; gap: var(--space-lg);">
            <div><strong>Status:</strong> ${escapeHtml(device.serverStatus)}</div>
            <div><strong>Last Seen:</strong> ${escapeHtml(device.lastSeen)}</div>
          </div>

          <!-- Endpoint Box with Copy Button -->
          <div style="background-color: var(--color-surface-secondary); padding: var(--space-sm) var(--space-md); border-radius: var(--radius-md); border: 1px solid var(--color-border); margin-bottom: var(--space-lg); display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm);">
            <code style="font-size: var(--font-size-xs); color: var(--color-text-primary); word-break: break-all;">${escapeHtml(device.endpoint)}</code>
            <button class="btn btn-ghost btn-sm" onclick="copyEndpointToClipboard('${escapeHtml(device.endpoint)}', this)" aria-label="Copy server address">
              Copy
            </button>
          </div>
        </div>

        <!-- CTA Action -->
        <div>
          ${ctaButtonHtml}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * 5. Clipboard Copy Helper
 */
function copyEndpointToClipboard(text, btnElement) {
  if (!navigator.clipboard) return;

  navigator.clipboard.writeText(text).then(() => {
    const originalText = btnElement.innerText;
    btnElement.innerText = "Copied!";
    btnElement.style.color = "var(--color-success)";
    
    setTimeout(() => {
      btnElement.innerText = originalText;
      btnElement.style.color = "";
    }, 1800);
  }).catch(() => {
    btnElement.innerText = "Failed";
  });
}

/**
 * Utility: HTML Escaping
 */
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, match => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[match]);
}
