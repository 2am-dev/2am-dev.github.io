/* ── Config ───────────────────────────────────── */
const USERNAME  = '2am-dev';
const API_BASE  = 'https://api.github.com';
const PER_PAGE  = 100;
const CACHE_KEY = 'portfolio_cache';
const CACHE_TTL = 5 * 60 * 1000;

/* ── Language colours ─────────────────────────── */
const LANG_COLORS = {
  JavaScript: '#f7df1e', TypeScript: '#3178c6', Python: '#3572A5',
  HTML: '#e34c26', CSS: '#563d7c', Rust: '#dea584', Go: '#00ADD8',
  C: '#555599', 'C++': '#f34b7d', 'C#': '#178600', Java: '#b07219',
  Shell: '#89e051', Ruby: '#701516', PHP: '#4F5D95', Swift: '#ffac45',
  Kotlin: '#A97BFF', Vue: '#41b883', Svelte: '#ff3e00', default: '#8b949e',
};

/* ── State ────────────────────────────────────── */
let allRepos     = [];
let activeFilter = 'all';
let searchTerm   = '';
let sortBy       = 'updated';

/* ── DOM refs ─────────────────────────────────── */
const grid        = document.getElementById('projectsGrid');
const loader      = document.getElementById('loader');
const emptyState  = document.getElementById('emptyState');
const searchInput = document.getElementById('searchInput');
const sortSelect  = document.getElementById('sortSelect');
const filterBtns  = document.querySelectorAll('.filter-btn');

/* ── Boot ─────────────────────────────────────── */
document.getElementById('year').textContent = new Date().getFullYear();
init();

async function init() {
  showLoader(true);

  // try cache first for instant display
  const cached = loadCache();
  if (cached && cached.length > 0) {
    allRepos = cached;
    showLoader(false);
    renderAll();
  }

  // always fetch fresh data
  await fetchRepos();
}

/* ── GitHub API fetch ─────────────────────────── */
async function fetchRepos() {
  try {
    // first check if the user exists at all
    const userRes = await fetch(`${API_BASE}/users/${USERNAME}`, {
      headers: { Accept: 'application/vnd.github+json' }
    });

    console.log('User API status:', userRes.status);

    if (userRes.status === 404) {
      showError(`GitHub user <strong>${USERNAME}</strong> not found.<br>Make sure the account exists and is public.`);
      return;
    }

    if (userRes.status === 403) {
      const reset = userRes.headers.get('X-RateLimit-Reset');
      const resetTime = reset ? new Date(reset * 1000).toLocaleTimeString() : 'soon';
      showError(`GitHub API rate limit hit.<br>Resets at ${resetTime} — try again then.`);
      return;
    }

    if (!userRes.ok) {
      showError(`GitHub API returned status ${userRes.status}.<br>Try refreshing the page.`);
      return;
    }

    // fetch all pages of repos
    let page    = 1;
    let fetched = [];

    while (true) {
      const url = `${API_BASE}/users/${USERNAME}/repos?per_page=${PER_PAGE}&page=${page}&type=public&sort=updated`;
      console.log('Fetching:', url);

      const res = await fetch(url, {
        headers: { Accept: 'application/vnd.github+json' }
      });

      console.log(`Page ${page} status:`, res.status, '| Remaining:', res.headers.get('X-RateLimit-Remaining'));

      if (!res.ok) {
        throw new Error(`Repos fetch failed: ${res.status}`);
      }

      const data = await res.json();
      console.log(`Page ${page}: got ${data.length} repos`);

      fetched = fetched.concat(data);
      if (data.length < PER_PAGE) break;
      page++;
    }

    console.log('Total repos fetched:', fetched.length);

    // filter out the portfolio repo itself
    allRepos = fetched.filter(r =>
      r.name !== `${USERNAME}.github.io` &&
      r.name.toLowerCase() !== 'portfolio'
    );

    console.log('Repos after filter:', allRepos.length);

    if (allRepos.length === 0) {
      showEmptyAccount();
      return;
    }

    saveCache(allRepos);
    showLoader(false);
    renderAll();
    updateSyncTime();

  } catch (err) {
    console.error('Fetch error:', err);

    // if we already have cached data showing, don't replace with error
    if (allRepos.length > 0) {
      showLoader(false);
      updateSyncTime();
      return;
    }

    showError(`Could not reach GitHub API.<br><small>${err.message}</small><br><br>
      <button onclick="retryFetch()" style="
        margin-top:12px; padding:8px 20px;
        background:var(--accent); border:none;
        border-radius:8px; color:#fff;
        font-family:var(--font); cursor:pointer;
        font-size:12px;">
        retry
      </button>`);
  }
}

/* exposed for the retry button */
window.retryFetch = function () {
  loader.innerHTML = `
    <div class="dots"><span></span><span></span><span></span></div>
    <p>fetching repos...</p>`;
  showLoader(true);
  fetchRepos();
};

/* ── Render ───────────────────────────────────── */
function renderAll() {
  const filtered = applyFilter(allRepos);
  const sorted   = applySort(filtered);

  grid.innerHTML = '';
  emptyState.style.display = 'none';

  if (sorted.length === 0) {
    emptyState.style.display  = 'flex';
    emptyState.style.flexDirection = 'column';
    emptyState.style.alignItems    = 'center';
  } else {
    sorted.forEach((repo, i) => {
      const card = buildCard(repo);
      card.style.animationDelay = `${i * 50}ms`;
      grid.appendChild(card);
    });
  }

  updateStats();
}

