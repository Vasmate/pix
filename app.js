let lastOptimizedBlob = null;
let lastOptimizedFileName = '';

// ---------- Video compression via Canvas + MediaRecorder (works everywhere) ----------
function compressVideo(file, onProgress) {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        const url = URL.createObjectURL(file);
        video.src = url;

        video.onloadedmetadata = () => {
            let width = video.videoWidth;
            let height = video.videoHeight;
            const maxH = 480;
            if (height > maxH) {
                const ratio = maxH / height;
                width = Math.round(width * ratio);
                height = maxH;
            }
            width = width % 2 === 0 ? width : width + 1;
            height = height % 2 === 0 ? height : height + 1;

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');

            const stream = canvas.captureStream(30);

            // Try to capture audio
            try {
                const audioCtx = new AudioContext();
                const source = audioCtx.createMediaElementSource(video);
                const dest = audioCtx.createMediaStreamDestination();
                source.connect(dest);
                source.connect(audioCtx.destination);
                dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
            } catch (e) {
                console.warn('Audio capture not supported:', e);
            }

            let mimeType = 'video/webm';
            if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
                mimeType = 'video/webm;codecs=vp9';
            } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) {
                mimeType = 'video/webm;codecs=vp8';
            } else if (MediaRecorder.isTypeSupported('video/mp4')) {
                mimeType = 'video/mp4';
            }

            const recorder = new MediaRecorder(stream, {
                mimeType,
                videoBitsPerSecond: 1000000
            });

            const chunks = [];
            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunks.push(e.data);
            };

            recorder.onstop = () => {
                URL.revokeObjectURL(url);
                const isMP4 = mimeType.includes('mp4');
                const blob = new Blob(chunks, { type: isMP4 ? 'video/mp4' : 'video/webm' });
                resolve({ blob, extension: isMP4 ? 'mp4' : 'webm' });
            };

            recorder.onerror = (e) => {
                URL.revokeObjectURL(url);
                reject(new Error('Recording failed'));
            };

            const duration = video.duration;
            recorder.start(100);

            function drawFrame() {
                if (video.ended || video.paused) {
                    recorder.stop();
                    return;
                }
                ctx.drawImage(video, 0, 0, width, height);
                if (onProgress && duration) {
                    onProgress(video.currentTime / duration);
                }
                requestAnimationFrame(drawFrame);
            }

            video.onended = () => recorder.stop();
            video.play().then(drawFrame).catch(reject);
        };

        video.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Could not load video file'));
        };
    });
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
    // PWA Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('SW registered', reg))
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
                wpStatus.textContent = 'Optimizing video...';
                wpProgress.textContent = 'Starting...';

                const result = await compressVideo(selectedFile, (progress) => {
                    wpProgress.textContent = `Processing: ${Math.round(progress * 100)}%`;
                });

                lastOptimizedBlob = result.blob;
                const baseName = selectedFile.name.replace(/\.[^.]+$/, '');
                lastOptimizedFileName = `Pics_Optimized_${baseName}.${result.extension}`;

                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                const originalMB = (selectedFile.size / (1024 * 1024)).toFixed(1);
                const newMB = (lastOptimizedBlob.size / (1024 * 1024)).toFixed(1);

                wpStatus.textContent = `Video optimized in ${elapsed}s! ${originalMB}MB → ${newMB}MB`;
                wpProgress.textContent = '';

                wpDownloadLink.href = URL.createObjectURL(lastOptimizedBlob);
                wpDownloadLink.download = lastOptimizedFileName;
                wpResult.classList.remove('hidden');

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
            wpStatus.textContent = 'Error during optimization. Try a smaller file or refresh the page.';
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
