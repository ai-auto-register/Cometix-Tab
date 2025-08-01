import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { ConfigValidator } from '../utils/config-validator';
import { getOrGenerateClientKey, validateChecksum } from '../utils/checksum';

export async function debugAuthCommand(): Promise<void> {
  const logger = Logger.getInstance();
  
  logger.info('🔍 开始认证调试...');
  
  // 1. 验证配置
  const validation = ConfigValidator.validateConfiguration();
  
  logger.info('📋 配置验证结果:');
  logger.info(`  有效性: ${validation.isValid ? '✅ 有效' : '❌ 无效'}`);
  
  if (validation.issues.length > 0) {
    logger.info('  问题:');
    validation.issues.forEach(issue => logger.info(`    ${issue}`));
  }
  
  if (validation.warnings.length > 0) {
    logger.info('  警告:');
    validation.warnings.forEach(warning => logger.info(`    ${warning}`));
  }
  
  // 2. 测试 checksum 生成
  logger.info('🔐 测试 Checksum 生成:');
  
  const checksum1 = getOrGenerateClientKey();
  const checksum2 = getOrGenerateClientKey();
  
  logger.info(`  Checksum 1: ${checksum1.substring(0, 30)}... (${checksum1.length} 字符)`);
  logger.info(`  Checksum 2: ${checksum2.substring(0, 30)}... (${checksum2.length} 字符)`);
  logger.info(`  验证 1: ${validateChecksum(checksum1) ? '✅' : '❌'}`);
  logger.info(`  验证 2: ${validateChecksum(checksum2) ? '✅' : '❌'}`);
  
  // 3. 检查配置中的值
  const config = vscode.workspace.getConfiguration('cometixTab');
  const configChecksum = config.get<string>('clientKey') || '';
  
  if (configChecksum) {
    logger.info(`  配置中的 Checksum: ${configChecksum.substring(0, 30)}... (${configChecksum.length} 字符)`);
    logger.info(`  配置验证: ${validateChecksum(configChecksum) ? '✅' : '❌'}`);
  } else {
    logger.info('  配置中没有 Checksum，将自动生成');
    await config.update('clientKey', checksum1, vscode.ConfigurationTarget.Global);
    logger.info('  ✅ 已保存新的 Checksum 到配置');
  }
  
  // 4. 显示结果给用户
  const message = `认证调试完成！${validation.isValid ? '配置有效' : '配置有问题'}`;
  
  if (validation.isValid) {
    vscode.window.showInformationMessage(message + ' - 查看输出面板获取详细信息');
  } else {
    const action = await vscode.window.showWarningMessage(
      message + ' - 需要配置认证令牌',
      '打开设置',
      '查看日志'
    );
    
    if (action === '打开设置') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'cometixTab.authToken');
    } else if (action === '查看日志') {
      await vscode.commands.executeCommand('cometix-tab.showLogs');
    }
  }
}