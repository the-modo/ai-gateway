param(
    [int]$Port = 3000,
    [string]$Root = ".\dashboard"
)

$mime = @{
    '.html'  = 'text/html; charset=utf-8'
    '.css'   = 'text/css'
    '.js'    = 'application/javascript'
    '.mjs'   = 'application/javascript'
    '.json'  = 'application/json'
    '.svg'   = 'image/svg+xml'
    '.png'   = 'image/png'
    '.jpg'   = 'image/jpeg'
    '.jpeg'  = 'image/jpeg'
    '.ico'   = 'image/x-icon'
    '.woff'  = 'font/woff'
    '.woff2' = 'font/woff2'
    '.ttf'   = 'font/ttf'
    '.txt'   = 'text/plain'
    '.xml'   = 'application/xml'
}

$Root = (Resolve-Path $Root).Path
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()

while ($listener.IsListening) {
    try {
        $ctx = $listener.GetContext()
    } catch { break }

    $localPath = $ctx.Request.Url.LocalPath.TrimStart('/')
    if ($localPath -eq '') { $localPath = 'index.html' }

    $filePath = Join-Path $Root $localPath

    # Directory → try index.html inside it
    if ((Test-Path $filePath) -and (Get-Item $filePath).PSIsContainer) {
        $filePath = Join-Path $filePath 'index.html'
    }

    $res = $ctx.Response
    if (Test-Path $filePath) {
        $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
        $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
        $bytes = [System.IO.File]::ReadAllBytes($filePath)
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
        $res.StatusCode = 404
        $body = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
        $res.ContentLength64 = $body.Length
        $res.OutputStream.Write($body, 0, $body.Length)
    }
    $res.Close()
}
