const DEFAULT_BASE_URL = 'http://66.42.101.154:8788';

export class PublisherApi {
  constructor(storage = window.localStorage) {
    this.storage = storage;
    this.baseUrl = storage.getItem('caishen.publisher.baseUrl') || DEFAULT_BASE_URL;
  }

  setBaseUrl(value) {
    this.baseUrl = String(value || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.storage.setItem('caishen.publisher.baseUrl', this.baseUrl);
  }

  async request(path, options = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload.data;
  }

  login(username, password) {
    return this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
  }

  logout() {
    return this.request('/api/auth/logout', { method: 'POST' });
  }

  status() {
    return this.request('/api/auth/status');
  }

  extensionOptions() {
    return this.request('/api/taobao/publish/extension-options');
  }

  saveSettings(settings) {
    return this.request('/api/rpc', {
      method: 'POST',
      body: JSON.stringify({ method: 'saveTaobaoPublishSettings', args: [settings] })
    });
  }

  heartbeat({ userId, deviceId, deviceName = '', appVersion = '', activeStoreId = '', autoPublish = true }) {
    return this.request('/api/taobao/publish/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ userId, deviceId, deviceName, appVersion, activeStoreId, autoPublish })
    });
  }

  listTasks({ token, userId = '', storeId = '', deviceId = '' }) {
    const params = new URLSearchParams({
      token: token || '',
      userId,
      storeId,
      deviceId
    });
    return this.request(`/api/taobao/publish/tasks?${params.toString()}`);
  }

  claimNextTask({ token, userId, storeId, deviceId }) {
    return this.request('/api/taobao/publish/claim', {
      method: 'POST',
      body: JSON.stringify({ token, userId, storeId, deviceId, extensionId: `exe:${deviceId}` })
    });
  }

  claimSpecificTask({ token, userId, storeId, deviceId, taskId }) {
    return this.request('/api/taobao/publish/claim', {
      method: 'POST',
      body: JSON.stringify({ token, userId, storeId, deviceId, taskId, extensionId: `exe:${deviceId}` })
    });
  }

  updateTaskStatus(id, payload) {
    return this.request(`/api/taobao/publish/tasks/${encodeURIComponent(id)}/status`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }
}
