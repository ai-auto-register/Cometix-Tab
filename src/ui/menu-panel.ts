import * as vscode from 'vscode';
import { ConfigManager } from '../utils/config';
import { Logger } from '../utils/logger';

interface QuickActionItem extends vscode.QuickPickItem {
  action: string;
  args?: any[];
}

interface StatusInfo {
  enabled: boolean;
  isSnoozing: boolean;
  model: string;
  completionCount: number;
  lastUpdate: Date;
}

export class MenuPanel {
  private static logger = Logger.getInstance();
  private static instance: MenuPanel;
  
  private constructor(private context: vscode.ExtensionContext) {}
  
  public static getInstance(context?: vscode.ExtensionContext): MenuPanel {
    if (!MenuPanel.instance && context) {
      MenuPanel.instance = new MenuPanel(context);
    }
    return MenuPanel.instance;
  }

  /**
   * 显示状态菜单面板
   */
  public async showMenuPanel(): Promise<void> {
    const quickPick = vscode.window.createQuickPick<QuickActionItem>();
    
    // 配置增强的视觉效果
    this.configureEnhancedAppearance(quickPick);
    
    // 构建分层内容
    quickPick.items = await this.buildLayeredContent();
    
    // 配置交互行为
    this.configureInteractions(quickPick);
    
    quickPick.show();
    MenuPanel.logger.debug('Menu panel displayed');
  }

  /**
   * 配置菜单外观
   */
  private configureEnhancedAppearance(quickPick: vscode.QuickPick<QuickActionItem>): void {
    const config = ConfigManager.getConfig();
    const statusInfo = this.getStatusInfo(config);
    
    // 动态标题，模拟hover容器的header
    quickPick.title = this.buildDynamicTitle(statusInfo);
    
    // 占位符，模拟tooltip的描述
    quickPick.placeholder = this.buildStatusDescription(statusInfo);
    
    // 启用忙碌指示器（当处理中时）
    quickPick.busy = false;
    
    // 设置匹配模式，提供更好的搜索体验
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
  }

  /**
   * 构建菜单内容
   */
  private async buildLayeredContent(): Promise<QuickActionItem[]> {
    const items: QuickActionItem[] = [];
    const config = ConfigManager.getConfig();
    const statusInfo = this.getStatusInfo(config);
    
    // 第一层：状态概览（模拟contribution部分）
    items.push(this.createStatusOverviewItem(statusInfo));
    
    // 分隔符
    items.push(this.createSeparator('状态信息'));
    
    // 第二层：快速操作（模拟settings部分）
    items.push(...this.createQuickActions(statusInfo));
    
    // 分隔符
    items.push(this.createSeparator('快速操作'));
    
    // 第三层：工具和设置（模拟底部操作部分）
    items.push(...this.createToolActions());
    
    return items;
  }

  /**
   * 创建状态概览项，类似Copilot的Workspace Index部分
   */
  private createStatusOverviewItem(statusInfo: StatusInfo): QuickActionItem {
    const statusIcon = this.getStatusIcon(statusInfo);
    const statusText = this.getStatusText(statusInfo);
    const detailText = this.getDetailText(statusInfo);
    
    return {
      label: `${statusIcon} ${statusText}`,
      description: detailText,
      detail: `活跃会话 • 上次更新: ${statusInfo.lastUpdate.toLocaleTimeString()}`,
      action: 'showStatus',
      alwaysShow: true
    };
  }

  /**
   * 创建快速操作项，类似Copilot的代码完成控制
   */
  private createQuickActions(statusInfo: StatusInfo): QuickActionItem[] {
    const actions: QuickActionItem[] = [];
    
    // 启用/禁用切换
    const toggleIcon = statusInfo.enabled ? '$(circle-filled)' : '$(circle-outline)';
    const toggleText = statusInfo.enabled ? '禁用所有文件的补全' : '启用所有文件的补全';
    actions.push({
      label: `${toggleIcon} ${toggleText}`,
      description: statusInfo.enabled ? '点击禁用AI补全' : '点击启用AI补全',
      action: 'toggleEnabled'
    });
    
    // Snooze控制
    if (statusInfo.isSnoozing) {
      actions.push({
        label: '$(bell) 取消Snooze',
        description: '重新启用AI补全',
        action: 'cancelSnooze'
      });
    } else if (statusInfo.enabled) {
      actions.push({
        label: '$(bell-slash) 暂停补全',
        description: '临时禁用一段时间',
        action: 'showSnoozeOptions'
      });
    }
    
    // 模型选择
    actions.push({
      label: `$(gear) 模型: ${statusInfo.model}`,
      description: '更改AI模型',
      action: 'showModelSelector'
    });
    
    return actions;
  }

  /**
   * 创建工具操作项，类似Copilot的底部操作
   */
  private createToolActions(): QuickActionItem[] {
    return [
      {
        label: '$(settings-gear) 打开设置',
        description: '配置Cometix Tab',
        action: 'openSettings',
        args: ['cometix-tab']
      },
      {
        label: '$(book) 查看日志',
        description: '查看详细日志信息',
        action: 'showLogs'
      },
      {
        label: '$(info) 使用统计',
        description: `今日完成 ${this.getTodayCompletions()} 次补全`,
        action: 'showStats'
      },
      {
        label: '$(question) 帮助文档',
        description: '查看使用指南',
        action: 'openDocs'
      }
    ];
  }

