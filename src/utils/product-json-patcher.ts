import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as fssync from 'node:fs';
import * as path from 'node:path';
import { showPermissionErrorRestartPrompt, showPatchSuccessRestartPrompt } from './restart-helper';

export interface PatchResult {
  success: boolean;
  message: string;
  path?: string;
  error?: unknown;
}

interface ProductJson {
  extensionEnabledApiProposals?: Record<string, string[]>;
  [k: string]: any;
}

function getCandidateProductJsonPaths(): string[] {
  const appRoot = vscode.env.appRoot;
  const candidates = [
    path.join(appRoot, 'product.json'),
    path.join(appRoot, 'resources', 'app', 'product.json'),
    path.join(path.dirname(appRoot), 'resources', 'app', 'product.json'),
  ];
  // Deduplicate while preserving order
  return Array.from(new Set(candidates));
}

async function firstExistingPath(paths: string[]): Promise<string | null> {
  for (const p of paths) {
    try {
      await fs.access(p);
      return p;
    } catch {
      // continue
    }
  }
  return null;
}

async function readJson(filePath: string): Promise<ProductJson> {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function writeJsonWithBackup(filePath: string, data: any): Promise<void> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(dir, `${base}.bak.${ts}`);
  try {
    // Make a backup copy using streams to preserve permissions
    await fs.copyFile(filePath, backup);
  } catch {
    // Ignore backup failures, still try to write
  }
  const content = JSON.stringify(data, null, 2) + '\n';
  await fs.writeFile(filePath, content, 'utf8');
}

function isPermissionError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as any).code;
  return code === 'EACCES' || code === 'EPERM';
}

export async function ensureApiProposalsEnabled(
  extensionId: string,
  proposals: string[]
): Promise<PatchResult> {
  try {
    const productPath = await firstExistingPath(getCandidateProductJsonPaths());
    if (!productPath) {
      return { success: false, message: '未找到 product.json 路径（不同发行版路径可能不同）' };
    }

    const product = await readJson(productPath);
    if (!product.extensionEnabledApiProposals) {
      product.extensionEnabledApiProposals = {};
    }

    const current = product.extensionEnabledApiProposals[extensionId] ?? [];
    const next = Array.from(new Set([...current, ...proposals]));

    // If nothing to change
    if (current.length === next.length && current.every((v, i) => v === next[i])) {
      return { success: true, message: '已启用所需 API Proposals（无需更改）', path: productPath };
    }

    product.extensionEnabledApiProposals[extensionId] = next;

    await writeJsonWithBackup(productPath, product);
    return { success: true, message: '已写入 product.json，并创建备份', path: productPath };
  } catch (err) {
    if (isPermissionError(err)) {
      return { success: false, message: '写入被拒绝：需要以管理员/root 权限运行 VS Code 后重试', error: err };
    }
    return { success: false, message: '修改 product.json 失败', error: err };
  }
}

export async function checkApiProposals(
  extensionId: string,
  proposals: string[]
): Promise<{ ok: boolean; path?: string; reason?: string }> {
  const productPath = await firstExistingPath(getCandidateProductJsonPaths());
  if (!productPath) return { ok: false, reason: '找不到 product.json' };

  try {
    const product = await readJson(productPath);
    const enabled = product.extensionEnabledApiProposals?.[extensionId] ?? [];
    const ok = proposals.every(p => enabled.includes(p));
    return { ok, path: productPath, reason: ok ? undefined : '缺少所需 API Proposals' };
  } catch (err) {
    return { ok: false, path: productPath, reason: '读取或解析 product.json 失败' };
  }
}

export async function promptAndPatchIfNeeded(
  extensionId: string,
  proposals: string[]
): Promise<void> {
  const check = await checkApiProposals(extensionId, proposals);
  if (check.ok) return;

  const selection = await vscode.window.showWarningMessage(
    '需要修改 VS Code 的 product.json 以启用提案 API（可能触发“安装不受支持/已损坏”的提示）。是否现在修复？',
    '一键修复',
    '忽略'
  );
  if (selection !== '一键修复') return;

  const res = await ensureApiProposalsEnabled(extensionId, proposals);
  if (res.success) {
    // 成功时显示重启提示
    await showPatchSuccessRestartPrompt(res.path);
  } else {
    if (isPermissionError(res.error)) {
      // 权限错误时显示重启指导
      await showPermissionErrorRestartPrompt();
    } else {
      // 其他错误的传统处理方式
      const detail = '请检查发行版 product.json 路径或权限。';
      vscode.window.showErrorMessage(`❌ ${res.message}`, { modal: false }, '查看详情').then(() => {});
      vscode.window.showInformationMessage(detail);
    }
  }
}