function applyFilter(repos) {
  const mainLangs = ['JavaScript', 'TypeScript', 'Python', 'HTML'];
  return repos.filter(r => {
    const matchSearch =
      !searchTerm ||
      r.name.toLowerCase().includes(searchTerm) ||
      (r.description || '').toLowerCase().includes(searchTerm) ||
      (r.topics || []).some(t => t.includes(searchTerm));

    const matchFilter =
      activeFilter === 'all' ||
      (activeFilter === 'other'
        ? !mainLangs.includes(r.language)
        : r.language === activeFilter);

    return matchSearch && matchFilter;
  });
}

function applySort(repos) {
  return [...repos].sort((a, b) => {
    switch (sortBy) {
      case 'stars':   return b.stargazers_count - a.stargazers_count;
      case 'forks':   return b.forks_count - a.forks_count;
      case 'name':    return a.name.localeCompare(b.name);
      case 'created': return new Date(b.created_at) - new Date(a.created_at);
      default:        return new Date(b.updated_at) - new Date(a.updated_at);
    }
  });
}

/* ── Card builder ─────────────────────────────── */
function buildCard(repo) {
  const card      = document.createElement('article');
  card.className  = 'card';
  const langColor = LANG_COLORS[repo.language] || LANG_COLORS.default;
  const updated   = timeAgo(repo.updated_at);
  const topics    = (repo.topics || []).slice(0, 5);

  card.innerHTML = `
    <div class="card-header">
      <div class="card-title">
        <a href="${repo.html_url}" target="_blank" rel="noopener noreferrer">
          ${escHtml(repo.name)}
        </a>
      </div>
      ${repo.fork ? '<span class="card-fork-badge">fork</span>' : ''}
    </div>

    <p class="card-desc ${repo.description ? '' : 'no-desc'}">
      ${escHtml(repo.description || 'no description yet.')}
    </p>

    ${topics.length ? `
    <div class="card-topics">
      ${topics.map(t => `<span class="topic">${escHtml(t)}</span>`).join('')}
    </div>` : ''}

    <div class="card-meta">
      ${repo.language ? `
      <span class="meta-item">
        <span class="lang-dot" style="background:${langColor}"></span>
        ${escHtml(repo.language)}
      </span>` : ''}
      <span class="meta-item">${starIcon()} ${repo.stargazers_count}</span>
      <span class="meta-item">${forkIcon()} ${repo.forks_count}</span>
    </div>

    <div class="card-footer">
      <a href="${repo.html_url}" target="_blank" rel="noopener noreferrer" class="card-link primary">
        view repo
      </a>
      ${repo.homepage ? `
      <a href="${repo.homepage}" target="_blank" rel="noopener noreferrer" class="card-link secondary">
        live demo
      </a>` : ''}
    </div>

    <div class="card-updated">updated ${updated}</div>
  `;

  return card;
}

/* ── Special states ───────────────────────────── */
function showLoader(show) {
  loader.style.display = show ? 'flex' : 'none';
  loader.style.flexDirection = 'column';
  loader.style.alignItems    = 'center';
}

function showError(msg) {
  showLoader(true);
  loader.innerHTML = `
    <div style="text-align:center; color:var(--muted); max-width:360px; line-height:1.8;">
      <div style="font-size:32px; margin-bottom:12px;">⚠</div>
      ${msg}
    </div>`;
}

function showEmptyAccount() {
  showLoader(false);
  emptyState.style.display       = 'flex';
  emptyState.style.flexDirection = 'column';
  emptyState.style.alignItems    = 'center';
  document.querySelector('.empty-state span').textContent = '👀';
  document.querySelector('.empty-state p').textContent =
    'no public repos yet — push something and refresh!';
}

/* ── Stats ────────────────────────────────────── */
function updateStats() {
  const visible = applyFilter(allRepos);
  const stars   = allRepos.reduce((s, r) => s + r.stargazers_count, 0);
  const forks   = allRepos.reduce((s, r) => s + r.forks_count, 0);
  animateCount('repoCount', visible.length);
  animateCount('starCount', stars);
  animateCount('forkCount', forks);
}

function animateCount(id, target) {
  const el     = document.getElementById(id);
  const start  = parseInt(el.textContent) || 0;
  const dur    = 600;
  const startT = performance.now();
  function step(now) {
    const p = Math.min((now - startT) / dur, 1);
    el.textContent = Math.round(start + (target - start) * easeOut(p));
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

function updateSyncTime() {
  document.getElementById('lastSync').textContent =
    new Date().toLocaleTimeString();
}

/* ── Cache ────────────────────────────────────── */
function saveCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
  } catch (_) {}
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) return null;
    return data;
  } catch (_) { return null; }
}

/* ── Events ───────────────────────────────────── */
searchInput.addEventListener('input', e => {
  searchTerm = e.target.value.toLowerCase().trim();
  renderAll();
});

sortSelect.addEventListener('change', e => {
  sortBy = e.target.value;
  renderAll();
});

filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    renderAll();
  });
});

/* ── Helpers ──────────────────────────────────── */
function timeAgo(iso) {
  const diff = Date.now() - new Date(iso);
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function starIcon() {
  return `<svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><path d="M12 .587l3.668 7.568L24 9.423l-6 5.843 1.416 8.254L12 19.005l-7.416 4.515L6 15.266 0 9.423l8.332-1.268z"/></svg>`;
}

function forkIcon() {
  return `<svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><path d="M6 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM4 4a4 4 0 1 1 5 3.874V10.5A2.5 2.5 0 0 0 11.5 13h1a4.5 4.5 0 0 1 4.46 4A4 4 0 1 1 15 20.874V17.5a2.5 2.5 0 0 0-2.5-2.5h-1A4.5 4.5 0 0 1 7 10.5V7.874A4.002 4.002 0 0 1 4 4zm14 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM6 20a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>`;
}
