import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as sudo from '@vscode/sudo-prompt';
import { Logger } from './logger';

/**
 * 简化的 product.json 修补工具
 * 集成权限提升和重启功能，遵循 KISS 原则
 */

const logger = Logger.getInstance();

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
  logger.info('🔐 开始尝试权限提升修改 product.json');
  logger.info(`📋 扩展ID: ${extensionId}`);
  logger.info(`📋 需要的API提案: ${proposals.join(', ')}`);

  return new Promise(async (resolve) => {
    try {
      const productPath = await firstExistingPath(getCandidateProductJsonPaths());
      if (!productPath) {
        logger.error('❌ 未找到 product.json 路径');
        resolve({ success: false, message: '未找到 product.json 路径' });
        return;
      }

      logger.info(`📁 找到 product.json 路径: ${productPath}`);

      const content = await fs.readFile(productPath, 'utf8');
      logger.debug(`📄 读取到 product.json 内容，长度: ${content.length} 字符`);

      const product: ProductJson = JSON.parse(content);
      logger.debug('✅ product.json 解析成功');

      if (!product.extensionEnabledApiProposals) {
        product.extensionEnabledApiProposals = {};
        logger.info('📝 创建 extensionEnabledApiProposals 字段');
      }

      const current = product.extensionEnabledApiProposals[extensionId] ?? [];
      const next = Array.from(new Set([...current, ...proposals]));

      logger.info(`📊 当前已启用的API提案: ${current.join(', ') || '无'}`);
      logger.info(`📊 合并后的API提案: ${next.join(', ')}`);

      if (current.length === next.length && current.every((v, i) => v === next[i])) {
        logger.info('✅ API提案已经启用，无需更改');
        resolve({ success: true, message: '已启用所需 API Proposals（无需更改）', path: productPath });
        return;
      }

      product.extensionEnabledApiProposals[extensionId] = next;
      const newContent = JSON.stringify(product, null, 2) + '\n';
      const backupPath = `${productPath}.bak.${new Date().toISOString().replace(/[:.]/g, '-')}`;

      logger.info('📝 准备修改 product.json');
      logger.info(`💾 备份路径: ${backupPath}`);
      logger.debug(`📄 新内容长度: ${newContent.length} 字符`);

      // 先用 Node.js fs API 写入临时文件
      const tempPath = path.join(os.tmpdir(), `product-${Date.now()}.json`);
      logger.info(`📁 临时文件路径: ${tempPath}`);

      try {
        await fs.writeFile(tempPath, newContent, 'utf8');
        logger.info('✅ 临时文件写入成功');
      } catch (tempError) {
        logger.error('❌ 临时文件写入失败', tempError as Error);
        resolve({ success: false, message: '临时文件创建失败', error: tempError });
        return;
      }

      // 构建跨平台复制命令（只做复制操作）
      const platform = process.platform;
      logger.info(`🖥️ 检测到平台: ${platform}`);
      let command: string;

      if (platform === 'win32') {
        const escapedProductPath = productPath.replace(/'/g, "''");
        const escapedBackupPath = backupPath.replace(/'/g, "''");
        const escapedTempPath = tempPath.replace(/'/g, "''");

        command = `powershell -Command "try { Copy-Item '${escapedProductPath}' '${escapedBackupPath}' -ErrorAction SilentlyContinue; Copy-Item '${escapedTempPath}' '${escapedProductPath}' -Force } catch { Write-Host 'ERROR:' $_.Exception.Message }"`;
      } else {
        const escapedProductPath = productPath.replace(/'/g, "'\"'\"'");
        const escapedBackupPath = backupPath.replace(/'/g, "'\"'\"'");
        const escapedTempPath = tempPath.replace(/'/g, "'\"'\"'");

        command = `sh -c "cp '${escapedProductPath}' '${escapedBackupPath}' 2>/dev/null || true && cp '${escapedTempPath}' '${escapedProductPath}'"`;
      }

      logger.debug(`🔧 执行命令: ${command.substring(0, 100)}...`);

      logger.info('🔐 开始执行权限提升命令...');

      sudo.exec(command, { name: 'Cometix Tab VS Code Configuration' }, async (error, stdout, stderr) => {
        logger.info('📋 权限提升命令执行完成');

        // 清理临时文件
        try {
          await fs.unlink(tempPath);
          logger.info('🗑️ 临时文件清理成功');
        } catch (cleanupError) {
          logger.warn('⚠️ 临时文件清理失败', cleanupError);
        }

        if (error) {
          logger.error('❌ 权限提升失败', error);
          logger.error('🔍 错误详细信息:');
          logger.error(`  🚨 错误类型: ${error.constructor.name}`);
          logger.error(`  📝 错误消息: ${error.message || '无消息'}`);
          logger.error(`  📊 错误代码: ${(error as any).code || '无代码'}`);
          logger.error(`  📋 错误堆栈: ${error.stack || '无堆栈'}`);

          resolve({ success: false, message: '获取管理员权限失败或用户取消操作', error });
          return;
        }

        logger.info('✅ 权限提升命令执行成功');
        logger.debug(`📤 stdout: ${stdout || '无输出'}`);
        logger.debug(`📤 stderr: ${stderr || '无错误输出'}`);

        // 检查是否有错误输出
        if (stderr && stderr.includes('ERROR:')) {
          logger.error('❌ 修改过程中发生错误');
          logger.error(`📤 错误输出: ${stderr}`);
          resolve({ success: false, message: '修改时发生错误', error: new Error(String(stderr)) });
        } else {
          logger.info('🎉 product.json 修改成功！');
          resolve({ success: true, message: '已成功修改 product.json 并创建备份', path: productPath });
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
  logger.info('🚀 开始 product.json 修补流程');
  logger.info(`📋 扩展ID: ${extensionId}`);
  logger.info(`📋 需要的API提案: ${proposals.join(', ')}`);

  // 检查是否已经启用
  const check = await checkApiProposals(extensionId, proposals);
  if (check.ok) {
    logger.info('✅ API提案已经启用，无需修改');
    return;
  }

  logger.info('📝 需要修改 product.json，开始尝试普通权限修改');

  // 首先尝试普通权限
  const normalResult = await tryNormalPatch(extensionId, proposals);
  if (normalResult.success) {
    logger.info('✅ 普通权限修改成功');
    // 成功 - 显示重启提示
    const restart = await vscode.window.showInformationMessage(
      `✅ ${normalResult.message}\n⚠️ 需要重启 VS Code 才能使 API 提案生效。`,
      '立即重启',
      '稍后重启'
    );
    if (restart === '立即重启') {
      logger.info('🔄 用户选择立即重启');
      await restartVSCode();
    } else {
      logger.info('⏰ 用户选择稍后重启');
    }
    return;
  }

  logger.warn('⚠️ 普通权限修改失败');
  logger.error('❌ 普通权限修改错误详情:', normalResult.error as Error);

  // 如果是权限错误，尝试权限提升
  if (isPermissionError(normalResult.error)) {
    logger.info('🔐 检测到权限错误，准备尝试权限提升');
    const elevate = await vscode.window.showWarningMessage(
      '需要管理员权限修改 VS Code 的 product.json 以启用提案 API。\n\n点击"获取管理员权限"将弹出系统权限对话框。',
      '获取管理员权限',
      '忽略'
    );

    if (elevate === '获取管理员权限') {
      logger.info('👤 用户选择获取管理员权限');

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: '正在获取管理员权限...',
        cancellable: false
      }, async (progress) => {
        progress.report({ message: '请在系统对话框中确认权限请求' });
        logger.info('⏳ 显示权限获取进度提示');

        const elevatedResult = await tryElevatedPatch(extensionId, proposals);

        if (elevatedResult.success) {
          logger.info('🎉 权限提升修改成功！');
          const restart = await vscode.window.showInformationMessage(
            `✅ ${elevatedResult.message}\n⚠️ 需要重启 VS Code 才能使 API 提案生效。`,
            '立即重启',
            '稍后重启'
          );
          if (restart === '立即重启') {
            logger.info('🔄 用户选择立即重启（权限提升后）');
            await restartVSCode();
          } else {
            logger.info('⏰ 用户选择稍后重启（权限提升后）');
          }
        } else {
          logger.error('❌ 权限提升修改失败');
          logger.error('❌ 权限提升失败详情:', elevatedResult.error as Error);
          vscode.window.showErrorMessage(`❌ ${elevatedResult.message}`);
        }
      });
    } else {
      logger.info('👤 用户选择忽略权限提升');
    }
  } else {
    logger.error('❌ 非权限错误，无法通过权限提升解决');
    logger.error('❌ 错误详情:', normalResult.error as Error);
    // 其他错误
    vscode.window.showErrorMessage(`❌ ${normalResult.message}`);
  }
}
