# Lanza el modelo local (llama.cpp) y la generación de explicaciones en segundo plano,
# con prioridad baja y registro en la carpeta de logs. Se puede repetir: continúa donde lo dejó.
param(
  [string]$Datos = $(if ($env:ALLIMITE_DATA) { $env:ALLIMITE_DATA } else { "C:\Users\anton\data\slayhacks" }),
  [string]$Servidor = "$Datos\tools\llama-vulkan\llama-server.exe",
  [string]$Modelo = "$Datos\models\Qwen3-4B-Q4_K_M.gguf"
)
$repo = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force "$Datos\logs" | Out-Null
if (-not (Get-Process llama-server -ErrorAction SilentlyContinue)) {
  $s = Start-Process -FilePath $Servidor -WindowStyle Hidden -PassThru `
    -ArgumentList '-m', $Modelo, '--host', '127.0.0.1', '--port', '8089', '-c', '4096', '-t', '4', '--parallel', '1', '-ngl', '99' `
    -RedirectStandardOutput "$Datos\logs\llama_server.log" -RedirectStandardError "$Datos\logs\llama_server.err.log"
  $s.PriorityClass = 'BelowNormal'
  Start-Sleep 30
}
$p = Start-Process -FilePath python -ArgumentList '-m', 'allimite.explain' -WorkingDirectory $repo -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput "$Datos\logs\explain.log" -RedirectStandardError "$Datos\logs\explain.err.log"
$p.PriorityClass = 'BelowNormal'
"Generando explicaciones (PID $($p.Id)). Progreso: Get-Content $Datos\logs\explain.log -Tail 3"
