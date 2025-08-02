import * as vscode from 'vscode';
import { Logger } from './logger';
import { EditOperation } from './smart-edit-detector';

/**
 * 性能指标类型
 */
interface PerformanceMetrics {
  // 补全性能
  completionResponseTime: number[];
  completionAcceptanceRate: number;
  completionTriggersPerMinute: number;
  
  // 编辑性能
  editOperationCounts: Record<EditOperation, number>;
  averageDebounceTime: number;
  
  // 文件同步性能
  fileSyncSuccessRate: number;
  fileSyncResponseTime: number[];
  incrementalSyncUsageRate: number;
  
  // 批处理性能
  batchProcessingStats: {
    averageBatchSize: number;
    averageProcessingTime: number;
    successRate: number;
  };
  
  // 系统资源
  memoryUsage: number[];
  networkRequests: number;
  
  // 用户体验
  ghostTextDisplayRate: number;
  userInteractionLatency: number[];
}

/**
 * 性能警告类型
 */
interface PerformanceWarning {
  type: 'high_latency' | 'low_acceptance' | 'memory_leak' | 'network_overuse' | 'sync_failure';
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: number;
  metric?: string;
  value?: number;
  threshold?: number;
}

/**
 * 性能监控器
 * 
 * 实时监控扩展性能，检测异常并提供调优建议：
 * 1. 补全性能：响应时间、接受率、触发频率
 * 2. 编辑检测：操作统计、防抖效果
 * 3. 文件同步：成功率、响应时间、增量同步使用率
 * 4. 批处理：批次大小、处理时间、成功率
 * 5. 系统资源：内存使用、网络请求
 * 6. 用户体验：幽灵文本显示、交互延迟
 */
export class PerformanceMonitor {
  private logger: Logger;
  private metrics: PerformanceMetrics;
  private warnings: PerformanceWarning[] = [];
  private startTime: number;
  private lastReportTime: number;
  
  // 监控配置
  private readonly METRICS_RETENTION_COUNT = 100; // 保留最近100个数据点
  private readonly WARNING_RETENTION_COUNT = 50;  // 保留最近50个警告
  private readonly REPORT_INTERVAL = 300000;      // 5分钟报告间隔
  private readonly AUTO_CLEANUP_INTERVAL = 600000; // 10分钟清理间隔
  
  // 性能阈值
  private readonly THRESHOLDS = {
    COMPLETION_RESPONSE_TIME: 2000,    // 2秒
    LOW_ACCEPTANCE_RATE: 0.3,         // 30%
    HIGH_MEMORY_USAGE: 100 * 1024 * 1024, // 100MB
    HIGH_NETWORK_REQUESTS: 100,        // 每分钟100次
    SYNC_SUCCESS_RATE: 0.8,           // 80%
    USER_INTERACTION_LATENCY: 500      // 500ms
  };
  
  // 定时器
  private reportTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.logger = Logger.getInstance();
    this.startTime = Date.now();
    this.lastReportTime = this.startTime;
    
    this.metrics = {
      completionResponseTime: [],
      completionAcceptanceRate: 0.5,
      completionTriggersPerMinute: 0,
      editOperationCounts: {
        [EditOperation.TYPING]: 0,
        [EditOperation.DELETING]: 0,
        [EditOperation.PASTING]: 0,
        [EditOperation.UNDOING]: 0,
        [EditOperation.IDLE]: 0
      },
      averageDebounceTime: 150,
      fileSyncSuccessRate: 1.0,
      fileSyncResponseTime: [],
      incrementalSyncUsageRate: 0.5,
      batchProcessingStats: {
        averageBatchSize: 0,
        averageProcessingTime: 0,
        successRate: 1.0
      },
      memoryUsage: [],
      networkRequests: 0,
      ghostTextDisplayRate: 1.0,
      userInteractionLatency: []
    };
    
    this.startPeriodicReporting();
    this.startPeriodicCleanup();
    
