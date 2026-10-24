# Servidor local do AERO MULT-MR ELEMENTS (sem dependências: só o PowerShell do Windows).
# Uso:  powershell -ExecutionPolicy Bypass -File iniciar.ps1 [-Porta 8765] [-SemNavegador]
# Serve os arquivos desta pasta em http://localhost:<Porta>/ e grava o estado em dados\estado.json.
param([int]$Porta = 8765, [switch]$SemNavegador)

$ErrorActionPreference = 'Stop'
$raiz = [IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path))
$dados = Join-Path $raiz 'dados'
New-Item -ItemType Directory -Force $dados | Out-Null
$estado = Join-Path $dados 'estado.json'
$utf8 = New-Object System.Text.UTF8Encoding $false

$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'; '.svg' = 'image/svg+xml'
  '.png' = 'image/png'; '.ico' = 'image/x-icon'; '.dat' = 'text/plain; charset=utf-8'; '.csv' = 'text/csv; charset=utf-8'
  '.md' = 'text/markdown; charset=utf-8'; '.txt' = 'text/plain; charset=utf-8'
  '.ttf' = 'font/ttf'; '.otf' = 'font/otf'; '.woff' = 'font/woff'; '.woff2' = 'font/woff2'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Porta/")
try { $listener.Start() } catch { Write-Host "Não foi possível abrir a porta $Porta. Tente: iniciar.ps1 -Porta 8766"; exit 1 }
Write-Host "AERO MULT-MR ELEMENTS em http://localhost:$Porta/  (Ctrl+C para encerrar)"
Write-Host "Dados gravados em: $estado"
if (-not $SemNavegador) { Start-Process "http://localhost:$Porta/" }

function Send($ctx, [int]$code, [byte[]]$bytes, [string]$type) {
  $r = $ctx.Response
  $r.StatusCode = $code
  $r.ContentType = $type
  $r.Headers['Cache-Control'] = 'no-store'
  $r.ContentLength64 = $bytes.Length
  $r.OutputStream.Write($bytes, 0, $bytes.Length)
  $r.OutputStream.Close()
}

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $req = $ctx.Request
    $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath)
    if ($path -eq '/api/estado') {
      if ($req.HttpMethod -eq 'GET') {
        if (Test-Path $estado) { Send $ctx 200 ([IO.File]::ReadAllBytes($estado)) 'application/json; charset=utf-8' }
        else { Send $ctx 404 $utf8.GetBytes('{}') 'application/json' }
      } elseif ($req.HttpMethod -eq 'PUT' -or $req.HttpMethod -eq 'POST') {
        $sr = New-Object IO.StreamReader($req.InputStream, $utf8)
        $body = $sr.ReadToEnd(); $sr.Close()
        if (Test-Path $estado) { Copy-Item $estado (Join-Path $dados 'estado.anterior.json') -Force }
        [IO.File]::WriteAllText($estado, $body, $utf8)
        Send $ctx 200 $utf8.GetBytes('{"ok":true}') 'application/json'
      } else { Send $ctx 405 $utf8.GetBytes('') 'text/plain' }
      continue
    }
    if ($path -eq '/api/info') { Send $ctx 200 $utf8.GetBytes((@{ arquivo = $estado; servidor = 'powershell' } | ConvertTo-Json)) 'application/json'; continue }
    $rel = $path.TrimStart('/')
    if ($rel -eq '') { $rel = 'index.html' }
    $full = [IO.Path]::GetFullPath((Join-Path $raiz $rel))
    if (-not $full.StartsWith($raiz) -or $full.StartsWith($dados)) { Send $ctx 403 $utf8.GetBytes('proibido') 'text/plain'; continue }
    if (Test-Path $full -PathType Container) { $full = Join-Path $full 'index.html' }
    if (Test-Path $full -PathType Leaf) {
      $ext = [IO.Path]::GetExtension($full).ToLower()
      $type = $mime[$ext]; if (-not $type) { $type = 'application/octet-stream' }
      Send $ctx 200 ([IO.File]::ReadAllBytes($full)) $type
    } else { Send $ctx 404 $utf8.GetBytes('não encontrado') 'text/plain; charset=utf-8' }
  } catch {
    try { Send $ctx 500 $utf8.GetBytes("erro: $_") 'text/plain; charset=utf-8' } catch {}
  }
}
