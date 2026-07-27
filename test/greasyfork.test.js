const assert = require('assert');
const path = require('path');

let api = null;
let loadError = null;

try {
    api = require(path.join(__dirname, '..', 'greasyfork.js'));
} catch (error) {
    loadError = error;
}

const tests = [];

function test(name, run) {
    tests.push({ name, run });
}

function fakeElement({ text = '', href = null, attributes = {}, children = {} } = {}) {
    return {
        innerText: text,
        href,
        currentSrc: attributes.currentSrc || '',
        getAttribute(name) {
            return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null;
        },
        querySelector(selector) {
            return children[selector] || null;
        }
    };
}

test('exports a testable userscript core', () => {
    assert.ok(api, `greasyfork.js could not be loaded: ${loadError && loadError.message}`);
    assert.strictEqual(typeof api.getPageType, 'function');
    assert.strictEqual(typeof api.extractNoteRecord, 'function');
    assert.strictEqual(typeof api.buildCsv, 'function');
    assert.strictEqual(typeof api.getMediaUrls, 'function');
    assert.strictEqual(typeof api.getNoteTitle, 'function');
    assert.strictEqual(typeof api.getNoteIdentity, 'function');
    assert.strictEqual(typeof api.updateCountText, 'function');
});

test('recognizes current feed, search, profile, and note URLs', () => {
    assert.strictEqual(api.getPageType('https://www.xiaohongshu.com/explore?source=tourist_search'), 'feed');
    assert.strictEqual(api.getPageType('https://www.xiaohongshu.com/explore?channel_id=homefeed_recommend'), 'feed');
    assert.strictEqual(api.getPageType('https://www.xiaohongshu.com/user/profile/abc123'), 'feed');
    assert.strictEqual(api.getPageType('https://www.xiaohongshu.com/search_result/?keyword=%E6%91%84%E5%BD%B1'), 'search');
    assert.strictEqual(api.getPageType('https://www.xiaohongshu.com/search_result?keyword=%E6%91%84%E5%BD%B1&type=51'), 'search');
    assert.strictEqual(api.getPageType('https://www.xiaohongshu.com/explore/6a43311a000000001503fe73?xsec_source=pc_feed'), 'note');
    assert.strictEqual(api.getPageType('https://www.xiaohongshu.com/red_video'), 'other');
});

test('extracts a current note card without data-v build hashes', () => {
    const titleSpan = fakeElement({ text: '标题,带逗号' });
    const authorName = fakeElement({ text: '作者甲' });
    const card = fakeElement({
        attributes: { 'data-note-id': '6a43311a000000001503fe73' },
        children: {
            'a.title': fakeElement({ children: { span: titleSpan } }),
            'a.title span': titleSpan,
            'a.cover': fakeElement({
                href: 'https://www.xiaohongshu.com/search_result/6a43311a000000001503fe73?xsec_source=pc_search'
            }),
            '.author-wrapper a.author': fakeElement({
                text: '作者甲',
                attributes: { href: '/user/profile/author-id' },
                children: { 'span.name': authorName }
            }),
            '.like-wrapper .count': fakeElement({ text: '1.3万' }),
            '.play-icon': fakeElement()
        }
    });

    assert.deepStrictEqual(api.extractNoteRecord(card, 'https://www.xiaohongshu.com/explore'), {
        title: '标题,带逗号',
        noteLink: 'https://www.xiaohongshu.com/explore/6a43311a000000001503fe73?xsec_source=pc_search',
        author: '作者甲',
        authorLink: 'https://www.xiaohongshu.com/user/profile/author-id',
        likeCount: '1.3万',
        video: 1
    });
});

test('deduplicates tracking variants by stable note identity', () => {
    const first = 'https://www.xiaohongshu.com/explore/6a43311a000000001503fe73?xsec_token=first&xsec_source=pc_feed';
    const second = 'https://www.xiaohongshu.com/explore/6a43311a000000001503fe73?xsec_token=second&xsec_source=pc_search';

    assert.strictEqual(api.getNoteIdentity(first), '6a43311a000000001503fe73');
    assert.strictEqual(api.getNoteIdentity(first), api.getNoteIdentity(second));
});

