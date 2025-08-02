import * as vscode from 'vscode';
import type { CursorConfig } from '../types';

export interface ConfigValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export class ConfigManager {
  private static readonly CONFIG_SECTION = 'cometixTab';
  
  static getConfig(): CursorConfig {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    
    return {
      enabled: config.get('enabled', true),
      serverUrl: config.get('serverUrl', 'https://api2.cursor.sh'),
      authToken: config.get('authToken', ''),
      clientKey: config.get('clientKey', ''),
      gcppHost: config.get('gcppHost', 'US'),
      model: config.get('model', 'auto'),
      snoozeUntil: config.get('snoozeUntil', 0),
      maxCompletionLength: config.get('maxCompletionLength', 1000),
      debounceMs: config.get('debounceMs', 300),
      logLevel: config.get('logLevel', 'info'),
      triggerConfig: config.get('triggerConfig', {
        commaTriggersCompletion: true,
        newLineHighConfidence: true,
        lineEndHighConfidence: true,
        customTriggerChars: []
      })
    };
  }
  
  static async updateConfig(key: keyof CursorConfig, value: any): Promise<void> {
    const config = vscode.workspace.getConfiguration(this.CONFIG_SECTION);
    await config.update(key, value, vscode.ConfigurationTarget.Global);
  }
  
  static onConfigChange(callback: () => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration(this.CONFIG_SECTION)) {
        callback();
      }
    });
  }
  
  /**
   * 验证配置是否有效
   */
  static validateConfig(config?: CursorConfig): ConfigValidationResult {
    const cfg = config || this.getConfig();
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // 检查必需的配置项
    if (!cfg.authToken || cfg.authToken.trim() === '') {
      errors.push('未配置 authToken。请在设置中配置 Cursor API 认证令牌。');
    }
    
    if (!cfg.clientKey || cfg.clientKey.trim() === '') {
      errors.push('未配置 clientKey。请在设置中配置客户端密钥（checksum格式）。');
    } else {
      // 支持多种checksum格式：72、129、137字符
      const len = cfg.clientKey.length;
      if (len !== 72 && len !== 129 && len !== 137) {
        errors.push('clientKey 格式错误。应为72、129或137字符的checksum格式。');
      } else {
        // 检查字符的有效性
        const isValidFormat = /^[A-Za-z0-9\-_\/]+$/.test(cfg.clientKey);
        if (!isValidFormat) {
          errors.push('clientKey 格式错误。包含无效字符。');
        } else if ((len === 129 && cfg.clientKey[64] !== '/') || (len === 137 && cfg.clientKey[72] !== '/')) {
          errors.push('clientKey 格式错误。分隔符位置不正确。');
        }
      }
    }
    
    if (!cfg.serverUrl || cfg.serverUrl.trim() === '') {
      errors.push('未配置 serverUrl。请设置 Cursor API 服务器地址。');
    } else {
      try {
        new URL(cfg.serverUrl);
      } catch {
        errors.push('serverUrl 格式错误。请输入有效的 URL 地址。');
      }
    }
    
    // 检查可选配置的合理性
    if (cfg.debounceMs < 100 || cfg.debounceMs > 2000) {
      warnings.push('debounceMs 值超出推荐范围（100-2000ms）。');
    }
    
    if (cfg.maxCompletionLength < 100 || cfg.maxCompletionLength > 5000) {
      warnings.push('maxCompletionLength 值超出推荐范围（100-5000）。');
    }
    
    // 使用第三方服务器的警告
    if (cfg.serverUrl !== 'https://api2.cursor.sh') {
      warnings.push('正在使用第三方或自部署API服务器，请确保服务器可信且可用。');
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }
  
  /**
   * 显示配置指导
   */
  static showConfigurationGuide(): void {
    const message = `
Cometix Tab 配置指南：

1. **获取 authToken**：
   - 访问 www.cursor.com 并完成注册登录
   - 在浏览器中打开开发者工具（F12）
   - 在 Application-Cookies 中查找 WorkosCursorSessionToken
   - 复制其值（注意：%3A%3A 是 :: 的编码形式）

2. **生成 clientKey**：
   - 扩展会自动生成，无需手动设置
   - 格式为137字符的checksum（包含时间戳、设备哈希和MAC哈希）

3. **服务器地址选择**：
   📌 官方API地址：https://api2.cursor.sh （推荐）
   
   🔧 自部署选项：
   - GitHub项目：https://github.com/wisdgod/cursor-api
   - 适合需要更高稳定性和隐私保护的用户
   - 部署后使用自己的服务器地址

💡 提示：推荐使用官方API或自部署以获得最佳体验
`;
    
    vscode.window.showInformationMessage(
      '需要配置 Cometix Tab',
      { modal: true, detail: message },
      '打开设置'
    ).then(selection => {
      if (selection === '打开设置') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'cometixTab');
      }
    });
  }
}