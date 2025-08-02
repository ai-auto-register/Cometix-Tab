import * as vscode from 'vscode';
import { Logger } from './logger';
import { CursorApiClient } from '../core/api-client';
import type { FileInfo } from '../types';
import { FileSyncStateManager } from '../core/filesync-state-manager';

/**
 * 批处理补丁项
 */
interface BatchPatchItem {
  uri: string;
  changes: vscode.TextDocumentContentChangeEvent[];
  timestamp: number;
  priority: 'low' | 'medium' | 'high';
}

/**
 * 批处理同步结果
 */
interface BatchSyncResult {
  success: boolean;
  processedCount: number;
  errorCount: number;
  totalSize: number;
  duration: number;
}

/**
 * 批处理增量同步管理器
 * 
 * 实现智能批处理策略，优化网络传输和服务器压力：
 * 1. 收集编辑变化到批次队列
 * 2. 基于大小、时间、优先级触发批处理
 * 3. 合并相同文件的多个变化
 * 4. 压缩和优化传输数据
 */
export class BatchSyncManager {
  private logger: Logger;
  private apiClient: CursorApiClient;
  private fileSyncStateManager: FileSyncStateManager;
  
  // 批处理队列
  private pendingPatches = new Map<string, BatchPatchItem>();
  private flushTimer: NodeJS.Timeout | null = null;
  
  // 配置参数
  private readonly BATCH_SIZE_LIMIT = 1024 * 8; // 8KB 批处理阈值
  private readonly FLUSH_INTERVAL = 500; // 500ms 强制刷新间隔
  private readonly MAX_BATCH_ITEMS = 10; // 最大批处理项目数
  private readonly PRIORITY_FLUSH_INTERVAL = 200; // 高优先级快速刷新
  
  // 性能监控
  private stats = {
    totalBatches: 0,
    totalPatches: 0,
    totalBytes: 0,
    successfulBatches: 0,
    averageLatency: 0
  };

  constructor(apiClient: CursorApiClient, fileSyncStateManager: FileSyncStateManager) {
    this.logger = Logger.getInstance();
    this.apiClient = apiClient;
    this.fileSyncStateManager = fileSyncStateManager;
  }

  /**
   * 添加变化到批处理队列
   */
  addChangesToBatch(
    document: vscode.TextDocument,
    changes: readonly vscode.TextDocumentContentChangeEvent[],
    priority: 'low' | 'medium' | 'high' = 'medium'
  ): void {
    const uri = document.uri.toString();
    const now = Date.now();
    
    // 获取或创建批处理项
    let batchItem = this.pendingPatches.get(uri);
    if (!batchItem) {
      batchItem = {
        uri,
        changes: [],
        timestamp: now,
        priority
      };
      this.pendingPatches.set(uri, batchItem);
    }
    
    // 合并变化 - 智能合并策略
    const mergedChanges = this.mergeChanges(batchItem.changes, Array.from(changes));
    batchItem.changes = mergedChanges;
    batchItem.priority = this.getHigherPriority(batchItem.priority, priority);
    
    this.logger.debug(`📦 添加变化到批处理: ${uri.split('/').pop()}, 变化数: ${changes.length}, 优先级: ${priority}`);
    
    // 检查是否需要触发批处理
    this.checkFlushConditions();
  }

  /**
   * 检查刷新条件
   */
  private checkFlushConditions(): void {
    const currentSize = this.calculateBatchSize();
    const itemCount = this.pendingPatches.size;
    const hasHighPriorityItems = this.hasHighPriorityItems();
    const oldestTimestamp = this.getOldestTimestamp();
    const timeSinceOldest = Date.now() - oldestTimestamp;
    
    // 触发刷新的条件
    const shouldFlush = 
      currentSize >= this.BATCH_SIZE_LIMIT ||                    // 大小超过阈值
      itemCount >= this.MAX_BATCH_ITEMS ||                      // 项目数超过阈值
      timeSinceOldest >= this.FLUSH_INTERVAL ||                 // 时间超过间隔
      (hasHighPriorityItems && timeSinceOldest >= this.PRIORITY_FLUSH_INTERVAL); // 高优先级快速刷新
    
    if (shouldFlush) {
      this.logger.debug(`🚀 触发批处理: 大小=${currentSize}B, 项目=${itemCount}, 时间=${timeSinceOldest}ms, 高优先级=${hasHighPriorityItems}`);
      this.flushBatch();
    } else {
      // 设置定时器确保最终会刷新
      this.scheduleFlush();
    }
  }

