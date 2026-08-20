const DATA_URL = 'data/usage.json';
const AUTO_REFRESH_MS = 60_000;
const THEME_STORAGE_KEY = 'codex-meter-theme';

const limitGrid = document.querySelector('#limitGrid');
const template = document.querySelector('#limitCardTemplate');
const refreshButton = document.querySelector('#refreshButton');
const updatedAt = document.querySelector('#updatedAt');
const planBadge = document.querySelector('#planBadge');
const themeColorMeta = document.querySelector('#themeColor');
const themeButtons = [...document.querySelectorAll('[data-theme-choice]')];

const THEMES = ['dark', 'light', 'aurora'];
const THEME_COLORS = {
  dark: '#090d17',
  light: '#f6f7fb',
  aurora: '#07151c',
};

const CARD_CONFIGS = [
  {
    id: 'codex',
    title: '週間枠',
    kicker: 'CODEX WEEKLY',
    badge: '7D',
  },
  {
    id: 'codex_bengalfox',
    title: 'GPT-5.3-Codex-Spark',
    kicker: 'SPARK WEEKLY',
    badge: 'SPARK',
  },
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function getSavedTheme() {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return THEMES.includes(value) ? value : 'dark';
  } catch {
    return 'dark';
  }
}

function applyTheme(choice, { persist = true } = {}) {
  const theme = THEMES.includes(choice) ? choice : 'dark';
  document.documentElement.dataset.theme = theme;

  for (const button of themeButtons) {
    button.setAttribute(
      'aria-pressed',
      button.dataset.themeChoice === theme ? 'true' : 'false'
    );
  }

  if (themeColorMeta) {
    themeColorMeta.setAttribute('content', THEME_COLORS[theme]);
  }

  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {}
  }
}

function formatResetTime(isoString) {
  if (!isoString) return '取得なし';

  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '取得なし';

  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();

  return new Intl.DateTimeFormat('ja-JP', {
    ...(sameYear ? {} : { year: 'numeric' }),
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatUpdatedTime(isoString) {
  if (!isoString) return '更新時刻不明';

  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '更新時刻不明';

  return `更新 ${new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)}`;
}

function getLevel(remaining) {
  if (remaining >= 50) return 'good';
  if (remaining >= 20) return 'warn';
  return 'low';
}

function findWeeklyWindow(limit) {
  const windows = Array.isArray(limit?.windows) ? limit.windows : [];

  return windows.find((item) => item.kind === 'weekly')
    || windows.find((item) => Number(item.windowDurationMins) === 10080)
    || null;
}

function findLimit(data, id) {
  if (id === 'codex') {
    const limits = Array.isArray(data.limits) ? data.limits : [];
    return limits.find((item) => item.limitId === 'codex')
      || { limitId: 'codex', limitName: 'Codex', windows: data.windows || [] };
  }

  const limits = Array.isArray(data.limits) ? data.limits : [];

  return limits.find((item) => item.limitId === id)
    || limits.find((item) =>
      id === 'codex_bengalfox'
      && String(item.limitName || '').toLowerCase().includes('codex-spark')
    )
    || null;
}

function createLimitCard(windowData, config) {
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector('.limit-card');

  const remaining = clamp(
    windowData.remainingPercent ?? (100 - windowData.usedPercent),
    0,
    100
  );

  const used = clamp(
    windowData.usedPercent ?? (100 - remaining),
    0,
    100
  );

  const level = getLevel(remaining);
  card.dataset.level = level;

  fragment.querySelector('.limit-kicker').textContent = config.kicker;
  fragment.querySelector('.limit-title').textContent = config.title;
  fragment.querySelector('.window-badge').textContent = config.badge;
  fragment.querySelector('.remaining-value').textContent = Math.round(remaining);
  fragment.querySelector('.used-value').textContent = `${Math.round(used)}%`;
  fragment.querySelector('.reset-value').textContent = formatResetTime(windowData.resetsAt);

  const track = fragment.querySelector('.progress-track');
  const fill = fragment.querySelector('.progress-fill');

  track.setAttribute('aria-valuenow', String(Math.round(remaining)));
  track.setAttribute('aria-label', `${config.title} 残り${Math.round(remaining)}%`);

  requestAnimationFrame(() => {
    fill.style.width = `${remaining}%`;
  });

  return fragment;
}

function createUnavailableCard(config) {
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector('.limit-card');
  card.dataset.unavailable = 'true';

  fragment.querySelector('.limit-kicker').textContent = config.kicker;
  fragment.querySelector('.limit-title').textContent = config.title;
  fragment.querySelector('.window-badge').textContent = config.badge;
  fragment.querySelector('.remaining-value').textContent = '--';
  fragment.querySelector('.remaining-unit').textContent = '%';
  fragment.querySelector('.used-value').textContent = '--';
  fragment.querySelector('.reset-value').textContent = '取得なし';

  return fragment;
}

function render(data) {
  limitGrid.replaceChildren();

  for (const config of CARD_CONFIGS) {
    const limit = findLimit(data, config.id);
    const weekly = findWeeklyWindow(limit);

    limitGrid.appendChild(
      weekly
        ? createLimitCard(weekly, config)
        : createUnavailableCard(config)
    );
  }

  updatedAt.textContent = formatUpdatedTime(data.updatedAt);

  if (data.planType) {
    planBadge.textContent = String(data.planType).toUpperCase();
    planBadge.hidden = false;
  } else {
    planBadge.hidden = true;
  }
}

function renderError(error) {
  console.error(error);
  updatedAt.textContent = '更新失敗';
  limitGrid.innerHTML = `
    <div class="empty-state">
      <strong>データを読み込めませんでした</strong>
    </div>
  `;
}

async function loadUsage() {
  refreshButton.disabled = true;
  refreshButton.classList.add('is-loading');

  try {
    const response = await fetch(`${DATA_URL}?v=${Date.now()}`, {
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    render(await response.json());
  } catch (error) {
    renderError(error);
  } finally {
    refreshButton.disabled = false;
    refreshButton.classList.remove('is-loading');
  }
}

for (const button of themeButtons) {
  button.addEventListener('click', () => {
    applyTheme(button.dataset.themeChoice);
  });
}

applyTheme(getSavedTheme(), { persist: false });

refreshButton.addEventListener('click', loadUsage);
loadUsage();
setInterval(loadUsage, AUTO_REFRESH_MS);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('sw.js')
      .catch((error) => console.warn('SW registration failed', error));
  });
}

