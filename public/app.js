(() => {
  'use strict';

  const DEFAULT_CATEGORY = 'General';
  const QUOTE_REFRESH_MS = 15 * 1000;
  const QUOTE_REFRESH_HIDDEN_MS = 60 * 1000;
  const QUOTE_REFRESH_BACKOFF_MS = 30 * 1000;
  const QUOTE_REFRESH_CLOSED_MS = 45 * 1000;
  const QUOTE_FLASH_MS = 900;
  const DEFAULT_SYMBOLS = [
    { symbol: 'NASDAQ:AAPL', category: 'General', tags: ['tech', 'mega-cap'] },
    { symbol: 'NASDAQ:MSFT', category: 'General', tags: ['tech', 'ai'] },
    { symbol: 'NASDAQ:NVDA', category: 'General', tags: ['semis', 'ai'] },
    { symbol: 'NASDAQ:TSLA', category: 'General', tags: ['ev', 'active'] },
    { symbol: 'AMEX:SPY', category: 'General', tags: ['etf', 'market'] },
    { symbol: 'NASDAQ:QQQ', category: 'General', tags: ['etf', 'growth'] },
    { symbol: 'BINANCE:BTCUSDT', category: 'General', tags: ['crypto'] },
    { symbol: 'BINANCE:ETHUSDT', category: 'General', tags: ['crypto'] },
    { symbol: 'FX:EURUSD', category: 'General', tags: ['forex'] },
    { symbol: 'TVC:GOLD', category: 'General', tags: ['macro', 'commodities'] }
  ];

  const els = {
    form: document.querySelector('#symbolForm'),
    symbolInput: document.querySelector('#symbolInput'),
    symbolSuggestions: document.querySelector('#symbolSuggestions'),
    categoryInput: document.querySelector('#categoryInput'),
    categoryOptions: document.querySelector('#categoryOptions'),
    deleteCategorySelect: document.querySelector('#deleteCategorySelect'),
    categoryNameInput: document.querySelector('#categoryNameInput'),
    createCategoryBtn: document.querySelector('#createCategoryBtn'),
    renameCategoryBtn: document.querySelector('#renameCategoryBtn'),
    deleteCategoryBtn: document.querySelector('#deleteCategoryBtn'),
    tagsInput: document.querySelector('#tagsInput'),
    selectedSymbolBadge: document.querySelector('#selectedSymbolBadge'),
    editTagsInput: document.querySelector('#editTagsInput'),
    saveTagsBtn: document.querySelector('#saveTagsBtn'),
    removeSelectedBtn: document.querySelector('#removeSelectedBtn'),
    filterInput: document.querySelector('#filterInput'),
    categoryFilter: document.querySelector('#categoryFilter'),
    watchlist: document.querySelector('#watchlist'),
    emptyState: document.querySelector('#emptyState'),
    template: document.querySelector('#itemTemplate'),
    countPill: document.querySelector('#countPill'),
    selectedLabel: document.querySelector('#selectedLabel'),
    chartTitle: document.querySelector('#chartTitle'),
    widgetStatus: document.querySelector('#widgetStatus'),
    tvOpenLink: document.querySelector('#tvOpenLink'),
    storageStatus: document.querySelector('#storageStatus'),
    exportBtn: document.querySelector('#exportBtn'),
    importFile: document.querySelector('#importFile'),
    resetBtn: document.querySelector('#resetBtn'),
    manageToggleBtn: document.querySelector('#manageToggleBtn'),
    logoutBtn: document.querySelector('#logoutBtn'),
    userEmail: document.querySelector('#userEmail'),
    chart: document.querySelector('#tradingview-chart'),
    timezoneSelect: document.querySelector('#timezoneSelect'),
    splitHandle: document.querySelector('#splitHandle'),
    shell: document.querySelector('.shell')
  };

  const state = {
    symbols: [],
    categories: [DEFAULT_CATEGORY],
    selected: '',
    filter: '',
    categoryFilter: '',
    chartStatusTimer: null,
    saving: false,
    draggedSymbol: '',
    draggedCategory: '',
    sidebarWidth: Number(window.localStorage.getItem('sidebarWidth') || 430),
    collapsedCategories: new Set(),
    quotes: {},
    quoteFlashes: {},
    quoteTimer: null,
    symbolSearchTimer: null,
    symbolSearchAbort: null,
    symbolSuggestions: [],
    managementOpen: window.localStorage.getItem('managementOpen') === '1',
    chartTimezone: window.localStorage.getItem('chartTimezone') || 'Etc/UTC'
  };

  function normalizeSymbol(value) {
    return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  }

  function canonicalSymbolAlias(value) {
    const normalized = normalizeSymbol(value);
    if (normalized === 'HK50' || normalized.endsWith(':HK50')) return 'HSI:HSI';
    const aliases = {
      'HKEX:HSI': 'HSI:HSI',
      'INDEX:HSI': 'HSI:HSI',
      'HKEX:HSTECH': 'HSI:HSTECH',
      'HKEX:HSCEI': 'HSI:HSCEI'
    };
    return aliases[normalized] || normalized;
  }

  function canonicalSymbolName(value) {
    const names = {
      'HSI:HSI': 'Hang Seng Index',
      'HSI:HSTECH': 'Hang Seng TECH Index',
      'HSI:HSCEI': 'Hang Seng China Enterprises Index'
    };
    return names[canonicalSymbolAlias(value)] || '';
  }

  function normalizeCategory(value) {
    const text = String(value || '').trim().replace(/\s+/g, ' ');
    return text || DEFAULT_CATEGORY;
  }

  function normalizeTags(value) {
    if (Array.isArray(value)) return value.map(String).map((tag) => tag.trim()).filter(Boolean).slice(0, 20);
    return String(value || '').split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 20);
  }

  function normalizeCategories(values = []) {
    const seen = new Set();
    const out = [];
    (Array.isArray(values) ? values : []).forEach((value) => {
      const category = normalizeCategory(value);
      if (!seen.has(category)) {
        seen.add(category);
        out.push(category);
      }
    });
    if (!out.length) out.push(DEFAULT_CATEGORY);
    return out.slice(0, 200);
  }

  function ensureCategory(category) {
    const normalized = normalizeCategory(category);
    if (!state.categories.includes(normalized)) state.categories.push(normalized);
    return normalized;
  }

  function pruneCategories() {
    state.categories = normalizeCategories([...state.categories, ...state.symbols.map((item) => item.category)]);
  }

  function dedupe(items) {
    const seen = new Set();
    return (Array.isArray(items) ? items : []).reduce((acc, item) => {
      const symbol = canonicalSymbolAlias(item && item.symbol);
      if (!symbol || seen.has(symbol)) return acc;
      seen.add(symbol);
      acc.push({ symbol, name: String(item.name || '').trim().slice(0, 48), category: normalizeCategory(item.category), tags: normalizeTags(item.tags) });
      return acc;
    }, []);
  }

  function categories() {
    return normalizeCategories([...state.categories, ...state.symbols.map((item) => item.category)]);
  }

  function categoryOrder(items = state.symbols) {
    const itemCats = new Set(items.map((item) => normalizeCategory(item.category)));
    return categories().filter((category) => itemCats.has(category));
  }

  function displayCategory(category) {
    return String(category || '').trim()
      .replace(/[-_]+/g, ' ')
      .replace(/\bai\b/gi, 'AI')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function applyManagementVisibility() {
    const panel = document.querySelector('.add-panel');
    if (!panel) return;
    panel.classList.toggle('collapsed', !state.managementOpen);
    if (els.manageToggleBtn) {
      els.manageToggleBtn.textContent = state.managementOpen ? 'Done' : 'Manage';
      els.manageToggleBtn.setAttribute('aria-expanded', String(state.managementOpen));
    }
  }

  function setManagementOpen(open) {
    state.managementOpen = Boolean(open);
    window.localStorage.setItem('managementOpen', state.managementOpen ? '1' : '0');
    applyManagementVisibility();
    if (state.managementOpen) els.symbolInput?.focus();
  }

  function refreshCategoryControls() {
    const cats = categories();
    const current = state.categoryFilter;
    els.categoryFilter.textContent = '';
    const all = document.createElement('option');
    all.value = '';
    all.textContent = 'All categories';
    els.categoryFilter.appendChild(all);
    cats.forEach((category) => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      els.categoryFilter.appendChild(option);
    });
    els.categoryFilter.value = cats.includes(current) ? current : '';
    state.categoryFilter = els.categoryFilter.value;

    els.categoryOptions.textContent = '';
    cats.forEach((category) => {
      const option = document.createElement('option');
      option.value = category;
      els.categoryOptions.appendChild(option);
    });
    if (els.deleteCategorySelect) {
      const priorDelete = els.deleteCategorySelect.value;
      els.deleteCategorySelect.textContent = '';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Manage category…';
      els.deleteCategorySelect.appendChild(placeholder);
      cats.forEach((category) => {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = category;
        els.deleteCategorySelect.appendChild(option);
      });
      els.deleteCategorySelect.value = cats.includes(priorDelete) ? priorDelete : '';
    }

  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    if (response.status === 401) {
      window.location.href = '/auth/login';
      throw new Error('Not authenticated');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  function setSymbolSuggestions(results = []) {
    state.symbolSuggestions = Array.isArray(results) ? results : [];
    if (!els.symbolSuggestions) return;
    els.symbolSuggestions.textContent = '';
    els.symbolSuggestions.hidden = state.symbolSuggestions.length === 0;
    state.symbolSuggestions.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'symbol-suggestion';
      button.setAttribute('role', 'option');
      button.innerHTML = '<span class="suggestion-symbol"></span><span class="suggestion-meta"></span>';
      button.querySelector('.suggestion-symbol').textContent = item.symbol;
      button.querySelector('.suggestion-meta').textContent = [item.description, item.type, item.currency, item.country].filter(Boolean).join(' · ');
      button.addEventListener('click', () => {
        els.symbolInput.value = item.symbol;
        els.symbolInput.dataset.selectedName = item.description || '';
        setSymbolSuggestions([]);
        els.categoryInput.focus();
      });
      els.symbolSuggestions.appendChild(button);
    });
  }

  async function searchSymbols(query, { immediate = false } = {}) {
    const text = String(query || '').trim();
    if (state.symbolSearchTimer) window.clearTimeout(state.symbolSearchTimer);
    if (state.symbolSearchAbort) state.symbolSearchAbort.abort();
    if (text.length < 2) {
      setSymbolSuggestions([]);
      return [];
    }
    const run = async () => {
      state.symbolSearchAbort = new AbortController();
      try {
        const data = await api(`/api/search-symbols?q=${encodeURIComponent(text)}`, { signal: state.symbolSearchAbort.signal });
        const results = data.results || [];
        setSymbolSuggestions(results);
        return results;
      } catch (error) {
        if (error.name !== 'AbortError') console.warn('Could not search TradingView symbols.', error);
        return [];
      } finally {
        state.symbolSearchAbort = null;
      }
    };
    if (immediate) return run();
    state.symbolSearchTimer = window.setTimeout(run, 220);
    return [];
  }

  function bestSuggestionFor(rawSymbol) {
    const normalized = normalizeSymbol(rawSymbol);
    return state.symbolSuggestions.find((item) => normalizeSymbol(item.symbol) === normalized)
      || state.symbolSuggestions.find((item) => normalizeSymbol(item.shortSymbol) === normalized)
      || state.symbolSuggestions.find((item) => item.primary)
      || state.symbolSuggestions[0] || null;
  }

  async function resolveSymbolInput(rawSymbol) {
    const normalized = canonicalSymbolAlias(rawSymbol);
    if (!normalized) return { symbol: '', name: '' };
    if (normalized.includes(':')) {
      const selected = bestSuggestionFor(normalized);
      return { symbol: normalized, name: els.symbolInput.dataset.selectedName || canonicalSymbolName(normalized) || (selected && selected.description) || '' };
    }
    let selected = bestSuggestionFor(normalized);
    if (!selected) {
      const results = await searchSymbols(normalized, { immediate: true });
      selected = (Array.isArray(results) ? results : [])[0] || null;
    }
    return { symbol: (selected && selected.symbol) || normalized, name: (selected && selected.description) || '' };
  }

  async function loadInitialState() {
    try {
      const [me, data] = await Promise.all([api('/api/me'), api('/api/watchlist')]);
      if (els.userEmail) els.userEmail.textContent = me.email;
      state.symbols = dedupe(data.watchlist?.symbols || []);
      state.categories = normalizeCategories(data.watchlist?.categories || state.symbols.map((item) => item.category));
      state.selected = state.symbols[0]?.symbol || '';
      els.storageStatus.textContent = `${state.symbols.length} synced`;
      els.storageStatus.classList.remove('warning');
    } catch (error) {
      console.warn('Could not load server watchlist.', error);
      state.symbols = [];
      state.selected = '';
      els.storageStatus.textContent = 'Sync failed';
      els.storageStatus.classList.add('warning');
    }
  }

  async function saveSymbols({ alertOnError = true } = {}) {
    if (state.saving) return false;
    state.saving = true;
    pruneCategories();
    els.storageStatus.textContent = 'Syncing…';
    els.storageStatus.classList.remove('warning');
    try {
      const data = await api('/api/watchlist', {
        method: 'PUT',
        body: JSON.stringify({ symbols: state.symbols, categories: state.categories })
      });
      state.symbols = dedupe(data.watchlist?.symbols || state.symbols);
      state.categories = normalizeCategories(data.watchlist?.categories || state.categories);
      els.storageStatus.textContent = `${state.symbols.length} synced`;
      els.storageStatus.classList.remove('warning');
      return true;
    } catch (error) {
      console.warn('Could not save watchlist to server.', error);
      els.storageStatus.textContent = 'Server sync failed';
      els.storageStatus.classList.add('warning');
      if (alertOnError) window.alert(`Save failed: ${error.message}`);
      return false;
    } finally {
      state.saving = false;
    }
  }

  async function loadQuotes({ schedule = true } = {}) {
    if (state.quoteTimer) {
      window.clearTimeout(state.quoteTimer);
      state.quoteTimer = null;
    }
    const symbols = state.symbols.map((item) => item.symbol).filter(Boolean);
    if (!symbols.length) {
      state.quotes = {};
      state.quoteFlashes = {};
      renderList();
      return;
    }
    let failed = false;
    try {
      const params = new URLSearchParams({ symbols: symbols.join(',') });
      const data = await api(`/api/quotes?${params.toString()}`);
      const nextQuotes = data.quotes || {};
      recordQuoteFlashes(state.quotes, nextQuotes);
      state.quotes = nextQuotes;
      renderList();
    } catch (error) {
      failed = true;
      console.warn('Could not load delayed quotes.', error);
    } finally {
      if (schedule) scheduleQuoteRefresh({ failed });
    }
  }

  function visibleSymbols() {
    const filter = state.filter.trim().toLowerCase();
    return state.symbols.filter((item) => {
      if (state.categoryFilter && normalizeCategory(item.category) !== state.categoryFilter) return false;
      if (!filter) return true;
      const haystack = `${item.symbol} ${item.name || ''} ${normalizeCategory(item.category)} ${(item.tags || []).join(' ')}`.toLowerCase();
      return haystack.includes(filter);
    });
  }

  function createCategoryHeader(category, count) {
    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'category-heading';
    header.draggable = true;
    header.dataset.category = category;
    header.title = 'Drag category to reorder';
    header.setAttribute('aria-expanded', String(!state.collapsedCategories.has(category)));
    header.innerHTML = `<span class="category-chevron" aria-hidden="true">${state.collapsedCategories.has(category) ? '›' : '⌄'}</span><span class="category-title"></span><span class="category-count"></span>`;
    header.querySelector('.category-title').textContent = displayCategory(category).toUpperCase();
    header.querySelector('.category-count').textContent = String(count);
    header.addEventListener('click', () => {
      if (state.collapsedCategories.has(category)) state.collapsedCategories.delete(category);
      else state.collapsedCategories.add(category);
      renderList();
    });
    header.addEventListener('dragstart', (event) => {
      state.draggedCategory = category;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('application/x-category', category);
      header.classList.add('dragging');
    });
    header.addEventListener('dragend', () => {
      state.draggedCategory = '';
      header.classList.remove('dragging');
    });
    header.addEventListener('dragover', (event) => {
      if (!state.draggedSymbol && !state.draggedCategory) return;
      if (state.draggedCategory === category) return;
      event.preventDefault();
      header.classList.add('drop-target');
    });
    header.addEventListener('dragleave', () => header.classList.remove('drop-target'));
    header.addEventListener('drop', async (event) => {
      event.preventDefault();
      header.classList.remove('drop-target');
      const draggedCategory = event.dataTransfer.getData('application/x-category') || state.draggedCategory;
      if (draggedCategory && draggedCategory !== category) {
        await moveCategoryBefore(draggedCategory, category);
        return;
      }
      const symbol = event.dataTransfer.getData('text/plain') || state.draggedSymbol;
      if (symbol) await moveToCategory(symbol, category);
    });
    return header;
  }

  function shortSymbol(symbol, _item = null) {
    const text = String(symbol || '');
    return text.includes(':') ? text.split(':').pop() : text;
  }

  function symbolIconText(item) {
    const label = shortSymbol(item.symbol, item).replace(/[^A-Z0-9]/g, '');
    if (label.includes('ETH')) return 'Ξ';
    if (label.includes('SOL')) return 'S';
    if (label.includes('ZEC')) return 'Z';
    if (label.includes('VIX')) return 'US';
    if (label.includes('ES1')) return '500';
    if (label.includes('NQ1')) return '100';
    if (label.includes('NIKKEI')) return '225';
    return label.slice(0, 2) || '•';
  }

  function formatLast(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '—';
    if (Math.abs(num) >= 1000) return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (Math.abs(num) >= 100) return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (Math.abs(num) >= 1) return num.toLocaleString(undefined, { maximumFractionDigits: 3 });
    return num.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }

  function formatChange(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '—';
    const sign = num > 0 ? '+' : '';
    return `${sign}${num.toFixed(2)}%`;
  }

  function quoteFor(symbol) {
    return state.quotes[normalizeSymbol(symbol)] || null;
  }

  function quoteNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function quoteFlashClass(symbol, field) {
    const key = `${normalizeSymbol(symbol)}:${field}`;
    const flash = state.quoteFlashes[key];
    if (!flash) return '';
    if (Date.now() - flash.at > QUOTE_FLASH_MS) {
      delete state.quoteFlashes[key];
      return '';
    }
    return flash.direction === 'down' ? 'flash-down' : 'flash-up';
  }

  function recordQuoteFlashes(previousQuotes, nextQuotes) {
    const now = Date.now();
    const fields = ['last', 'changePercent'];
    Object.entries(nextQuotes || {}).forEach(([symbol, nextQuote]) => {
      const normalized = normalizeSymbol(symbol);
      const previousQuote = previousQuotes && previousQuotes[normalized];
      if (!previousQuote) return;
      fields.forEach((field) => {
        const previous = quoteNumber(previousQuote[field]);
        const next = quoteNumber(nextQuote[field]);
        if (previous === null || next === null || previous === next) return;
        state.quoteFlashes[`${normalized}:${field}`] = { direction: next > previous ? 'up' : 'down', at: now };
      });
    });
    Object.keys(state.quoteFlashes).forEach((key) => {
      if (now - state.quoteFlashes[key].at > QUOTE_FLASH_MS) delete state.quoteFlashes[key];
    });
  }

  function nextQuoteRefreshDelay({ failed = false } = {}) {
    if (document.visibilityState === 'hidden') return QUOTE_REFRESH_HIDDEN_MS;
    if (failed) return QUOTE_REFRESH_BACKOFF_MS;
    const quoteValues = Object.values(state.quotes || {});
    if (quoteValues.length && quoteValues.every((quote) => quote.marketState === 'closed')) return QUOTE_REFRESH_CLOSED_MS;
    return QUOTE_REFRESH_MS;
  }

  function scheduleQuoteRefresh(options = {}) {
    if (state.quoteTimer) window.clearTimeout(state.quoteTimer);
    state.quoteTimer = window.setTimeout(() => loadQuotes(), nextQuoteRefreshDelay(options));
  }

  function marketStatusClass(quote) {
    if (!quote || quote.marketState === 'continuous') return '';
    return quote.marketState === 'open' ? 'open' : 'closed';
  }

  function marketStatusLabel(status) {
    if (status === 'open') return 'Market open';
    if (status === 'closed') return 'Market closed';
    return '';
  }

  function renderWatchRow(item) {
    const node = els.template.content.firstElementChild.cloneNode(true);
    node.dataset.symbol = item.symbol;
    node.classList.toggle('active', item.symbol === state.selected);
    node.setAttribute('aria-selected', String(item.symbol === state.selected));
    const quote = quoteFor(item.symbol);
    const change = quote ? Number(quote.changePercent) : null;
    const status = marketStatusClass(quote);
    node.querySelector('.watch-symbol').textContent = shortSymbol(item.symbol, item);
    node.querySelector('.watch-symbol').title = item.symbol;
    const statusDot = node.querySelector('.market-status-dot');
    statusDot.hidden = !status;
    statusDot.classList.toggle('open', status === 'open');
    statusDot.classList.toggle('closed', status === 'closed');
    statusDot.title = marketStatusLabel(status);
    statusDot.setAttribute('aria-label', marketStatusLabel(status));
    const tagsEl = node.querySelector('.watch-tags');
    const tags = normalizeTags(item.tags);
    tagsEl.textContent = '';
    tagsEl.hidden = tags.length === 0;
    tags.slice(0, 3).forEach((tag) => {
      const pill = document.createElement('span');
      pill.className = 'watch-tag';
      pill.textContent = tag;
      pill.title = tag;
      tagsEl.appendChild(pill);
    });
    if (tags.length > 3) {
      const more = document.createElement('span');
      more.className = 'watch-tag muted';
      more.textContent = `+${tags.length - 3}`;
      more.title = tags.slice(3).join(', ');
      tagsEl.appendChild(more);
    }
    const icon = node.querySelector('.drag-handle');
    icon.textContent = symbolIconText(item);
    icon.title = item.symbol;
    const displayName = String(item.name || '').trim();
    const meta = displayName;
    const metaEl = node.querySelector('.watch-meta');
    metaEl.textContent = meta;
    metaEl.title = meta;
    const lastEl = node.querySelector('.quote-last');
    lastEl.textContent = quote ? formatLast(quote.last) : '—';
    lastEl.classList.toggle('flash-up', quoteFlashClass(item.symbol, 'last') === 'flash-up');
    lastEl.classList.toggle('flash-down', quoteFlashClass(item.symbol, 'last') === 'flash-down');
    const changeEl = node.querySelector('.quote-change');
    changeEl.textContent = quote ? formatChange(change) : '—';
    changeEl.classList.toggle('up', Number.isFinite(change) && change > 0);
    changeEl.classList.toggle('down', Number.isFinite(change) && change < 0);
    changeEl.classList.toggle('flash-up', quoteFlashClass(item.symbol, 'changePercent') === 'flash-up');
    changeEl.classList.toggle('flash-down', quoteFlashClass(item.symbol, 'changePercent') === 'flash-down');
    const extendedEl = node.querySelector('.quote-extended');
    const ext = quote && quote.extended ? (quote.extended.pre || quote.extended.post) : null;
    const extLabel = quote && quote.extended && quote.extended.pre ? 'Pre' : 'Post';
    if (ext && Number.isFinite(Number(ext.last))) {
      const extChange = Number(ext.changePercent);
      extendedEl.textContent = `${extLabel} ${formatLast(ext.last)}${Number.isFinite(extChange) ? ` ${formatChange(extChange)}` : ''}`;
      extendedEl.title = `${extLabel}-market quote`;
      extendedEl.classList.toggle('up', Number.isFinite(extChange) && extChange > 0);
      extendedEl.classList.toggle('down', Number.isFinite(extChange) && extChange < 0);
    } else {
      extendedEl.textContent = '';
      extendedEl.removeAttribute('title');
      extendedEl.classList.remove('up', 'down');
    }
    node.querySelector('.watch-main').addEventListener('click', () => selectSymbol(item.symbol));
    node.querySelector('.remove-btn').addEventListener('click', () => removeSymbol(item.symbol));


    node.addEventListener('dragstart', (event) => {
      state.draggedSymbol = item.symbol;
      node.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', item.symbol);
    });
    node.addEventListener('dragend', () => {
      state.draggedSymbol = '';
      node.classList.remove('dragging');
    });
    node.addEventListener('dragover', (event) => {
      if (!state.draggedSymbol || state.draggedSymbol === item.symbol) return;
      event.preventDefault();
      node.classList.add('drop-target');
    });
    node.addEventListener('dragleave', () => node.classList.remove('drop-target'));
    node.addEventListener('drop', async (event) => {
      event.preventDefault();
      node.classList.remove('drop-target');
      const from = event.dataTransfer.getData('text/plain') || state.draggedSymbol;
      if (from && from !== item.symbol && !state.draggedCategory) await moveBefore(from, item.symbol);
    });

    return node;
  }

  function refreshSelectedEditor() {
    const item = state.symbols.find((entry) => entry.symbol === state.selected);
    if (els.selectedSymbolBadge) els.selectedSymbolBadge.textContent = item ? `Selected: ${shortSymbol(item.symbol, item)}` : 'Select ticker to edit tags';
    if (els.editTagsInput && document.activeElement !== els.editTagsInput) els.editTagsInput.value = item ? (item.tags || []).join(', ') : '';
    if (els.saveTagsBtn) els.saveTagsBtn.disabled = !item;
    if (els.removeSelectedBtn) els.removeSelectedBtn.disabled = !item;
  }

  function scrollSelectedIntoView() {
    if (!state.selected || !els.watchlist) return;
    window.requestAnimationFrame(() => {
      const row = els.watchlist.querySelector(`.watch-item[data-symbol="${CSS.escape(state.selected)}"]`);
      if (!row) return;
      const listRect = els.watchlist.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      if (rowRect.top < listRect.top || rowRect.bottom > listRect.bottom) row.scrollIntoView({ block: 'nearest' });
    });
  }

  function renderList() {
    refreshCategoryControls();
    const items = visibleSymbols();
    els.watchlist.textContent = '';
    els.emptyState.hidden = items.length > 0;
    els.emptyState.textContent = state.symbols.length === 0
      ? 'Your unified watchlist is empty. Add a TradingView symbol to load a chart.'
      : 'No matches. Add a symbol or clear the filter.';
    els.countPill.textContent = `${state.symbols.length} ${state.symbols.length === 1 ? 'symbol' : 'symbols'}`;
    els.selectedLabel.textContent = state.selected || 'No symbol selected';
    refreshSelectedEditor();

    categoryOrder(items).forEach((category) => {
      const groupItems = items.filter((item) => normalizeCategory(item.category) === category);
      if (!groupItems.length) return;
      els.watchlist.appendChild(createCategoryHeader(category, groupItems.length));
      if (state.collapsedCategories.has(category)) return;
      groupItems.forEach((item) => els.watchlist.appendChild(renderWatchRow(item)));
    });
  }

  async function mutateWithRollback(change, { reloadChart = true } = {}) {
    const previous = JSON.stringify(state.symbols);
    const previousCategories = JSON.stringify(state.categories);
    const previousSelected = state.selected;
    change();
    renderList();
    if (reloadChart) loadChart(state.selected);
    if (!(await saveSymbols())) {
      state.symbols = JSON.parse(previous);
      state.categories = JSON.parse(previousCategories);
      state.selected = previousSelected;
      renderList();
      if (reloadChart) loadChart(state.selected);
      return false;
    }
    renderList();
    loadQuotes({ schedule: false });
    return true;
  }

  async function addSymbol(symbol, category, tags, name = '') {
    const normalized = normalizeSymbol(symbol);
    if (!normalized) return;
    await mutateWithRollback(() => {
      const existing = state.symbols.find((item) => item.symbol === normalized);
      if (existing) {
        existing.tags = Array.from(new Set([...existing.tags, ...normalizeTags(tags)]));
        existing.category = ensureCategory(category || existing.category);
        if (name) existing.name = name;
      } else {
        state.symbols.unshift({ symbol: normalized, name: String(name || '').slice(0, 48), category: ensureCategory(category), tags: normalizeTags(tags) });
      }
      state.selected = normalized;
    });
  }

  async function removeSymbol(symbol) {
    const confirmed = window.confirm(`Remove ${symbol} from the unified watchlist?`);
    if (!confirmed) return;
    await mutateWithRollback(() => {
      state.symbols = state.symbols.filter((item) => item.symbol !== symbol);
      pruneCategories();
      if (state.selected === symbol) state.selected = state.symbols[0]?.symbol || '';
    });
  }

  function firstAlternateCategory(category) {
    return categories().find((entry) => entry !== category) || DEFAULT_CATEGORY;
  }

  function repositionAtCategoryEnd(symbol, category) {
    const fromIndex = state.symbols.findIndex((item) => item.symbol === symbol);
    if (fromIndex < 0) return;
    const [item] = state.symbols.splice(fromIndex, 1);
    item.category = ensureCategory(category);
    let insertIndex = -1;
    state.symbols.forEach((entry, index) => {
      if (normalizeCategory(entry.category) === category) insertIndex = index;
    });
    state.symbols.splice(insertIndex + 1, 0, item);
  }

  async function moveCategoryBefore(fromCategory, beforeCategory) {
    const source = normalizeCategory(fromCategory);
    const target = normalizeCategory(beforeCategory);
    if (!source || !target || source === target) return;
    await mutateWithRollback(() => {
      state.categories = categories();
      const fromIndex = state.categories.findIndex((category) => normalizeCategory(category) === source);
      const beforeIndex = state.categories.findIndex((category) => normalizeCategory(category) === target);
      if (fromIndex < 0 || beforeIndex < 0 || fromIndex === beforeIndex) return;
      const [category] = state.categories.splice(fromIndex, 1);
      const insertIndex = state.categories.findIndex((entry) => normalizeCategory(entry) === target);
      state.categories.splice(insertIndex, 0, category);
    }, { reloadChart: false });
  }

  async function moveToCategory(symbol, category) {
    const normalized = normalizeCategory(category);
    await mutateWithRollback(() => {
      repositionAtCategoryEnd(symbol, normalized);
      state.selected = symbol;
      if (state.collapsedCategories.has(normalized)) state.collapsedCategories.delete(normalized);
    }, { reloadChart: false });
  }

  async function createCategory(category) {
    const normalized = normalizeCategory(category || (els.categoryNameInput && els.categoryNameInput.value));
    if (!normalized) return;
    await mutateWithRollback(() => {
      ensureCategory(normalized);
      if (els.categoryInput) els.categoryInput.value = normalized;
      if (els.categoryNameInput) els.categoryNameInput.value = '';
    }, { reloadChart: false });
  }

  async function saveSelectedTags() {
    const symbol = state.selected;
    if (!symbol) return;
    await mutateWithRollback(() => {
      const item = state.symbols.find((entry) => entry.symbol === symbol);
      if (item) item.tags = normalizeTags(els.editTagsInput.value);
    }, { reloadChart: false });
  }

  async function moveCategory(sourceCategory, targetCategory) {
    const source = normalizeCategory(sourceCategory);
    const target = normalizeCategory(targetCategory);
    if (!source || !target || source === target) return;
    const count = state.symbols.filter((item) => normalizeCategory(item.category) === source).length;
    if (!count && !state.categories.includes(source)) return;
    await mutateWithRollback(() => {
      ensureCategory(target);
      state.symbols.forEach((item) => {
        if (normalizeCategory(item.category) === source) item.category = target;
      });
      state.categories = state.categories.filter((category) => normalizeCategory(category) !== source);
      state.categoryFilter = '';
      if (els.deleteCategorySelect) els.deleteCategorySelect.value = '';
      if (els.categoryNameInput) els.categoryNameInput.value = '';
    }, { reloadChart: false });
  }

  async function renameCategory(category, nextName) {
    const source = normalizeCategory(category);
    const target = normalizeCategory(nextName || (els.categoryNameInput && els.categoryNameInput.value));
    if (!source || !target || source === target) return;
    await moveCategory(source, target);
  }

  async function deleteCategory(category) {
    const normalized = normalizeCategory(category);
    if (!normalized) return;
    const count = state.symbols.filter((item) => normalizeCategory(item.category) === normalized).length;
    if (!count && !state.categories.includes(normalized)) return;
    const target = normalized === DEFAULT_CATEGORY ? firstAlternateCategory(normalized) : DEFAULT_CATEGORY;
    if (target === normalized && count) return;
    const confirmed = window.confirm(`Delete category ${normalized}? Its ${count} symbol${count === 1 ? '' : 's'} will move to ${target}.`);
    if (!confirmed) return;
    await mutateWithRollback(() => {
      state.symbols.forEach((item) => {
        if (normalizeCategory(item.category) === normalized) item.category = target;
      });
      state.categories = state.categories.filter((category) => normalizeCategory(category) !== normalized);
      ensureCategory(target);
      state.categoryFilter = '';
      if (els.deleteCategorySelect) els.deleteCategorySelect.value = '';
      if (els.categoryNameInput) els.categoryNameInput.value = '';
    }, { reloadChart: false });
  }

  async function moveBefore(fromSymbol, beforeSymbol) {
    await mutateWithRollback(() => {
      const fromIndex = state.symbols.findIndex((item) => item.symbol === fromSymbol);
      const beforeIndex = state.symbols.findIndex((item) => item.symbol === beforeSymbol);
      if (fromIndex < 0 || beforeIndex < 0 || fromIndex === beforeIndex) return;
      const [item] = state.symbols.splice(fromIndex, 1);
      const insertIndex = state.symbols.findIndex((entry) => entry.symbol === beforeSymbol);
      state.symbols.splice(insertIndex, 0, item);
    }, { reloadChart: false });
  }

  function selectSymbol(symbol) {
    if (state.selected === symbol) return;
    state.selected = symbol;
    renderList();
    scrollSelectedIntoView();
    loadChart(symbol);
  }

  function embeddedChartSymbol(symbol) {
    const aliases = {
      'ES1!': 'OANDA:SPX500USD',
      'CME_MINI:ES1!': 'OANDA:SPX500USD',
      'CME:ES': 'OANDA:SPX500USD',
      'MES1!': 'OANDA:SPX500USD',
      'CME_MINI:MES1!': 'OANDA:SPX500USD',
      'CME:MES': 'OANDA:SPX500USD',
      'NQ1!': 'OANDA:NAS100USD',
      'CME_MINI:NQ1!': 'OANDA:NAS100USD',
      'CME:NQ': 'OANDA:NAS100USD',
      'MNQ1!': 'OANDA:NAS100USD',
      'CME_MINI:MNQ1!': 'OANDA:NAS100USD',
      'CME:MNQ': 'OANDA:NAS100USD'
    };
    return aliases[normalizeSymbol(symbol)] || symbol;
  }

  function directTradingViewSymbol(symbol) {
    const aliases = {
      'ES1!': 'CME_MINI:ES1!',
      'NQ1!': 'CME_MINI:NQ1!',
      'MES1!': 'CME_MINI:MES1!',
      'MNQ1!': 'CME_MINI:MNQ1!'
    };
    return aliases[normalizeSymbol(symbol)] || symbol;
  }

  function tradingViewChartUrl(symbol) {
    return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(directTradingViewSymbol(symbol))}`;
  }

  function updateTradingViewLink(symbol) {
    if (!els.tvOpenLink) return;
    if (!symbol) {
      els.tvOpenLink.hidden = true;
      els.tvOpenLink.href = 'https://www.tradingview.com/chart/';
      return;
    }
    els.tvOpenLink.hidden = false;
    els.tvOpenLink.href = tradingViewChartUrl(symbol);
    els.tvOpenLink.title = `Open ${symbol} directly on TradingView`;
  }

  function loadChart(symbol) {
    if (state.chartStatusTimer) {
      window.clearTimeout(state.chartStatusTimer);
      state.chartStatusTimer = null;
    }

    if (!symbol) {
      updateTradingViewLink('');
      els.chartTitle.textContent = 'No symbol selected';
      els.widgetStatus.hidden = false;
      els.widgetStatus.textContent = 'Add a symbol to load a chart';
      els.selectedLabel.textContent = 'No symbol selected';
      els.chart.textContent = '';
      const fallback = document.createElement('div');
      fallback.className = 'empty-state';
      fallback.textContent = 'Your unified watchlist is empty. Add a TradingView symbol to load a chart.';
      els.chart.appendChild(fallback);
      return;
    }

    const chartSymbol = embeddedChartSymbol(symbol);
    const usingProxy = chartSymbol !== symbol;
    els.chartTitle.textContent = symbol;
    updateTradingViewLink(symbol);
    els.widgetStatus.hidden = true;
    els.widgetStatus.textContent = usingProxy ? `Proxy chart ${chartSymbol}` : 'Updating chart…';
    els.chart.textContent = '';

    if (!window.TradingView || typeof window.TradingView.widget !== 'function') {
      els.widgetStatus.hidden = false;
      els.widgetStatus.textContent = 'TradingView script unavailable';
      const fallback = document.createElement('div');
      fallback.className = 'empty-state';
      fallback.textContent = 'TradingView widget script did not load. Check network access or ad/script blockers.';
      els.chart.appendChild(fallback);
      return;
    }

    const containerId = `tv_${Date.now()}`;
    const container = document.createElement('div');
    container.id = containerId;
    container.style.height = '100%';
    els.chart.appendChild(container);

    new window.TradingView.widget({
      autosize: true,
      symbol: chartSymbol,
      interval: 'D',
      timezone: state.chartTimezone,
      theme: 'dark',
      style: '1',
      locale: 'en',
      enable_publishing: false,
      allow_symbol_change: true,
      hide_side_toolbar: false,
      studies: ['Volume@tv-basicstudies'],
      container_id: containerId
    });

    state.chartStatusTimer = window.setTimeout(() => {
      els.widgetStatus.textContent = usingProxy ? `Proxy chart · Open TV for ${symbol}` : 'Embed loaded · Open TV if blocked';
      state.chartStatusTimer = null;
    }, 650);
  }

  function applySidebarWidth(width) {
    const viewport = window.innerWidth || 1200;
    const min = viewport < 700 ? Math.min(320, viewport - 24) : 300;
    const max = Math.max(min, Math.min(720, viewport - 420));
    const next = Math.round(Math.min(max, Math.max(min, Number(width) || state.sidebarWidth)));
    state.sidebarWidth = next;
    if (els.shell) els.shell.style.setProperty('--sidebar-width', `${next}px`);
    return next;
  }

  function initSplitResize() {
    applySidebarWidth(state.sidebarWidth);
    if (!els.splitHandle || !els.shell) return;
    let active = false;
    const commit = () => window.localStorage.setItem('sidebarWidth', String(state.sidebarWidth));
    const onMove = (event) => {
      if (!active) return;
      event.preventDefault();
      applySidebarWidth((window.innerWidth || 1200) - event.clientX);
    };
    const stop = () => {
      if (!active) return;
      active = false;
      document.body.classList.remove('resizing-split');
      commit();
    };
    els.splitHandle.addEventListener('pointerdown', (event) => {
      if (window.innerWidth <= 980) return;
      active = true;
      els.splitHandle.setPointerCapture(event.pointerId);
      document.body.classList.add('resizing-split');
      onMove(event);
    });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('resize', () => applySidebarWidth(state.sidebarWidth));
    els.splitHandle.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const delta = event.shiftKey ? 60 : 24;
      if (event.key === 'ArrowLeft') applySidebarWidth(state.sidebarWidth + delta);
      if (event.key === 'ArrowRight') applySidebarWidth(state.sidebarWidth - delta);
      if (event.key === 'Home') applySidebarWidth(300);
      if (event.key === 'End') applySidebarWidth(720);
      commit();
    });
  }

  function initTimezoneSelect() {
    if (!els.timezoneSelect) return;
    els.timezoneSelect.value = state.chartTimezone;
    if (els.timezoneSelect.value !== state.chartTimezone) {
      state.chartTimezone = 'Etc/UTC';
      els.timezoneSelect.value = state.chartTimezone;
    }
    els.timezoneSelect.addEventListener('change', () => {
      state.chartTimezone = els.timezoneSelect.value || 'Etc/UTC';
      window.localStorage.setItem('chartTimezone', state.chartTimezone);
      loadChart(state.selected);
    });
  }

  function exportJson() {
    const payload = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), symbols: state.symbols }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `trading-watchlist-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function importJson(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const items = Array.isArray(parsed) ? parsed : parsed.symbols;
      const symbols = dedupe(Array.isArray(items) ? items : []);
      if (!symbols.length) throw new Error('No symbols found in JSON');
      await mutateWithRollback(() => {
        state.symbols = symbols;
        state.selected = symbols[0].symbol;
      });
    } catch (error) {
      window.alert(`Import failed: ${error.message}`);
    } finally {
      els.importFile.value = '';
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadQuotes();
    else scheduleQuoteRefresh();
  });

  els.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const resolved = await resolveSymbolInput(els.symbolInput.value);
    await addSymbol(resolved.symbol, els.categoryInput.value, els.tagsInput.value, resolved.name);
    els.symbolInput.value = '';
    els.symbolInput.dataset.selectedName = '';
    setSymbolSuggestions([]);
    els.tagsInput.value = '';
    els.symbolInput.focus();
  });

  els.symbolInput.addEventListener('input', () => {
    els.symbolInput.dataset.selectedName = '';
    searchSymbols(els.symbolInput.value);
  });
  els.symbolInput.addEventListener('blur', () => window.setTimeout(() => setSymbolSuggestions([]), 180));

  els.filterInput.addEventListener('input', () => {
    state.filter = els.filterInput.value;
    renderList();
  });
  els.categoryFilter.addEventListener('change', () => {
    state.categoryFilter = els.categoryFilter.value;
    renderList();
  });
  if (els.saveTagsBtn) els.saveTagsBtn.addEventListener('click', saveSelectedTags);
  if (els.removeSelectedBtn) els.removeSelectedBtn.addEventListener('click', () => {
    if (state.selected) removeSymbol(state.selected);
  });
  if (els.createCategoryBtn) els.createCategoryBtn.addEventListener('click', () => createCategory(els.categoryNameInput.value));
  if (els.renameCategoryBtn) els.renameCategoryBtn.addEventListener('click', () => renameCategory(els.deleteCategorySelect.value, els.categoryNameInput.value));
  if (els.deleteCategoryBtn) els.deleteCategoryBtn.addEventListener('click', () => deleteCategory(els.deleteCategorySelect.value));
  if (els.manageToggleBtn) els.manageToggleBtn.addEventListener('click', () => setManagementOpen(!state.managementOpen));
  els.exportBtn.addEventListener('click', exportJson);
  els.importFile.addEventListener('change', () => importJson(els.importFile.files[0]));
  els.resetBtn.addEventListener('click', async () => {
    if (!window.confirm('Replace the unified watchlist with the default symbols?')) return;
    await mutateWithRollback(() => {
      state.symbols = DEFAULT_SYMBOLS.slice();
      state.selected = state.symbols[0].symbol;
      state.categoryFilter = '';
      els.categoryInput.value = '';
    });
  });
  if (els.logoutBtn) els.logoutBtn.addEventListener('click', () => { window.location.href = '/auth/logout'; });

  initSplitResize();
  initTimezoneSelect();
  applyManagementVisibility();

  loadInitialState().then(() => {
    renderList();
    scrollSelectedIntoView();
    loadQuotes();
    if (document.readyState === 'complete') loadChart(state.selected);
    else window.addEventListener('load', () => loadChart(state.selected));
  });
})();
