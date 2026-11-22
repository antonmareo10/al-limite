# Deploys the agentic sites to their own Vercel projects, never to the original "al-limite" project.
#   site/                        -> al-limite-agent     (https://al-limite-agent.vercel.app)
#   companion/pide-el-expediente -> pide-el-expediente  (https://pide-el-expediente.vercel.app)
# It refuses to run off the agentic-web branch or with failing tests, links each folder explicitly,
# deploys to production and removes the link again, so a later "vercel deploy" in site/ on main
# cannot land in the wrong project by accident.
#   powershell -File tools/deploy_agentic.ps1 [-Only site|companion]
param([ValidateSet("all", "site", "companion")][string]$Only = "all")
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne "agentic-web") { throw "On branch '$branch'. Deploy only from agentic-web." }
npm test --silent | Out-Null
if ($LASTEXITCODE -ne 0) { throw "npm test failed: not deploying." }
$targets = @(
  @{ dir = "site"; project = "al-limite-agent"; key = "site" },
  @{ dir = "companion\pide-el-expediente"; project = "pide-el-expediente"; key = "companion" }
)
foreach ($t in $targets) {
  if ($Only -ne "all" -and $Only -ne $t.key) { continue }
  Push-Location $t.dir
  try {
    vercel link --yes --project $t.project | Out-Null
    $linked = (Get-Content .vercel\project.json | ConvertFrom-Json).projectName
    if ($linked -ne $t.project) { throw "Linked to '$linked', expected '$($t.project)'." }
    vercel deploy --prod --yes
  } finally {
    if (Test-Path .vercel) { Remove-Item -Recurse -Force .vercel }
    Pop-Location
  }
}
