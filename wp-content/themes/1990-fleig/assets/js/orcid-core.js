/*
 * Núcleo compartilhado pelas páginas Publicações e Atividades (e pela página inicial).
 *
 * - fetch com timeout
 * - cache em localStorage com validade e reaproveitamento do último resultado se a consulta falhar
 * - leitura dos dados do ORCID (/activities e lote de trabalhos)
 * - links (DOI > uri > url), datas em português e pequenos utilitários de DOM
 *
 * Exposto como window.OrcidCore. Nada aqui depende do WordPress: o site final é estático.
 * Para ignorar todo o cache numa visita, acrescente ?recarregar à URL da página.
 */
(function (window, document) {
    'use strict';

    var ORCID_API  = 'https://pub.orcid.org/v3.0/';
    var TIMEOUT_MS = 10000;
    var DAY_MS     = 24 * 60 * 60 * 1000;

    var forceReload = /[?&]recarregar(?:[=&]|$)/.test(window.location.search);


    /* =========================================
       REQUISIÇÕES
       ========================================= */

    function withTimeout(promise, ms, onTimeout) {
        var timer;
        var timeout = new Promise(function (resolve, reject) {
            timer = setTimeout(function () {
                if (onTimeout) {
                    onTimeout();
                }
                var err = new Error('timeout');
                err.timeout = true;
                reject(err);
            }, ms || TIMEOUT_MS);
        });

        return Promise.race([promise, timeout]).then(
            function (value) { clearTimeout(timer); return value; },
            function (err) { clearTimeout(timer); throw err; }
        );
    }

    // Rejeita com err.status quando a resposta não é 2xx (ex.: 403/429 do GitHub).
    function fetchJson(url, options) {
        options = options || {};
        var controller = typeof AbortController === 'function' ? new AbortController() : null;

        var request = fetch(url, {
            headers: options.headers || { 'Accept': 'application/json' },
            credentials: 'omit',
            signal: controller ? controller.signal : undefined
        }).then(function (response) {
            if (!response.ok) {
                var err = new Error('HTTP ' + response.status);
                err.status = response.status;
                throw err;
            }
            return response.json();
        });

        return withTimeout(request, options.timeout || TIMEOUT_MS, function () {
            if (controller) {
                controller.abort();
            }
        });
    }


    /* =========================================
       CACHE (localStorage)
       ========================================= */

    function cacheRead(key) {
        try {
            var raw = window.localStorage.getItem(key);
            if (!raw) {
                return null;
            }
            var entry = JSON.parse(raw);
            return entry && typeof entry.time === 'number' ? entry : null;
        } catch (e) {
            return null;
        }
    }

    function cacheWrite(key, data, extra) {
        try {
            var entry = { time: Date.now(), data: data };
            if (extra) {
                Object.keys(extra).forEach(function (k) { entry[k] = extra[k]; });
            }
            window.localStorage.setItem(key, JSON.stringify(entry));
        } catch (e) { /* localStorage indisponível ou cheio: segue sem cache */ }
    }

    /*
     * Busca com cache:
     * - cache dentro da validade (e aceito por options.accept) => devolve sem consultar a API;
     * - vencido => consulta (com timeout de 10 s) e grava o resultado;
     * - consulta falhou => devolve o último resultado salvo, mesmo vencido.
     *
     * options: key, maxAgeHours, fetch(): Promise, accept(entry): bool, extra: {}, timeout
     */
    function cached(options) {
        var entry = cacheRead(options.key);
        var accepted = entry && (!options.accept || options.accept(entry));

        if (accepted && !forceReload && Date.now() - entry.time < options.maxAgeHours * 60 * 60 * 1000) {
            return Promise.resolve(entry.data);
        }

        return withTimeout(Promise.resolve().then(options.fetch), options.timeout || TIMEOUT_MS)
            .then(function (data) {
                cacheWrite(options.key, data, options.extra);
                return data;
            }, function (err) {
                if (entry) {
                    return entry.data;
                }
                throw err;
            });
    }


    /* =========================================
       ORCID
       ========================================= */

    function parseWorkSummary(s) {
        var title = s.title || {};
        var date  = s['publication-date'] || {};
        return {
            putCode:  s['put-code'],
            title:    val(title.title),
            subtitle: val(title.subtitle),
            type:     str(s.type),
            year:     toInt(val(date.year)),
            month:    toInt(val(date.month)),
            journal:  val(s['journal-title']),
            doi:      externalId(s, 'doi'),
            uri:      externalId(s, 'uri'),
            url:      val(s.url),
            created:  createdDate(s)
        };
    }

    // Em cada grupo, o primeiro "work-summary" representa o trabalho.
    function parseWorks(section) {
        var groups = section && Array.isArray(section.group) ? section.group : [];
        var works = [];
        groups.forEach(function (group) {
            var s = group && Array.isArray(group['work-summary']) ? group['work-summary'][0] : null;
            if (s) {
                works.push(parseWorkSummary(s));
            }
        });
        return works;
    }

    // kind: 'distinction' | 'invited-position' | 'employment'
    function parseAffiliations(section, kind) {
        var groups = section && Array.isArray(section['affiliation-group']) ? section['affiliation-group'] : [];
        var items = [];
        groups.forEach(function (group) {
            var first = group && Array.isArray(group.summaries) ? group.summaries[0] : null;
            var s = first && first[kind + '-summary'];
            if (!s) {
                return;
            }
            items.push({
                kind:       kind,
                putCode:    s['put-code'],
                role:       str(s['role-title']),
                department: str(s['department-name']),
                org:        str(s.organization && s.organization.name),
                doi:        externalId(s, 'doi'),
                uri:        externalId(s, 'uri'),
                url:        val(s.url),
                created:    createdDate(s)
            });
        });
        return items;
    }

    function parseFundings(section) {
        var groups = section && Array.isArray(section.group) ? section.group : [];
        var items = [];
        groups.forEach(function (group) {
            var s = group && Array.isArray(group['funding-summary']) ? group['funding-summary'][0] : null;
            if (!s) {
                return;
            }
            items.push({
                putCode: s['put-code'],
                title:   val(s.title && s.title.title),
                type:    str(s.type),
                org:     str(s.organization && s.organization.name),
                doi:     externalId(s, 'doi'),
                uri:     externalId(s, 'uri'),
                url:     val(s.url),
                created: createdDate(s)
            });
        });
        return items;
    }

    function parseActivities(data) {
        data = data || {};
        return {
            works:            parseWorks(data.works),
            distinctions:     parseAffiliations(data.distinctions, 'distinction'),
            invitedPositions: parseAffiliations(data['invited-positions'], 'invited-position'),
            employments:      parseAffiliations(data.employments, 'employment'),
            fundings:         parseFundings(data.fundings)
        };
    }

    // GET /activities com cache (o mesmo cache é usado pela página inicial, Atividades e Publicações).
    function loadActivities(orcid, options) {
        return cached({
            key: options.cacheKey,
            maxAgeHours: options.maxAgeHours,
            fetch: function () {
                return fetchJson(ORCID_API + orcid + '/activities').then(parseActivities);
            }
        });
    }

    /*
     * Contribuidores via endpoint em lote (até 100 put-codes por chamada, em paralelo).
     * Resolve com { putCode: [{ name, orcid }] }; rejeita só se todas as chamadas falharem.
     */
    function fetchContributors(orcid, putCodes) {
        return Promise.all(chunk(putCodes, 100).map(function (codes) {
            return fetchJson(ORCID_API + orcid + '/works/' + codes.join(','))
                .catch(function () { return null; });
        })).then(function (pages) {
            var byCode = {};
            var anyOk = false;

            pages.forEach(function (page) {
                if (!page || !Array.isArray(page.bulk)) {
                    return;
                }
                anyOk = true;
                page.bulk.forEach(function (item) {
                    var work = item && item.work;
                    if (!work) {
                        return; // itens com "error" no lote são ignorados
                    }
                    var contributors = (work.contributors && work.contributors.contributor) || [];
                    byCode[work['put-code']] = contributors.map(function (c) {
                        return {
                            name:  val(c && c['credit-name']),
                            orcid: str(c && c['contributor-orcid'] && c['contributor-orcid'].path)
                        };
                    }).filter(function (c) { return c.name; });
                });
            });

            if (!anyOk) {
                throw new Error('lote indisponível');
            }
            return byCode;
        });
    }

    function createdDate(summary) {
        var created = summary && summary['created-date'];
        return created && typeof created.value === 'number' ? created.value : 0;
    }

    // Prefere o identificador do próprio item (relationship "self").
    function externalId(summary, type) {
        var ids = (summary['external-ids'] && summary['external-ids']['external-id']) || [];
        var matches = ids.filter(function (e) { return e && e['external-id-type'] === type; });
        var chosen = matches.filter(function (e) { return e['external-id-relationship'] === 'self'; })[0] || matches[0];
        if (!chosen) {
            return '';
        }
        if (type === 'doi') {
            return val(chosen['external-id-normalized']) || str(chosen['external-id-value']);
        }
        return str(chosen['external-id-value']) || val(chosen['external-id-url']);
    }


    /* =========================================
       LINKS
       ========================================= */

    // DOI (https://doi.org/...) > identificador uri > campo url > sem link.
    function workLink(item) {
        var doi = str(item.doi).replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:\s*)/i, '');
        if (/^10\./.test(doi)) {
            return 'https://doi.org/' + encodeURI(doi);
        }
        return safeHttpUrl(item.uri) || safeHttpUrl(item.url);
    }

    // Só aceita http(s). Com base, aceita também caminhos relativos ao site.
    function safeHttpUrl(value, base) {
        if (!value || typeof value !== 'string') {
            return '';
        }
        try {
            var u = base ? new URL(value, base) : new URL(value);
            return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '';
        } catch (e) {
            return '';
        }
    }


    /* =========================================
       DATAS (pt-BR)
       ========================================= */

    var rtf = window.Intl && Intl.RelativeTimeFormat
        ? new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' })
        : null;
    var fullFormat  = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
    var monthFormat = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });

    // Aceita timestamp (ms), "AAAA-MM-DD" (meia-noite local) ou data ISO completa. Devolve ms ou 0.
    function parseDate(value) {
        if (typeof value === 'number') {
            return isFinite(value) ? value : 0;
        }
        if (typeof value !== 'string' || !value) {
            return 0;
        }
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
        var ms = m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : Date.parse(value);
        return isNaN(ms) ? 0 : ms;
    }

    function startOfDay(ms) {
        var d = new Date(ms);
        return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    }

    function daysAgo(ms) {
        return Math.max(0, Math.round((startOfDay(Date.now()) - startOfDay(ms)) / DAY_MS));
    }

    // "hoje", "ontem", "há 3 dias", "há 2 semanas", "há 4 meses", "há 2 anos"
    function relativeDate(ms) {
        if (!rtf) {
            return fullDate(ms);
        }
        var days = daysAgo(ms);
        if (days < 7) {
            return rtf.format(days === 0 ? 0 : -days, 'day');
        }
        if (days < 30) {
            return rtf.format(-Math.floor(days / 7), 'week');
        }
        if (days < 365) {
            return rtf.format(-Math.max(1, Math.floor(days / 30)), 'month');
        }
        return rtf.format(-Math.floor(days / 365), 'year');
    }

    function fullDate(ms) {
        return fullFormat.format(new Date(ms));
    }

    // "Outubro de 2026"
    function monthYear(ms) {
        var text = monthFormat.format(new Date(ms));
        return text.charAt(0).toUpperCase() + text.slice(1);
    }

    function isoDate(ms) {
        var d = new Date(ms);
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    function pad(n) {
        return n < 10 ? '0' + n : String(n);
    }

    // Selo "Novo": a partir da data de corte e com menos de `days` dias.
    function isNew(ms, days, since) {
        return !!ms && ms >= (since || 0) && (Date.now() - ms) < days * DAY_MS;
    }


    /* =========================================
       DOM
       ========================================= */

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) {
            node.className = className;
        }
        if (text) {
            node.textContent = text;
        }
        return node;
    }

    function clear(node) {
        while (node.firstChild) {
            node.removeChild(node.firstChild);
        }
    }

    // Link externo: nova aba, rel="noopener".
    function externalLink(href, text, className) {
        var a = el('a', className, text);
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener';
        return a;
    }

    // <time datetime="..." title="29 de outubro de 2026">há 3 dias</time>
    function timeElement(ms) {
        var t = el('time', null, relativeDate(ms));
        t.setAttribute('datetime', isoDate(ms));
        t.title = fullDate(ms);
        return t;
    }

    /*
     * Barra de filtros (mesmo visual nas páginas Publicações e Atividades).
     * filters: [{ key, label, test(item) }]; o primeiro é "Todos".
     */
    function renderFilterBar(container, filters, items, onSelect) {
        clear(container);
        filters.forEach(function (filter, i) {
            var count = items.filter(filter.test).length;
            var button = el('button', 'pub-filter', filter.label + ' ');
            button.type = 'button';
            button.setAttribute('data-filter', filter.key);
            button.appendChild(el('span', 'pub-filter-count', '(' + count + ')'));
            if (count === 0 && i > 0) {
                button.disabled = true;
            }
            button.addEventListener('click', function () { onSelect(filter.key); });
            container.appendChild(button);
        });
        container.hidden = false;
    }

    function markActiveFilter(container, key) {
        Array.prototype.forEach.call(container.querySelectorAll('.pub-filter'), function (button) {
            button.setAttribute('aria-pressed', button.getAttribute('data-filter') === key ? 'true' : 'false');
        });
    }

    // Esconde itens que não passam no filtro e os grupos (ano/mês) que ficaram vazios.
    function filterList(root, itemSelector, groupSelector, isVisible) {
        Array.prototype.forEach.call(root.querySelectorAll(itemSelector), function (item) {
            item.hidden = !isVisible(item);
        });
        Array.prototype.forEach.call(root.querySelectorAll(groupSelector), function (group) {
            group.hidden = !group.querySelector(itemSelector + ':not([hidden])');
        });
    }


    /* =========================================
       UTILITÁRIOS
       ========================================= */

    // Campos do ORCID no formato { "value": "..." }
    function val(field) {
        return field && typeof field.value === 'string' ? field.value.trim() : '';
    }

    function str(value) {
        return typeof value === 'string' ? value.trim() : '';
    }

    function toInt(value) {
        var n = parseInt(value, 10);
        return isNaN(n) ? 0 : n;
    }

    function chunk(list, size) {
        var out = [];
        for (var i = 0; i < list.length; i += size) {
            out.push(list.slice(i, i + size));
        }
        return out;
    }

    function isValidOrcid(id) {
        return /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(id || '');
    }


    window.OrcidCore = {
        forceReload:       forceReload,
        fetchJson:         fetchJson,
        withTimeout:       withTimeout,
        cached:            cached,
        cacheRead:         cacheRead,
        cacheWrite:        cacheWrite,
        loadActivities:    loadActivities,
        fetchContributors: fetchContributors,
        workLink:          workLink,
        safeHttpUrl:       safeHttpUrl,
        parseDate:         parseDate,
        relativeDate:      relativeDate,
        fullDate:          fullDate,
        monthYear:         monthYear,
        isNew:             isNew,
        el:                el,
        clear:             clear,
        externalLink:      externalLink,
        timeElement:       timeElement,
        renderFilterBar:   renderFilterBar,
        markActiveFilter:  markActiveFilter,
        filterList:        filterList,
        str:               str,
        chunk:             chunk,
        isValidOrcid:      isValidOrcid
    };
})(window, document);
