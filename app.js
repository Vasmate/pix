const { FFmpeg } = FFmpegWASM;
const { fetchFile } = FFmpegUtil;

let ffmpeg = null;

async function loadFFmpeg() {
    if (ffmpeg) return ffmpeg;
    ffmpeg = new FFmpeg();
    ffmpeg.on('progress', ({ progress }) => {
        const wpProgress = document.getElementById('wp-progress');
        wpProgress.textContent = `Processing: ${Math.round(progress * 100)}%`;
    });
    // Load ffmpeg.wasm from CDN
    await ffmpeg.load({
        coreURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
        wasmURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm',
    });
    return ffmpeg;
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
        console.log('Pix PWA installed!');
    });

    // WhatsApp Optimization Elements
    const mediaUpload = document.getElementById('media-upload');
    const wpPreviewContainer = document.getElementById('wp-preview-container');
    const wpStatus = document.getElementById('wp-status');
    const wpProgress = document.getElementById('wp-progress');
    const processWpBtn = document.getElementById('process-wp-btn');
    const wpResult = document.getElementById('wp-result');
    const wpDownloadLink = document.getElementById('wp-download-link');
    
    let selectedFile = null;

    mediaUpload.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            selectedFile = e.target.files[0];
            wpStatus.textContent = `Selected: ${selectedFile.name}`;
            wpProgress.textContent = '';
            wpPreviewContainer.classList.remove('hidden');
            wpResult.classList.add('hidden');
            processWpBtn.classList.remove('hidden');
        }
    });

    processWpBtn.addEventListener('click', async () => {
        if (!selectedFile) return;

        wpStatus.textContent = 'Loading video engine...';
        processWpBtn.classList.add('hidden');

        try {
            const ff = await loadFFmpeg();
            
            wpStatus.textContent = 'Reading file...';
            const inputName = 'input.mp4';
            const outputName = 'output.mp4';
            
            await ff.writeFile(inputName, await fetchFile(selectedFile));

            wpStatus.textContent = 'Optimizing for WhatsApp...';
            // Same FFmpeg command used previously, but run entirely in browser!
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

            wpStatus.textContent = 'Finalizing...';
            const data = await ff.readFile(outputName);
            const blob = new Blob([data.buffer], { type: 'video/mp4' });
            const url = URL.createObjectURL(blob);
            
            wpStatus.textContent = 'Optimization complete!';
            wpProgress.textContent = '';
            wpDownloadLink.href = url;
            wpDownloadLink.download = `Pix_Optimized_${selectedFile.name}`;
            wpResult.classList.remove('hidden');
            
            // Cleanup memory
            await ff.deleteFile(inputName);
            await ff.deleteFile(outputName);
        } catch (error) {
            console.error(error);
            wpStatus.textContent = 'Error during optimization. Your device might be low on memory.';
            wpProgress.textContent = '';
        } finally {
            processWpBtn.classList.remove('hidden');
        }
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
            // Use TikWM public API (CORS friendly)
            const response = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`);
            const json = await response.json();
            
            if (json.code !== 0) throw new Error('Could not fetch video. Invalid URL or API limits.');

            const videoUrl = json.data.play;

            tkStatus.textContent = 'Preparing direct download link...';
            
            // TikWM URLs are sometimes CORS blocked for direct Blob fetching,
            // but we can provide the direct link with the download attribute or open in new tab.
            // Let's try fetching as blob first to force standard download dialog:
            try {
                const vidResponse = await fetch(videoUrl);
                const blob = await vidResponse.blob();
                const blobUrl = URL.createObjectURL(blob);
                tkDownloadLink.href = blobUrl;
                tkDownloadLink.download = 'Pix_TikTok.mp4';
            } catch (blobErr) {
                // Fallback to direct link if CORS blocks the blob fetch
                console.warn('CORS blocked blob fetch, using direct link fallback');
                tkDownloadLink.href = videoUrl;
                tkDownloadLink.target = '_blank'; // Open in new tab if it can't force download
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
