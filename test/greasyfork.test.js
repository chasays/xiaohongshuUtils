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
    assert.strictEqual(typeof api.downloadRemoteFile, 'function');
});

test('requests silent unique downloads from the Tampermonkey browser API', () => {
    let capturedDetails = null;
    const rootValue = {
        GM_download(details) {
            capturedDetails = details;
        }
    };

    api.downloadRemoteFile(rootValue, 'https://sns-webpic-qc.xhscdn.com/example.webp', 'example.webp');

    assert.ok(capturedDetails);
    assert.strictEqual(capturedDetails.saveAs, false);
    assert.strictEqual(capturedDetails.conflictAction, 'uniquify');
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
        location: {
            href: 'https://www.xiaohongshu.com/explore/noteId'
        },
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

test('prefers current-note original image URLs over rendered thumbnails', () => {
    const thumbnail = fakeElement({
        attributes: { src: 'https://sns-webpic-qc.xhscdn.com/rendered-thumbnail!webp' }
    });
    const initialStateScript = {
        textContent: `window.__INITIAL_STATE__=${JSON.stringify({
            note: {
                noteDetailMap: {
                    currentNote: {
                        note: {
                            imageList: [{
                                urlDefault: 'http://sns-webpic-qc.xhscdn.com/20260804/abc/first-image!nd_dft_wlteh_jpg_3'
                            }, {
                                url: 'https://sns-webpic-qc.xhscdn.com/20260804/abc/second-image!nd_dft_wlteh_jpg_3'
                            }, {
                                urlDefault: 'https://example.com/unsupported-thumbnail.webp',
                                url: 'https://sns-webpic-qc.xhscdn.com/20260804/abc/third-image!nd_dft_wlteh_jpg_3'
                            }]
                        }
                    }
                }
            }
        })};`
    };
    const documentFixture = {
        location: {
            href: 'https://www.xiaohongshu.com/explore/currentNote'
        },
        querySelectorAll(selector) {
            if (selector === '.swiper-slide img, .note-slider-img img') {
                return [thumbnail];
            }
            if (selector === 'script') {
                return [initialStateScript];
            }
            return [];
        }
    };

    assert.deepStrictEqual(api.getMediaUrls(documentFixture).images, [
        'https://ci.xiaohongshu.com/first-image?imageView2/format/jpeg',
        'https://ci.xiaohongshu.com/second-image?imageView2/format/jpeg',
        'https://ci.xiaohongshu.com/third-image?imageView2/format/jpeg'
    ]);
});

test('prefers the current note originVideoKey over renditions and JSON-LD', () => {
    const renditionUrl = 'https://sns-video-qc.xhscdn.com/rendition.mp4';
    const jsonLdUrl = 'https://sns-video-qc.xhscdn.com/json-ld.mp4';
    const initialStateScript = {
        textContent: `window.__INITIAL_STATE__=${JSON.stringify({
            note: {
                noteDetailMap: {
                    currentNote: {
                        note: {
                            video: {
                                consumer: { originVideoKey: 'original/video-key' },
                                media: {
                                    stream: {
                                        h264: [{
                                            masterUrl: renditionUrl,
                                            height: 2160,
                                            streamDesc: 'X264_MP4'
                                        }]
                                    }
                                }
                            }
                        }
                    }
                }
            }
        })};`
    };
    const jsonLdScript = {
        textContent: JSON.stringify({
            '@type': 'VideoObject',
            contentUrl: jsonLdUrl
        })
    };
    const documentFixture = {
        location: {
            href: 'https://www.xiaohongshu.com/explore/currentNote'
        },
        querySelectorAll(selector) {
            if (selector === 'script') {
                return [initialStateScript];
            }
            if (selector === 'script[type="application/ld+json"]') {
                return [jsonLdScript];
            }
            return [];
        }
    };

    assert.deepStrictEqual(api.getMediaUrls(documentFixture).videos, [
        'https://sns-video-bd.xhscdn.com/original/video-key'
    ]);
});

test('uses the clean highest-resolution rendition backup URL before masterUrl', () => {
    const cleanMasterUrl = 'https://sns-video-qc.xhscdn.com/clean-master.mp4';
    const cleanBackupUrl = 'http://sns-video-qc.xhscdn.com/clean-backup.mp4';
    const watermarkedUrl = 'https://sns-video-qc.xhscdn.com/watermarked.mp4';
    const initialStateScript = {
        textContent: `window.__INITIAL_STATE__=${JSON.stringify({
            note: {
                noteDetailMap: {
                    currentNote: {
                        note: {
                            video: {
                                media: {
                                    stream: {
                                        h264: [{
                                            masterUrl: watermarkedUrl,
                                            backupUrls: [watermarkedUrl],
                                            height: 2160,
                                            streamDesc: 'WM_X264_MP4_web'
                                        }],
                                        EF5: [{
                                            masterUrl: cleanMasterUrl,
                                            backupUrls: [cleanBackupUrl],
                                            height: 1080,
                                            streamDesc: 'WEB_301'
                                        }]
                                    }
                                }
                            }
                        }
                    }
                }
            }
        })};`
    };
    const documentFixture = {
        location: {
            href: 'https://www.xiaohongshu.com/explore/currentNote'
        },
        querySelectorAll(selector) {
            return selector === 'script' ? [initialStateScript] : [];
        }
    };

    assert.deepStrictEqual(api.getMediaUrls(documentFixture).videos, [
        'https://sns-video-qc.xhscdn.com/clean-backup.mp4'
    ]);
});

test('falls back to rendition masterUrl when its backup URL is invalid', () => {
    const masterUrl = 'http://sns-video-qc.xhscdn.com/clean-master.mp4';
    const initialStateScript = {
        textContent: `window.__INITIAL_STATE__=${JSON.stringify({
            note: {
                noteDetailMap: {
                    currentNote: {
                        note: {
                            video: {
                                media: {
                                    stream: {
                                        EF5: [{
                                            masterUrl,
                                            backupUrls: ['blob:https://www.xiaohongshu.com/invalid-backup'],
                                            height: 1080,
                                            streamDesc: 'WEB_301'
                                        }]
                                    }
                                }
                            }
                        }
                    }
                }
            }
        })};`
    };
    const documentFixture = {
        location: {
            href: 'https://www.xiaohongshu.com/explore/currentNote'
        },
        querySelectorAll(selector) {
            return selector === 'script' ? [initialStateScript] : [];
        }
    };

    assert.deepStrictEqual(api.getMediaUrls(documentFixture).videos, [
        'https://sns-video-qc.xhscdn.com/clean-master.mp4'
    ]);
});

test('prefers a non-watermarked initial-state stream over the JSON-LD video URL', () => {
    const watermarkedUrl = 'https://sns-video-v2.xhscdn.com/stream/79/110/259/watermarked_259.mp4';
    const cleanUrl = 'http://sns-video-v2.xhscdn.com/stream/1/110/301/clean_301.mp4';
    const videoScript = {
        textContent: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'VideoObject',
            contentUrl: watermarkedUrl
        })
    };
    const initialStateScript = {
        textContent: `window.__INITIAL_STATE__=${JSON.stringify({
            note: {
                noteDetailMap: {
                    noteId: {
                        note: {
                            video: {
                                media: {
                                    stream: {
                                        EF4: [{
                                            masterUrl: watermarkedUrl,
                                            streamDesc: 'WM_X264_MP4_web',
                                            videoCodec: 'h264',
                                            width: 720
                                        }],
                                        EF5: [{
                                            masterUrl: cleanUrl,
                                            streamDesc: 'WEB_301',
                                            videoCodec: 'EF5',
                                            width: 1080
                                        }]
                                    }
                                }
                            }
                        }
                    }
                }
            }
        })};`
    };
    const documentFixture = {
        querySelectorAll(selector) {
            if (selector === 'script[type="application/ld+json"]') {
                return [videoScript];
            }
            if (selector === 'script') {
                return [initialStateScript];
            }
            return [];
        }
    };

    assert.deepStrictEqual(api.getMediaUrls(documentFixture), {
        images: [],
        videos: ['https://sns-video-v2.xhscdn.com/stream/1/110/301/clean_301.mp4']
    });
});

