const { FFmpeg } = FFmpegWASM;
const { fetchFile } = FFmpegUtil;

let ffmpeg = null;
let lastOptimizedBlob = null;
let lastOptimizedFileName = '';

async function loadFFmpeg() {
    if (ffmpeg) return ffmpeg;
    ffmpeg = new FFmpeg();
    ffmpeg.on('progress', ({ progress }) => {
        const wpProgress = document.getElementById('wp-progress');
        wpProgress.textContent = `Processing: ${Math.round(progress * 100)}%`;
    });
    await ffmpeg.load({
        coreURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
        wasmURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm',
    });
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

        try {
            if (isVideo) {
                wpStatus.textContent = 'Loading video engine (first time may take a moment)...';
                wpProgress.textContent = '';

                const ff = await loadFFmpeg();

                wpStatus.textContent = 'Reading file...';
                const inputName = 'input.mp4';
                const outputName = 'output.mp4';
                await ff.writeFile(inputName, await fetchFile(selectedFile));

                wpStatus.textContent = 'Optimizing for WhatsApp...';
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
                    outputName
                ]);

                const data = await ff.readFile(outputName);
                lastOptimizedBlob = new Blob([data.buffer], { type: 'video/mp4' });
                lastOptimizedFileName = `Pics_Optimized_${selectedFile.name}`;

                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                const originalMB = (selectedFile.size / (1024 * 1024)).toFixed(1);
                const newMB = (lastOptimizedBlob.size / (1024 * 1024)).toFixed(1);

                wpStatus.textContent = `Video optimized in ${elapsed}s! ${originalMB}MB → ${newMB}MB`;
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
