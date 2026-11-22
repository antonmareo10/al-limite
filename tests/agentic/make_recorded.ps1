# Rebuilds site/runs/recorded.json from the runs kept in docs/agentic-runs/2026-11-22.
# Run from the repository root:  powershell -File tests/agentic/make_recorded.ps1
$r = "docs\agentic-runs\2026-11-22"
$m8 = "Qwen3-8B (Q4_K_M, llama.cpp, laptop)"
$m4 = "Qwen3-4B (Q4_K_M, llama.cpp, laptop)"
$here = "a local copy of this site // una copia local de esta web"
python -I tests\agentic\make_recorded.py site\runs\recorded.json `
  "$r\qwen3-8b-site\run.json|1|Both agents, checked twice // Los dos agentes, revisado dos veces|$here|$m8" `
  "$r\qwen3-8b-second-site\run.json|1|Called from another site: Pide el expediente fills in a transparency request // Desde otro sitio: Pide el expediente rellena una solicitud de transparencia|a local copy of Pide el expediente, which loaded this site's live network after the consent card // una copia local de Pide el expediente, que cargó la red publicada de esta web tras la tarjeta de consentimiento|$m8" `
  "$r\qwen3-8b-site-2\run.json|2|The ranking, every ratio with its interval // El ranking, cada razón con su intervalo|$here|$m8" `
  "$r\qwen3-4b-site-same-chat\run.json|1|Flagged: a small model left out the caveat // Marcada: un modelo pequeño omitió la cautela|$here|$m4" `
  "$r\qwen3-8b-site-2\run.json|4|Asked to name a company, it declines // Se le pide nombrar una empresa y no lo hace|$here|$m8"
