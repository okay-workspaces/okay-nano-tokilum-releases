#!/usr/bin/env node
/**
 * generate-latest-json.mjs
 *
 * 从各平台的构建产物（安装包 + .sig 签名文件）组合生成 latest.json，
 * 供 tauri-plugin-updater 的 endpoint 使用。
 *
 * 环境变量（由 GitHub Actions 传入）：
 *   TAG          - 本次发布的 tag，如 v1.1.0
 *   RELEASE_REPO - 公开 releases 仓库，如 okay-workspaces/okay-nano-tokilum-releases
 *   APP_NAME     - 应用名，如 okay-nano-tokilum（用于匹配文件名）
 *
 * 运行后在当前目录生成 latest.json。
 */

import { readdirSync, readFileSync, writeFileSync } from 'fs'
import { join, extname, basename } from 'path'

const TAG         = process.env.TAG          || ''
const RELEASE_REPO = process.env.RELEASE_REPO || ''
const APP_NAME    = process.env.APP_NAME     || ''

if (!TAG || !RELEASE_REPO) {
  console.error('缺少环境变量 TAG 或 RELEASE_REPO')
  process.exit(1)
}

const VERSION = TAG.startsWith('v') ? TAG.slice(1) : TAG
const BASE_URL = `https://github.com/${RELEASE_REPO}/releases/download/${TAG}`
const ARTIFACTS_DIR = 'artifacts'

// ─── 平台 → 对应 updater 下载文件的后缀优先级 ─────────────────────────────
// v2 updater 格式（createUpdaterArtifacts: true）：直接签名安装包本体
//   Windows: *-setup.exe（NSIS，优先）/ .msi（WiX）
//   macOS:   .app.tar.gz
//   Linux:   .AppImage
const PLATFORM_PATTERNS = {
  'windows-x86_64': ['-setup.exe', '.msi'],
  'darwin-x86_64':  ['.app.tar.gz'],
  'darwin-aarch64': ['.app.tar.gz'],
  'linux-x86_64':   ['.AppImage'],
}

const platforms = {}

for (const [platform, patterns] of Object.entries(PLATFORM_PATTERNS)) {
  const artifactDir = join(ARTIFACTS_DIR, `artifacts-${platform}`)

  let files
  try {
    files = readdirSync(artifactDir)
  } catch {
    console.warn(`[skip] ${platform}：目录不存在 ${artifactDir}`)
    continue
  }

  // 按优先级找安装包
  let installerFile = null
  for (const pattern of patterns) {
    installerFile = files.find(f => f.endsWith(pattern) && !f.endsWith('.sig'))
    if (installerFile) break
  }

  if (!installerFile) {
    console.warn(`[skip] ${platform}：未找到匹配的安装包文件（${patterns.join(', ')}）`)
    continue
  }

  const sigFile = `${installerFile}.sig`
  if (!files.includes(sigFile)) {
    console.warn(`[skip] ${platform}：找不到签名文件 ${sigFile}`)
    continue
  }

  const signature = readFileSync(join(artifactDir, sigFile), 'utf8').trim()
  // Tauri 打包时将 productName 中的空格替换为点号（如 "Nano Tokilum" → "Nano.Tokilum"），
  // 确保 URL 中的文件名与实际上传的文件名一致，避免 404。
  const urlFileName = installerFile.replace(/ /g, '.')
  const url = `${BASE_URL}/${urlFileName}`

  platforms[platform] = { signature, url }
  console.log(`[ok] ${platform}: ${urlFileName}`)
}

if (Object.keys(platforms).length === 0) {
  console.error('没有任何平台的产物，latest.json 生成失败')
  process.exit(1)
}

// ─── 读取 release notes（从 CHANGELOG.md 提取，可选）──────────────────────
let notes = ''
try {
  // Changesets 将 CHANGELOG 写在 apps/desktop 下，不在仓库根目录
  const changelog = readFileSync('apps/desktop/CHANGELOG.md', 'utf8')
  const match = changelog.match(
    new RegExp(`##\\s+\\[?${VERSION.replace(/\./g, '\\.')}\\]?[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)`)
  )
  notes = match ? match[1].trim() : ''
} catch {
  // CHANGELOG.md 不存在则留空
}

const latestJson = {
  version: VERSION,
  notes,
  pub_date: new Date().toISOString(),
  platforms,
}

writeFileSync('latest.json', JSON.stringify(latestJson, null, 2))
console.log('\n生成 latest.json：')
console.log(JSON.stringify(latestJson, null, 2))
