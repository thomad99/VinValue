Param(
  [string]$RepoUrl = "https://github.com/thomad99/VinValue.git",
  [string]$Branch = "main"
)

Write-Host "Initializing git repo and pushing to $RepoUrl ($Branch)" -ForegroundColor Cyan

if (!(Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Error "git is not installed or not on PATH. Install Git for Windows first: https://git-scm.com/download/win"
  exit 1
}

if (!(Test-Path .git)) {
  git init
}

# Create a .gitignore if missing
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

git add -A

# Create an initial commit if none
if (-not (git rev-parse --verify HEAD 2>$null)) {
  git commit -m "Initial commit"
} else {
  git commit -m "Sync" --allow-empty
}

# Set default branch
git branch -M $Branch

# Set remote
if (git remote get-url origin 2>$null) {
  git remote set-url origin $RepoUrl
} else {
  git remote add origin $RepoUrl
}

# Push
git push -u origin $Branch

Write-Host "Done. Repo pushed to $RepoUrl on branch $Branch" -ForegroundColor Green

