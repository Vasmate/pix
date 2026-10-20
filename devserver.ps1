$port = 8080
$root = "c:\Users\HP\Documents\Pics frontend"

$mimeTypes = @{
    '.html' = 'text/html'
    '.css'  = 'text/css'
    '.js'   = 'application/javascript'
    '.json' = 'application/json'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
    '.mp4'  = 'video/mp4'
    '.wasm' = 'application/wasm'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://+:$port/")
$listener.Start()

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Pix Dev Server Running!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  PC:    http://localhost:$port" -ForegroundColor Yellow
Write-Host "  Phone: http://192.168.181.5:$port" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Press Ctrl+C to stop" -ForegroundColor Gray
Write-Host ""

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $urlPath = $request.Url.LocalPath
        if ($urlPath -eq '/') { $urlPath = '/index.html' }

        $filePath = Join-Path $root ($urlPath -replace '/', '\')

        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $contentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { 'application/octet-stream' }

            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentType = $contentType
            $response.ContentLength64 = $bytes.Length
            $response.StatusCode = 200
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            Write-Host "[200] $urlPath" -ForegroundColor Green
        } else {
            $response.StatusCode = 404
            $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
            $response.OutputStream.Write($msg, 0, $msg.Length)
            Write-Host "[404] $urlPath" -ForegroundColor Red
        }

        $response.OutputStream.Close()
    }
} finally {
    $listener.Stop()
}
