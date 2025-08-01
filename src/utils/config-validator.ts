import * as vscode from 'vscode';
import { Logger } from './logger';
import { validateChecksum } from './checksum';

export interface ConfigValidationResult {
  isValid: boolean;
  issues: string[];
  warnings: string[];
  configuration: {
    endpointType: string;
    serverUrl: string;
    authToken: string;
    clientKey: string;
    hasAuthToken: boolean;
    hasClientKey: boolean;
    checksumValid: boolean;
  };
}

export class ConfigValidator {
  private static logger = Logger.getInstance();

  static validateConfiguration(): ConfigValidationResult {
    const config = vscode.workspace.getConfiguration('cometixTab');
    
    const endpointType = config.get<string>('endpointType') || 'official';
    const serverUrl = config.get<string>('serverUrl') || '';
    const authToken = config.get<string>('authToken') || '';
    const clientKey = config.get<string>('clientKey') || '';

    const issues: string[] = [];
    const warnings: string[] = [];

    // 检查认证令牌
    if (!authToken || authToken.trim() === '') {
      issues.push('❌ 认证令牌 (authToken) 未设置');
      issues.push('💡 请在 VSCode 设置中设置 cometixTab.authToken');
    } else if (authToken.length < 10) {
      warnings.push('⚠️ 认证令牌似乎太短，请检查是否正确');
    }

    // 检查客户端密钥 - 需要137字符的checksum格式
    let checksumValid = false;
    if (!clientKey || clientKey.trim() === '') {
      warnings.push('⚠️ 客户端密钥 (clientKey) 未设置，将自动生成');
      // 生成137字符的checksum格式
      const newChecksum = require('./checksum').getOrGenerateClientKey();
      config.update('clientKey', newChecksum, vscode.ConfigurationTarget.Global);
      this.logger.info('🔄 已生成并保存新的客户端密钥');
      checksumValid = true;
    } else {
      // 验证checksum格式 - 支持72/129/137字符长度
      checksumValid = validateChecksum(clientKey);
      if (!checksumValid) {
        warnings.push('⚠️ 客户端密钥格式不正确，将重新生成');
        // 生成137字符的checksum格式
        const newChecksum = require('./checksum').getOrGenerateClientKey();
        config.update('clientKey', newChecksum, vscode.ConfigurationTarget.Global);
        this.logger.info('🔄 已重新生成并保存新的客户端密钥');
        checksumValid = true;
      }
    }

    // 检查服务器URL
    if (endpointType === 'official') {
      if (serverUrl && !serverUrl.includes('cursor.sh')) {
        warnings.push('⚠️ 选择了官方端点但URL不是官方地址，将使用默认官方URL');
      }
    } else if (endpointType === 'selfhosted') {
      if (serverUrl && serverUrl.includes('cursor.sh')) {
        warnings.push('⚠️ 选择了自部署端点但URL是官方地址，将使用默认自部署URL');
      }
    }

    // 详细配置信息
    const configuration = {
      endpointType,
      serverUrl,
      authToken: authToken.substring(0, 10) + '...',
      clientKey: clientKey.substring(0, 20) + '...',
      hasAuthToken: !!authToken,
      hasClientKey: !!clientKey,
      checksumValid
    };

    this.logger.info('🔍 配置验证结果:');
    this.logger.info(`📊 端点类型: ${endpointType}`);
    this.logger.info(`🌐 服务器URL: ${serverUrl || '使用默认'}`);
    this.logger.info(`🔑 有认证令牌: ${configuration.hasAuthToken}`);
    this.logger.info(`🔐 有客户端密钥: ${configuration.hasClientKey}`);
    this.logger.info(`✅ 密钥格式正确: ${checksumValid}`);

    if (issues.length > 0) {
      this.logger.warn('⚠️ 配置问题:');
      issues.forEach(issue => this.logger.warn(`  ${issue}`));
    }

    if (warnings.length > 0) {
      this.logger.warn('⚠️ 配置警告:');
      warnings.forEach(warning => this.logger.warn(`  ${warning}`));
    }

    return {
      isValid: issues.length === 0,
      issues,
      warnings,
      configuration
    };
  }

  static async promptForMissingConfiguration(): Promise<boolean> {
    const validation = this.validateConfiguration();
    
    if (!validation.isValid) {
      const authTokenMissing = validation.issues.some(issue => issue.includes('authToken'));
      
      if (authTokenMissing) {
        const action = await vscode.window.showErrorMessage(
          '❌ Cometix Tab 配置不完整：缺少认证令牌',
          {
            detail: '请设置 Cursor API 认证令牌才能使用代码补全功能',
            modal: true
          },
          '打开设置',
          '配置指南'
        );

        if (action === '打开设置') {
          await vscode.commands.executeCommand('workbench.action.openSettings', 'cometixTab.authToken');
          return false;
        } else if (action === '配置指南') {
          await vscode.commands.executeCommand('cometix-tab.openConfiguration');
          return false;
        }
      }
    }

    return validation.isValid;
  }

  static logCurrentConfiguration(): void {
    const config = vscode.workspace.getConfiguration('cometixTab');
    
    this.logger.info('📋 当前配置:');
    this.logger.info(`  endpointType: ${config.get('endpointType')}`);
    this.logger.info(`  serverUrl: ${config.get('serverUrl')}`);
    this.logger.info(`  authToken: ${config.get('authToken') ? '已设置' : '未设置'}`);
    this.logger.info(`  clientKey: ${config.get('clientKey') ? '已设置' : '未设置'}`);
    this.logger.info(`  model: ${config.get('model')}`);
    this.logger.info(`  maxCompletionLength: ${config.get('maxCompletionLength')}`);
  }
}