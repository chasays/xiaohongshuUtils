# Original Media Download Design

## Goal

Update the userscript to follow XHS-Downloader's original-media selection behavior for both images and videos while avoiding streams explicitly marked as watermarked.

## Image Selection

- Read the current note from `window.__INITIAL_STATE__.note.noteDetailMap[noteId]`.
- For each `note.imageList` entry, prefer `urlDefault`, then `url`.
- Convert supported Xiaohongshu CDN image URLs to `https://ci.xiaohongshu.com/<asset-path>?imageView2/format/jpeg` so downloads request the source asset instead of the rendered DOM thumbnail.
- Preserve image order and remove duplicate URLs.
- Fall back to the existing visible-image extraction only when current-note image data is unavailable or cannot produce a valid URL.

## Video Selection

- Read only the current note's `note.video` data.
- Prefer `video.consumer.originVideoKey` and build `https://sns-video-bd.xhscdn.com/<originVideoKey>`.
- Otherwise flatten `video.media.stream`, reject candidates explicitly marked `WM` or `watermark` when a clean candidate exists, sort by height descending, and choose `backupUrls[0]` before `masterUrl`.
- Preserve the existing JSON-LD and DOM video fallbacks when the structured current-note data has no usable video URL.

## Download Behavior

- Keep the existing one-click sequential batch download and `GM_download({ saveAs: false, conflictAction: 'uniquify' })` behavior.
- Continue saving images as `.jpg`/`.jpeg` and videos as `.mp4` according to URL/type inference.
- Do not add confirmation dialogs or new UI controls.

## Version And Tests

- Bump the userscript version from `3.2.3` to `3.2.4`.
- Add regression tests proving:
  - current-note `imageList` replaces lower-resolution DOM image URLs with `ci.xiaohongshu.com` URLs;
  - `originVideoKey` wins over rendition and JSON-LD URLs;
  - when no origin key exists, the highest-resolution clean rendition uses `backupUrls[0]` before `masterUrl`;
  - existing JSON-LD fallback behavior remains intact.