test('only ranks initial-state streams belonging to the current note', () => {
    const currentUrl = 'http://sns-video-v2.xhscdn.com/stream/1/110/301/current_301.mp4';
    const otherUrl = 'http://sns-video-v2.xhscdn.com/stream/1/110/109/other_109.mp4';
    const initialStateScript = {
        textContent: `window.__INITIAL_STATE__=${JSON.stringify({
            note: {
                noteDetailMap: {
                    currentNote: {
                        note: {
                            video: {
                                media: {
                                    stream: {
                                        EF5: [{
                                            masterUrl: currentUrl,
                                            streamDesc: 'WEB_301',
                                            videoCodec: 'EF5',
                                            width: 1080
                                        }]
                                    }
                                }
                            }
                        }
                    },
                    otherNote: {
                        note: {
                            video: {
                                media: {
                                    stream: {
                                        h264: [{
                                            masterUrl: otherUrl,
                                            streamDesc: 'X264_MP4',
                                            videoCodec: 'h264',
                                            width: 2160
                                        }]
                                    }
                                }
                            }
                        }
                    }
                }
            }
        })};`
    };
    const documentFixture = {
        location: {
            href: 'https://www.xiaohongshu.com/explore/currentNote'
        },
        querySelectorAll(selector) {
            return selector === 'script' ? [initialStateScript] : [];
        }
    };

    assert.deepStrictEqual(api.getMediaUrls(documentFixture), {
        images: [],
        videos: ['https://sns-video-v2.xhscdn.com/stream/1/110/301/current_301.mp4']
    });
});