  /**
   * 计算当前批次大小
   */
  private calculateBatchSize(): number {
    let totalSize = 0;
    for (const item of this.pendingPatches.values()) {
      for (const change of item.changes) {
        totalSize += change.text.length + (change.rangeLength || 0);
      }
    }
    return totalSize;
  }

  /**
   * 检查是否有高优先级项目
   */
  private hasHighPriorityItems(): boolean {
    return Array.from(this.pendingPatches.values()).some(item => item.priority === 'high');
  }

  /**
   * 获取最旧的时间戳
   */
  private getOldestTimestamp(): number {
    let oldest = Date.now();
    for (const item of this.pendingPatches.values()) {
      if (item.timestamp < oldest) {
        oldest = item.timestamp;
      }
    }
    return oldest;
  }

  /**
   * 设置定时器刷新
   */
  private scheduleFlush(): void {
    if (this.flushTimer) return; // 已经有定时器了
    
    const hasHighPriority = this.hasHighPriorityItems();
    const interval = hasHighPriority ? this.PRIORITY_FLUSH_INTERVAL : this.FLUSH_INTERVAL;
    
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushBatch();
    }, interval);
  }

  /**
   * 执行批处理刷新
   */
  private async flushBatch(): Promise<BatchSyncResult> {
    if (this.pendingPatches.size === 0) {
      return {
        success: true,
        processedCount: 0,
        errorCount: 0,
        totalSize: 0,
        duration: 0
      };
    }

    const startTime = Date.now();
    const batchItems = Array.from(this.pendingPatches.values());
    const totalSize = this.calculateBatchSize();
    
    this.logger.info(`🔄 开始批处理同步: ${batchItems.length} 个文件, 总大小: ${totalSize} 字节`);
    
    // 清空待处理队列
    this.pendingPatches.clear();
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    let processedCount = 0;
    let errorCount = 0;

    // 按优先级排序处理
    const sortedItems = this.sortByPriority(batchItems);
    
    // 并行处理批次（限制并发数）
    const concurrencyLimit = 3;
    const promises: Promise<boolean>[] = [];
    
    for (let i = 0; i < sortedItems.length; i += concurrencyLimit) {
      const batch = sortedItems.slice(i, i + concurrencyLimit);
      const batchPromises = batch.map(item => this.processBatchItem(item));
      promises.push(...batchPromises);
    }

    const results = await Promise.allSettled(promises);
    
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        processedCount++;
      } else {
        errorCount++;
        if (result.status === 'rejected') {
          this.logger.error('批处理项目失败', result.reason);
        }
      }
    }

    const duration = Date.now() - startTime;
    const success = errorCount === 0;

    // 更新统计信息
    this.updateStats(processedCount, totalSize, duration, success);

    this.logger.info(`✅ 批处理完成: 成功=${processedCount}, 失败=${errorCount}, 用时=${duration}ms`);

    return {
      success,
      processedCount,
      errorCount,
      totalSize,
      duration
    };
  }

  /**
   * 处理单个批处理项目
   */
  private async processBatchItem(item: BatchPatchItem): Promise<boolean> {
    try {
      const uri = vscode.Uri.parse(item.uri);
      const document = await vscode.workspace.openTextDocument(uri);
      const filePath = vscode.workspace.asRelativePath(uri);
      
      // 检查是否可以进行增量同步
      if (!this.fileSyncStateManager.canPerformIncrementalSync(filePath)) {
        this.logger.debug(`⚠️ 文件无法进行增量同步，跳过: ${filePath}`);
        return false;
      }

      // 应用变化并计算新内容
      const lastContent = this.fileSyncStateManager.getLastSyncedContent(filePath);
      if (!lastContent) {
        this.logger.debug(`⚠️ 无法获取上次同步内容，跳过: ${filePath}`);
        return false;
      }

      const newContent = this.applyChangesToContent(lastContent, item.changes);
      
      // 构建增量同步请求
      const fileInfo: FileInfo = {
        path: filePath,
        content: newContent,
        sha256: '', // 临时置空，让 API 客户端计算
        modelVersion: this.fileSyncStateManager.getFileSyncState(filePath)?.modelVersion
      };

      // 执行增量同步
      const success = await this.apiClient.syncFile(fileInfo);
      
      if (success) {
        this.logger.debug(`✅ 批处理增量同步成功: ${filePath}`);
        return true;
      } else {
        this.logger.warn(`❌ 批处理增量同步失败: ${filePath}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`批处理项目处理失败: ${item.uri}`, error as Error);
      return false;
    }
  }

  /**
   * 应用变化到内容
   */
  private applyChangesToContent(
    originalContent: string,
    changes: vscode.TextDocumentContentChangeEvent[]
  ): string {
    let content = originalContent;
    
    // 按范围位置排序，从后往前应用（避免位置偏移）
    const sortedChanges = changes.sort((a, b) => {
      const aStart = a.range?.start || new vscode.Position(0, 0);
      const bStart = b.range?.start || new vscode.Position(0, 0);
      if (aStart.line !== bStart.line) {
        return bStart.line - aStart.line;
      }
      return bStart.character - aStart.character;
    });

    for (const change of sortedChanges) {
      if (change.range) {
        content = this.applyRangeChange(content, change);
      }
    }

    return content;
  }

  /**
   * 应用范围变化
   */
  private applyRangeChange(
    content: string,
    change: vscode.TextDocumentContentChangeEvent
  ): string {
    if (!change.range) return content;

    const lines = content.split('\n');
    const startLine = change.range.start.line;
    const startChar = change.range.start.character;
    const endLine = change.range.end.line;
    const endChar = change.range.end.character;

    // 构建新内容
    const beforeLines = lines.slice(0, startLine);
    const afterLines = lines.slice(endLine + 1);
    
    let modifiedLine = '';
    if (startLine < lines.length) {
      const lineContent = lines[startLine];
      const beforeRange = lineContent.substring(0, startChar);
      
      if (startLine === endLine) {
        const afterRange = lineContent.substring(endChar);
        modifiedLine = beforeRange + change.text + afterRange;
      } else {
        const lastLineContent = endLine < lines.length ? lines[endLine] : '';
        const afterRange = lastLineContent.substring(endChar);
        modifiedLine = beforeRange + change.text + afterRange;
      }
    } else {
      modifiedLine = change.text;
    }

    // 合并结果
    const result = [
      ...beforeLines,
      modifiedLine,
      ...afterLines
    ].join('\n');

    return result;
  }

  /**
   * 合并变化
   */
  private mergeChanges(
    existing: vscode.TextDocumentContentChangeEvent[],
    newChanges: vscode.TextDocumentContentChangeEvent[]
  ): vscode.TextDocumentContentChangeEvent[] {
    // 简单合并策略：按时间顺序添加
    // TODO: 可以实现更智能的合并，比如合并连续的插入操作
    return [...existing, ...newChanges];
  }

  /**
   * 获取更高的优先级
   */
  private getHigherPriority(p1: 'low' | 'medium' | 'high', p2: 'low' | 'medium' | 'high'): 'low' | 'medium' | 'high' {
    const priorities = { low: 1, medium: 2, high: 3 };
    return priorities[p1] >= priorities[p2] ? p1 : p2;
  }

  /**
   * 按优先级排序
   */
  private sortByPriority(items: BatchPatchItem[]): BatchPatchItem[] {
    const priorities = { high: 3, medium: 2, low: 1 };
    return items.sort((a, b) => priorities[b.priority] - priorities[a.priority]);
  }

  /**
   * 更新统计信息
   */
  private updateStats(processedCount: number, totalBytes: number, duration: number, success: boolean): void {
    this.stats.totalBatches++;
    this.stats.totalPatches += processedCount;
    this.stats.totalBytes += totalBytes;
    
    if (success) {
      this.stats.successfulBatches++;
    }
    
    // 更新平均延迟（指数移动平均）
    const alpha = 0.2;
    this.stats.averageLatency = alpha * duration + (1 - alpha) * this.stats.averageLatency;
  }

  /**
   * 获取统计信息
   */
  getStats(): typeof this.stats {
    return { ...this.stats };
  }

  /**
   * 强制刷新所有待处理的批次
   */
  async forceFlush(): Promise<BatchSyncResult> {
    return await this.flushBatch();
  }

  /**
   * 清理资源
   */
  dispose(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.pendingPatches.clear();
    this.logger.debug('🧹 批处理同步管理器已销毁');
  }
}

/**
 * 单例批处理同步管理器
 * 需要在扩展激活时初始化
 */
let batchSyncManagerInstance: BatchSyncManager | null = null;

export function createBatchSyncManager(apiClient: CursorApiClient, fileSyncStateManager: FileSyncStateManager): BatchSyncManager {
  if (!batchSyncManagerInstance) {
    batchSyncManagerInstance = new BatchSyncManager(apiClient, fileSyncStateManager);
  }
  return batchSyncManagerInstance;
}

export function getBatchSyncManager(): BatchSyncManager | null {
  return batchSyncManagerInstance;
}