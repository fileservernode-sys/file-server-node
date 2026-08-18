/* ==========================================================================
   SERVER DISCOVERY & DEVICE STATUS SERVICE — REAL BACKEND API INTEGRATION
   Zero mock data. Uses authenticated control plane API.
   ========================================================================== */

/**
 * 1. Discover Real Registered Devices via Authenticated Backend API
 */
async function findUserDevices() {
  const token = typeof AuthService !== 'undefined' ? AuthService.getAuthToken() : null;

  if (!token) {
    return {
      authenticated: false,
      devices: []
    };
  }

  try {
    const res = await apiRequest('/devices', 'GET');
    if (!res.ok || !res.data || !res.data.success) {
      throw new Error(res.data?.error?.message || 'Failed to query servers');
    }

    const rawDevices = res.data.data?.devices || [];

    const mappedDevices = rawDevices.map(d => {
      const server = d.server;
      const endpoint = server?.endpoint;
      const isOnline = d.status === 'ONLINE' && server?.status === 'RUNNING';
      const isStarting = server?.status === 'STARTING';

      let status = 'offline';
      let serverStatusText = 'Offline';
      if (isOnline) {
        status = 'online';
        serverStatusText = 'Available';
      } else if (isStarting) {
        status = 'connecting';
        serverStatusText = 'Starting Server...';
      }

      const publicUrl = endpoint && endpoint.status === 'ACTIVE' && endpoint.hostname
        ? `https://${endpoint.hostname}`
        : null;

      return {
        id: d.id,
        serverId: server?.id || null,
        name: server?.serverName || d.deviceName || 'Personal File Server',
        status,
        serverStatus: serverStatusText,
        lastSeen: d.lastSeenAt ? formatRelativeTime(d.lastSeenAt) : 'Not available yet',
        endpoint: publicUrl || (endpoint?.hostname ? `https://${endpoint.hostname} (Connecting)` : 'Provisioning...'),
        canAccess: isOnline && !!server?.id,
        storageStats: `${d.platform || 'Android'} ${d.osVersion || ''} • App v${d.appVersion || '1.0.0'}`
      };
    });

    return {
      authenticated: true,
      devices: mappedDevices
    };
  } catch (err) {
    throw err;
  }
}

/**
 * 2. Frontend State Controller & Event Registration
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

  const showState = (targetState) => {
    [containerInitial, containerLoading, containerNotFound, containerNoDevices, containerDevicesFound, containerError].forEach(el => {
      if (el) el.style.display = 'none';
    });
    if (targetState) targetState.style.display = 'block';
  };

  const savedUser = typeof AuthService !== 'undefined' ? AuthService.getSavedUser() : null;
  if (savedUser && savedUser.email) {
    emailInput.value = savedUser.email;
  }

  // Form Submit Handler
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = typeof AuthService !== 'undefined' ? AuthService.getAuthToken() : null;

    if (!token) {
      // Must be authenticated to access server list
      window.location.href = 'login.html';
      return;
    }

    showState(containerLoading);

    try {
      const response = await findUserDevices();

      if (!response.authenticated) {
        window.location.href = 'login.html';
        return;
      }

      if (response.devices.length === 0) {
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
 * 3. Device Cards Renderer
 */
function renderDeviceCards(devices, container) {
  if (!container) return;

  container.innerHTML = devices.map(device => {
    const statusMap = {
      online: { badgeClass: 'status-online', text: 'Online' },
      offline: { badgeClass: 'status-offline', text: 'Offline' },
      connecting: { badgeClass: 'status-connecting', text: 'Connecting...' }
    };

    const currentStatus = statusMap[device.status] || statusMap.offline;

    let ctaButtonHtml = '';
    if (device.status === 'online' && device.canAccess && device.serverId) {
      ctaButtonHtml = `
        <a href="file-manager.html?server=${escapeHtml(device.serverId)}" class="btn btn-primary" style="width: 100%; text-align: center; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600;">
          <svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
          <span>Open File Manager</span>
        </a>
      `;
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
            ${device.canAccess ? `
              <button class="btn btn-ghost btn-sm" onclick="copyEndpointToClipboard('${escapeHtml(device.endpoint)}', this)" aria-label="Copy server address">
                Copy
              </button>
            ` : ''}
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
 * 4. Clipboard Copy Helper
 */
function copyEndpointToClipboard(text, btnElement) {
  if (!navigator.clipboard) {
    const temp = document.createElement('textarea');
    temp.value = text;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand('copy');
    document.body.removeChild(temp);
  } else {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  if (btnElement) {
    const originalText = btnElement.innerText;
    btnElement.innerText = "Copied!";
    btnElement.style.color = "var(--color-success, #059669)";
    
    setTimeout(() => {
      btnElement.innerText = originalText;
      btnElement.style.color = "";
    }, 2000);
  }
}

/**
 * Helper: Relative Time Formatter
 */
function formatRelativeTime(dateString) {
  if (!dateString) return 'Not available yet';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return 'Not available yet';

  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSec < 15) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/**
 * Utility: HTML Escaping
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, match => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[match]);
}
