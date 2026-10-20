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
        const pct = Math.round(progress * 100);
        wpProgress.textContent = `Processing: ${pct}%`;
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
                (blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error('Failed to compress image'));
                },
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

// ---------- Share to WhatsApp via Web Share API ----------
async function shareToWhatsApp(blob, fileName) {
    const file = new File([blob], fileName, { type: blob.type });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({
                files: [file],
                title: 'Pics Optimized Media',
                text: 'Optimized with Pics'
            });
            return true;
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Share failed:', err);
            }
            return false;
        }
    } else {
        // Fallback: open WhatsApp web
        alert('Direct sharing is not supported on this browser. Please download the file and share it manually.');
        return false;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // PWA Service Worker Registration
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('Service Worker registered', reg))
            .catch(err => console.error('Service Worker registration failed', err));
    }

    // PWA Install Prompt
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
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`Install prompt outcome: ${outcome}`);
        deferredPrompt = null;
        installBtn.classList.add('hidden');
    });

    window.addEventListener('appinstalled', () => {
        installBtn.classList.add('hidden');
        deferredPrompt = null;
        console.log('Pics PWA installed!');
    });

    // WhatsApp Optimization Elements
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
            const fileType = isVideo ? 'Video' : 'Photo';
            wpStatus.textContent = `Selected ${fileType}: ${selectedFile.name}`;
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
                // ----- Video: use FFmpeg.wasm (fast settings) -----
                wpStatus.textContent = 'Loading video engine (first time may take a moment)...';
                wpProgress.textContent = '';

                let ff;
                try {
                    ff = await loadFFmpeg();
                } catch (loadErr) {
                    console.error('FFmpeg load error:', loadErr);
                    wpStatus.textContent = 'Could not load video engine. Try refreshing the page or use a desktop browser (Chrome/Edge).';
                    wpProgress.textContent = '';
                    processWpBtn.classList.remove('hidden');
                    return;
                }

                wpStatus.textContent = 'Reading file...';
                const inputName = 'input.mp4';
                const outputName = 'output.mp4';

                await ff.writeFile(inputName, await fetchFile(selectedFile));

                wpStatus.textContent = 'Optimizing for WhatsApp (fast mode)...';
                await ff.exec([
                    '-i', inputName,
                    '-vf', "scale=-2:'min(480,ih)'",
                    '-c:v', 'libx264',
                    '-crf', '28',
                    '-preset', 'ultrafast',
                    '-tune', 'fastdecode',
                    '-movflags', '+faststart',
                    '-c:a', 'aac',
                    '-b:a', '96k',
                    '-ac', '1',
                    '-threads', '4',
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

                const url = URL.createObjectURL(lastOptimizedBlob);
                wpDownloadLink.href = url;
                wpDownloadLink.download = lastOptimizedFileName;
                wpResult.classList.remove('hidden');

                await ff.deleteFile(inputName);
                await ff.deleteFile(outputName);

            } else {
                // ----- Image: use Canvas API -----
                wpStatus.textContent = 'Optimizing photo...';
                wpProgress.textContent = 'Processing...';

                lastOptimizedBlob = await optimizeImage(selectedFile, 1920, 1920, 0.92);
                const ext = selectedFile.name.lastIndexOf('.') !== -1
                    ? selectedFile.name.substring(0, selectedFile.name.lastIndexOf('.'))
                    : selectedFile.name;
                lastOptimizedFileName = `Pics_Optimized_${ext}.jpg`;

                const url = URL.createObjectURL(lastOptimizedBlob);
                const originalKB = Math.round(selectedFile.size / 1024);
                const newKB = Math.round(lastOptimizedBlob.size / 1024);

                wpStatus.textContent = `Photo optimized! ${originalKB}KB → ${newKB}KB`;
                wpProgress.textContent = '';
                wpDownloadLink.href = url;
                wpDownloadLink.download = lastOptimizedFileName;
                wpResult.classList.remove('hidden');
            }
        } catch (error) {
            console.error(error);
            wpStatus.textContent = 'Error during optimization. Try a smaller file or refresh the page.';
            wpProgress.textContent = '';
        } finally {
            processWpBtn.classList.remove('hidden');
        }
    });

    // Share to WhatsApp button
    wpShareBtn.addEventListener('click', async () => {
        if (!lastOptimizedBlob) return;
        wpShareBtn.textContent = 'Opening share...';
        await shareToWhatsApp(lastOptimizedBlob, lastOptimizedFileName);
        wpShareBtn.textContent = 'Share to WhatsApp';
    });

    // TikTok Downloader Elements
    const tiktokUrlInput = document.getElementById('tiktok-url');
    const downloadTiktokBtn = document.getElementById('download-tiktok-btn');
    const tkResult = document.getElementById('tk-result');
    const tkStatus = document.getElementById('tk-status');
    const tkDownloadLink = document.getElementById('tk-download-link');

    downloadTiktokBtn.addEventListener('click', async () => {
        const url = tiktokUrlInput.value.trim();
        if (!url) return;

        tkStatus.textContent = 'Fetching video from public API...';
        tkResult.classList.remove('hidden');
        tkDownloadLink.classList.add('hidden');
        downloadTiktokBtn.disabled = true;

        try {
            const response = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`);
            const json = await response.json();

            if (json.code !== 0) throw new Error('Could not fetch video. Invalid URL or API limits.');

            const videoUrl = json.data.play;

            tkStatus.textContent = 'Preparing direct download link...';

            try {
                const vidResponse = await fetch(videoUrl);
                const blob = await vidResponse.blob();
                const blobUrl = URL.createObjectURL(blob);
                tkDownloadLink.href = blobUrl;
                tkDownloadLink.download = 'Pics_TikTok.mp4';
            } catch (blobErr) {
                console.warn('CORS blocked blob fetch, using direct link fallback');
                tkDownloadLink.href = videoUrl;
                tkDownloadLink.target = '_blank';
                tkDownloadLink.removeAttribute('download');
            }

            tkStatus.textContent = 'Video ready!';
            tkDownloadLink.classList.remove('hidden');
        } catch (error) {
            console.error(error);
            tkStatus.textContent = 'Failed to fetch video. Ensure the URL is correct.';
        } finally {
            downloadTiktokBtn.disabled = false;
        }
    });
});
