import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { smartEditDetector, EditOperation } from '../utils/smart-edit-detector';
import { completionTracker } from '../utils/completion-tracker';

/**
 * 调试智能编辑检测系统
 */
export async function debugSmartEdit(): Promise<void> {
  const logger = Logger.getInstance();
  
  try {
    // 获取当前活动编辑器
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('请先打开一个文件');
      return;
    }
    
    const document = editor.document;
    const position = editor.selection.active;
    
    logger.info('🧠 === 智能编辑检测调试信息 ===');
    logger.info(`📁 文件: ${document.fileName}`);
    logger.info(`📍 位置: ${position.line}:${position.character}`);
    
    // 获取当前编辑操作状态
    const currentOperation = smartEditDetector.getCurrentOperation(document);
    logger.info(`🎯 当前编辑操作: ${currentOperation}`);
    
    // 获取补全触发建议
    const triggerCheck = smartEditDetector.shouldTriggerCompletion(document, position);
    logger.info(`🚀 补全触发建议:`);
    logger.info(`   是否触发: ${triggerCheck.shouldTrigger}`);
    logger.info(`   原因: ${triggerCheck.reason}`);
    logger.info(`   防抖时间: ${triggerCheck.debounceTime}ms`);
    
    // 获取文件同步建议
    const syncCheck = smartEditDetector.shouldSyncFile(document);
    logger.info(`📤 文件同步建议:`);
    logger.info(`   是否同步: ${syncCheck.shouldSync}`);
    logger.info(`   原因: ${syncCheck.reason}`);
    logger.info(`   使用增量同步: ${syncCheck.useIncrementalSync}`);
    
    // 获取调试信息
    const debugInfo = smartEditDetector.getDebugInfo();
    logger.info(`📊 编辑状态统计:`);
    
    for (const [uri, state] of Object.entries(debugInfo)) {
      const fileName = uri.split('/').pop() || uri;
      logger.info(`   📄 ${fileName}:`);
      logger.info(`     操作: ${state.operation}`);
      logger.info(`     变化次数: ${state.changeCount}`);
      logger.info(`     总字符变化: ${state.totalCharsChanged}`);
      logger.info(`     最后变化: ${new Date(state.lastChangeTime).toLocaleTimeString()}`);
      
      const timeSinceLastChange = Date.now() - state.lastChangeTime;
      logger.info(`     距离上次变化: ${timeSinceLastChange}ms`);
    }
    
    // 显示操作说明
    const operationDescriptions = {
      [EditOperation.TYPING]: '⌨️ 正在连续输入',
      [EditOperation.DELETING]: '🗑️ 正在连续删除',
      [EditOperation.UNDOING]: '🔙 撤销操作',
      [EditOperation.PASTING]: '📋 粘贴操作',
      [EditOperation.IDLE]: '😴 空闲状态'
    };
    
    logger.info(`🔍 操作类型说明:`);
    for (const [op, desc] of Object.entries(operationDescriptions)) {
      const isCurrent = currentOperation === op;
      logger.info(`   ${desc} ${isCurrent ? '← 当前' : ''}`);
    }
    
    // 显示当前行的上下文
    const currentLine = document.lineAt(position.line);
    const textBeforeCursor = currentLine.text.substring(0, position.character);
    const textAfterCursor = currentLine.text.substring(position.character);
    
    logger.info(`📝 当前行上下文:`);
    logger.info(`   行号: ${position.line + 1}`);
    logger.info(`   光标前: "${textBeforeCursor}"`);
    logger.info(`   光标后: "${textAfterCursor}"`);
    logger.info(`   整行: "${currentLine.text}"`);
    
    // 模拟不同编辑操作的效果预测
    logger.info(`🔮 编辑操作预测:`);
    
    const mockOperations = [EditOperation.TYPING, EditOperation.DELETING, EditOperation.UNDOING, EditOperation.PASTING];
    for (const mockOp of mockOperations) {
      // 这里使用自适应防抖时间计算
      const debounceTime = smartEditDetector.getAdaptiveDebounceTime(document, position);
      logger.info(`   ${operationDescriptions[mockOp]}: 防抖~${debounceTime}ms (自适应)`);
    }
    
    // 完整的补全跟踪统计展示
    const completionStats = completionTracker.getStats();
    logger.info(`📊 补全跟踪统计:`);
    logger.info(`   总跟踪数: ${completionStats.totalTracked}`);
    logger.info(`   已接受: ${completionStats.accepted}`);
    logger.info(`   已忽略: ${completionStats.dismissed}`);
    logger.info(`   已过期: ${completionStats.expired}`);
    logger.info(`   待处理: ${completionStats.pending}`);
    logger.info(`   接受率: ${(completionStats.acceptanceRate * 100).toFixed(1)}%`);
    
    // 增强统计信息
    const total = completionStats.accepted + completionStats.dismissed + completionStats.expired;
    if (total > 0) {
      logger.info(`📈 详细统计:`);
      logger.info(`   接受比例: ${((completionStats.accepted / total) * 100).toFixed(1)}%`);
      logger.info(`   忽略比例: ${((completionStats.dismissed / total) * 100).toFixed(1)}%`);
      logger.info(`   过期比例: ${((completionStats.expired / total) * 100).toFixed(1)}%`);
      
      // 性能指标
      if (completionStats.totalTracked > 5) {
        const avgLifetime = completionStats.totalTracked > 0 ? 
          (Date.now() - performance.now()) / completionStats.totalTracked : 0;
        logger.info(`   平均补全生命周期: ${avgLifetime.toFixed(0)}ms`);
      }
    }
    
    // 实时状态提示
    if (completionStats.pending > 0) {
      logger.info(`⏳ 当前有 ${completionStats.pending} 个补全正在等待用户操作`);
    }
    
    if (completionStats.acceptanceRate < 0.3 && total > 3) {
      logger.info(`💡 提示: 接受率较低(${(completionStats.acceptanceRate * 100).toFixed(1)}%)，可能需要调整触发策略`);
    } else if (completionStats.acceptanceRate > 0.7 && total > 3) {
      logger.info(`🎯 优秀: 接受率较高(${(completionStats.acceptanceRate * 100).toFixed(1)}%)，触发策略表现良好`);
    }
    
    logger.info('🧠 === 调试信息结束 ===');
    
    vscode.window.showInformationMessage(
      `智能编辑检测调试完成！当前状态: ${operationDescriptions[currentOperation]}，补全接受率: ${(completionStats.acceptanceRate * 100).toFixed(1)}%。查看输出面板获取详细信息。`
    );
    
  } catch (error) {
    logger.error('❌ 智能编辑检测调试失败', error as Error);
    vscode.window.showErrorMessage(`调试失败: ${error}`);
  }
}

/**
 * 注册智能编辑检测调试命令
 */
export function registerDebugSmartEditCommand(context: vscode.ExtensionContext): void {
  const command = vscode.commands.registerCommand('cometix-tab.debugSmartEdit', debugSmartEdit);
  context.subscriptions.push(command);
}