/**
 * 调试编辑历史命令
 * 
 * 用于测试 EditHistoryTracker 的功能
 */

import * as vscode from 'vscode';
import { Logger } from '../utils/logger';

// 需要从扩展实例中获取 EditHistoryTracker
let editHistoryTracker: any = null;

export function setEditHistoryTracker(tracker: any): void {
  editHistoryTracker = tracker;
}

export async function debugEditHistoryCommand(): Promise<void> {
  const logger = Logger.getInstance();
  
  try {
    logger.info('🧪 开始调试编辑历史功能...');
    
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      vscode.window.showErrorMessage('没有活动的编辑器');
      return;
    }
    
    const document = activeEditor.document;
    const filePath = document.uri.fsPath;
    
    logger.info(`📄 当前文件: ${filePath}`);
    logger.info(`📐 文档版本: ${document.version}`);
    logger.info(`📊 内容长度: ${document.getText().length} 字符`);
    logger.info(`📏 总行数: ${document.lineCount}`);
    
    // 显示当前光标位置
    const position = activeEditor.selection.active;
    logger.info(`🎯 光标位置: line ${position.line + 1}, column ${position.character}`);
    
    // 获取当前行内容
    const currentLine = document.lineAt(position.line);
    logger.info(`📝 当前行内容: "${currentLine.text}"`);
    
    // 🔧 调试 EditHistoryTracker 状态
    if (editHistoryTracker) {
      logger.info('📊 EditHistoryTracker 状态:');
      
      const debugInfo = editHistoryTracker.getDebugInfo();
      logger.info(`📁 跟踪的文件数量: ${debugInfo.fileCount}`);
      logger.info(`📝 总历史条目数: ${debugInfo.totalHistoryEntries}`);
      
      // 获取当前文件的编辑历史
      const diffHistory = editHistoryTracker.buildDiffHistory(filePath);
      const allDiffs = editHistoryTracker.getAllRecentDiffs(filePath);
      const fileVersion = editHistoryTracker.getFileVersion(filePath);
      const editIntent = editHistoryTracker.getEditIntent(filePath);
      
      logger.info(`🔢 文件版本: ${fileVersion}`);
      logger.info(`🎯 编辑意图: ${editIntent}`);
      logger.info(`📝 最新差异历史长度: ${diffHistory.length} 字符`);
      logger.info(`📚 所有差异历史数量: ${allDiffs.length}`);
      
      if (diffHistory.length > 0) {
        logger.info('📋 最新差异历史内容:');
        logger.info(diffHistory);
      } else {
        logger.info('📋 无编辑历史记录');
      }
      
      if (allDiffs.length > 0) {
        logger.info('📚 所有差异历史完整内容:');
        allDiffs.forEach((diff: string, index: number) => {
          logger.info(`--- 差异历史 ${index + 1} (长度: ${diff.length} 字符) ---`);
          logger.info(diff);
          logger.info(`--- 差异历史 ${index + 1} 结束 ---`);
        });
      }
      
    } else {
      logger.warn('⚠️ EditHistoryTracker 未设置，无法获取编辑历史信息');
    }
    
    vscode.window.showInformationMessage(
      `编辑历史调试完成！请查看输出面板获取详细信息。\n文件: ${document.fileName}\n版本: ${document.version}`
    );
    
  } catch (error) {
    const errorMessage = (error as Error).message;
    logger.error('❌ 编辑历史调试失败', error as Error);
    vscode.window.showErrorMessage(`编辑历史调试失败: ${errorMessage}`);
  }
}