    this.logger.info('📊 性能监控器已启动');
  }

  /**
   * 记录补全性能指标
   */
  recordCompletionMetrics(responseTime: number, accepted: boolean, triggered: boolean = true): void {
    // 记录响应时间
    this.addToArray(this.metrics.completionResponseTime, responseTime);
    
    // 更新接受率（指数移动平均）
    const alpha = 0.1;
    this.metrics.completionAcceptanceRate = 
      alpha * (accepted ? 1 : 0) + (1 - alpha) * this.metrics.completionAcceptanceRate;
    
    // 计算触发频率
    if (triggered) {
      this.updateTriggerRate();
    }
    
    // 检查性能警告
    this.checkCompletionWarnings(responseTime);
    
    this.logger.debug(`📊 补全指标: RT=${responseTime}ms, 接受=${accepted}, 接受率=${this.metrics.completionAcceptanceRate.toFixed(3)}`);
  }

  /**
   * 记录编辑操作指标
   */
  recordEditOperation(operation: EditOperation, debounceTime: number): void {
    this.metrics.editOperationCounts[operation]++;
    
    // 更新平均防抖时间
    const alpha = 0.2;
    this.metrics.averageDebounceTime = 
      alpha * debounceTime + (1 - alpha) * this.metrics.averageDebounceTime;
    
    this.logger.debug(`📊 编辑操作: ${operation}, 防抖=${debounceTime}ms`);
  }

  /**
   * 记录文件同步指标
   */
  recordFileSyncMetrics(responseTime: number, success: boolean, useIncremental: boolean): void {
    this.addToArray(this.metrics.fileSyncResponseTime, responseTime);
    
    // 更新成功率
    const alpha = 0.2;
    this.metrics.fileSyncSuccessRate = 
      alpha * (success ? 1 : 0) + (1 - alpha) * this.metrics.fileSyncSuccessRate;
    
    // 更新增量同步使用率
    this.metrics.incrementalSyncUsageRate = 
      alpha * (useIncremental ? 1 : 0) + (1 - alpha) * this.metrics.incrementalSyncUsageRate;
    
    // 检查警告
    this.checkSyncWarnings();
    
    this.logger.debug(`📊 文件同步: RT=${responseTime}ms, 成功=${success}, 增量=${useIncremental}`);
  }

  /**
   * 记录批处理性能指标
   */
  recordBatchProcessingMetrics(batchSize: number, processingTime: number, success: boolean): void {
    const stats = this.metrics.batchProcessingStats;
    const alpha = 0.3;
    
    stats.averageBatchSize = alpha * batchSize + (1 - alpha) * stats.averageBatchSize;
    stats.averageProcessingTime = alpha * processingTime + (1 - alpha) * stats.averageProcessingTime;
    stats.successRate = alpha * (success ? 1 : 0) + (1 - alpha) * stats.successRate;
    
    this.logger.debug(`📊 批处理: 大小=${batchSize}, 时间=${processingTime}ms, 成功=${success}`);
  }

  /**
   * 记录网络请求
   */
  recordNetworkRequest(): void {
    this.metrics.networkRequests++;
  }

  /**
   * 记录用户交互延迟
   */
  recordUserInteractionLatency(latency: number): void {
    this.addToArray(this.metrics.userInteractionLatency, latency);
    
    if (latency > this.THRESHOLDS.USER_INTERACTION_LATENCY) {
      this.addWarning({
        type: 'high_latency',
        message: `用户交互延迟过高: ${latency}ms (阈值: ${this.THRESHOLDS.USER_INTERACTION_LATENCY}ms)`,
        severity: latency > this.THRESHOLDS.USER_INTERACTION_LATENCY * 2 ? 'high' : 'medium',
        timestamp: Date.now(),
        metric: 'userInteractionLatency',
        value: latency,
        threshold: this.THRESHOLDS.USER_INTERACTION_LATENCY
      });
    }
  }

  /**
   * 记录幽灵文本显示率
   */
  recordGhostTextDisplay(displayed: boolean): void {
    const alpha = 0.1;
    this.metrics.ghostTextDisplayRate = 
      alpha * (displayed ? 1 : 0) + (1 - alpha) * this.metrics.ghostTextDisplayRate;
  }

  /**
   * 记录内存使用情况
   */
  recordMemoryUsage(): void {
    if (process.memoryUsage) {
      const usage = process.memoryUsage();
      this.addToArray(this.metrics.memoryUsage, usage.heapUsed);
      
      if (usage.heapUsed > this.THRESHOLDS.HIGH_MEMORY_USAGE) {
        this.addWarning({
          type: 'memory_leak',
          message: `内存使用过高: ${Math.round(usage.heapUsed / 1024 / 1024)}MB`,
          severity: usage.heapUsed > this.THRESHOLDS.HIGH_MEMORY_USAGE * 2 ? 'critical' : 'high',
          timestamp: Date.now(),
          metric: 'memoryUsage',
          value: usage.heapUsed,
          threshold: this.THRESHOLDS.HIGH_MEMORY_USAGE
        });
      }
    }
  }

  /**
   * 获取性能报告
   */
  getPerformanceReport(): {
    metrics: PerformanceMetrics;
    warnings: PerformanceWarning[];
    uptime: number;
    healthScore: number;
  } {
    const uptime = Date.now() - this.startTime;
    const healthScore = this.calculateHealthScore();
    
    return {
      metrics: this.getMetricsSummary(),
      warnings: [...this.warnings],
      uptime,
      healthScore
    };
  }

  /**
   * 获取性能调优建议
   */
  getOptimizationSuggestions(): string[] {
    const suggestions: string[] = [];
    
    // 补全性能建议
    if (this.metrics.completionAcceptanceRate < this.THRESHOLDS.LOW_ACCEPTANCE_RATE) {
      suggestions.push('💡 补全接受率较低，建议调整触发策略或增加上下文精度');
    }
    
    const avgResponseTime = this.getAverage(this.metrics.completionResponseTime);
    if (avgResponseTime > this.THRESHOLDS.COMPLETION_RESPONSE_TIME) {
      suggestions.push('💡 补全响应时间较长，建议增加防抖时间或减少上下文文件数量');
    }
    
    // 文件同步建议
    if (this.metrics.fileSyncSuccessRate < this.THRESHOLDS.SYNC_SUCCESS_RATE) {
      suggestions.push('💡 文件同步成功率较低，建议检查网络连接或增加重试机制');
    }
    
    if (this.metrics.incrementalSyncUsageRate < 0.5) {
      suggestions.push('💡 增量同步使用率较低，建议优化文件差异检测算法');
    }
    
    // 批处理建议
    if (this.metrics.batchProcessingStats.averageBatchSize < 3) {
      suggestions.push('💡 批处理效率较低，建议调整批次触发条件');
    }
    
    // 网络请求建议
    const requestsPerMinute = this.getNetworkRequestsPerMinute();
    if (requestsPerMinute > this.THRESHOLDS.HIGH_NETWORK_REQUESTS) {
      suggestions.push('💡 网络请求频率过高，建议增加缓存或批处理请求');
    }
    
    // 幽灵文本显示建议
    if (this.metrics.ghostTextDisplayRate < 0.8) {
      suggestions.push('💡 幽灵文本显示率较低，建议检查VS Code API兼容性');
    }
    
    return suggestions;
  }

  /**
   * 强制生成性能报告
   */
  generateReport(): void {
    this.recordMemoryUsage();
    
    const report = this.getPerformanceReport();
    const suggestions = this.getOptimizationSuggestions();
    
    this.logger.info('📊 === 性能监控报告 ===');
    this.logger.info(`⏱️ 运行时间: ${Math.round(report.uptime / 1000 / 60)} 分钟`);
    this.logger.info(`💚 健康评分: ${report.healthScore}/100`);
    
    // 补全性能
    this.logger.info('🎯 补全性能:');
    this.logger.info(`   响应时间: ${this.getAverage(report.metrics.completionResponseTime).toFixed(0)}ms (平均)`);
    this.logger.info(`   接受率: ${(report.metrics.completionAcceptanceRate * 100).toFixed(1)}%`);
    this.logger.info(`   触发频率: ${report.metrics.completionTriggersPerMinute.toFixed(1)} 次/分钟`);
    
    // 编辑性能
    this.logger.info('✏️ 编辑性能:');
    this.logger.info(`   平均防抖: ${report.metrics.averageDebounceTime.toFixed(0)}ms`);
    const totalEdits = Object.values(report.metrics.editOperationCounts).reduce((a, b) => a + b, 0);
    this.logger.info(`   总编辑操作: ${totalEdits}`);
    
    // 文件同步性能
    this.logger.info('📁 同步性能:');
    this.logger.info(`   成功率: ${(report.metrics.fileSyncSuccessRate * 100).toFixed(1)}%`);
    this.logger.info(`   响应时间: ${this.getAverage(report.metrics.fileSyncResponseTime).toFixed(0)}ms (平均)`);
    this.logger.info(`   增量同步率: ${(report.metrics.incrementalSyncUsageRate * 100).toFixed(1)}%`);
    
    // 批处理性能
    this.logger.info('📦 批处理性能:');
    this.logger.info(`   平均批次大小: ${report.metrics.batchProcessingStats.averageBatchSize.toFixed(1)}`);
    this.logger.info(`   成功率: ${(report.metrics.batchProcessingStats.successRate * 100).toFixed(1)}%`);
    
    // 系统资源
    this.logger.info('💾 系统资源:');
    const avgMemory = this.getAverage(report.metrics.memoryUsage);
    this.logger.info(`   内存使用: ${Math.round(avgMemory / 1024 / 1024)}MB (平均)`);
    this.logger.info(`   网络请求: ${this.getNetworkRequestsPerMinute().toFixed(1)} 次/分钟`);
    
    // 警告信息
    if (report.warnings.length > 0) {
      this.logger.info(`⚠️ 性能警告 (${report.warnings.length} 个):`);
      const recentWarnings = report.warnings.slice(-5); // 显示最近5个警告
      recentWarnings.forEach(warning => {
        this.logger.info(`   ${this.getWarningIcon(warning.severity)} ${warning.message}`);
      });
    }
    
    // 优化建议
    if (suggestions.length > 0) {
      this.logger.info('🔧 优化建议:');
      suggestions.forEach(suggestion => {
        this.logger.info(`   ${suggestion}`);
      });
    }
    
    this.logger.info('📊 === 报告结束 ===');
  }

  /**
   * 启动定期报告
   */
  private startPeriodicReporting(): void {
    this.reportTimer = setInterval(() => {
      this.generateReport();
    }, this.REPORT_INTERVAL);
  }

  /**
   * 启动定期清理
   */
  private startPeriodicCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupOldData();
    }, this.AUTO_CLEANUP_INTERVAL);
  }

  /**
   * 清理旧数据
   */
  private cleanupOldData(): void {
    // 清理指标数组
    this.metrics.completionResponseTime = this.metrics.completionResponseTime.slice(-this.METRICS_RETENTION_COUNT);
    this.metrics.fileSyncResponseTime = this.metrics.fileSyncResponseTime.slice(-this.METRICS_RETENTION_COUNT);
    this.metrics.memoryUsage = this.metrics.memoryUsage.slice(-this.METRICS_RETENTION_COUNT);
    this.metrics.userInteractionLatency = this.metrics.userInteractionLatency.slice(-this.METRICS_RETENTION_COUNT);
    
    // 清理警告
    this.warnings = this.warnings.slice(-this.WARNING_RETENTION_COUNT);
    
    // 重置网络请求计数
    this.metrics.networkRequests = 0;
    
    this.logger.debug('🧹 性能监控数据清理完成');
  }

  /**
   * 添加数值到数组（保持固定长度）
   */
  private addToArray(array: number[], value: number): void {
    array.push(value);
    if (array.length > this.METRICS_RETENTION_COUNT) {
      array.shift();
    }
  }

  /**
   * 计算数组平均值
   */
  private getAverage(array: number[]): number {
    if (array.length === 0) return 0;
    return array.reduce((sum, val) => sum + val, 0) / array.length;
  }

  /**
   * 更新触发频率
   */
  private updateTriggerRate(): void {
    const now = Date.now();
    const minutes = (now - this.lastReportTime) / 1000 / 60;
    if (minutes > 0) {
      // 简化的触发频率计算
      this.metrics.completionTriggersPerMinute = 
        0.9 * this.metrics.completionTriggersPerMinute + 0.1 * (1 / Math.max(minutes, 0.1));
    }
  }

  /**
   * 计算网络请求频率
   */
  private getNetworkRequestsPerMinute(): number {
    const now = Date.now();
    const minutes = (now - this.lastReportTime) / 1000 / 60;
    return minutes > 0 ? this.metrics.networkRequests / minutes : 0;
  }

  /**
   * 检查补全警告
   */
  private checkCompletionWarnings(responseTime: number): void {
    if (responseTime > this.THRESHOLDS.COMPLETION_RESPONSE_TIME) {
      this.addWarning({
        type: 'high_latency',
        message: `补全响应时间过长: ${responseTime}ms (阈值: ${this.THRESHOLDS.COMPLETION_RESPONSE_TIME}ms)`,
        severity: responseTime > this.THRESHOLDS.COMPLETION_RESPONSE_TIME * 2 ? 'high' : 'medium',
        timestamp: Date.now(),
        metric: 'completionResponseTime',
        value: responseTime,
        threshold: this.THRESHOLDS.COMPLETION_RESPONSE_TIME
      });
    }
    
    if (this.metrics.completionAcceptanceRate < this.THRESHOLDS.LOW_ACCEPTANCE_RATE) {
      this.addWarning({
        type: 'low_acceptance',
        message: `补全接受率过低: ${(this.metrics.completionAcceptanceRate * 100).toFixed(1)}% (阈值: ${this.THRESHOLDS.LOW_ACCEPTANCE_RATE * 100}%)`,
        severity: 'medium',
        timestamp: Date.now(),
        metric: 'completionAcceptanceRate',
        value: this.metrics.completionAcceptanceRate,
        threshold: this.THRESHOLDS.LOW_ACCEPTANCE_RATE
      });
    }
  }

  /**
   * 检查同步警告
   */
  private checkSyncWarnings(): void {
    if (this.metrics.fileSyncSuccessRate < this.THRESHOLDS.SYNC_SUCCESS_RATE) {
      this.addWarning({
        type: 'sync_failure',
        message: `文件同步成功率过低: ${(this.metrics.fileSyncSuccessRate * 100).toFixed(1)}% (阈值: ${this.THRESHOLDS.SYNC_SUCCESS_RATE * 100}%)`,
        severity: 'high',
        timestamp: Date.now(),
        metric: 'fileSyncSuccessRate',
        value: this.metrics.fileSyncSuccessRate,
        threshold: this.THRESHOLDS.SYNC_SUCCESS_RATE
      });
    }
  }

  /**
   * 添加警告
   */
  private addWarning(warning: PerformanceWarning): void {
    // 避免重复警告（5分钟内相同类型）
    const recent = this.warnings.filter(w => 
      w.type === warning.type && 
      Date.now() - w.timestamp < 300000
    );
    
    if (recent.length === 0) {
      this.warnings.push(warning);
      this.logger.warn(`⚠️ 性能警告: ${warning.message}`);
    }
  }

  /**
   * 计算健康评分 (0-100)
   */
  private calculateHealthScore(): number {
    let score = 100;
    
    // 补全性能 (30分)
    const avgResponseTime = this.getAverage(this.metrics.completionResponseTime);
    if (avgResponseTime > this.THRESHOLDS.COMPLETION_RESPONSE_TIME) {
      score -= 15;
    }
    if (this.metrics.completionAcceptanceRate < this.THRESHOLDS.LOW_ACCEPTANCE_RATE) {
      score -= 15;
    }
    
    // 文件同步 (25分)
    if (this.metrics.fileSyncSuccessRate < this.THRESHOLDS.SYNC_SUCCESS_RATE) {
      score -= 25;
    }
    
    // 系统资源 (25分)
    const avgMemory = this.getAverage(this.metrics.memoryUsage);
    if (avgMemory > this.THRESHOLDS.HIGH_MEMORY_USAGE) {
      score -= 15;
    }
    const requestsPerMinute = this.getNetworkRequestsPerMinute();
    if (requestsPerMinute > this.THRESHOLDS.HIGH_NETWORK_REQUESTS) {
      score -= 10;
    }
    
    // 用户体验 (20分)
    if (this.metrics.ghostTextDisplayRate < 0.8) {
      score -= 10;
    }
    const avgLatency = this.getAverage(this.metrics.userInteractionLatency);
    if (avgLatency > this.THRESHOLDS.USER_INTERACTION_LATENCY) {
      score -= 10;
    }
    
    return Math.max(0, score);
  }

  /**
   * 获取指标摘要
   */
  private getMetricsSummary(): PerformanceMetrics {
    return {
      ...this.metrics,
      // 计算平均值而不是数组
      completionResponseTime: [this.getAverage(this.metrics.completionResponseTime)],
      fileSyncResponseTime: [this.getAverage(this.metrics.fileSyncResponseTime)],
      memoryUsage: [this.getAverage(this.metrics.memoryUsage)],
      userInteractionLatency: [this.getAverage(this.metrics.userInteractionLatency)]
    };
  }

  /**
   * 获取警告图标
   */
  private getWarningIcon(severity: string): string {
    switch (severity) {
      case 'critical': return '🚨';
      case 'high': return '⚠️';
      case 'medium': return '⚡';
      case 'low': return '💡';
      default: return '📋';
    }
  }

  /**
   * 销毁监控器
   */
  dispose(): void {
    if (this.reportTimer) {
      clearInterval(this.reportTimer);
      this.reportTimer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    // 生成最终报告
    this.generateReport();
    
    this.logger.info('📊 性能监控器已销毁');
  }
}

/**
 * 单例性能监控器
 */
let performanceMonitorInstance: PerformanceMonitor | null = null;

export function createPerformanceMonitor(): PerformanceMonitor {
  if (!performanceMonitorInstance) {
    performanceMonitorInstance = new PerformanceMonitor();
  }
  return performanceMonitorInstance;
}

export function getPerformanceMonitor(): PerformanceMonitor | null {
  return performanceMonitorInstance;
}