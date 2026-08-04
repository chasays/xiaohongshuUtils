# Original Media Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Download high-resolution current-note images and original Xiaohongshu videos using the selected XHS-Downloader-compatible source priority.

**Architecture:** Keep media discovery in `getMediaUrls`, but isolate current-note lookup, original image URL conversion, and video rendition choice into pure helpers. Structured current-note data becomes the primary source; existing DOM and JSON-LD extraction remains fallback behavior.

**Tech Stack:** Tampermonkey userscript JavaScript, Node.js built-in `assert`, existing custom test runner.

---

### Task 1: Prefer Current-Note High-Resolution Images

**Files:**
- Modify: `test/greasyfork.test.js`
- Modify: `greasyfork.js:261-387`

- [ ] **Step 1: Write the failing test**

Add a fixture with a lower-resolution DOM image and two `imageList` entries whose `urlDefault` values use the Xiaohongshu CDN path format. Assert that `getMediaUrls()` returns ordered `ci.xiaohongshu.com/<asset>?imageView2/format/jpeg` URLs instead of the DOM thumbnail.

```js
test('prefers current-note original image URLs over rendered thumbnails', () => {
    const initialStateScript = {
        textContent: `window.__INITIAL_STATE__=${JSON.stringify({
            note: { noteDetailMap: { currentNote: { note: { imageList: [
                { urlDefault: 'http://sns-webpic-qc.xhscdn.com/20260804/abc/first-image!nd_dft_wlteh_jpg_3' },
                { url: 'https://sns-webpic-qc.xhscdn.com/20260804/abc/second-image!nd_dft_wlteh_jpg_3' }
            ] } } } }
        })};`
    };
    const documentFixture = createMediaDocumentFixture('currentNote', initialStateScript, [
        fakeElement({ attributes: { src: 'https://sns-webpic-qc.xhscdn.com/rendered-thumbnail!webp' } })
    ]);

    assert.deepStrictEqual(api.getMediaUrls(documentFixture).images, [
        'https://ci.xiaohongshu.com/first-image?imageView2/format/jpeg',
        'https://ci.xiaohongshu.com/second-image?imageView2/format/jpeg'
    ]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `/opt/homebrew/bin/node test/greasyfork.test.js`

Expected: FAIL because `getMediaUrls()` still returns the rendered thumbnail.

- [ ] **Step 3: Implement current-note image selection**

Add helpers equivalent to the following and call them before the existing DOM image fallback:

```js
function getCurrentNote(initialState, noteId) {
    const noteDetailMap = initialState && initialState.note && initialState.note.noteDetailMap;
    const entry = noteId && noteDetailMap && noteDetailMap[noteId];
    return entry && (entry.note || entry);
}

function getOriginalImageUrl(value) {
    const mediaUrl = normalizeRemoteMediaUrl(value);
    if (!mediaUrl) return '';
    const url = new URL(mediaUrl);
    const match = url.pathname.match(/^\/\d+\/[0-9a-z]+\/([^!]+)/i);
    return match
        ? `https://ci.xiaohongshu.com/${match[1]}?imageView2/format/jpeg`
        : '';
}
```

Read `urlDefault || url` from each current-note `imageList` item, deduplicate with `Set`, and only scan `.swiper-slide img, .note-slider-img img` when no structured image URL was generated.

- [ ] **Step 4: Run the full test file**

Run: `/opt/homebrew/bin/node test/greasyfork.test.js`

Expected: all existing tests plus the new image test PASS.

- [ ] **Step 5: Commit the image behavior**

```bash
git add greasyfork.js test/greasyfork.test.js
git commit -m "feat: download original note images"
```

### Task 2: Match Original Video Source Priority

**Files:**
- Modify: `test/greasyfork.test.js`
- Modify: `greasyfork.js:304-387`

- [ ] **Step 1: Write failing video priority tests**

Add one test proving `video.consumer.originVideoKey` produces `https://sns-video-bd.xhscdn.com/<key>` ahead of rendition and JSON-LD URLs. Add another proving that, without an origin key, a clean higher-resolution rendition selects `backupUrls[0]` before its `masterUrl`, while an explicitly watermarked rendition is not selected.

```js
assert.deepStrictEqual(api.getMediaUrls(originFixture).videos, [
    'https://sns-video-bd.xhscdn.com/original/video-key'
]);

assert.deepStrictEqual(api.getMediaUrls(renditionFixture).videos, [
    'https://sns-video-qc.xhscdn.com/clean-backup.mp4'
]);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `/opt/homebrew/bin/node test/greasyfork.test.js`

Expected: FAIL because the script does not read `originVideoKey` or `backupUrls`.

- [ ] **Step 3: Implement attachment-compatible video selection**

Use the current note returned by `getCurrentNote()`. Return the origin URL first when `originVideoKey` exists. Otherwise flatten `note.video.media.stream`, prefer clean candidates, sort by `height` descending, and choose `backupUrls[0] || masterUrl`:

```js
function getOriginalVideoUrl(note) {
    const originKey = note && note.video && note.video.consumer && note.video.consumer.originVideoKey;
    if (originKey) {
        return normalizeRemoteMediaUrl(`https://sns-video-bd.xhscdn.com/${originKey}`);
    }
    const streams = Object.values(note && note.video && note.video.media
        && note.video.media.stream || {}).flat().filter(Boolean);
    const watermarkPattern = /(?:^|[_\s-])wm(?:[_\s-]|$)|watermark/i;
    streams.sort((left, right) => {
        const leftClean = watermarkPattern.test(String(left.streamDesc || '')) ? 0 : 1;
        const rightClean = watermarkPattern.test(String(right.streamDesc || '')) ? 0 : 1;
        return rightClean - leftClean || Number(right.height || 0) - Number(left.height || 0);
    });
    const selected = streams[0];
    return selected
        ? normalizeRemoteMediaUrl((selected.backupUrls || [])[0] || selected.masterUrl)
        : '';
}
```

Use the previous recursive `masterUrl` selection only for pages without a resolvable current-note entry, then retain JSON-LD and DOM fallbacks.

- [ ] **Step 4: Run the full test file**

Run: `/opt/homebrew/bin/node test/greasyfork.test.js`

Expected: every video selection, stale-note, and fallback test PASS.

- [ ] **Step 5: Commit the video behavior**

```bash
git add greasyfork.js test/greasyfork.test.js
git commit -m "feat: prefer original video sources"
```

### Task 3: Version And Release Verification

**Files:**
- Modify: `greasyfork.js:1-10`

- [ ] **Step 1: Update the userscript version**

Change the metadata header from `// @version 3.2.3` to `// @version 3.2.4`.

- [ ] **Step 2: Run complete verification**

Run:

```bash
/opt/homebrew/bin/node test/greasyfork.test.js
/opt/homebrew/bin/node --check greasyfork.js
git diff --check
```

Expected: all tests PASS, syntax check exits 0, and diff check produces no output.

- [ ] **Step 3: Review the final diff against the design**

Run: `git diff -- greasyfork.js test/greasyfork.test.js`

Expected: only structured media selection, tests, and the version header changed; existing one-click download behavior remains unchanged.

- [ ] **Step 4: Commit the version update**

```bash
git add greasyfork.js
git commit -m "chore: bump userscript to 3.2.4"
```

- [ ] **Step 5: Verify repository state and remote delivery**

Run:

```bash
git status --short
git log -4 --oneline
git push origin main
git status -sb
```

Expected: a clean worktree and local `main` synchronized with `origin/main`.
