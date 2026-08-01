// ==UserScript==
// @name 小红书工具
// @version 3.2.1
// @description 仅用于学习：小红书搜索、首页、推荐页面笔记数据导出、小红书笔记图片视频导出、小红书搜索快速跳转
// @match https://www.xiaohongshu.com/*
// @run-at document-idle
// @grant GM_download
// @connect xhscdn.com
// @license MIT
// ==/UserScript==

(function (root, factory) {
    'use strict';

    const api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    if (root && root.document) {
        api.start(root);
    }
})(typeof window !== 'undefined' ? window : null, function () {
    'use strict';

    const CONTROL_IDS = [
        'xhs-utils-style',
        'xhs-utils-feed-controls',
        'xhs-utils-search-toolbar',
        'xhs-utils-media-download'
    ];
    const CSV_HEADERS = ['笔记标题', '笔记链接', '作者', '作者链接', '点赞数', '视频'];
    const SEARCH_ENGINES = [
        { name: '百度', url: 'https://www.baidu.com/s?wd=' },
        { name: '知乎', url: 'https://www.zhihu.com/search?type=content&q=' },
        { name: '抖音', url: 'https://www.douyin.com/search/' },
        { name: '公众号', url: 'https://weixin.sogou.com/weixin?type=2&query=' }
    ];

    function getPageType(urlValue) {
        let url;

        try {
            url = new URL(urlValue, 'https://www.xiaohongshu.com');
        } catch (error) {
            return 'other';
        }

        if (!/(^|\.)xiaohongshu\.com$/i.test(url.hostname)) {
            return 'other';
        }

        const path = url.pathname.replace(/\/+$/, '') || '/';

        if (/^\/explore\/[0-9a-z]+$/i.test(path)) {
            return 'note';
        }
        if (path === '/search_result') {
            return 'search';
        }
        if (path === '/explore' || /^\/(?:user\/)?profile\//i.test(path)) {
            return 'feed';
        }
        return 'other';
    }

    function getText(element) {
        if (!element) {
            return '';
        }
        return String(element.innerText || element.textContent || '').trim();
    }

    function getAttribute(element, name) {
        if (!element || typeof element.getAttribute !== 'function') {
            return '';
        }
        return element.getAttribute(name) || '';
    }

    function toAbsoluteUrl(value, baseUrl) {
        if (!value) {
            return '';
        }

        try {
            return new URL(value, baseUrl).href;
        } catch (error) {
            return '';
        }
    }

    function normalizeNoteUrl(value, baseUrl) {
        const absoluteUrl = toAbsoluteUrl(value, baseUrl);

        if (!absoluteUrl) {
            return '';
        }

        const url = new URL(absoluteUrl);
        url.pathname = url.pathname.replace(/^\/search_result\/(?=[0-9a-z])/i, '/explore/');
        return url.href;
    }

    function getNoteIdentity(noteUrl) {
        try {
            const path = new URL(noteUrl, 'https://www.xiaohongshu.com').pathname;
            const match = path.match(/^\/explore\/([0-9a-z]+)/i);
            return match ? match[1] : noteUrl;
        } catch (error) {
            return noteUrl;
        }
    }

    function extractNoteRecord(noteElement, baseUrl) {
        if (!noteElement || typeof noteElement.querySelector !== 'function') {
            return null;
        }

        const titleLink = noteElement.querySelector('a.title');
        const titleElement = noteElement.querySelector('a.title span') || titleLink;
        const coverElement = noteElement.querySelector('a.cover') || titleLink;
        const noteId = getAttribute(noteElement, 'data-note-id');
        const rawNoteLink = coverElement && (coverElement.href || getAttribute(coverElement, 'href'));
        const noteLink = normalizeNoteUrl(rawNoteLink || (noteId ? `/explore/${noteId}` : ''), baseUrl);

        if (!noteLink) {
            return null;
        }

        const authorElement = noteElement.querySelector('.author-wrapper a.author');
        const authorNameElement = authorElement && authorElement.querySelector('span.name');
        const rawAuthorLink = authorElement && (authorElement.href || getAttribute(authorElement, 'href'));
        const likeElement = noteElement.querySelector('.like-wrapper .count');
        const isVideo = Boolean(noteElement.querySelector('.play-icon') || noteElement.querySelector('video'));

        return {
            title: getText(titleElement),
            noteLink,
            author: getText(authorNameElement || authorElement),
            authorLink: toAbsoluteUrl(rawAuthorLink, baseUrl),
            likeCount: getText(likeElement),
            video: isVideo ? 1 : 0
        };
    }

    function escapeCsvCell(value) {
        let text = value == null ? '' : String(value);
        if (/^[=+\-@\t\r]/.test(text)) {
            text = `'${text}`;
        }
        return `"${text.replace(/"/g, '""')}"`;
    }

    function buildCsv(rows) {
        return '\uFEFF' + rows
            .map(row => row.map(escapeCsvCell).join(','))
            .join('\r\n');
    }

    function updateCountText(element, count) {
        if (!element) {
            return false;
        }

        const nextText = `已获取 ${count} 条`;
        if (element.textContent === nextText) {
            return false;
        }

        element.textContent = nextText;
        return true;
    }

    function parseJsonLd(documentValue) {
        const values = [];

        if (!documentValue || typeof documentValue.querySelectorAll !== 'function') {
            return values;
        }

        Array.from(documentValue.querySelectorAll('script[type="application/ld+json"]')).forEach(script => {
            try {
                values.push(JSON.parse(script.textContent || ''));
            } catch (error) {
                // Ignore malformed metadata from the page and keep checking other blocks.
            }
        });

        return values;
    }

    function walkObject(value, visit, seen) {
        if (value == null || typeof value !== 'object') {
            return;
        }

        const visited = seen || new Set();
        if (visited.has(value)) {
            return;
        }
        visited.add(value);
        visit(value);

        Object.keys(value).forEach(key => {
            walkObject(value[key], visit, visited);
        });
    }

    function normalizeUndefinedValues(text) {
        let result = '';
        let inString = false;
        let escaped = false;
        let index = 0;

        while (index < text.length) {
            const character = text[index];

            if (inString) {
                result += character;
                if (escaped) {
                    escaped = false;
                } else if (character === '\\') {
                    escaped = true;
                } else if (character === '"') {
                    inString = false;
                }
                index += 1;
                continue;
            }

            if (character === '"') {
                inString = true;
                result += character;
                index += 1;
                continue;
            }

            if (text.slice(index, index + 9) === 'undefined') {
                const previous = text[index - 1] || '';
                const next = text[index + 9] || '';
                if (!/[0-9A-Z_$]/i.test(previous) && !/[0-9A-Z_$]/i.test(next)) {
                    result += 'null';
                    index += 9;
                    continue;
                }
            }

            result += character;
            index += 1;
        }

        return result;
    }

    function readInitialState(documentValue) {
        if (!documentValue || typeof documentValue.querySelectorAll !== 'function') {
            return null;
        }

        const marker = 'window.__INITIAL_STATE__=';
        const scripts = Array.from(documentValue.querySelectorAll('script'));

        for (const script of scripts) {
            const text = script.textContent || '';
            const markerIndex = text.indexOf(marker);
            if (markerIndex < 0) {
                continue;
            }

            const jsonText = text.slice(markerIndex + marker.length).trim().replace(/;\s*$/, '');
            try {
                return JSON.parse(normalizeUndefinedValues(jsonText));
            } catch (error) {
                return null;
            }
        }

        return null;
    }

    function getMediaUrls(documentValue) {
        const images = new Set();
        const videos = new Set();

        if (!documentValue || typeof documentValue.querySelectorAll !== 'function') {
            return { images: [], videos: [] };
        }

        Array.from(documentValue.querySelectorAll('.swiper-slide img, .note-slider-img img')).forEach(image => {
            const url = image.currentSrc || getAttribute(image, 'src') || getAttribute(image, 'data-src');
            if (url && !url.startsWith('data:')) {
                images.add(url);
            }
        });

        parseJsonLd(documentValue).forEach(data => {
            walkObject(data, value => {
                const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
                if (types.includes('VideoObject') && typeof value.contentUrl === 'string') {
                    videos.add(value.contentUrl.replace(/^http:/, 'https:'));
                }
            });
        });

        if (videos.size === 0) {
            Array.from(documentValue.querySelectorAll('video, video source')).forEach(video => {
                const url = video.currentSrc || getAttribute(video, 'src') || getAttribute(video, 'data-src');
                if (url && !url.startsWith('blob:')) {
                    videos.add(url.replace(/^http:/, 'https:'));
                }
            });
        }

        if (videos.size === 0) {
            const initialState = readInitialState(documentValue);
            const candidates = [];

            walkObject(initialState, value => {
                if (typeof value.masterUrl === 'string') {
                    candidates.push({
                        url: value.masterUrl,
                        codec: String(value.videoCodec || ''),
                        width: Number(value.width || 0),
                        isDefault: Number(value.defaultStream || 0)
                    });
                }
            });

            candidates.sort((left, right) => {
                const leftH264 = left.codec.toLowerCase() === 'h264' ? 1 : 0;
                const rightH264 = right.codec.toLowerCase() === 'h264' ? 1 : 0;
                return rightH264 - leftH264 || right.isDefault - left.isDefault || right.width - left.width;
            });

            if (candidates[0]) {
                videos.add(candidates[0].url.replace(/^http:/, 'https:'));
            }
        }

        return {
            images: Array.from(images),
            videos: Array.from(videos)
        };
    }

    function stripXiaohongshuSuffix(value) {
        return String(value || '')
            .replace(/\s*-\s*小红书(?:搜索)?\s*$/i, '')
            .trim();
    }

    function getNoteTitle(documentValue) {
        let structuredTitle = '';

        parseJsonLd(documentValue).some(data => {
            walkObject(data, value => {
                if (structuredTitle) {
                    return;
                }
                const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
                if (types.some(type => ['VideoObject', 'ImageObject', 'Article', 'SocialMediaPosting'].includes(type))
                    && typeof value.name === 'string') {
                    structuredTitle = value.name;
                }
            });
            return Boolean(structuredTitle);
        });

        if (structuredTitle) {
            return stripXiaohongshuSuffix(structuredTitle);
        }

        const detailTitle = documentValue.querySelector('#detail-title, .note-content .title');
        if (detailTitle && getText(detailTitle)) {
            return getText(detailTitle);
        }

        const noteContent = documentValue.querySelector('.note-content');
        if (noteContent && getText(noteContent)) {
            return getText(noteContent).split('\n')[0].trim();
        }

        return stripXiaohongshuSuffix(documentValue.title || '');
    }

    function sanitizeFilename(value, fallback) {
        const sanitized = String(value || '')
            .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
            .replace(/\s+/g, ' ')
            .replace(/[. ]+$/g, '')
            .trim()
            .slice(0, 120);
        return sanitized || fallback;
    }

    function inferExtension(url, type) {
        if (type === 'video') {
            return '.mp4';
        }
        if (/webp/i.test(url)) {
            return '.webp';
        }
        if (/\.png(?:[?#]|$)/i.test(url)) {
            return '.png';
        }
        if (/\.gif(?:[?#]|$)/i.test(url)) {
            return '.gif';
        }
        return '.jpg';
    }

    function ensureStyle(documentValue) {
        if (documentValue.getElementById('xhs-utils-style')) {
            return;
        }

        const style = documentValue.createElement('style');
        style.id = 'xhs-utils-style';
        style.textContent = `
            #xhs-utils-feed-controls {
                position: fixed;
                right: 20px;
                bottom: 20px;
                z-index: 9999;
                display: flex;
                flex-direction: column;
                align-items: flex-end;
                gap: 8px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            }
            #xhs-utils-count {
                min-width: 128px;
                box-sizing: border-box;
                padding: 8px 12px;
                border: 1px solid rgba(0, 0, 0, 0.08);
                border-radius: 6px;
                background: rgba(255, 255, 255, 0.96);
                box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
                color: #333;
                font-size: 14px;
                line-height: 20px;
                text-align: center;
            }
            .xhs-utils-button {
                min-height: 38px;
                box-sizing: border-box;
                padding: 8px 14px;
                border: 0;
                border-radius: 6px;
                background: #ff2442;
                color: #fff;
                font: 600 14px/20px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                letter-spacing: 0;
                cursor: pointer;
                box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
            }
            .xhs-utils-button:hover { background: #e91e3a; }
            .xhs-utils-button:focus-visible { outline: 2px solid #111; outline-offset: 2px; }
            .xhs-utils-button:disabled { cursor: progress; opacity: 0.65; }
            #xhs-utils-search-toolbar {
                position: fixed;
                top: 76px;
                right: 20px;
                z-index: 9999;
                display: grid;
                grid-template-columns: repeat(2, minmax(76px, 1fr));
                gap: 6px;
                padding: 8px;
                border: 1px solid rgba(0, 0, 0, 0.08);
                border-radius: 6px;
                background: rgba(255, 255, 255, 0.96);
                box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
            }
            #xhs-utils-search-toolbar button {
                min-height: 34px;
                padding: 6px 10px;
                border: 1px solid #d9d9d9;
                border-radius: 5px;
                background: #fff;
                color: #333;
                font: 500 13px/20px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                letter-spacing: 0;
                cursor: pointer;
            }
            #xhs-utils-search-toolbar button:hover { border-color: #ff2442; color: #ff2442; }
            #xhs-utils-search-toolbar button:focus-visible { outline: 2px solid #ff2442; outline-offset: 1px; }
            #xhs-utils-media-download {
                position: fixed;
                left: 20px;
                bottom: 20px;
                z-index: 9999;
                max-width: min(320px, calc(100vw - 40px));
            }
            @media (max-width: 720px) {
                #xhs-utils-search-toolbar { top: auto; right: 12px; bottom: 108px; }
                #xhs-utils-feed-controls { right: 12px; bottom: 12px; }
                #xhs-utils-media-download { left: 12px; bottom: 12px; }
            }
        `;
        documentValue.head.appendChild(style);
    }

    function removeControls(documentValue) {
        CONTROL_IDS.slice(1).forEach(id => {
            const element = documentValue.getElementById(id);
            if (element) {
                element.remove();
            }
        });
    }

    function getCsvFilename(documentValue) {
        const title = stripXiaohongshuSuffix(documentValue.title || '').split(' - ')[0];
        return `${sanitizeFilename(title, '小红书笔记数据')}.csv`;
    }

    function triggerBlobDownload(rootValue, content, filename, mimeType) {
        const blob = new rootValue.Blob([content], { type: mimeType });
        const url = rootValue.URL.createObjectURL(blob);
        const link = rootValue.document.createElement('a');
        link.href = url;
        link.download = filename;
        link.hidden = true;
        rootValue.document.body.appendChild(link);
        link.click();
        link.remove();
        rootValue.setTimeout(() => rootValue.URL.revokeObjectURL(url), 1000);
    }

    function getSearchKeyword(rootValue) {
        const input = rootValue.document.querySelector('#search-input, .input-box input.search-input');
        if (input && input.value.trim()) {
            return input.value.trim();
        }
        return new URL(rootValue.location.href).searchParams.get('keyword') || '';
    }

    function ensureSearchToolbar(rootValue) {
        const documentValue = rootValue.document;
        if (documentValue.getElementById('xhs-utils-search-toolbar') || !documentValue.body) {
            return;
        }

        const toolbar = documentValue.createElement('div');
        toolbar.id = 'xhs-utils-search-toolbar';
        toolbar.setAttribute('role', 'group');
        toolbar.setAttribute('aria-label', '跨平台搜索');

        SEARCH_ENGINES.forEach(engine => {
            const button = documentValue.createElement('button');
            button.type = 'button';
            button.textContent = engine.name;
            button.addEventListener('click', () => {
                const keyword = getSearchKeyword(rootValue);
                if (keyword) {
                    rootValue.open(engine.url + encodeURIComponent(keyword), '_blank', 'noopener,noreferrer');
                }
            });
            toolbar.appendChild(button);
        });

        documentValue.body.appendChild(toolbar);
    }

    function getGmDownload(rootValue) {
        if (typeof GM_download === 'function') {
            return GM_download;
        }
        if (rootValue && typeof rootValue.GM_download === 'function') {
            return rootValue.GM_download;
        }
        return null;
    }

    function downloadRemoteFile(rootValue, url, filename) {
        const gmDownload = getGmDownload(rootValue);

        if (gmDownload) {
            return new Promise((resolve, reject) => {
                gmDownload({
                    url,
                    name: filename,
                    saveAs: false,
                    conflictAction: 'uniquify',
                    onload: resolve,
                    onerror: reject,
                    ontimeout: reject
                });
            });
        }

        return rootValue.fetch(url)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                return response.blob();
            })
            .then(blob => {
                const objectUrl = rootValue.URL.createObjectURL(blob);
                const link = rootValue.document.createElement('a');
                link.href = objectUrl;
                link.download = filename;
                link.hidden = true;
                rootValue.document.body.appendChild(link);
                link.click();
                link.remove();
                rootValue.setTimeout(() => rootValue.URL.revokeObjectURL(objectUrl), 1000);
            });
    }

    function ensureMediaDownloadButton(rootValue) {
        const documentValue = rootValue.document;
        if (documentValue.getElementById('xhs-utils-media-download') || !documentValue.body) {
            return;
        }

        const button = documentValue.createElement('button');
        button.id = 'xhs-utils-media-download';
        button.type = 'button';
        button.className = 'xhs-utils-button';
        button.textContent = '下载本条图片和视频';
        button.addEventListener('click', async () => {
            const media = getMediaUrls(documentValue);
            const files = [
                ...media.images.map(url => ({ url, type: 'image' })),
                ...media.videos.map(url => ({ url, type: 'video' }))
            ];

            if (files.length === 0) {
                button.textContent = '未找到可下载媒体';
                rootValue.setTimeout(() => {
                    button.textContent = '下载本条图片和视频';
                }, 1800);
                return;
            }

            const title = sanitizeFilename(getNoteTitle(documentValue), '小红书笔记');
            let completed = 0;
            let failed = 0;
            button.disabled = true;

            for (let index = 0; index < files.length; index += 1) {
                const file = files[index];
                const extension = inferExtension(file.url, file.type);
                button.textContent = `正在下载 ${index + 1}/${files.length}`;
                try {
                    await downloadRemoteFile(rootValue, file.url, `${title}-${index + 1}${extension}`);
                    completed += 1;
                } catch (error) {
                    failed += 1;
                }
            }

            button.disabled = false;
            button.textContent = failed > 0 ? `已下载 ${completed} 个，失败 ${failed} 个` : `已下载 ${completed} 个`;
            rootValue.setTimeout(() => {
                button.textContent = '下载本条图片和视频';
            }, 2200);
        });

        documentValue.body.appendChild(button);
    }

    function start(rootValue) {
        if (rootValue.__XHS_UTILS_320_STARTED__) {
            return;
        }
        rootValue.__XHS_UTILS_320_STARTED__ = true;

        const documentValue = rootValue.document;
        let currentRoute = '';
        let rows = [CSV_HEADERS.slice()];
        let extractedNoteIds = new Set();
        let refreshTimer = null;

        function resetRouteState(route) {
            currentRoute = route;
            rows = [CSV_HEADERS.slice()];
            extractedNoteIds = new Set();
            removeControls(documentValue);
        }

        function extractNotes() {
            const noteElements = documentValue.querySelectorAll(
                'section.note-item[data-note-id], section.note-item, .note-item[data-note-id]'
            );

            noteElements.forEach(noteElement => {
                const record = extractNoteRecord(noteElement, rootValue.location.href);
                const noteIdentity = record && getNoteIdentity(record.noteLink);
                if (!record || extractedNoteIds.has(noteIdentity)) {
                    return;
                }

                rows.push([
                    record.title,
                    record.noteLink,
                    record.author,
                    record.authorLink,
                    record.likeCount,
                    record.video
                ]);
                extractedNoteIds.add(noteIdentity);
            });

            const countElement = documentValue.getElementById('xhs-utils-count');
            updateCountText(countElement, extractedNoteIds.size);
        }

        function ensureFeedControls() {
            if (documentValue.getElementById('xhs-utils-feed-controls') || !documentValue.body) {
                return;
            }

            const controls = documentValue.createElement('div');
            controls.id = 'xhs-utils-feed-controls';

            const button = documentValue.createElement('button');
            button.type = 'button';
            button.className = 'xhs-utils-button';
            button.textContent = '导出 CSV';
            button.addEventListener('click', () => {
                triggerBlobDownload(
                    rootValue,
                    buildCsv(rows),
                    getCsvFilename(documentValue),
                    'text/csv;charset=utf-8'
                );
            });

            const count = documentValue.createElement('output');
            count.id = 'xhs-utils-count';
            count.textContent = `已获取 ${extractedNoteIds.size} 条`;

            controls.appendChild(button);
            controls.appendChild(count);
            documentValue.body.appendChild(controls);
        }

        function refresh() {
            refreshTimer = null;
            const route = `${rootValue.location.pathname}${rootValue.location.search}`;
            const pageType = getPageType(rootValue.location.href);

            if (route !== currentRoute) {
                resetRouteState(route);
            }

            ensureStyle(documentValue);

            if (pageType === 'feed' || pageType === 'search') {
                ensureFeedControls();
                extractNotes();
            }
            if (pageType === 'search') {
                ensureSearchToolbar(rootValue);
            }
            if (pageType === 'note') {
                ensureMediaDownloadButton(rootValue);
            }
        }

        function scheduleRefresh() {
            if (refreshTimer != null) {
                return;
            }
            refreshTimer = rootValue.setTimeout(refresh, 120);
        }

        function initialize() {
            refresh();
            const observer = new rootValue.MutationObserver(scheduleRefresh);
            observer.observe(documentValue.documentElement, { childList: true, subtree: true });
            rootValue.addEventListener('scroll', scheduleRefresh, { passive: true });
            rootValue.addEventListener('popstate', scheduleRefresh);
        }

        if (documentValue.readyState === 'loading') {
            documentValue.addEventListener('DOMContentLoaded', initialize, { once: true });
        } else {
            initialize();
        }
    }

    return {
        buildCsv,
        downloadRemoteFile,
        extractNoteRecord,
        getMediaUrls,
        getNoteTitle,
        getNoteIdentity,
        getPageType,
        normalizeNoteUrl,
        sanitizeFilename,
        start,
        updateCountText
    };
});
