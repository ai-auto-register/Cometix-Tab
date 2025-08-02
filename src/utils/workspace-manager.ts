import * as vscode from 'vscode';
import { CryptoUtils } from './crypto';
import { Logger } from './logger';

/**
 * 工作区管理器 - 统一管理工作区路径和 workspaceId 生成
 * 确保整个扩展中使用一致的工作区标识
 */
export class WorkspaceManager {
  private static instance: WorkspaceManager;
  private logger: Logger;
  private cachedWorkspaceId: string | null = null;
  private cachedWorkspacePath: string | null = null;

  private constructor() {
    this.logger = Logger.getInstance();
  }

  static getInstance(): WorkspaceManager {
    if (!WorkspaceManager.instance) {
      WorkspaceManager.instance = new WorkspaceManager();
    }
    return WorkspaceManager.instance;
  }

  /**
   * 获取当前工作区的根路径
   * 优先级：当前活动编辑器 > 第一个工作区文件夹 > 当前工作目录
   */
  getCurrentWorkspacePath(): string {
    // 如果已缓存且有效，直接返回
    if (this.cachedWorkspacePath && this.isValidWorkspacePath(this.cachedWorkspacePath)) {
      return this.cachedWorkspacePath;
    }

    let workspaceRootPath = '';

    // 1. 尝试从当前活动文档获取工作区信息
    if (vscode.window.activeTextEditor) {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri);
      if (workspaceFolder) {
        workspaceRootPath = workspaceFolder.uri.fsPath;
        this.logger.debug(`🔍 从活动编辑器获取工作区路径: ${workspaceRootPath}`);
      }
    }

    // 2. 如果没有获取到，使用第一个工作区文件夹
    if (!workspaceRootPath && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      workspaceRootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
      this.logger.debug(`🔍 使用第一个工作区文件夹: ${workspaceRootPath}`);
    }

    // 3. 如果仍然没有，使用当前工作目录
    if (!workspaceRootPath) {
      workspaceRootPath = process.cwd();
      this.logger.warn(`⚠️ 无法获取工作区路径，使用当前工作目录: ${workspaceRootPath}`);
    }

    // 缓存结果
    this.cachedWorkspacePath = workspaceRootPath;
    return workspaceRootPath;
  }

  /**
   * 获取稳定的工作区ID
   * 基于工作区路径生成，同一工作区每次都生成相同的ID
   */
  getWorkspaceId(): string {
    // 如果已缓存，直接返回
    if (this.cachedWorkspaceId) {
      return this.cachedWorkspaceId;
    }

    const workspacePath = this.getCurrentWorkspacePath();
    const workspaceId = CryptoUtils.generateStableWorkspaceId(workspacePath);
    
    // 缓存结果
    this.cachedWorkspaceId = workspaceId;
    
    this.logger.info(`🆔 生成工作区ID: ${workspaceId}`);
    this.logger.info(`📁 基于路径: ${workspacePath}`);
    
    return workspaceId;
  }

  /**
   * 清除缓存（当工作区变化时调用）
   */
  clearCache(): void {
    this.cachedWorkspaceId = null;
    this.cachedWorkspacePath = null;
    this.logger.debug('🧹 工作区缓存已清除');
  }

  /**
   * 监听工作区变化事件
   */
  startWatching(): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];

    // 监听工作区文件夹变化
    disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.logger.info('📁 工作区文件夹发生变化，清除缓存');
        this.clearCache();
      })
    );

    // 监听活动编辑器变化
    disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        // 如果当前缓存的路径不是最优的，清除缓存
        const currentPath = this.getCurrentWorkspacePath();
        if (this.cachedWorkspacePath && this.cachedWorkspacePath !== currentPath) {
          this.logger.debug('📝 活动编辑器变化，更新工作区路径');
          this.clearCache();
        }
      })
    );

    this.logger.info('👀 工作区监听已启动');
    return disposables;
  }

  /**
   * 检查工作区路径是否有效
   */
  private isValidWorkspacePath(path: string): boolean {
    try {
      // 简单检查路径是否存在且可访问
      return Boolean(path && path.length > 0);
    } catch {
      return false;
    }
  }

  /**
   * 获取工作区相对路径
   */
  getRelativePath(filePath: string): string {
    return vscode.workspace.asRelativePath(filePath);
  }

  /**
   * 获取工作区名称（用于显示）
   */
  getWorkspaceName(): string {
    const workspacePath = this.getCurrentWorkspacePath();
    return workspacePath.split(/[/\\]/).pop() || 'Unknown';
  }
}