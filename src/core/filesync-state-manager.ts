import { Logger } from '../utils/logger';
import type { FileInfo } from '../types';
import { FSUploadFileResponse, FSUploadErrorType } from '../generated/fs_pb';

/**
 * 文件同步状态信息
 */
export interface FileSyncState {
  path: string;
  workspaceId: string;
  uuid: string;
  modelVersion: number;
  sha256Hash: string;
  uploadTime: number;
  successful: boolean;
  lastContent?: string; // 🔧 添加最后同步的内容，用于计算差异
}

/**
 * 文件同步状态管理器
 * 
 * 负责跟踪文件上传状态，确保补全请求时能够正确引用文件缓存
 */
export class FileSyncStateManager {
  private logger: Logger;
  private syncStates = new Map<string, FileSyncState>();

  constructor() {
    this.logger = Logger.getInstance();
  }

  /**
   * 记录文件上传成功状态
   */
  recordUploadSuccess(
    fileInfo: FileInfo, 
    workspaceId: string, 
    uuid: string, 
    response: FSUploadFileResponse
  ): void {
    const state: FileSyncState = {
      path: fileInfo.path,
      workspaceId,
      uuid,
      modelVersion: fileInfo.modelVersion || 0, // 使用上传时的版本号
      sha256Hash: fileInfo.sha256 || '',
      uploadTime: Date.now(),
      successful: response.error === FSUploadErrorType.FS_UPLOAD_ERROR_TYPE_UNSPECIFIED, // 无错误表示成功
      lastContent: fileInfo.content // 🔧 保存文件内容以便后续计算差异
    };

    this.syncStates.set(fileInfo.path, state);
    
    this.logger.info('📝 记录文件同步状态:');
    this.logger.info(`  📄 文件: ${state.path}`);
    this.logger.info(`  🆔 工作区: ${state.workspaceId}`);
    this.logger.info(`  📦 UUID: ${state.uuid}`);
    this.logger.info(`  🔢 版本: ${state.modelVersion}`);
    this.logger.info(`  🔐 哈希: ${state.sha256Hash.substring(0, 16)}...`);
    this.logger.info(`  ✅ 成功: ${state.successful}`);
  }

  /**
   * 获取文件同步状态
   */
  getFileSyncState(filePath: string): FileSyncState | undefined {
    return this.syncStates.get(filePath);
  }

  /**
   * 获取文件最后同步的内容，用于计算增量差异
   */
  getLastSyncedContent(filePath: string): string | null {
    const state = this.syncStates.get(filePath);
    return state?.lastContent || null;
  }

  /**
   * 检查文件是否可以进行增量同步
   */
  canPerformIncrementalSync(filePath: string): boolean {
    const state = this.syncStates.get(filePath);
    return !!(state?.successful && state?.lastContent);
  }

  /**
   * 检查文件是否已成功同步且版本匹配
   */
  isFileSynced(fileInfo: FileInfo, workspaceId: string): boolean {
    const state = this.syncStates.get(fileInfo.path);
    if (!state || !state.successful) {
      return false;
    }

    // 检查工作区ID是否匹配
    if (state.workspaceId !== workspaceId) {
      this.logger.warn(`⚠️ 工作区ID不匹配: 缓存=${state.workspaceId}, 请求=${workspaceId}`);
      return false;
    }

    // 检查文件哈希是否匹配
    if (state.sha256Hash !== fileInfo.sha256) {
      this.logger.warn(`⚠️ 文件哈希不匹配: 缓存=${state.sha256Hash.substring(0, 16)}..., 当前=${fileInfo.sha256?.substring(0, 16)}...`);
      return false;
    }

    // 检查上传时间是否过期 (超过1小时重新上传)
    const age = Date.now() - state.uploadTime;
    if (age > 60 * 60 * 1000) {
      this.logger.warn(`⚠️ 文件同步状态过期: ${Math.round(age / 1000 / 60)} 分钟前上传`);
      return false;
    }

    return true;
  }

  /**
   * 为补全请求构建文件版本信息
   */
  buildFileVersionInfo(filePath: string): { fileVersion: number; sha256Hash: string } | null {
    const state = this.syncStates.get(filePath);
    if (!state || !state.successful) {
      return null;
    }

    return {
      fileVersion: state.modelVersion,
      sha256Hash: state.sha256Hash
    };
  }

  /**
   * 清理过期的同步状态
   */
  cleanup(): void {
    const now = Date.now();
    const expiredPaths: string[] = [];

    for (const [path, state] of this.syncStates.entries()) {
      // 清理超过2小时的状态
      if (now - state.uploadTime > 2 * 60 * 60 * 1000) {
        expiredPaths.push(path);
      }
    }

    if (expiredPaths.length > 0) {
      this.logger.info(`🧹 清理 ${expiredPaths.length} 个过期的文件同步状态`);
      expiredPaths.forEach(path => this.syncStates.delete(path));
    }
  }

  /**
   * 移除文件同步状态
   */
  removeFileSyncState(filePath: string): void {
    if (this.syncStates.delete(filePath)) {
      this.logger.debug(`🗑️ 移除文件同步状态: ${filePath}`);
    }
  }

  /**
   * 获取所有同步状态的统计信息
   */
  getStats(): { total: number; successful: number; failed: number } {
    let successful = 0;
    let failed = 0;

    for (const state of this.syncStates.values()) {
      if (state.successful) {
        successful++;
      } else {
        failed++;
      }
    }

    return {
      total: this.syncStates.size,
      successful,
      failed
    };
  }
}