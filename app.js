const { FFmpeg } = FFmpegWASM;
const { fetchFile } = FFmpegUtil;

let ffmpeg = null;
let lastOptimizedBlob = null;
let lastOptimizedFileName = '';
const AD_LINK = 'https://uplcm.com/4/12134199';

// ---------- Ad modal overlay ----------
function createAdModal() {
    // Only create once
    if (document.getElementById('ad-modal-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'ad-modal-overlay';
    overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 99999;
        background: rgba(0,0,0,0.7); backdrop-filter: blur(6px);
        display: flex; justify-content: center; align-items: center;
        animation: fadeIn 0.3s ease-out;
    `;

    const box = document.createElement('div');
    box.style.cssText = `
        background: #fff; border-radius: 20px; padding: 2rem 1.75rem;
        text-align: center; max-width: 340px; width: 90%;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        animation: fadeInUp 0.4s ease-out;
    `;

    const title = document.createElement('h3');
    title.textContent = 'Support Us!';
    title.style.cssText = 'margin-bottom: 0.5rem; font-size: 1.2rem; color: #1a1a2e;';

    const msg = document.createElement('p');
    msg.id = 'ad-modal-msg';
    msg.style.cssText = 'font-size: 0.9rem; color: #6b7280; margin-bottom: 1.25rem; line-height: 1.5;';

    const btn = document.createElement('button');
    btn.id = 'ad-modal-btn';
    btn.textContent = 'Go Back';
    btn.style.cssText = `
        padding: 0.75rem 2rem; font-size: 0.95rem; font-weight: 600;
        color: #fff; background: linear-gradient(135deg, #6366f1, #8b5cf6);
        border: none; border-radius: 12px; cursor: pointer;
        box-shadow: 0 4px 16px rgba(99,102,241,0.3);
        transition: all 0.3s ease; width: 100%;
    `;
    btn.onmouseenter = () => btn.style.transform = 'translateY(-2px) scale(1.02)';
    btn.onmouseleave = () => btn.style.transform = '';

    box.appendChild(title);
    box.appendChild(msg);
    box.appendChild(btn);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
}

function showAdModal(secondsViewed, minSeconds) {
    createAdModal();
    const overlay = document.getElementById('ad-modal-overlay');
    const msg = document.getElementById('ad-modal-msg');
    const btn = document.getElementById('ad-modal-btn');

    msg.textContent = `Please view the ad for at least ${minSeconds} seconds to support us. You closed it after ${Math.floor(secondsViewed)}s.`;

    overlay.style.display = 'flex';

    // Replace button handler each time
    const newBtn = btn.cloneNode(true);
    newBtn.onmouseenter = () => newBtn.style.transform = 'translateY(-2px) scale(1.02)';
    newBtn.onmouseleave = () => newBtn.style.transform = '';
    btn.parentNode.replaceChild(newBtn, btn);

    return new Promise((resolve) => {
        newBtn.addEventListener('click', () => {
            overlay.style.display = 'none';
            resolve();
        }, { once: true });
    });
}

// ---------- Ad enforcement: must view for at least 7 seconds ----------
function openAdWithEnforcement(minSeconds = 7) {
    const adWindow = window.open(AD_LINK, '_blank');

    // If popup was blocked by browser, nothing we can do
    if (!adWindow) return;

    const startTime = Date.now();
    const checkInterval = setInterval(() => {
        try {
            const elapsed = (Date.now() - startTime) / 1000;

            if (adWindow.closed && elapsed < minSeconds) {
                clearInterval(checkInterval);
                // Show modal with only "Go Back" button, then reopen with full timer reset
                showAdModal(elapsed, minSeconds).then(() => {
                    openAdWithEnforcement(minSeconds);
                });
            } else if (adWindow.closed || elapsed >= minSeconds) {
                clearInterval(checkInterval);
            }
        } catch {
            clearInterval(checkInterval);
        }
    }, 500);
}

// ---------- Ad cooldown: only show on button clicks once every 12 hours ----------
const AD_COOLDOWN_KEY = 'pics_ad_last_shown';
const AD_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 hours

function tryShowAdWithCooldown() {
    const lastShown = parseInt(localStorage.getItem(AD_COOLDOWN_KEY) || '0', 10);
    const now = Date.now();

    if (now - lastShown >= AD_COOLDOWN_MS) {
        localStorage.setItem(AD_COOLDOWN_KEY, now.toString());
        openAdWithEnforcement();
    }
}

// ---------- Probe video dimensions using HTML video element ----------
function probeVideo(file) {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        const url = URL.createObjectURL(file);

        video.onloadedmetadata = () => {
            URL.revokeObjectURL(url);
            resolve({
                width: video.videoWidth,
                height: video.videoHeight,
                duration: video.duration,
                sizeMB: file.size / (1024 * 1024)
            });
        };

        video.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load video metadata'));
        };

        video.src = url;
    });
}

async function loadFFmpeg() {
    if (ffmpeg) return ffmpeg;
    ffmpeg = new FFmpeg();
    ffmpeg.on('progress', ({ progress }) => {
        const wpProgress = document.getElementById('wp-progress');
        wpProgress.textContent = `Processing: ${Math.round(progress * 100)}%`;
    });

    // Use multi-threaded build for much faster encoding (requires SharedArrayBuffer)
    const useMultiThread = typeof SharedArrayBuffer !== 'undefined';

    if (useMultiThread) {
        await ffmpeg.load({
            coreURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.6/dist/umd/ffmpeg-core.js',
            wasmURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.6/dist/umd/ffmpeg-core.wasm',
            workerURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.6/dist/umd/ffmpeg-core.worker.js',
        });
    } else {
        // Fallback to single-threaded if SharedArrayBuffer is unavailable
        await ffmpeg.load({
            coreURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
            wasmURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm',
        });
    }

    return ffmpeg;
}

// ---------- Image optimization using Canvas ----------
function optimizeImage(file, maxWidth, maxHeight, quality) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;

            if (width > maxWidth || height > maxHeight) {
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            canvas.toBlob(
                (blob) => blob ? resolve(blob) : reject(new Error('Failed to compress image')),
                'image/jpeg',
                quality
            );
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load image'));
        };

        img.src = url;
    });
}

// ---------- Share via Web Share API ----------
async function shareToWhatsApp(blob, fileName) {
    const file = new File([blob], fileName, { type: blob.type });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title: 'Pics Optimized Media' });
            return true;
        } catch (err) {
            if (err.name !== 'AbortError') console.error('Share failed:', err);
            return false;
        }
    } else {
        alert('Direct sharing is not supported on this browser. Please download the file and share manually.');
        return false;
    }
}

// ==========================================================
document.addEventListener('DOMContentLoaded', () => {
    // Register service worker (adds required headers for FFmpeg.wasm)
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(reg => {
                console.log('SW registered', reg);
                // If this is the first load (no controller), reload so the SW can inject headers
                if (!navigator.serviceWorker.controller) {
                    reg.addEventListener('statechange', () => {
                        if (reg.active) {
                            window.location.reload();
                        }
                    });
                }
            })
            .catch(err => console.error('SW failed', err));
    }

    // Open ad 10 seconds after page load (every fresh open, not on minimize/restore)
    // DOMContentLoaded only fires on fresh page loads, not on visibility changes
    setTimeout(() => openAdWithEnforcement(), 10000);

    // Also handle PWA being restored from bfcache (back/forward navigation)
    window.addEventListener('pageshow', (e) => {
        if (e.persisted) {
            // Page was restored from bfcache — treat as a fresh open
            setTimeout(() => openAdWithEnforcement(), 10000);
        }
    });

    // PWA Install
    let deferredPrompt;
    const installBtn = document.getElementById('install-btn');

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        installBtn.classList.remove('hidden');
    });

    installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        installBtn.classList.add('hidden');
    });

    window.addEventListener('appinstalled', () => {
        installBtn.classList.add('hidden');
        deferredPrompt = null;
    });

    // WhatsApp Elements
    const mediaUpload = document.getElementById('media-upload');
    const wpPreviewContainer = document.getElementById('wp-preview-container');
    const wpStatus = document.getElementById('wp-status');
    const wpProgress = document.getElementById('wp-progress');
    const processWpBtn = document.getElementById('process-wp-btn');
    const wpResult = document.getElementById('wp-result');
    const wpDownloadLink = document.getElementById('wp-download-link');
    const wpShareBtn = document.getElementById('wp-share-btn');

    let selectedFile = null;
    let isVideo = false;

    mediaUpload.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            selectedFile = e.target.files[0];
            isVideo = selectedFile.type.startsWith('video/');
            wpStatus.textContent = `Selected ${isVideo ? 'Video' : 'Photo'}: ${selectedFile.name}`;
            wpProgress.textContent = '';
            wpPreviewContainer.classList.remove('hidden');
            wpResult.classList.add('hidden');
            processWpBtn.classList.remove('hidden');
            processWpBtn.textContent = isVideo ? 'Process & Optimize Video' : 'Optimize Photo';
        }
    });

    processWpBtn.addEventListener('click', async () => {
        if (!selectedFile) return;
        processWpBtn.classList.add('hidden');
        const startTime = Date.now();

        // Show ad only if 12-hour cooldown has passed
        tryShowAdWithCooldown();

        try {
            if (isVideo) {
                // --- Step 1: Probe video to decide processing path ---
                wpStatus.textContent = 'Analyzing video...';
                wpProgress.textContent = '';

                let meta;
                try {
                    meta = await probeVideo(selectedFile);
                } catch {
                    // Fallback: if probing fails, assume re-encode is needed
                    meta = { width: 9999, height: 9999, duration: 0, sizeMB: selectedFile.size / (1024 * 1024) };
                }

                const needsResize = meta.height > 720;
                const needsCompress = meta.sizeMB > 16;
                const needsReencode = needsResize || needsCompress;

                wpStatus.textContent = 'Loading video engine (first time may take a moment)...';
                const ff = await loadFFmpeg();

                wpStatus.textContent = 'Reading file...';
                const inputName = 'input.mp4';
                const outputName = 'output.mp4';
                await ff.writeFile(inputName, await fetchFile(selectedFile));

                if (needsReencode) {
                    // --- Full re-encode (only when actually needed) ---
                    const reason = needsResize && needsCompress
                        ? 'Resizing & compressing'
                        : needsResize ? 'Resizing to 720p' : 'Compressing to fit WhatsApp limit';
                    wpStatus.textContent = `${reason} for WhatsApp...`;

                    await ff.exec([
                        '-i', inputName,
                        '-vf', "scale=-2:'min(720,ih)'",
                        '-c:v', 'libx264',
                        '-b:v', '1500k',
                        '-maxrate', '1500k',
                        '-bufsize', '3000k',
                        '-preset', 'ultrafast',
                        '-c:a', 'aac',
                        '-b:a', '128k',
                        '-movflags', '+faststart',
                        outputName
                    ]);
                } else {
                    // --- Fast remux: no re-encoding needed! ---
                    wpStatus.textContent = 'Repackaging for WhatsApp (fast mode)...';
                    wpProgress.textContent = '';

                    await ff.exec([
                        '-i', inputName,
                        '-c', 'copy',
                        '-movflags', '+faststart',
                        outputName
                    ]);
                }

                const data = await ff.readFile(outputName);
                lastOptimizedBlob = new Blob([data.buffer], { type: 'video/mp4' });
                lastOptimizedFileName = `Pics_Optimized_${selectedFile.name}`;

                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                const originalMB = (selectedFile.size / (1024 * 1024)).toFixed(1);
                const newMB = (lastOptimizedBlob.size / (1024 * 1024)).toFixed(1);
                const mode = needsReencode ? 'compressed' : 'repackaged (fast)';

                wpStatus.textContent = `Video ${mode} in ${elapsed}s! ${originalMB}MB → ${newMB}MB`;
                wpProgress.textContent = '';
                wpDownloadLink.href = URL.createObjectURL(lastOptimizedBlob);
                wpDownloadLink.download = lastOptimizedFileName;
                wpResult.classList.remove('hidden');

                await ff.deleteFile(inputName);
                await ff.deleteFile(outputName);

            } else {
                wpStatus.textContent = 'Optimizing photo...';
                wpProgress.textContent = 'Processing...';

                lastOptimizedBlob = await optimizeImage(selectedFile, 1920, 1920, 0.92);
                const baseName = selectedFile.name.replace(/\.[^.]+$/, '');
                lastOptimizedFileName = `Pics_Optimized_${baseName}.jpg`;

                const originalKB = Math.round(selectedFile.size / 1024);
                const newKB = Math.round(lastOptimizedBlob.size / 1024);

                wpStatus.textContent = `Photo optimized! ${originalKB}KB → ${newKB}KB`;
                wpProgress.textContent = '';
                wpDownloadLink.href = URL.createObjectURL(lastOptimizedBlob);
                wpDownloadLink.download = lastOptimizedFileName;
                wpResult.classList.remove('hidden');
            }
        } catch (error) {
            console.error(error);
            wpStatus.textContent = 'Error during optimization. Try refreshing the page or use Chrome/Edge on desktop.';
            wpProgress.textContent = '';
        } finally {
            processWpBtn.classList.remove('hidden');
        }
    });

    wpShareBtn.addEventListener('click', async () => {
        if (!lastOptimizedBlob) return;
        wpShareBtn.textContent = 'Opening share...';
        await shareToWhatsApp(lastOptimizedBlob, lastOptimizedFileName);
        wpShareBtn.textContent = 'Share to WhatsApp';
    });

    // TikTok Downloader
    const tiktokUrlInput = document.getElementById('tiktok-url');
    const downloadTiktokBtn = document.getElementById('download-tiktok-btn');
    const tkResult = document.getElementById('tk-result');
    const tkStatus = document.getElementById('tk-status');
    const tkDownloadLink = document.getElementById('tk-download-link');

    downloadTiktokBtn.addEventListener('click', async () => {
        const url = tiktokUrlInput.value.trim();
        if (!url) return;

        tkStatus.textContent = 'Fetching video...';
        tkResult.classList.remove('hidden');
        tkDownloadLink.classList.add('hidden');
        downloadTiktokBtn.disabled = true;

        // Show ad only if 12-hour cooldown has passed
        tryShowAdWithCooldown();

        try {
            const response = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`);
            const json = await response.json();
            if (json.code !== 0) throw new Error('Invalid URL');

            const videoUrl = json.data.play;
            try {
                const vidResponse = await fetch(videoUrl);
                const blob = await vidResponse.blob();
                tkDownloadLink.href = URL.createObjectURL(blob);
                tkDownloadLink.download = 'Pics_TikTok.mp4';
            } catch {
                tkDownloadLink.href = videoUrl;
                tkDownloadLink.target = '_blank';
                tkDownloadLink.removeAttribute('download');
            }

            tkStatus.textContent = 'Video ready!';
            tkDownloadLink.classList.remove('hidden');
        } catch (error) {
            console.error(error);
            tkStatus.textContent = 'Failed to fetch video. Check the URL and try again.';
        } finally {
            downloadTiktokBtn.disabled = false;
        }
    });
});
