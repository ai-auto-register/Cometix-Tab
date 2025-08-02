/**
 * 设置日志级别命令
 */

import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { ConfigManager } from '../utils/config';

export async function setLogLevelCommand(): Promise<void> {
  const logger = Logger.getInstance();
  
  try {
    const currentLevel = logger.getCurrentLogLevelName();
    
    const levelOptions = [
      {
        label: '$(bug) Debug',
        description: '显示所有日志（包括详细调试信息）',
        value: 'debug',
        picked: currentLevel === 'debug'
      },
      {
        label: '$(info) Info',
        description: '显示一般信息及以上级别',
        value: 'info',
        picked: currentLevel === 'info'
      },
      {
        label: '$(warning) Warn',
        description: '仅显示警告和错误',
        value: 'warn',
        picked: currentLevel === 'warn'
      },
      {
        label: '$(error) Error',
        description: '仅显示错误',
        value: 'error',
        picked: currentLevel === 'error'
      }
    ];

    const selected = await vscode.window.showQuickPick(levelOptions, {
      title: '选择日志级别',
      placeHolder: `当前级别: ${currentLevel}`,
      canPickMany: false
    });

    if (selected) {
      await ConfigManager.updateConfig('logLevel', selected.value);
      
      logger.info(`✅ 日志级别已设置为: ${selected.value}`);
      vscode.window.showInformationMessage(`✅ 日志级别已设置为: ${selected.value}`);
      
      // 如果设置为 debug，提示用户关于性能影响
      if (selected.value === 'debug') {
        vscode.window.showInformationMessage(
          '⚠️ Debug 级别会显示大量日志，可能影响性能。调试完成后建议改回 Info 级别。',
          '知道了'
        );
      }
    }
    
  } catch (error) {
    const errorMessage = (error as Error).message;
    logger.error('❌ 设置日志级别失败', error as Error);
    vscode.window.showErrorMessage(`❌ 设置日志级别失败: ${errorMessage}`);
  }
}