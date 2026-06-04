(() => {
  'use strict';

  const DEFAULT_CATEGORY = 'General';
  const els = {
    saveStatus: document.querySelector('#saveStatus'),
    logoutBtn: document.querySelector('#logoutBtn'),
    categoryCount: document.querySelector('#categoryCount'),
    categoryForm: document.querySelector('#categoryForm'),
    newCategoryInput: document.querySelector('#newCategoryInput'),
    categoryList: document.querySelector('#categoryList'),
    categoryTemplate: document.querySelector('#categoryTemplate'),
    tickerTemplate: document.querySelector('#tickerTemplate'),
    searchInput: document.querySelector('#searchInput'),
    categoryFilter: document.querySelector('#categoryFilter'),
    bulkCategorySelect: document.querySelector('#bulkCategorySelect'),
    bulkMoveBtn: document.querySelector('#bulkMoveBtn'),
    bulkTagsInput: document.querySelector('#bulkTagsInput'),
    bulkAddTagsBtn: document.querySelector('#bulkAddTagsBtn'),
    bulkClearTagsBtn: document.querySelector('#bulkClearTagsBtn'),
    bulkDeleteBtn: document.querySelector('#bulkDeleteBtn'),
    selectAllBox: document.querySelector('#selectAllBox'),
    tickerSummary: document.querySelector('#tickerSummary'),
    tickerGroups: document.querySelector('#tickerGroups'),
    saveBtn: document.querySelector('#saveBtn'),
    refreshBtn: document.querySelector('#refreshBtn')
  };

  const state = {
    symbols: [],
    categories: [DEFAULT_CATEGORY],
    selected: new Set(),
    search: '',
    categoryFilter: '',
    dirty: false,
    saving: false,
    saveTimer: null,
    draggedSymbol: '',
    draggedCategory: ''
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

  function dedupe(items) {
    const seen = new Set();
    return (Array.isArray(items) ? items : []).reduce((acc, item) => {
      const symbol = canonicalSymbolAlias(item && item.symbol);
      if (!symbol || seen.has(symbol)) return acc;
      seen.add(symbol);
      acc.push({
        symbol,
        name: String(item.name || '').trim().slice(0, 80),
        category: normalizeCategory(item.category),
        tags: normalizeTags(item.tags)
      });
      return acc;
    }, []);
  }

  function allCategories() {
    return normalizeCategories([...state.categories, ...state.symbols.map((item) => item.category)]);
  }

  function visibleSymbols() {
    const q = state.search.trim().toLowerCase();
    return state.symbols.filter((item) => {
      if (state.categoryFilter && item.category !== state.categoryFilter) return false;
      if (!q) return true;
      return [item.symbol, item.name, item.category, ...(item.tags || [])].join(' ').toLowerCase().includes(q);
    });
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

  function setStatus(text, cls = '') {
    els.saveStatus.textContent = text;
    els.saveStatus.className = `status ${cls}`.trim();
  }

  function markDirty({ autosave = true } = {}) {
    state.dirty = true;
    setStatus('Unsaved changes', 'dirty');
    if (!autosave) return;
    if (state.saveTimer) window.clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(() => save(), 700);
  }

  async function save() {
    if (state.saving) return false;
    if (state.saveTimer) window.clearTimeout(state.saveTimer);
    state.saveTimer = null;
    state.saving = true;
    setStatus('Saving…');
    try {
      state.symbols = dedupe(state.symbols);
      state.categories = allCategories();
      const data = await api('/api/watchlist', {
        method: 'PUT',
        body: JSON.stringify({ symbols: state.symbols, categories: state.categories })
      });
      state.symbols = dedupe(data.watchlist.symbols || []);
      state.categories = normalizeCategories(data.watchlist.categories || []);
      state.dirty = false;
      render();
      setStatus('Saved', 'saved');
      return true;
    } catch (error) {
      console.error(error);
      setStatus(`Save failed: ${error.message}`, 'error');
      return false;
    } finally {
      state.saving = false;
    }
  }

  async function refreshFromServer({ confirmDiscard = true } = {}) {
    if (state.saving) return false;
    if (state.dirty && confirmDiscard && !window.confirm('Discard unsaved dashboard edits and reload from server?')) return false;
    if (state.saveTimer) window.clearTimeout(state.saveTimer);
    state.saveTimer = null;
    setStatus('Refreshing…');
    if (els.refreshBtn) els.refreshBtn.disabled = true;
    try {
      const data = await api('/api/watchlist');
      state.symbols = dedupe(data.watchlist.symbols || []);
      state.categories = normalizeCategories(data.watchlist.categories || []);
      state.selected.clear();
      state.dirty = false;
      render();
      setStatus('Refreshed', 'saved');
      window.setTimeout(() => { if (!state.dirty) setStatus('Saved', 'saved'); }, 1200);
      return true;
    } catch (error) {
      console.error(error);
      setStatus(`Refresh failed: ${error.message}`, 'error');
      return false;
    } finally {
      if (els.refreshBtn) els.refreshBtn.disabled = false;
    }
  }

  function refreshSelect(select, { placeholder = '', value = '' } = {}) {
    select.textContent = '';
    if (placeholder) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = placeholder;
      select.appendChild(opt);
    }
    allCategories().forEach((category) => {
      const opt = document.createElement('option');
      opt.value = category;
      opt.textContent = category;
      select.appendChild(opt);
    });
    select.value = value && allCategories().includes(value) ? value : '';
  }

  function renderCategoryList() {
    const cats = allCategories();
    els.categoryCount.textContent = String(cats.length);
    els.categoryList.textContent = '';
    const counts = Object.fromEntries(cats.map((cat) => [cat, 0]));
    state.symbols.forEach((item) => { counts[item.category] = (counts[item.category] || 0) + 1; });

    cats.forEach((category) => {
      const node = els.categoryTemplate.content.firstElementChild.cloneNode(true);
      node.dataset.category = category;
      node.querySelector('.category-name').value = category;
      node.querySelector('.category-size').textContent = counts[category] || 0;
      node.addEventListener('dragstart', (event) => {
        state.draggedCategory = category;
        node.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/category', category);
      });
      node.addEventListener('dragend', () => {
        state.draggedCategory = '';
        node.classList.remove('dragging');
      });
      node.addEventListener('dragover', (event) => {
        event.preventDefault();
        node.classList.add('drop-target');
      });
      node.addEventListener('dragleave', () => node.classList.remove('drop-target'));
      node.addEventListener('drop', (event) => {
        event.preventDefault();
        node.classList.remove('drop-target');
        if (state.draggedSymbol) moveSymbolToCategory(state.draggedSymbol, category);
        else if (state.draggedCategory && state.draggedCategory !== category) moveCategoryBefore(state.draggedCategory, category);
      });
      node.querySelector('.category-name').addEventListener('change', (event) => renameCategory(category, event.target.value));
      node.querySelector('.delete-category').addEventListener('click', () => deleteCategory(category));
      els.categoryList.appendChild(node);
    });
  }

  function renderToolbar() {
    refreshSelect(els.categoryFilter, { placeholder: 'All', value: state.categoryFilter });
    refreshSelect(els.bulkCategorySelect, { placeholder: 'Choose category…' });
    const count = state.selected.size;
    els.bulkMoveBtn.disabled = !count;
    els.bulkAddTagsBtn.disabled = !count;
    els.bulkClearTagsBtn.disabled = !count;
    els.bulkDeleteBtn.disabled = !count;
    const visible = visibleSymbols();
    els.selectAllBox.checked = visible.length > 0 && visible.every((item) => state.selected.has(item.symbol));
    els.selectAllBox.indeterminate = visible.some((item) => state.selected.has(item.symbol)) && !els.selectAllBox.checked;
  }

  function createTickerRow(item) {
    const node = els.tickerTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.symbol = item.symbol;
    node.querySelector('.row-select').checked = state.selected.has(item.symbol);
    node.querySelector('.symbol-field').value = item.symbol;
    node.querySelector('.name-field').value = item.name || '';
    const catSelect = node.querySelector('.category-field');
    refreshSelect(catSelect, { value: item.category });
    node.querySelector('.tags-field').value = (item.tags || []).join(', ');

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
      event.stopPropagation();
      node.classList.add('drop-target');
    });
    node.addEventListener('dragleave', () => node.classList.remove('drop-target'));
    node.addEventListener('drop', (event) => {
      event.preventDefault();
      event.stopPropagation();
      node.classList.remove('drop-target');
      const symbol = event.dataTransfer.getData('text/plain') || state.draggedSymbol;
      if (symbol && symbol !== item.symbol) moveSymbolBefore(symbol, item.symbol);
    });

    node.querySelector('.row-select').addEventListener('change', (event) => {
      if (event.target.checked) state.selected.add(item.symbol);
      else state.selected.delete(item.symbol);
      renderToolbar();
    });
    node.querySelector('.symbol-field').addEventListener('change', (event) => updateSymbol(item.symbol, event.target.value));
    node.querySelector('.name-field').addEventListener('change', (event) => updateItem(item.symbol, { name: event.target.value.trim().slice(0, 80) }));
    catSelect.addEventListener('change', (event) => updateItem(item.symbol, { category: normalizeCategory(event.target.value) }));
    node.querySelector('.tags-field').addEventListener('change', (event) => updateItem(item.symbol, { tags: normalizeTags(event.target.value) }));
    node.querySelector('.delete-ticker').addEventListener('click', () => deleteSymbols([item.symbol]));
    return node;
  }

  function renderTickerGroups() {
    const visible = visibleSymbols();
    const searchActive = Boolean(state.search.trim());
    const categoriesToRender = state.categoryFilter ? [state.categoryFilter] : allCategories();
    els.tickerSummary.textContent = `${visible.length} visible / ${state.symbols.length} total · ${state.selected.size} selected`;
    els.tickerGroups.textContent = '';
    if (!categoriesToRender.length || (!visible.length && searchActive && !state.categoryFilter)) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No matching tickers.';
      els.tickerGroups.appendChild(empty);
      return;
    }
    categoriesToRender.forEach((category) => {
      const items = visible.filter((item) => item.category === category);
      if (!items.length && searchActive) return;
      const block = document.createElement('section');
      block.className = 'group-block';
      block.dataset.category = category;
      block.addEventListener('dragover', (event) => {
        if (!state.draggedSymbol) return;
        event.preventDefault();
        block.classList.add('drop-target');
      });
      block.addEventListener('dragleave', (event) => {
        if (!block.contains(event.relatedTarget)) block.classList.remove('drop-target');
      });
      block.addEventListener('drop', (event) => {
        event.preventDefault();
        block.classList.remove('drop-target');
        const symbol = event.dataTransfer.getData('text/plain') || state.draggedSymbol;
        if (symbol) moveSymbolToCategory(symbol, category);
      });
      const title = document.createElement('div');
      title.className = 'group-title';
      title.dataset.category = category;
      title.innerHTML = '<span class="drag-dot">⇩</span><span></span><small></small>';
      title.querySelector('span:nth-child(2)').textContent = category;
      title.querySelector('small').textContent = `${items.length}`;
      title.addEventListener('dragover', (event) => {
        if (!state.draggedSymbol) return;
        event.preventDefault();
        title.classList.add('drop-target');
      });
      title.addEventListener('dragleave', () => title.classList.remove('drop-target'));
      title.addEventListener('drop', (event) => {
        event.preventDefault();
        title.classList.remove('drop-target');
        if (state.draggedSymbol) moveSymbolToCategory(state.draggedSymbol, category);
      });
      block.appendChild(title);
      const head = document.createElement('div');
      head.className = 'ticker-head';
      head.innerHTML = '<span></span><span></span><span>Symbol</span><span>Name</span><span>Category</span><span>Tags</span><span></span>';
      block.appendChild(head);
      if (items.length) {
        items.forEach((item) => block.appendChild(createTickerRow(item)));
      } else {
        const empty = document.createElement('div');
        empty.className = 'empty-category';
        empty.textContent = 'Empty category — drop tickers here or move selected tickers into this category.';
        block.appendChild(empty);
      }
      els.tickerGroups.appendChild(block);
    });
    if (!els.tickerGroups.children.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No matching tickers.';
      els.tickerGroups.appendChild(empty);
    }
  }

  function render() {
    state.categories = allCategories();
    renderToolbar();
    renderCategoryList();
    renderTickerGroups();
  }

  function updateItem(symbol, patch) {
    const item = state.symbols.find((entry) => entry.symbol === symbol);
    if (!item) return;
    Object.assign(item, patch);
    item.category = normalizeCategory(item.category);
    item.tags = normalizeTags(item.tags);
    state.categories = allCategories();
    markDirty();
    render();
  }

  function updateSymbol(oldSymbol, nextSymbol) {
    const normalized = canonicalSymbolAlias(nextSymbol);
    const item = state.symbols.find((entry) => entry.symbol === oldSymbol);
    if (!item || !normalized) return render();
    if (normalized !== oldSymbol && state.symbols.some((entry) => entry.symbol === normalized)) {
      window.alert(`${normalized} already exists.`);
      return render();
    }
    item.symbol = normalized;
    if (state.selected.delete(oldSymbol)) state.selected.add(normalized);
    markDirty();
    render();
  }

  function createCategory(value) {
    const category = normalizeCategory(value);
    if (!category) return;
    if (!state.categories.includes(category)) {
      state.categories.push(category);
      markDirty();
    }
    els.newCategoryInput.value = '';
    render();
  }

  function renameCategory(oldCategory, nextValue) {
    const source = normalizeCategory(oldCategory);
    const target = normalizeCategory(nextValue);
    if (!target || source === target) return render();
    if (state.categories.includes(target)) {
      window.alert(`${target} already exists.`);
      return render();
    }
    state.categories = state.categories.map((category) => category === source ? target : category);
    state.symbols.forEach((item) => { if (item.category === source) item.category = target; });
    if (state.categoryFilter === source) state.categoryFilter = target;
    markDirty();
    render();
  }

  function deleteCategory(category) {
    const source = normalizeCategory(category);
    const count = state.symbols.filter((item) => item.category === source).length;
    const fallback = state.categories.find((entry) => entry !== source) || DEFAULT_CATEGORY;
    const target = source === DEFAULT_CATEGORY ? fallback : (state.categories.includes(DEFAULT_CATEGORY) ? DEFAULT_CATEGORY : fallback);
    if (count && source === target) {
      window.alert(`Create another category before deleting ${source}.`);
      return;
    }
    const moveText = count ? ` ${count} ticker${count === 1 ? '' : 's'} will move to ${target}.` : '';
    if (!window.confirm(`Delete category ${source}?${moveText}`)) return;
    state.symbols.forEach((item) => { if (item.category === source) item.category = target; });
    state.categories = state.categories.filter((entry) => entry !== source);
    if (count && !state.categories.includes(target)) state.categories.unshift(target);
    if (state.categoryFilter === source) state.categoryFilter = '';
    markDirty();
    render();
  }

  function moveCategoryBefore(from, before) {
    const source = normalizeCategory(from);
    const target = normalizeCategory(before);
    const fromIndex = state.categories.indexOf(source);
    const targetIndex = state.categories.indexOf(target);
    if (fromIndex < 0 || targetIndex < 0 || source === target) return;
    const [item] = state.categories.splice(fromIndex, 1);
    const insertIndex = state.categories.indexOf(target);
    state.categories.splice(insertIndex, 0, item);
    markDirty();
    render();
  }

  function moveSymbolBefore(fromSymbol, beforeSymbol) {
    const fromIndex = state.symbols.findIndex((item) => item.symbol === fromSymbol);
    const beforeIndex = state.symbols.findIndex((item) => item.symbol === beforeSymbol);
    if (fromIndex < 0 || beforeIndex < 0 || fromSymbol === beforeSymbol) return;
    const [item] = state.symbols.splice(fromIndex, 1);
    const insertIndex = state.symbols.findIndex((entry) => entry.symbol === beforeSymbol);
    state.symbols.splice(insertIndex, 0, item);
    item.category = state.symbols.find((entry) => entry.symbol === beforeSymbol)?.category || item.category;
    markDirty();
    render();
  }

  function moveSymbolToCategory(symbol, category) {
    const item = state.symbols.find((entry) => entry.symbol === symbol);
    if (!item) return;
    item.category = normalizeCategory(category);
    const fromIndex = state.symbols.indexOf(item);
    state.symbols.splice(fromIndex, 1);
    let insertIndex = -1;
    state.symbols.forEach((entry, index) => { if (entry.category === item.category) insertIndex = index; });
    state.symbols.splice(insertIndex + 1, 0, item);
    markDirty();
    render();
  }

  function bulkMove() {
    const category = normalizeCategory(els.bulkCategorySelect.value);
    if (!category || !state.selected.size) return;
    state.symbols.forEach((item) => { if (state.selected.has(item.symbol)) item.category = category; });
    markDirty();
    render();
  }

  function bulkAddTags() {
    const tags = normalizeTags(els.bulkTagsInput.value);
    if (!tags.length || !state.selected.size) return;
    state.symbols.forEach((item) => {
      if (state.selected.has(item.symbol)) item.tags = Array.from(new Set([...(item.tags || []), ...tags]));
    });
    els.bulkTagsInput.value = '';
    markDirty();
    render();
  }

  function bulkClearTags() {
    if (!state.selected.size) return;
    if (!window.confirm(`Clear tags from ${state.selected.size} selected ticker${state.selected.size === 1 ? '' : 's'}?`)) return;
    state.symbols.forEach((item) => { if (state.selected.has(item.symbol)) item.tags = []; });
    markDirty();
    render();
  }

  function deleteSymbols(symbols) {
    const list = symbols.filter(Boolean);
    if (!list.length) return;
    if (!window.confirm(`Delete ${list.length} ticker${list.length === 1 ? '' : 's'} from the watchlist?`)) return;
    const doomed = new Set(list);
    state.symbols = state.symbols.filter((item) => !doomed.has(item.symbol));
    list.forEach((symbol) => state.selected.delete(symbol));
    markDirty();
    render();
  }

  async function init() {
    try {
      const me = await api('/api/me');
      setStatus(me.email || 'Loaded');
      await refreshFromServer({ confirmDiscard: false });
    } catch (error) {
      console.error(error);
      setStatus(error.message, 'error');
    }
  }

  els.categoryForm.addEventListener('submit', (event) => {
    event.preventDefault();
    createCategory(els.newCategoryInput.value);
  });
  els.searchInput.addEventListener('input', () => { state.search = els.searchInput.value; render(); });
  els.categoryFilter.addEventListener('change', () => { state.categoryFilter = els.categoryFilter.value; render(); });
  els.selectAllBox.addEventListener('change', () => {
    visibleSymbols().forEach((item) => {
      if (els.selectAllBox.checked) state.selected.add(item.symbol);
      else state.selected.delete(item.symbol);
    });
    render();
  });
  els.bulkMoveBtn.addEventListener('click', bulkMove);
  els.bulkAddTagsBtn.addEventListener('click', bulkAddTags);
  els.bulkClearTagsBtn.addEventListener('click', bulkClearTags);
  els.bulkDeleteBtn.addEventListener('click', () => deleteSymbols([...state.selected]));
  els.saveBtn.addEventListener('click', save);
  if (els.refreshBtn) els.refreshBtn.addEventListener('click', () => refreshFromServer());
  els.logoutBtn.addEventListener('click', () => { window.location.href = '/auth/logout'; });
  window.addEventListener('beforeunload', (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  init();
})();
