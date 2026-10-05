# ============================================================
# 天枢 · 智能运维中枢平台（Tianshu IOC）— 一键推送到 GitHub
# 用法（在本目录打开 PowerShell）：
#   .\推送GitHub.ps1 -RepoUrl https://github.com/<你的用户名>/tianshu-ioc-platform.git
#   .\推送GitHub.ps1 -RepoUrl git@github.com:<你的用户名>/tianshu-ioc-platform.git -Branch main
# ============================================================
param(
  [Parameter(Mandatory = $true)][string]$RepoUrl,
  [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path (Join-Path $PWD '.git'))) {
  Write-Host '[错误] 当前目录不是 git 仓库（缺少 .git），请先运行：git init -b main && git add -A && git commit -m "init"' -ForegroundColor Red
  exit 1
}

# 重新绑定 origin（可重复执行）
git remote remove origin 2>$null
git remote add origin $RepoUrl
git branch -M $Branch

Write-Host "==> 正在推送到 $RepoUrl （分支 $Branch）…" -ForegroundColor Cyan
git push -u origin $Branch

if ($LASTEXITCODE -eq 0) {
  Write-Host '==> 推送完成！刷新 GitHub 仓库页面即可看到代码。' -ForegroundColor Green
} else {
  Write-Host '[错误] 推送失败，请对照《GitHub提交帮助-全流程.md》第 8 节排错。' -ForegroundColor Red
  exit 1
}