test('ignores stale initial-state notes after SPA navigation', () => {
    const staleUrl = 'http://sns-video-v2.xhscdn.com/stream/1/110/109/stale_109.mp4';
    const currentJsonLdUrl = 'https://sns-video-v2.xhscdn.com/stream/79/110/259/current_259.mp4';
    const initialStateScript = {
        textContent: `window.__INITIAL_STATE__=${JSON.stringify({
            note: {
                noteDetailMap: {
                    previousNote: {
                        note: {
                            video: {
                                media: {
                                    stream: {
                                        EF5: [{
                                            masterUrl: staleUrl,
                                            streamDesc: 'WEB_109',
                                            videoCodec: 'EF5',
                                            width: 2160
                                        }]
                                    }
                                }
                            }
                        }
                    }
                }
            }
        })};`
    };
    const jsonLdScript = {
        textContent: JSON.stringify({
            '@type': 'VideoObject',
            contentUrl: currentJsonLdUrl
        })
    };
    const documentFixture = {
        location: {
            href: 'https://www.xiaohongshu.com/explore/currentNote'
        },
        querySelectorAll(selector) {
            if (selector === 'script') {
                return [initialStateScript];
            }
            if (selector === 'script[type="application/ld+json"]') {
                return [jsonLdScript];
            }
            return [];
        }
    };

    assert.deepStrictEqual(api.getMediaUrls(documentFixture), {
        images: [],
        videos: [currentJsonLdUrl]
    });
});

test('does not use unrelated root-state streams on a current note URL', () => {
    const unrelatedUrl = 'http://sns-video-v2.xhscdn.com/stream/1/110/109/unrelated_109.mp4';
    const currentJsonLdUrl = 'https://sns-video-v2.xhscdn.com/stream/79/110/259/current_259.mp4';
    const initialStateScript = {
        textContent: `window.__INITIAL_STATE__=${JSON.stringify({
            feed: {
                cards: [{
                    masterUrl: unrelatedUrl,
                    streamDesc: 'WEB_109',
                    videoCodec: 'h264',
                    width: 2160
                }]
            }
        })};`
    };
    const jsonLdScript = {
        textContent: JSON.stringify({
            '@type': 'VideoObject',
            contentUrl: currentJsonLdUrl
        })
    };
    const documentFixture = {
        location: {
            href: 'https://www.xiaohongshu.com/explore/currentNote'
        },
        querySelectorAll(selector) {
            if (selector === 'script') {
                return [initialStateScript];
            }
            if (selector === 'script[type="application/ld+json"]') {
                return [jsonLdScript];
            }
            return [];
        }
    };

    assert.deepStrictEqual(api.getMediaUrls(documentFixture), {
        images: [],
        videos: [currentJsonLdUrl]
    });
});

test('falls back to JSON-LD when the current stream URL is empty', () => {
    const jsonLdUrl = 'https://sns-video-v2.xhscdn.com/stream/79/110/259/fallback_259.mp4';
    const initialStateScript = {
        textContent: `window.__INITIAL_STATE__=${JSON.stringify({
            note: {
                noteDetailMap: {
                    currentNote: {
                        note: {
                            video: {
                                media: {
                                    stream: {
                                        EF5: [{ masterUrl: '', streamDesc: 'WEB_301', width: 1080 }]
                                    }
                                }
                            }
                        }
                    }
                }
            }
        })};`
    };
    const jsonLdScript = {
        textContent: JSON.stringify({
            '@type': 'VideoObject',
            contentUrl: jsonLdUrl
        })
    };
    const documentFixture = {
        location: {
            href: 'https://www.xiaohongshu.com/explore/currentNote'
        },
        querySelectorAll(selector) {
            if (selector === 'script') {
                return [initialStateScript];
            }
            if (selector === 'script[type="application/ld+json"]') {
                return [jsonLdScript];
            }
            return [];
        }
    };

    assert.deepStrictEqual(api.getMediaUrls(documentFixture), {
        images: [],
        videos: [jsonLdUrl]
    });
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
