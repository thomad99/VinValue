Param(
  [string]$RepoUrl = "https://github.com/thomad99/VinValue.git",
  [string]$Branch = "main",
  [int]$IntervalSeconds = 60,
  [switch]$SkipEmptyCommits
)

if (!(Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Error "git is not installed or not on PATH. Install Git for Windows first: https://git-scm.com/download/win"
  exit 1
}

if (!(Test-Path .git)) { git init }

if (!(Test-Path .gitignore)) {
  @(
    "node_modules/",
    ".DS_Store",
    "npm-debug.log*",
    "yarn-debug.log*",
    "yarn-error.log*",
    ".env",
    ".playwright/",
    "playwright-report/",
    "test-results/"
  ) | Out-File -Encoding utf8 .gitignore
}

# Ensure branch and remote
git branch -M $Branch
if (git remote get-url origin 2>$null) {
  git remote set-url origin $RepoUrl
} else {
  git remote add origin $RepoUrl
}

Write-Host "Auto-sync enabled. Pushing to $RepoUrl ($Branch) every $IntervalSeconds seconds." -ForegroundColor Cyan

while ($true) {
  try {
    git add -A | Out-Null

    $hasHead = $true
    git rev-parse --verify HEAD 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { $hasHead = $false }

    $status = git status --porcelain
    $changedCount = if ([string]::IsNullOrWhiteSpace($status)) { 0 } else { ($status -split "`n").Count }

    if (-not $hasHead) {
      Write-Host "First push: committing initial files ($changedCount files)." -ForegroundColor Green
      git commit -m "Initial commit" | Out-Null
      git push -u origin $Branch | Out-Null
      Write-Host "Upload complete." -ForegroundColor Green
    } elseif ($SkipEmptyCommits -and $changedCount -eq 0) {
      Write-Host ("No updates required.") -ForegroundColor Blue
    } else {
      if ($changedCount -eq 0) {
        Write-Host "No detected file changes; creating empty sync commit." -ForegroundColor Blue
      } else {
        Write-Host ("{0} files changed. Uploading..." -f $changedCount) -ForegroundColor Green
      }
      git commit -m "Sync" --allow-empty | Out-Null
      git push -u origin $Branch | Out-Null
      Write-Host "Upload complete." -ForegroundColor Green
    }
  } catch {
    Write-Host ("Push failed: {0}" -f $_.Exception.Message) -ForegroundColor Red
  }

  for ($i = $IntervalSeconds; $i -gt 0; $i--) {
    Write-Host ("Sleeping {0}s ... Press Ctrl+C to stop" -f $i) -ForegroundColor DarkCyan -NoNewline
    Start-Sleep -Seconds 1
    Write-Host "`r" -NoNewline
  }
  Write-Host ""
}