test('does not rewrite an unchanged count and retrigger observers', () => {
    let writes = 0;
    const countElement = {
        value: '已获取 3 条',
        get textContent() {
            return this.value;
        },
        set textContent(value) {
            writes += 1;
            this.value = value;
        }
    };

    assert.strictEqual(api.updateCountText(countElement, 3), false);
    assert.strictEqual(writes, 0);
    assert.strictEqual(api.updateCountText(countElement, 4), true);
    assert.strictEqual(writes, 1);
    assert.strictEqual(countElement.textContent, '已获取 4 条');
});

test('builds valid CSV without deleting or corrupting rows', () => {
    const rows = [
        ['标题', '链接'],
        ['含,逗号', '含"引号\n换行'],
        ['=HYPERLINK("https://example.com")', '+SUM(A1:A2)']
    ];
    const original = JSON.parse(JSON.stringify(rows));
    const csv = api.buildCsv(rows);

    assert.strictEqual(
        csv,
        '\uFEFF"标题","链接"\r\n'
            + '"含,逗号","含""引号\n换行"\r\n'
            + '"\'=HYPERLINK(""https://example.com"")","\'+SUM(A1:A2)"'
    );
    assert.deepStrictEqual(rows, original);
});

test('deduplicates current slide images and reads JSON-LD video URLs', () => {
    const imageOne = fakeElement({ attributes: { src: 'https://sns-webpic-qc.xhscdn.com/image-one!webp' } });
    const imageOneDuplicate = fakeElement({ attributes: { src: 'https://sns-webpic-qc.xhscdn.com/image-one!webp' } });
    const imageTwo = fakeElement({ attributes: { currentSrc: 'https://sns-webpic-qc.xhscdn.com/image-two!webp' } });
    const videoScript = {
        textContent: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'VideoObject',
            name: '视频标题 - 小红书',
            contentUrl: 'https://sns-video-v4.xhscdn.com/example.mp4?sign=abc'
        })
    };
    const documentFixture = {
        querySelectorAll(selector) {
            if (selector === '.swiper-slide img, .note-slider-img img') {
                return [imageOne, imageOneDuplicate, imageTwo];
            }
            if (selector === 'script[type="application/ld+json"]') {
                return [videoScript];
            }
            return [];
        }
    };

    assert.deepStrictEqual(api.getMediaUrls(documentFixture), {
        images: [
            'https://sns-webpic-qc.xhscdn.com/image-one!webp',
            'https://sns-webpic-qc.xhscdn.com/image-two!webp'
        ],
        videos: ['https://sns-video-v4.xhscdn.com/example.mp4?sign=abc']
    });
    assert.strictEqual(api.getNoteTitle(documentFixture), '视频标题');
});

test('reads video masterUrl from initial state containing undefined values', () => {
    const initialStateScript = {
        textContent: 'window.__INITIAL_STATE__={"note":{"unused":undefined,"stream":{"videoCodec":"h264","width":1080,"masterUrl":"http:\\u002F\\u002Fsns-video-v4.xhscdn.com\\u002Ffallback.mp4"}}};'
    };
    const documentFixture = {
        querySelectorAll(selector) {
            if (selector === 'script') {
                return [initialStateScript];
            }
            return [];
        }
    };

    assert.deepStrictEqual(api.getMediaUrls(documentFixture), {
        images: [],
        videos: ['https://sns-video-v4.xhscdn.com/fallback.mp4']
    });
});

let failures = 0;

tests.forEach(({ name, run }) => {
    try {
        run();
        console.log(`PASS ${name}`);
    } catch (error) {
        failures += 1;
        console.error(`FAIL ${name}`);
        console.error(error.stack || error.message);
    }
});

if (failures > 0) {
    process.exitCode = 1;
} else {
    console.log(`\n${tests.length} tests passed`);
}