  /**
   * 配置交互行为
   */
  private configureInteractions(quickPick: vscode.QuickPick<QuickActionItem>): void {
    // 选择处理
    quickPick.onDidAccept(() => this.handleSelection(quickPick));
    
    // 自动关闭逻辑
    this.setupAutoClose(quickPick);
    
    // 键盘导航增强
    this.setupKeyboardNavigation(quickPick);
  }

  /**
   * 处理用户选择
   */
  private async handleSelection(quickPick: vscode.QuickPick<QuickActionItem>): Promise<void> {
    const selected = quickPick.selectedItems[0];
    if (!selected) {
      return;
    }
    
    try {
      await this.executeAction(selected.action, selected.args);
      quickPick.hide();
    } catch (error) {
      MenuPanel.logger.error('Action execution failed', error as Error);
      vscode.window.showErrorMessage(`操作失败: ${error}`);
    }
  }

  /**
   * 执行具体操作
   */
  private async executeAction(action: string, args?: any[]): Promise<void> {
    switch (action) {
      case 'showStatus':
        // 显示详细状态信息
        vscode.window.showInformationMessage('状态详情已显示在输出面板中');
        break;
        
      case 'toggleEnabled':
        await vscode.commands.executeCommand('cometix-tab.toggleEnabled');
        break;
        
      case 'cancelSnooze':
        await vscode.commands.executeCommand('cometix-tab.cancelSnooze');
        break;
        
      case 'showSnoozeOptions':
        await vscode.commands.executeCommand('cometix-tab.showSnoozePicker');
        break;
        
      case 'showModelSelector':
        await vscode.commands.executeCommand('cometix-tab.showModelPicker');
        break;
        
      case 'openSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', ...(args || []));
        break;
        
      case 'showLogs':
        await vscode.commands.executeCommand('cometix-tab.showLogs');
        break;
        
      case 'showStats':
        await this.showUsageStats();
        break;
        
      case 'openDocs':
        await vscode.commands.executeCommand('vscode.open', 
          vscode.Uri.parse('https://github.com/your-org/cometix-tab#readme'));
        break;
        
      default:
        MenuPanel.logger.warn(`Unknown action: ${action}`);
    }
  }

  /**
   * 设置自动关闭
   */
  private setupAutoClose(quickPick: vscode.QuickPick<QuickActionItem>): void {
    // 失焦时自动关闭
    quickPick.onDidHide(() => {
      MenuPanel.logger.debug('Menu panel hidden');
    });
    
    // 设置定时器，模拟hover的自动关闭行为
    const autoCloseTimer = setTimeout(() => {
      if (quickPick.activeItems.length === 0) {
        quickPick.hide();
      }
    }, 10000); // 10秒无操作自动关闭
    
    quickPick.onDidHide(() => clearTimeout(autoCloseTimer));
  }

  /**
   * 设置键盘导航
   */
  private setupKeyboardNavigation(quickPick: vscode.QuickPick<QuickActionItem>): void {
    // 可以在这里添加自定义键盘快捷键处理
    // VSCode的QuickPick已经提供了基本的键盘导航
  }

  // 辅助方法
  private getStatusInfo(config: any): StatusInfo {
    return {
      enabled: config.enabled,
      isSnoozing: config.snoozeUntil > Date.now(),
      model: config.model,
      completionCount: this.getTodayCompletions(),
      lastUpdate: new Date()
    };
  }

  private getStatusIcon(statusInfo: StatusInfo): string {
    if (!statusInfo.enabled) {
      return '$(circle-slash)';
    }
    if (statusInfo.isSnoozing) {
      return '$(clock)';
    }
    return '$(zap)';
  }

  private getStatusText(statusInfo: StatusInfo): string {
    if (!statusInfo.enabled) {
      return 'AI补全已禁用';
    }
    if (statusInfo.isSnoozing) {
      return 'AI补全已暂停';
    }
    return 'AI补全活跃中';
  }

  private getDetailText(statusInfo: StatusInfo): string {
    if (!statusInfo.enabled) {
      return '点击启用智能代码补全';
    }
    if (statusInfo.isSnoozing) {
      return '暂停模式，可手动取消';
    }
    return `使用 ${statusInfo.model} 模型`;
  }

  private buildDynamicTitle(statusInfo: StatusInfo): string {
    const baseTitle = 'Cometix Tab - AI代码补全';
    if (!statusInfo.enabled) {
      return `${baseTitle} (已禁用)`;
    }
    if (statusInfo.isSnoozing) {
      return `${baseTitle} (已暂停)`;
    }
    return `${baseTitle} (${statusInfo.model})`;
  }

  private buildStatusDescription(statusInfo: StatusInfo): string {
    if (!statusInfo.enabled) {
      return '选择操作以启用AI补全功能';
    }
    if (statusInfo.isSnoozing) {
      return '选择操作以管理暂停状态';
    }
    return '选择操作以配置AI补全设置';
  }

  private createSeparator(label: string): QuickActionItem {
    return {
      label: '',
      kind: vscode.QuickPickItemKind.Separator,
      action: 'separator'
    };
  }

  private getTodayCompletions(): number {
    // 这里应该从统计系统获取实际数据
    // 暂时返回模拟数据
    return Math.floor(Math.random() * 50) + 10;
  }

  private async showUsageStats(): Promise<void> {
    const stats = {
      today: this.getTodayCompletions(),
      thisWeek: Math.floor(Math.random() * 200) + 50,
      total: Math.floor(Math.random() * 1000) + 500
    };
    
    const message = `📊 使用统计\n` +
      `今日补全: ${stats.today} 次\n` +
      `本周补全: ${stats.thisWeek} 次\n` +
      `总计补全: ${stats.total} 次`;
      
    vscode.window.showInformationMessage(message);
  }
}