import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as sudo from '@vscode/sudo-prompt';

/**
 * 简化的 product.json 修补工具
 * 集成权限提升和重启功能，遵循 KISS 原则
 */

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

/**
 * 获取候选的 product.json 路径
 */
function getCandidateProductJsonPaths(): string[] {
  const appRoot = vscode.env.appRoot;
  const candidates = [
    path.join(appRoot, 'product.json'),
    path.join(appRoot, 'resources', 'app', 'product.json'),
    path.join(path.dirname(appRoot), 'resources', 'app', 'product.json'),
  ];
  return Array.from(new Set(candidates));
}

/**
 * 查找第一个存在的路径
 */
async function firstExistingPath(paths: string[]): Promise<string | null> {
  for (const p of paths) {
    try {
      await fs.access(p);
      return p;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * 检测是否为权限错误
 */
function isPermissionError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as any).code;
  return code === 'EACCES' || code === 'EPERM';
}

/**
 * 重启 VS Code
 */
async function restartVSCode(): Promise<void> {
  try {
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
  } catch (error) {
    console.error('重启失败:', error);
    vscode.window.showErrorMessage('重启失败，请手动重启 VS Code');
  }
}

/**
 * 尝试普通权限修改 product.json
 */
async function tryNormalPatch(
  extensionId: string,
  proposals: string[]
): Promise<PatchResult> {
  try {
    const productPath = await firstExistingPath(getCandidateProductJsonPaths());
    if (!productPath) {
      return { success: false, message: '未找到 product.json 路径' };
    }

    const content = await fs.readFile(productPath, 'utf8');
    const product: ProductJson = JSON.parse(content);

    if (!product.extensionEnabledApiProposals) {
      product.extensionEnabledApiProposals = {};
    }

    const current = product.extensionEnabledApiProposals[extensionId] ?? [];
    const next = Array.from(new Set([...current, ...proposals]));

    // 检查是否需要修改
    if (current.length === next.length && current.every((v, i) => v === next[i])) {
      return { success: true, message: '已启用所需 API Proposals（无需更改）', path: productPath };
    }

    // 更新并写入
    product.extensionEnabledApiProposals[extensionId] = next;
    
    // 创建备份
    const backup = `${productPath}.bak.${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await fs.copyFile(productPath, backup).catch(() => {}); // 忽略备份失败
    
    // 写入新内容
    const newContent = JSON.stringify(product, null, 2) + '\n';
    await fs.writeFile(productPath, newContent, 'utf8');
    
    return { success: true, message: '已修改 product.json 并创建备份', path: productPath };
  } catch (err) {
    return { 
      success: false, 
      message: isPermissionError(err) ? '需要管理员权限' : '修改失败', 
      error: err 
    };
  }
}

/**
 * 使用提升权限修改 product.json
 */
async function tryElevatedPatch(
  extensionId: string,
  proposals: string[]
): Promise<PatchResult> {
  return new Promise(async (resolve) => {
    try {
      const productPath = await firstExistingPath(getCandidateProductJsonPaths());
      if (!productPath) {
        resolve({ success: false, message: '未找到 product.json 路径' });
        return;
      }

      const content = await fs.readFile(productPath, 'utf8');
      const product: ProductJson = JSON.parse(content);

      if (!product.extensionEnabledApiProposals) {
        product.extensionEnabledApiProposals = {};
      }

      const current = product.extensionEnabledApiProposals[extensionId] ?? [];
      const next = Array.from(new Set([...current, ...proposals]));

      if (current.length === next.length && current.every((v, i) => v === next[i])) {
        resolve({ success: true, message: '已启用所需 API Proposals（无需更改）', path: productPath });
        return;
      }

      product.extensionEnabledApiProposals[extensionId] = next;
      const newContent = JSON.stringify(product, null, 2) + '\n';
      const backupPath = `${productPath}.bak.${new Date().toISOString().replace(/[:.]/g, '-')}`;

      // 构建跨平台命令
      const platform = process.platform;
      let command: string;

      if (platform === 'win32') {
        const escapedProductPath = productPath.replace(/'/g, "''");
        const escapedBackupPath = backupPath.replace(/'/g, "''");
        const escapedContent = newContent.replace(/'/g, "''").replace(/\r?\n/g, '`n');
        
        command = `powershell -Command "try { Copy-Item '${escapedProductPath}' '${escapedBackupPath}' -ErrorAction SilentlyContinue; Set-Content -Path '${escapedProductPath}' -Value '${escapedContent}' -Encoding UTF8; Write-Host 'SUCCESS' } catch { Write-Host 'ERROR:' $_.Exception.Message }"`;
      } else {
        const escapedProductPath = productPath.replace(/'/g, "'\"'\"'");
        const escapedBackupPath = backupPath.replace(/'/g, "'\"'\"'");
        const escapedContent = newContent.replace(/'/g, "'\"'\"'");
        
        command = `sh -c "cp '${escapedProductPath}' '${escapedBackupPath}' 2>/dev/null || true && echo '${escapedContent}' > '${escapedProductPath}' && echo 'SUCCESS'"`;
      }

      sudo.exec(command, { name: 'Cometix Tab - 修改 VS Code 配置' }, (error, stdout, stderr) => {
        if (error) {
          resolve({ success: false, message: '获取管理员权限失败或用户取消操作', error });
          return;
        }

        if (stdout && stdout.includes('SUCCESS')) {
          resolve({ success: true, message: '已成功修改 product.json 并创建备份', path: productPath });
        } else {
          resolve({ success: false, message: '修改时发生错误', error: new Error(stderr || '未知错误') });
        }
      });
    } catch (error) {
      resolve({ success: false, message: '修改失败', error });
    }
  });
}

