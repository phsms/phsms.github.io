/*
 * Seção "Atividades": página inicial (data-modo="destaque") e página de histórico (data-modo="arquivo").
 *
 * Fontes públicas consultadas no navegador (o site final é estático, sem PHP):
 * ORCID, OpenAlex (citações recebidas), GitHub e o arquivo assets/data/atividades-manuais.json.
 *
 * Este arquivo também é carregado na página Publicações, só para fornecer a configuração abaixo
 * (window.AtividadesConfig); lá ele sai logo depois, porque não existe a seção #atividades.
 *
 * Parâmetros de URL úteis para testes:
 *   ?recarregar            ignora o cache e consulta todas as fontes de novo
 *   ?desde=2025-01-01      simula outra data de corte (atividadesDesde) nesta visita
 */
(function (window, document) {
    'use strict';

    /* =========================================
       CONFIGURAÇÃO
       ========================================= */

    var CONFIG = {
        orcid: '0000-0002-3713-5190',

        githubContas: [
            { conta: 'phsms',            nome: 'Paulo Serrano' },
            { conta: 'CodexUFPB',        nome: 'CodexLab' },
            { conta: 'interfaceslivres', nome: 'Interfaces Livres' }
        ],

        fontes: {
            orcid:    true,
            openalex: true,
            github:   true,
            manual:   true
        },

        // Itens do ORCID (created-date), repositórios do GitHub (criação) e trabalhos que citam
        // (publicação) anteriores a esta data são ignorados. Não vale para o arquivo manual.
        atividadesDesde: '2026-10-30',

        // Itens mais recentes que isso ganham o selo "Novo" (nada é descartado por idade).
        diasSeloNovo: 60,

        // Quantos itens aparecem na página inicial.
        maxItens: 5,

        validadeCacheHoras: { orcid: 24, openalex: 72, github: 72, manual: 24 },

        // Opcional: e-mail enviado ao OpenAlex como parâmetro mailto (só se preenchido).
        openalexMailto: '',

        // Mude para "v2" para invalidar todo o cache salvo nos navegadores dos visitantes.
        cacheVersao: 'v1'
    };

    var desdeParam = /[?&]desde=(\d{4}-\d{2}-\d{2})(?:&|$)/.exec(window.location.search);
    if (desdeParam) {
        CONFIG.atividadesDesde = desdeParam[1];
    }

    CONFIG.cacheKey = function (fonte) {
        return 'atividades:' + CONFIG.cacheVersao + ':' + fonte;
    };

    window.AtividadesConfig = CONFIG;

    // Caminho do JSON manual relativo a este script: funciona no WordPress e na exportação estática.
    var scriptSrc = document.currentScript && document.currentScript.src;
    var MANUAL_URL = scriptSrc ? new URL('../data/atividades-manuais.json', scriptSrc).href : '';


    /* =========================================
       INÍCIO
       ========================================= */

    var Core    = window.OrcidCore;
    var section = document.getElementById('atividades');
    if (!section || !Core) {
        return;
    }

    var MODO      = section.getAttribute('data-modo') === 'arquivo' ? 'arquivo' : 'destaque';
    var listEl    = document.getElementById('atividades-lista');
    var statusEl  = document.getElementById('atividades-status');
    var filtersEl = document.getElementById('atividades-filtros');
    var DESDE     = Core.parseDate(CONFIG.atividadesDesde);

    var OPENALEX_API = 'https://api.openalex.org/';
    var GITHUB_API   = 'https://api.github.com/';

    // Tipos visuais: classe CSS activity-item--{tipo}, símbolo e nome do filtro.
    var TIPOS = [
        { tipo: 'publicacao',    simbolo: '✎',   filtro: 'Publicações' },
        { tipo: 'dados',         simbolo: '▦',   filtro: 'Dados e software' },
        { tipo: 'citacao',       simbolo: '❝',   filtro: 'Citações' },
        { tipo: 'premio',        simbolo: '★',   filtro: 'Prêmios' },
        { tipo: 'vinculo',       simbolo: '⚑',   filtro: 'Vínculos' },
        { tipo: 'financiamento', simbolo: '$',   filtro: 'Financiamentos' },
        { tipo: 'github',        simbolo: '</>', filtro: 'GitHub' },
        { tipo: 'manual',        simbolo: '✦',   filtro: 'Outras' }
    ];

    var state = { items: [], filter: 'all' };

    // Sem JavaScript a seção continua escondida; com ele, mostra a mensagem de carregamento.
    section.hidden = false;

    if (!listEl || !Core.isValidOrcid(CONFIG.orcid) || typeof window.fetch !== 'function' || !Promise.allSettled) {
        finish([]);
        return;
    }

    var FONTES = [
        { nome: 'orcid',    carregar: itensOrcid },
        { nome: 'openalex', carregar: itensOpenAlex },
        { nome: 'github',   carregar: itensGithub },
        { nome: 'manual',   carregar: itensManuais }
    ].filter(function (f) { return CONFIG.fontes[f.nome]; });

    // Cada fonte tem seu timeout (10 s, dentro de Core.cached); uma falha não impede as outras.
    Promise.allSettled(FONTES.map(function (f) {
        return Promise.resolve().then(f.carregar);
    })).then(function (results) {
        var items = [];
        results.forEach(function (r) {
            if (r.status === 'fulfilled' && Array.isArray(r.value)) {
                items = items.concat(r.value);
            }
        });
        finish(items);
    }).catch(function () {
        finish([]);
    });


    /* =========================================
       FONTE: ORCID
       ========================================= */

    function itensOrcid() {
        return Core.loadActivities(CONFIG.orcid, {
            cacheKey: CONFIG.cacheKey('orcid'),
            maxAgeHours: CONFIG.validadeCacheHoras.orcid
        }).then(function (data) {
            data = data || {};
            var items = [];

            (data.works || []).forEach(function (w) {
                var dados = w.type === 'data-set' || w.type === 'software';
                items.push(item({
                    id:     'orcid:work:' + w.putCode,
                    tipo:   dados ? 'dados' : 'publicacao',
                    rotulo: w.type === 'data-set' ? 'Novo conjunto de dados'
                          : w.type === 'software' ? 'Novo software'
                          : 'Nova publicação',
                    titulo: w.title + (w.subtitle ? ': ' + w.subtitle : ''),
                    origem: w.journal,
                    link:   Core.workLink(w),
                    data:   w.created
                }));
            });

            (data.distinctions || []).forEach(function (a) {
                items.push(afiliacao(a, 'premio', 'Prêmio'));
            });
            (data.invitedPositions || []).forEach(function (a) {
                items.push(afiliacao(a, 'vinculo', 'Pesquisador convidado'));
            });
            (data.employments || []).forEach(function (a) {
                items.push(afiliacao(a, 'vinculo', 'Novo vínculo'));
            });

            (data.fundings || []).forEach(function (f) {
                items.push(item({
                    id:     'orcid:funding:' + f.putCode,
                    tipo:   'financiamento',
                    rotulo: 'Projeto com financiamento',
                    titulo: f.title,
                    origem: f.org,
                    link:   Core.workLink(f),
                    data:   f.created
                }));
            });

            return items.filter(depoisDoCorte);
        });
    }

    function afiliacao(a, tipo, rotulo) {
        var origem = [a.department, a.org].filter(Boolean).join(' · ');
        return item({
            id:     'orcid:' + a.kind + ':' + a.putCode,
            tipo:   tipo,
            rotulo: rotulo,
            titulo: a.role || a.org,
            origem: a.role ? origem : a.department,
            link:   Core.workLink(a),
            data:   a.created
        });
    }


    /* =========================================
       FONTE: OPENALEX (citações recebidas)
       ========================================= */

    function itensOpenAlex() {
        var desde = CONFIG.atividadesDesde;

        return Core.cached({
            key: CONFIG.cacheKey('openalex'),
            maxAgeHours: CONFIG.validadeCacheHoras.openalex,
            // A consulta depende da data de corte: se ela mudar, o cache não serve.
            accept: function (entry) { return entry.desde === desde; },
            extra: { desde: desde },
            fetch: function () { return buscarCitacoes(desde); }
        }).then(agruparCitacoes);
    }

    function buscarCitacoes(desde) {
        var mailto = CONFIG.openalexMailto ? '&mailto=' + encodeURIComponent(CONFIG.openalexMailto) : '';

        return Core.fetchJson(OPENALEX_API + 'works?filter=author.orcid:' + CONFIG.orcid +
            '&per-page=200&select=id,title,doi' + mailto
        ).then(function (mine) {
            var meus = {};
            var ids = [];
            ((mine && mine.results) || []).forEach(function (w) {
                var id = openalexId(w.id);
                if (id) {
                    meus[id] = limparTitulo(w.title);
                    ids.push(id);
                }
            });
            if (!ids.length) {
                return [];
            }

            // No máximo 100 ids por filtro "cites"; os lotes vão em paralelo.
            return Promise.all(Core.chunk(ids, 100).map(function (lote) {
                return Core.fetchJson(OPENALEX_API + 'works?filter=cites:' + lote.join('|') +
                    ',from_publication_date:' + desde +
                    '&sort=publication_date:desc&per-page=50' +
                    '&select=id,title,doi,publication_date,authorships,primary_location,referenced_works' + mailto);
            })).then(function (pages) {
                var vistos = {};
                var registros = [];

                pages.forEach(function (page) {
                    ((page && page.results) || []).forEach(function (w) {
                        var id = openalexId(w.id);
                        if (!id || vistos[id] || autocitacao(w)) {
                            return;
                        }
                        vistos[id] = true;

                        var fonte = w.primary_location && w.primary_location.source;
                        var link  = Core.safeHttpUrl(w.doi) || 'https://openalex.org/' + id;

                        (w.referenced_works || []).forEach(function (ref) {
                            var meuId = openalexId(ref);
                            if (meuId && meus.hasOwnProperty(meuId)) {
                                registros.push({
                                    meuId:     meuId,
                                    meuTitulo: meus[meuId],
                                    id:        id,
                                    titulo:    limparTitulo(w.title),
                                    origem:    Core.str(fonte && fonte.display_name),
                                    link:      link,
                                    data:      Core.parseDate(w.publication_date)
                                });
                            }
                        });
                    });
                });

                return registros;
            });
        });
    }

    // Trabalhos que citam e têm meu ORCID entre os autores não contam.
    function autocitacao(w) {
        return (w.authorships || []).some(function (a) {
            var orcid = a && a.author && a.author.orcid;
            return typeof orcid === 'string' && orcid.slice(-19) === CONFIG.orcid;
        });
    }

    // Citações do mesmo trabalho meu na mesma semana viram um item só.
    function agruparCitacoes(registros) {
        var grupos = {};
        var ordem = [];

        (registros || []).forEach(function (r) {
            if (!r || !r.data || r.data < DESDE) {
                return;
            }
            var chave = r.meuId + ':' + inicioDaSemana(r.data);
            if (!grupos[chave]) {
                grupos[chave] = [];
                ordem.push(chave);
            }
            grupos[chave].push(r);
        });

        return ordem.map(function (chave) {
            var lista = grupos[chave].sort(function (a, b) { return b.data - a.data; });
            var r = lista[0];
            var titulo = r.meuTitulo || 'Um trabalho meu';

            if (lista.length === 1) {
                return item({
                    id:     'openalex:' + chave,
                    tipo:   'citacao',
                    rotulo: 'Citação recebida',
                    titulo: titulo + ' foi citado em ' + (r.titulo || 'um novo trabalho'),
                    origem: r.origem || 'OpenAlex',
                    link:   r.link,
                    data:   r.data
                });
            }
            return item({
                id:     'openalex:' + chave,
                tipo:   'citacao',
                rotulo: 'Citação recebida',
                titulo: titulo + ' foi citado em ' + lista.length + ' trabalhos',
                origem: 'OpenAlex',
                link:   'https://openalex.org/works?filter=cites:' + r.meuId,
                data:   r.data
            });
        });
    }

    function openalexId(value) {
        var m = /(W\d+)$/.exec(Core.str(value));
        return m ? m[1] : '';
    }

    // Títulos do OpenAlex às vezes trazem marcação (<i>, <sub>...): removemos as tags do texto.
    function limparTitulo(title) {
        return Core.str(title).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    }

    // Segunda-feira da semana da data (chave de agrupamento).
    function inicioDaSemana(ms) {
        var d = new Date(ms);
        var diff = (d.getDay() + 6) % 7;
        return new Date(d.getFullYear(), d.getMonth(), d.getDate() - diff).getTime();
    }


    /* =========================================
       FONTE: GITHUB
       ========================================= */

    function itensGithub() {
        var contas = CONFIG.githubContas.map(function (c) { return c.conta; });

        return Core.cached({
            key: CONFIG.cacheKey('github'),
            maxAgeHours: CONFIG.validadeCacheHoras.github,
            accept: function (entry) { return entry.contas === contas.join(','); },
            extra: { contas: contas.join(',') },
            fetch: function () { return buscarRepositorios(contas); }
        }).then(function (repos) {
            return (repos || []).map(function (r) {
                return item({
                    id:        'github:' + r.conta + '/' + r.nome,
                    tipo:      'github',
                    rotulo:    'Nova ferramenta no GitHub',
                    titulo:    r.nome,
                    descricao: r.descricao,
                    origem:    nomeDaConta(r.conta),
                    link:      Core.safeHttpUrl(r.link),
                    data:      r.data
                });
            }).filter(depoisDoCorte);
        });
    }

    // As contas são consultadas em paralelo. Limite de requisições (403/429) => pula a fonte
    // (Core.cached devolve então o último resultado salvo, se houver).
    function buscarRepositorios(contas) {
        return Promise.allSettled(contas.map(function (conta) {
            return Core.fetchJson(GITHUB_API + 'users/' + encodeURIComponent(conta) + '/repos?sort=created&per_page=20', {
                headers: { 'Accept': 'application/vnd.github+json' }
            }).then(function (repos) {
                return (Array.isArray(repos) ? repos : []).filter(function (r) {
                    // Ignora forks, arquivados e os repositórios de site (phsms.github.io, etc.).
                    return r && !r.fork && !r.archived && !/\.github\.io$/i.test(r.name || '');
                }).map(function (r) {
                    return {
                        conta:     conta,
                        nome:      Core.str(r.name),
                        descricao: Core.str(r.description),
                        link:      Core.str(r.html_url),
                        data:      Core.parseDate(r.created_at)
                    };
                });
            });
        })).then(function (results) {
            var limitado = results.some(function (r) {
                return r.status === 'rejected' && r.reason && (r.reason.status === 403 || r.reason.status === 429);
            });
            var ok = results.filter(function (r) { return r.status === 'fulfilled'; });
            if (limitado || !ok.length) {
                throw new Error('GitHub indisponível');
            }
            return ok.reduce(function (all, r) { return all.concat(r.value); }, []);
        });
    }

    function nomeDaConta(conta) {
        var c = CONFIG.githubContas.filter(function (x) { return x.conta === conta; })[0];
        return c ? c.nome : conta;
    }


    /* =========================================
       FONTE: ARQUIVO MANUAL
       ========================================= */

    // assets/data/atividades-manuais.json — o corte atividadesDesde não se aplica aqui.
    function itensManuais() {
        if (!MANUAL_URL) {
            return [];
        }
        return Core.cached({
            key: CONFIG.cacheKey('manual'),
            maxAgeHours: CONFIG.validadeCacheHoras.manual,
            fetch: function () {
                return Core.fetchJson(MANUAL_URL).then(function (d) { return Array.isArray(d) ? d : []; });
            }
        }).then(function (lista) {
            return (lista || []).map(function (m, i) {
                if (!m || typeof m !== 'object') {
                    return null;
                }
                return item({
                    id:     'manual:' + i,
                    tipo:   'manual',
                    rotulo: Core.str(m.rotulo) || 'Atividade',
                    titulo: Core.str(m.titulo),
                    origem: Core.str(m.origem),
                    link:   Core.safeHttpUrl(m.link, window.location.href),
                    data:   Core.parseDate(m.data)
                });
            });
        });
    }


    /* =========================================
       RENDERIZAÇÃO
       ========================================= */

    function item(fields) {
        return {
            id:        fields.id,
            tipo:      fields.tipo,
            rotulo:    fields.rotulo,
            titulo:    Core.str(fields.titulo),
            descricao: Core.str(fields.descricao),
            origem:    Core.str(fields.origem),
            link:      fields.link || '',
            data:      fields.data || 0
        };
    }

    function depoisDoCorte(it) {
        return it.data >= DESDE;
    }

    function finish(items) {
        items = items.filter(function (it) { return it && it.data && it.titulo; });
        items.sort(function (a, b) { return b.data - a.data; });
        state.items = items;

        if (!items.length) {
            if (MODO === 'arquivo' && statusEl) {
                // Na página de histórico, avisa em vez de deixar a página vazia.
                statusEl.textContent = 'Nenhuma atividade registrada desde ' + Core.fullDate(DESDE) + '.';
                statusEl.className = 'orcid-status orcid-status--error';
            } else {
                section.hidden = true;
            }
            return;
        }

        if (statusEl) {
            statusEl.hidden = true;
        }
        Core.clear(listEl);

        if (MODO === 'arquivo') {
            renderArquivo(items);
        } else {
            listEl.appendChild(renderLista(items.slice(0, CONFIG.maxItens)));
        }
    }

    function renderLista(items) {
        var ol = Core.el('ol', 'activity-list');
        items.forEach(function (it) {
            ol.appendChild(renderItem(it));
        });
        return ol;
    }

    // Histórico: todos os itens, agrupados por mês ("Outubro de 2026"), com filtros por tipo.
    function renderArquivo(items) {
        var mesAtual = null;
        var grupo = null;
        var porMes = [];

        items.forEach(function (it) {
            var mes = Core.monthYear(it.data);
            if (mes !== mesAtual) {
                mesAtual = mes;
                grupo = { mes: mes, itens: [] };
                porMes.push(grupo);
            }
            grupo.itens.push(it);
        });

        porMes.forEach(function (g) {
            var sec = Core.el('section', 'activity-month');
            sec.appendChild(Core.el('h2', 'pub-year-heading', g.mes));
            sec.appendChild(renderLista(g.itens));
            listEl.appendChild(sec);
        });

        if (filtersEl) {
            var filtros = [{ key: 'all', label: 'Todos', test: function () { return true; } }]
                .concat(TIPOS.map(function (t) {
                    return { key: t.tipo, label: t.filtro, test: function (it) { return it.tipo === t.tipo; } };
                }));
            Core.renderFilterBar(filtersEl, filtros, items, aplicarFiltro);
        }
        aplicarFiltro('all');
    }

    function aplicarFiltro(key) {
        state.filter = key;
        Core.filterList(listEl, '.activity-item', '.activity-month', function (li) {
            return key === 'all' || li.getAttribute('data-tipo') === key;
        });
        if (filtersEl) {
            Core.markActiveFilter(filtersEl, key);
        }
    }

    function renderItem(it) {
        var info = TIPOS.filter(function (t) { return t.tipo === it.tipo; })[0] || TIPOS[TIPOS.length - 1];

        var li = Core.el('li', 'activity-item activity-item--' + info.tipo);
        li.setAttribute('data-tipo', info.tipo);

        var icon = Core.el('span', 'activity-icon', info.simbolo);
        icon.setAttribute('aria-hidden', 'true');
        li.appendChild(icon);

        var body = Core.el('div', 'activity-body');

        var label = Core.el('div', 'activity-label');
        label.appendChild(Core.el('span', 'activity-rotulo', it.rotulo));
        if (Core.isNew(it.data, CONFIG.diasSeloNovo)) {
            label.appendChild(Core.el('span', 'selo-novo', 'Novo'));
        }
        body.appendChild(label);

        var title = Core.el('p', 'activity-title');
        if (it.link) {
            title.appendChild(Core.externalLink(it.link, it.titulo));
        } else {
            title.textContent = it.titulo;
        }
        body.appendChild(title);

        if (it.descricao) {
            body.appendChild(Core.el('p', 'activity-desc', it.descricao));
        }

        var meta = Core.el('div', 'activity-meta');
        if (it.origem) {
            meta.appendChild(Core.el('span', 'activity-origin', it.origem));
        }
        meta.appendChild(Core.timeElement(it.data));
        body.appendChild(meta);

        li.appendChild(body);
        return li;
    }
})(window, document);
