/*
 * Página Publicações montada a partir do ORCID.
 *
 * O site final é estático (GitHub Pages): nada aqui depende do WordPress.
 * Usa assets/js/orcid-core.js (busca, cache em localStorage, links, datas) e a configuração
 * window.AtividadesConfig definida em assets/js/atividades.js (data de corte, selo "Novo",
 * validade do cache). O cache do ORCID é o mesmo da seção Atividades.
 * Todo o HTML é criado com createElement/textContent (nunca innerHTML com dados da API).
 */
(function () {
    'use strict';

    var list = document.getElementById('orcid-publications');
    if (!list) {
        return;
    }

    var Core      = window.OrcidCore;
    var CONFIG    = window.AtividadesConfig || {};
    var statusEl  = document.getElementById('orcid-status');
    var filtersEl = document.getElementById('orcid-filters');

    var orcid   = (list.getAttribute('data-orcid') || CONFIG.orcid || '').trim();
    var PROFILE = 'https://orcid.org/' + orcid;

    var TYPE_LABELS = {
        'journal-article':  'Artigo em periódico',
        'conference-paper': 'Trabalho em evento',
        'book-chapter':     'Capítulo de livro',
        'book':             'Livro',
        'data-set':         'Conjunto de dados',
        'software':         'Software'
    };

    var FILTERS = [
        { key: 'all',      label: 'Todos',              types: null },
        { key: 'articles', label: 'Artigos',            types: ['journal-article'] },
        { key: 'events',   label: 'Eventos',            types: ['conference-paper'] },
        { key: 'books',    label: 'Capítulos e livros', types: ['book-chapter', 'book'] },
        { key: 'data',     label: 'Dados e software',   types: ['data-set', 'software'] }
    ].map(function (f) {
        f.test = function (w) { return f.types === null || f.types.indexOf(w.type) !== -1; };
        return f;
    });

    // Grafias do meu nome que recebem destaque (comparação exata, sem acentos/maiúsculas).
    var MY_NAMES = [
        'Paulo Henrique Serrano',
        'Paulo Henrique Souto Maior Serrano',
        'Serrano, Paulo Henrique'
    ].map(normalizeName);

    var state = {
        works: [],
        authors: {},
        metaByPutCode: {}
    };

    if (!Core || !Core.isValidOrcid(orcid) || typeof window.fetch !== 'function') {
        showError();
        return;
    }

    var cacheHoras = (CONFIG.validadeCacheHoras && CONFIG.validadeCacheHoras.orcid) || 24;
    var diasNovo   = CONFIG.diasSeloNovo || 60;
    var desde      = Core.parseDate(CONFIG.atividadesDesde);

    function cacheKey(fonte) {
        return CONFIG.cacheKey ? CONFIG.cacheKey(fonte) : 'atividades:v1:' + fonte;
    }

    // Remove o cache da versão anterior desta página (ficava em sessionStorage).
    try {
        window.sessionStorage.removeItem('orcid-publications:v1:' + orcid);
    } catch (e) { /* sem acesso ao sessionStorage */ }

    Core.loadActivities(orcid, { cacheKey: cacheKey('orcid'), maxAgeHours: cacheHoras })
        .then(function (data) {
            var works = (data && Array.isArray(data.works)) ? data.works.slice() : [];
            if (!works.length) {
                showError();
                return;
            }
            sortWorks(works);
            state.works = works;
            render();
            loadAuthors();
        })
        .catch(showError);


    /* =========================================
       AUTORES (segunda etapa, endpoint em lote)
       ========================================= */

    // Se falhar e não houver cache, a lista simplesmente fica sem autores.
    function loadAuthors() {
        var codes = state.works
            .map(function (w) { return w.putCode; })
            .filter(Boolean);

        Core.cached({
            key: cacheKey('orcid-autores'),
            maxAgeHours: cacheHoras,
            // O cache só serve se cobrir todos os trabalhos atuais.
            accept: function (entry) {
                return !!entry.data && codes.every(function (c) { return entry.data.hasOwnProperty(c); });
            },
            fetch: function () { return Core.fetchContributors(orcid, codes); }
        }).then(function (byCode) {
            state.authors = byCode || {};
            state.works.forEach(renderAuthors);
        }).catch(function () { /* silencioso: a lista continua sem autores */ });
    }


    /* =========================================
       RENDERIZAÇÃO
       ========================================= */

    function sortWorks(works) {
        works.sort(function (a, b) {
            return (b.year - a.year) ||
                (b.month - a.month) ||
                a.title.localeCompare(b.title, 'pt');
        });
    }

    function render() {
        Core.clear(list);
        state.metaByPutCode = {};

        var currentYear = null;
        var currentItems = null;

        state.works.forEach(function (w) {
            var yearKey = w.year ? String(w.year) : '';
            if (currentItems === null || yearKey !== currentYear) {
                currentYear = yearKey;
                var group = Core.el('section', 'pub-year-group');
                group.appendChild(Core.el('h2', 'pub-year-heading', yearKey || 'Sem data'));
                currentItems = Core.el('div', 'pub-year-items');
                group.appendChild(currentItems);
                list.appendChild(group);
            }
            currentItems.appendChild(createItem(w));
        });

        if (filtersEl) {
            Core.renderFilterBar(filtersEl, FILTERS, state.works, applyFilter);
        }
        applyFilter('all');

        if (statusEl) {
            statusEl.hidden = true;
        }
    }

    function createItem(w) {
        var item = Core.el('article', 'pub-item');
        item.setAttribute('data-type', w.type);

        item.appendChild(Core.el('div', 'pub-year-badge', w.year ? String(w.year) : '----'));

        var info  = Core.el('div', 'pub-info');
        var title = Core.el('h3', 'pub-title');
        var fullTitle = (w.title || 'Sem título') + (w.subtitle ? ': ' + w.subtitle : '');
        var href = Core.workLink(w);

        if (href) {
            title.appendChild(Core.externalLink(href, fullTitle));
        } else {
            title.textContent = fullTitle;
        }
        info.appendChild(title);

        var meta = Core.el('div', 'pub-meta');
        if (w.journal) {
            meta.appendChild(Core.el('span', 'journal-name', w.journal));
        }
        meta.appendChild(Core.el('span', 'pub-type', TYPE_LABELS[w.type] || 'Outro'));
        // Selo "Novo": created-date a partir do corte e dentro de diasSeloNovo.
        if (Core.isNew(w.created, diasNovo, desde)) {
            meta.appendChild(Core.el('span', 'selo-novo', 'Novo'));
        }
        info.appendChild(meta);

        item.appendChild(info);

        state.metaByPutCode[w.putCode] = meta;
        renderAuthors(w);

        return item;
    }

    function renderAuthors(w) {
        var meta = state.metaByPutCode[w.putCode];
        var contributors = state.authors[w.putCode];
        if (!meta || !contributors || !contributors.length || meta.querySelector('.pub-authors')) {
            return;
        }

        // Mesma pessoa pode aparecer com mais de um papel.
        var seen = {};
        var authors = contributors.filter(function (c) {
            var key = normalizeName(c.name);
            if (seen[key]) {
                return false;
            }
            seen[key] = true;
            return true;
        });

        var span = Core.el('span', 'pub-authors');
        authors.forEach(function (author, i) {
            if (i > 0) {
                span.appendChild(document.createTextNode(', '));
            }
            var me = author.orcid === orcid || MY_NAMES.indexOf(normalizeName(author.name)) !== -1;
            span.appendChild(me
                ? Core.el('strong', null, author.name)
                : document.createTextNode(author.name));
        });
        meta.insertBefore(span, meta.firstChild);
    }

    function applyFilter(key) {
        var filter = FILTERS.filter(function (f) { return f.key === key; })[0] || FILTERS[0];

        Core.filterList(list, '.pub-item', '.pub-year-group', function (item) {
            return filter.test({ type: item.getAttribute('data-type') });
        });

        if (filtersEl) {
            Core.markActiveFilter(filtersEl, filter.key);
        }
    }

    // Aviso discreto no lugar do "carregando" (sem erro no console).
    function showError() {
        if (state.works.length || !statusEl) {
            return;
        }
        while (statusEl.firstChild) {
            statusEl.removeChild(statusEl.firstChild);
        }
        statusEl.className = 'orcid-status orcid-status--error';
        statusEl.appendChild(document.createTextNode('Não foi possível carregar a lista de publicações agora. Veja todas no '));
        var a = document.createElement('a');
        a.textContent = 'meu perfil no ORCID';
        a.href = PROFILE;
        a.target = '_blank';
        a.rel = 'noopener';
        statusEl.appendChild(a);
        statusEl.appendChild(document.createTextNode('.'));
        statusEl.hidden = false;
    }

    function normalizeName(name) {
        return String(name)
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .replace(/\s*,\s*/g, ', ')
            .replace(/[.\s]+/g, ' ')
            .trim();
    }
})();