/**
 * 检查 API 提案是否已启用
 */
export async function checkApiProposals(
  extensionId: string,
  proposals: string[]
): Promise<{ ok: boolean; path?: string; reason?: string }> {
  const productPath = await firstExistingPath(getCandidateProductJsonPaths());
  if (!productPath) return { ok: false, reason: '找不到 product.json' };

  try {
    const content = await fs.readFile(productPath, 'utf8');
    const product: ProductJson = JSON.parse(content);
    const enabled = product.extensionEnabledApiProposals?.[extensionId] ?? [];
    const ok = proposals.every(p => enabled.includes(p));
    return { ok, path: productPath, reason: ok ? undefined : '缺少所需 API Proposals' };
  } catch (err) {
    return { ok: false, path: productPath, reason: '读取或解析失败' };
  }
}

/**
 * 主要的修补函数 - 自动处理权限提升和重启
 */
export async function promptAndPatchIfNeeded(
  extensionId: string,
  proposals: string[]
): Promise<void> {
  // 检查是否已经启用
  const check = await checkApiProposals(extensionId, proposals);
  if (check.ok) return;

  // 首先尝试普通权限
  const normalResult = await tryNormalPatch(extensionId, proposals);
  if (normalResult.success) {
    // 成功 - 显示重启提示
    const restart = await vscode.window.showInformationMessage(
      `✅ ${normalResult.message}\n⚠️ 需要重启 VS Code 才能使 API 提案生效。`,
      '立即重启',
      '稍后重启'
    );
    if (restart === '立即重启') {
      await restartVSCode();
    }
    return;
  }

  // 如果是权限错误，尝试权限提升
  if (isPermissionError(normalResult.error)) {
    const elevate = await vscode.window.showWarningMessage(
      '需要管理员权限修改 VS Code 的 product.json 以启用提案 API。\n\n点击"获取管理员权限"将弹出系统权限对话框。',
      '获取管理员权限',
      '忽略'
    );

    if (elevate === '获取管理员权限') {
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: '正在获取管理员权限...',
        cancellable: false
      }, async (progress) => {
        progress.report({ message: '请在系统对话框中确认权限请求' });
        
        const elevatedResult = await tryElevatedPatch(extensionId, proposals);
        
        if (elevatedResult.success) {
          const restart = await vscode.window.showInformationMessage(
            `✅ ${elevatedResult.message}\n⚠️ 需要重启 VS Code 才能使 API 提案生效。`,
            '立即重启',
            '稍后重启'
          );
          if (restart === '立即重启') {
            await restartVSCode();
          }
        } else {
          vscode.window.showErrorMessage(`❌ ${elevatedResult.message}`);
        }
      });
    }
  } else {
    // 其他错误
    vscode.window.showErrorMessage(`❌ ${normalResult.message}`);
  }
}
