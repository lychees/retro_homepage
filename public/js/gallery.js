/**
 * 星间画廊
 * 拉取 /api/gallery 展示投稿作品
 */
(function () {
    'use strict';

    var grid = null;
    var moreBtn = null;
    var empty = null;
    var modal = null;
    var page = 1;
    var limit = 20;
    var total = 0;
    var filterType = 'all';
    var allItems = [];
    var loadedIds = {};

    function $(id) { return document.getElementById(id); }

    window.initGallery = function () {
        grid = $('gallery-grid');
        moreBtn = $('gallery-load-more');
        empty = $('gallery-empty');
        modal = $('gallery-modal');
        page = 1;
        allItems = [];
        loadedIds = {};
        if (grid) grid.innerHTML = '';
        bindFilters();
        bindModal();
        if (moreBtn) {
            moreBtn._bound = true;
            moreBtn.addEventListener('click', function () {
                page++;
                loadPage(page);
            });
        }
        loadPage(1);
    };

    function bindFilters() {
        var buttons = document.querySelectorAll('.gallery-filter [data-filter]');
        buttons.forEach(function (btn) {
            if (btn._bound) return;
            btn._bound = true;
            btn.addEventListener('click', function () {
                buttons.forEach(function (b) { b.classList.remove('active'); });
                btn.classList.add('active');
                filterType = btn.getAttribute('data-filter');
                page = 1;
                allItems = [];
                loadedIds = {};
                if (grid) grid.innerHTML = '';
                loadPage(1);
            });
        });
    }

    function loadPage(p) {
        if (!grid) return;
        fetch('/api/gallery?page=' + p + '&limit=' + limit)
            .then(function (res) { return res.json(); })
            .then(function (data) {
                total = data.total || 0;
                var items = data.items || [];
                if (p === 1 && items.length === 0) {
                    if (empty) empty.style.display = 'block';
                    if (moreBtn && moreBtn.parentElement) moreBtn.parentElement.style.display = 'none';
                    return;
                }
                if (empty) empty.style.display = 'none';
                items.forEach(function (item) {
                    if (loadedIds[item.id]) return;
                    loadedIds[item.id] = true;
                    allItems.push(item);
                });
                renderItems();
                if (moreBtn && moreBtn.parentElement) {
                    moreBtn.parentElement.style.display = (allItems.length < total) ? 'block' : 'none';
                }
            })
            .catch(function (err) {
                console.error('[gallery] load failed', err);
                if (grid && p === 1) grid.innerHTML = '<div class="gallery-empty">画廊暂时无法访问，请稍后再试。</div>';
            });
    }

    function renderItems() {
        var filtered = filterType === 'all' ? allItems : allItems.filter(function (i) { return i.type === filterType; });
        grid.innerHTML = '';
        if (filtered.length === 0) {
            if (empty) empty.style.display = 'block';
            return;
        }
        if (empty) empty.style.display = 'none';
        filtered.forEach(function (item) {
            var el = document.createElement('div');
            el.className = 'gallery-item';
            el.innerHTML =
                '<img class="gallery-thumb" src="' + escapeHtml(item.thumbnail || '') + '" alt="' + escapeHtml(item.title) + '" loading="lazy">' +
                '<div class="gallery-meta">' +
                    '<strong>' + escapeHtml(item.title) + '</strong>' +
                    '<span>' + escapeHtml(item.author || '匿名') + ' · ' + formatTime(item.timestamp) + '</span>' +
                '</div>';
            el.addEventListener('click', function () { openModal(item.id); });
            grid.appendChild(el);
        });
    }

    function openModal(id) {
        var item = allItems.find(function (i) { return i.id === id; });
        if (!item) return;
        $('gallery-modal-img').src = item.thumbnail || '';
        $('gallery-modal-title').textContent = item.title;
        $('gallery-modal-author').textContent = item.author || '匿名';
        $('gallery-modal-time').textContent = formatTime(item.timestamp);
        if (modal) modal.style.display = 'flex';
    }

    function closeModal() {
        if (modal) modal.style.display = 'none';
    }

    function bindModal() {
        var close = $('gallery-modal-close');
        var backdrop = $('gallery-modal-backdrop');
        if (close && !close._bound) {
            close._bound = true;
            close.addEventListener('click', closeModal);
        }
        if (backdrop && !backdrop._bound) {
            backdrop._bound = true;
            backdrop.addEventListener('click', closeModal);
        }
        if (modal && !modal._boundKey) {
            modal._boundKey = true;
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') closeModal();
            });
        }
    }

    function formatTime(ts) {
        if (!ts) return '-';
        var d = new Date(ts);
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
            pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function pad(n) { return n < 10 ? '0' + n : n; }

    function escapeHtml(text) {
        if (text == null) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
})();
