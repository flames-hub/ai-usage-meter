const DATA_URL = 'data/usage.json';
const AUTO_REFRESH_MS = 60_000;

const limitGrid = document.querySelector('#limitGrid');
const template = document.querySelector('#limitCardTemplate');
const refreshButton = document.querySelector('#refreshButton');
const statusText = document.querySelector('#statusText');
const updatedAt = document.querySelector('#updatedAt');
const planBadge = document.querySelector('#planBadge');
const connectionState = document.querySelector('#connectionState');

const EXPECTED_WINDOWS = [
  { kind: 'fiveHour', label: '5時間枠', duration: 300, kicker: 'SHORT WINDOW' },
  { kind: 'weekly', label: '週間枠', duration: 10080, kicker: 'WEEKLY WINDOW' },
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
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
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).format(date)}`;
}

function findWindow(data, expected) {
  const windows = Array.isArray(data.windows) ? data.windows : [];
  return windows.find((item) => item.kind === expected.kind)
    || windows.find((item) => Number(item.windowDurationMins) === expected.duration)
    || null;
}

function createLimitCard(windowData, expected) {
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector('.limit-card');
  const remaining = clamp(windowData.remainingPercent ?? (100 - windowData.usedPercent), 0, 100);
  const used = clamp(windowData.usedPercent ?? (100 - remaining), 0, 100);

  fragment.querySelector('.limit-kicker').textContent = expected.kicker;
  fragment.querySelector('.limit-title').textContent = expected.label;
  fragment.querySelector('.window-badge').textContent = expected.duration === 300 ? '5H' : '7D';
  fragment.querySelector('.remaining-value').textContent = Math.round(remaining);
  fragment.querySelector('.used-value').textContent = `${Math.round(used)}%`;
  fragment.querySelector('.reset-value').textContent = formatResetTime(windowData.resetsAt);

  const track = fragment.querySelector('.progress-track');
  const fill = fragment.querySelector('.progress-fill');
  track.setAttribute('aria-valuenow', String(Math.round(remaining)));
  track.setAttribute('aria-label', `${expected.label} 残り${Math.round(remaining)}%`);
  requestAnimationFrame(() => { fill.style.width = `${remaining}%`; });

  if (remaining <= 20) card.dataset.level = 'low';
  return fragment;
}

function createUnavailableCard(expected) {
  const fragment = template.content.cloneNode(true);
  fragment.querySelector('.limit-kicker').textContent = expected.kicker;
  fragment.querySelector('.limit-title').textContent = expected.label;
  fragment.querySelector('.window-badge').textContent = 'N/A';
  fragment.querySelector('.remaining-value').textContent = '--';
  fragment.querySelector('.remaining-unit').textContent = 'not returned';
  fragment.querySelector('.used-value').textContent = '--';
  fragment.querySelector('.reset-value').textContent = '取得なし';
  fragment.querySelector('.progress-track').setAttribute('aria-valuenow', '0');
  return fragment;
}

function render(data) {
  limitGrid.replaceChildren();

  for (const expected of EXPECTED_WINDOWS) {
    const item = findWindow(data, expected);
    limitGrid.appendChild(item ? createLimitCard(item, expected) : createUnavailableCard(expected));
  }

  const available = EXPECTED_WINDOWS.filter((item) => findWindow(data, item)).length;
  if (data.source === 'sample') {
    statusText.textContent = 'サンプルデータ — PCで更新スクリプトを実行してください';
  } else {
    statusText.textContent = available
      ? `${available}件の利用枠を取得しました`
      : 'Codexから利用枠が返されませんでした';
  }

  updatedAt.textContent = formatUpdatedTime(data.updatedAt);
  if (data.planType) {
    planBadge.textContent = String(data.planType).toUpperCase();
    planBadge.hidden = false;
  } else {
    planBadge.hidden = true;
  }

  connectionState.textContent = data.source === 'sample' ? '● demo' : '● ready';
}

function renderError(error) {
  console.error(error);
  statusText.textContent = 'usage.jsonを読み込めませんでした';
  updatedAt.textContent = '更新失敗';
  connectionState.textContent = '● error';
  limitGrid.innerHTML = `
    <div class="empty-state">
      <strong>データがまだありません</strong><br />
      <span>PCで tools/update-codex-usage.ps1 を実行して usage.json を更新してください。</span>
    </div>`;
}

async function loadUsage() {
  refreshButton.disabled = true;
  refreshButton.classList.add('is-loading');
  connectionState.textContent = '● loading';

  try {
    const response = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
  } catch (error) {
    renderError(error);
  } finally {
    refreshButton.disabled = false;
    refreshButton.classList.remove('is-loading');
  }
}

refreshButton.addEventListener('click', loadUsage);
loadUsage();
setInterval(loadUsage, AUTO_REFRESH_MS);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((error) => console.warn('SW registration failed', error));
  });
}
