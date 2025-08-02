import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { getPerformanceMonitor } from '../utils/performance-monitor';

/**
 * 显示性能报告命令
 */
export async function showPerformanceReport(): Promise<void> {
  const logger = Logger.getInstance();
  
  try {
    const performanceMonitor = getPerformanceMonitor();
    if (!performanceMonitor) {
      vscode.window.showWarningMessage('性能监控器未初始化');
      return;
    }

    // 生成详细报告
    performanceMonitor.generateReport();
    
    // 获取报告数据
    const report = performanceMonitor.getPerformanceReport();
    const suggestions = performanceMonitor.getOptimizationSuggestions();
    
    // 创建报告内容
    const reportLines: string[] = [];
    
    reportLines.push('📊 === Cometix Tab 性能报告 ===');
    reportLines.push('');
    reportLines.push(`⏱️ 运行时间: ${Math.round(report.uptime / 1000 / 60)} 分钟`);
    reportLines.push(`💚 健康评分: ${report.healthScore}/100`);
    reportLines.push('');
    
    // 补全性能部分
    reportLines.push('🎯 补全性能:');
    const avgResponseTime = Array.isArray(report.metrics.completionResponseTime) && report.metrics.completionResponseTime.length > 0 
      ? report.metrics.completionResponseTime[0] 
      : 0;
    reportLines.push(`   • 平均响应时间: ${avgResponseTime.toFixed(0)}ms`);
    reportLines.push(`   • 接受率: ${(report.metrics.completionAcceptanceRate * 100).toFixed(1)}%`);
    reportLines.push(`   • 触发频率: ${report.metrics.completionTriggersPerMinute.toFixed(1)} 次/分钟`);
    reportLines.push('');
    
    // 编辑性能部分
    reportLines.push('✏️ 编辑性能:');
    reportLines.push(`   • 平均防抖时间: ${report.metrics.averageDebounceTime.toFixed(0)}ms`);
    const totalEdits = Object.values(report.metrics.editOperationCounts).reduce((a, b) => a + b, 0);
    reportLines.push(`   • 总编辑操作: ${totalEdits}`);
    reportLines.push(`   • 编辑分布: 输入=${report.metrics.editOperationCounts.TYPING}, 删除=${report.metrics.editOperationCounts.DELETING}, 粘贴=${report.metrics.editOperationCounts.PASTING}`);
    reportLines.push('');
    
    // 文件同步性能
    reportLines.push('📁 文件同步性能:');
    reportLines.push(`   • 成功率: ${(report.metrics.fileSyncSuccessRate * 100).toFixed(1)}%`);
    const avgSyncTime = Array.isArray(report.metrics.fileSyncResponseTime) && report.metrics.fileSyncResponseTime.length > 0 
      ? report.metrics.fileSyncResponseTime[0] 
      : 0;
    reportLines.push(`   • 平均响应时间: ${avgSyncTime.toFixed(0)}ms`);
    reportLines.push(`   • 增量同步使用率: ${(report.metrics.incrementalSyncUsageRate * 100).toFixed(1)}%`);
    reportLines.push('');
    
    // 批处理性能
    reportLines.push('📦 批处理性能:');
    reportLines.push(`   • 平均批次大小: ${report.metrics.batchProcessingStats.averageBatchSize.toFixed(1)}`);
    reportLines.push(`   • 平均处理时间: ${report.metrics.batchProcessingStats.averageProcessingTime.toFixed(0)}ms`);
    reportLines.push(`   • 成功率: ${(report.metrics.batchProcessingStats.successRate * 100).toFixed(1)}%`);
    reportLines.push('');
    
    // 系统资源
    reportLines.push('💾 系统资源:');
    const avgMemory = Array.isArray(report.metrics.memoryUsage) && report.metrics.memoryUsage.length > 0 
      ? report.metrics.memoryUsage[0] 
      : 0;
    reportLines.push(`   • 平均内存使用: ${Math.round(avgMemory / 1024 / 1024)}MB`);
    reportLines.push(`   • 网络请求数: ${report.metrics.networkRequests}`);
    reportLines.push('');
    
    // 用户体验
    reportLines.push('👤 用户体验:');
    reportLines.push(`   • 幽灵文本显示率: ${(report.metrics.ghostTextDisplayRate * 100).toFixed(1)}%`);
    const avgLatency = Array.isArray(report.metrics.userInteractionLatency) && report.metrics.userInteractionLatency.length > 0 
      ? report.metrics.userInteractionLatency[0] 
      : 0;
    reportLines.push(`   • 平均交互延迟: ${avgLatency.toFixed(0)}ms`);
    reportLines.push('');
    
    // 性能警告
    if (report.warnings.length > 0) {
      reportLines.push('⚠️ 性能警告:');
      const recentWarnings = report.warnings.slice(-5);
      recentWarnings.forEach((warning, index) => {
        const icon = warning.severity === 'critical' ? '🚨' : 
                     warning.severity === 'high' ? '⚠️' : 
                     warning.severity === 'medium' ? '⚡' : '💡';
        reportLines.push(`   ${index + 1}. ${icon} ${warning.message}`);
      });
      reportLines.push('');
    }
    
    // 优化建议
    if (suggestions.length > 0) {
      reportLines.push('🔧 优化建议:');
      suggestions.forEach((suggestion, index) => {
        reportLines.push(`   ${index + 1}. ${suggestion}`);
      });
      reportLines.push('');
    } else {
      reportLines.push('🎉 性能表现良好，无需优化！');
      reportLines.push('');
    }
    
    reportLines.push('📊 === 报告结束 ===');
    
    // 显示报告
    const reportContent = reportLines.join('\n');
    
    // 方案1: 在输出面板显示
    logger.info(reportContent);
    
    // 方案2: 在新文档中显示
    const doc = await vscode.workspace.openTextDocument({
      content: reportContent,
      language: 'plaintext'
    });
    await vscode.window.showTextDocument(doc, { preview: true });
    
    // 方案3: 在信息消息中显示简要信息
    const healthEmoji = report.healthScore >= 90 ? '💚' : 
                       report.healthScore >= 70 ? '💛' : 
                       report.healthScore >= 50 ? '🧡' : '❤️';
    
    vscode.window.showInformationMessage(
      `${healthEmoji} 性能健康评分: ${report.healthScore}/100 | 接受率: ${(report.metrics.completionAcceptanceRate * 100).toFixed(1)}% | 查看详细报告已打开`
    );
    
    logger.info('✅ 性能报告显示完成');
    
  } catch (error) {
    logger.error('❌ 显示性能报告失败', error as Error);
    vscode.window.showErrorMessage(`显示性能报告失败: ${error}`);
  }
}

/**
 * 注册性能报告命令
 */
export function registerShowPerformanceReportCommand(context: vscode.ExtensionContext): void {
  const command = vscode.commands.registerCommand('cometix-tab.showPerformanceReport', showPerformanceReport);
  context.subscriptions.push(command);
}