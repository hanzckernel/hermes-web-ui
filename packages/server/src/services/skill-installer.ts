/**
 * skill-installer — 启动时自动将 cli-response skill 安装到 Hermes / Claude Code
 *
 * 安装内容：
 *   1. push 命令 → ~/.hermes-web-ui/bin/push
 *   2. SKILL.md → ~/.claude/skills/cli-response/ (Claude Code)
 *   3. SKILL.md → ~/.hermes/hermes-agent/skills/cli-response/ (Hermes skill)
 *   4. Hermes plugin → ~/.hermes/plugins/cli-response/ (自动推送工具调用)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, copyFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { homedir } from 'os'

const execFileAsync = promisify(execFile)

function resolveSkillDir(): string {
  const candidates = [
    join(__dirname, '..', '..', '..', 'skills', 'cli-response'),
    join(__dirname, '..', '..', 'skills', 'cli-response'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return ''
}

const PUSH_BIN_DIR = join(homedir(), '.hermes-web-ui', 'bin')
const PUSH_BIN = join(PUSH_BIN_DIR, 'push')

const SKILL_TARGETS = [
  { name: 'Claude Code', dir: join(homedir(), '.claude', 'skills', 'cli-response') },
  { name: 'Hermes', dir: join(homedir(), '.hermes', 'hermes-agent', 'skills', 'cli-response') },
]

const HERMES_PLUGIN_DIR = join(homedir(), '.hermes', 'plugins', 'hermes-web-ui')

export async function installSkills(): Promise<void> {
  const skillDir = resolveSkillDir()
  if (!skillDir) {
    console.log('[Skills] cli-response source not found, skipping install')
    return
  }

  // 1. 安装 push 命令
  installPushCommand(skillDir)

  // 2. 安装 SKILL.md
  installSkillFiles(skillDir)

  // 3. 安装 Hermes 插件
  await installHermesPlugin(skillDir)
}

function installPushCommand(skillDir: string): void {
  const pushScript = join(skillDir, 'push.sh')
  if (!existsSync(pushScript)) return

  mkdirSync(PUSH_BIN_DIR, { recursive: true })
  copyFileSync(pushScript, PUSH_BIN)
  chmodSync(PUSH_BIN, 0o755)
  console.log(`[Skills] push command → ${PUSH_BIN}`)
}

function installSkillFiles(skillDir: string): void {
  const skillFile = join(skillDir, 'SKILL.md')
  if (!existsSync(skillFile)) return
  const content = readFileSync(skillFile, 'utf-8')

  for (const target of SKILL_TARGETS) {
    const targetFile = join(target.dir, 'SKILL.md')
    if (existsSync(targetFile)) {
      console.log(`[Skills] ${target.name}: SKILL.md already installed`)
      continue
    }

    try {
      mkdirSync(target.dir, { recursive: true })
      writeFileSync(targetFile, content, 'utf-8')
      console.log(`[Skills] ${target.name}: SKILL.md installed`)
    } catch (err: any) {
      console.error(`[Skills] ${target.name}: failed to install — ${err.message}`)
    }
  }
}

async function installHermesPlugin(skillDir: string): Promise<void> {
  const pluginSrc = join(skillDir, 'hermes-web-ui-plugin')
  if (!existsSync(pluginSrc)) return

  // 已安装则跳过
  if (existsSync(join(HERMES_PLUGIN_DIR, 'plugin.yaml'))) {
    console.log('[Skills] Hermes plugin: already installed')
    return
  }

  try {
    // 复制整个插件目录
    mkdirSync(HERMES_PLUGIN_DIR, { recursive: true })
    copyDirRecursive(pluginSrc, HERMES_PLUGIN_DIR)
    console.log(`[Skills] Hermes plugin → ${HERMES_PLUGIN_DIR}`)
  } catch (err: any) {
    console.error(`[Skills] Hermes plugin: failed to install — ${err.message}`)
  }
}

function copyDirRecursive(src: string, dest: string): void {
  const entries = readdirSync(src)
  for (const entry of entries) {
    const srcPath = join(src, entry)
    const destPath = join(dest, entry)
    if (statSync(srcPath).isDirectory()) {
      mkdirSync(destPath, { recursive: true })
      copyDirRecursive(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}
