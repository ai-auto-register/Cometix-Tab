import * as vscode from 'vscode';
import { ConfigManager } from '../utils/config';
import { Logger } from '../utils/logger';
import { MenuPanel } from './menu-panel';

export enum StatusBarState {
  Idle = 'idle',
  Working = 'working', 
  Error = 'error',
  Disabled = 'disabled',
  Snoozing = 'snoozing'
}

interface StatusBarConfig {
  text: string;
  icon: string;
  color?: vscode.ThemeColor;
  tooltip: string;
  command: string;
}

export class StatusBar {
  private statusBarItem: vscode.StatusBarItem;
  private menuPanel: MenuPanel;
  private disposables: vscode.Disposable[] = [];
  private logger = Logger.getInstance();
  private currentState: StatusBarState = StatusBarState.Idle;
  private updateTimer?: NodeJS.Timeout;

  constructor(private context: vscode.ExtensionContext) {
    // 初始化状态栏项目
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right, 
      100
    );
    
    // 初始化菜单面板
    this.menuPanel = MenuPanel.getInstance(context);
    
    // 设置基本配置
    this.setupStatusBar();
    
    // 注册事件监听器
    this.registerEventListeners();
    
    // 初始更新
    this.updateStatus();
    
    // 显示状态栏
    this.statusBarItem.show();
    
    this.logger.info('StatusBar initialized');
  }

  /**
   * 设置状态栏基本配置
   */
  private setupStatusBar(): void {
    // 设置点击命令 - 显示菜单面板
    this.statusBarItem.command = 'cometix-tab.showMenuPanel';
    
    // 注册菜单显示命令
    const showMenuCommand = vscode.commands.registerCommand(
      'cometix-tab.showMenuPanel', 
      () => this.showMenuPanel()
    );
    
    this.disposables.push(showMenuCommand);
  }

  /**
   * 注册事件监听器
   */
  private registerEventListeners(): void {
    // 监听配置变化
    this.disposables.push(
      ConfigManager.onConfigChange(() => {
        this.updateStatus();
      })
    );

    // 监听活动编辑器变化
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.updateStatus();
      })
    );

    // 监听工作区变化
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('cometixTab')) {
          this.updateStatus();
        }
      })
    );
  }

  /**
   * 显示菜单面板
   */
  private async showMenuPanel(): Promise<void> {
    try {
      await this.menuPanel.showMenuPanel();
      this.logger.debug('Menu panel displayed');
    } catch (error) {
      this.logger.error('Failed to show menu panel', error as Error);
      vscode.window.showErrorMessage('无法显示菜单，请检查日志');
    }
  }

  /**
   * 更新状态栏显示
   */
  public updateStatus(): void {
    // 防抖更新，避免频繁刷新
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
    }
    
    this.updateTimer = setTimeout(() => {
      this.performStatusUpdate();
    }, 100);
  }

  /**
   * 执行实际的状态更新
   */
  private performStatusUpdate(): void {
    try {
      const config = ConfigManager.getConfig();
      const newState = this.determineState(config);
      const statusConfig = this.getStatusConfig(newState, config);
      
      // 更新状态栏
      this.applyStatusConfig(statusConfig);
      
      // 记录状态变化
      if (this.currentState !== newState) {
        this.logger.debug(`Status changed: ${this.currentState} -> ${newState}`);
        this.currentState = newState;
      }
      
    } catch (error) {
      this.logger.error('Failed to update status', error as Error);
      this.setErrorState('更新状态失败');
    }
  }

  /**
   * 确定当前状态
   */
  private determineState(config: any): StatusBarState {
    // 检查是否被禁用
    if (!config.enabled) {
      return StatusBarState.Disabled;
    }
    
    // 检查是否在snooze状态
    if (config.snoozeUntil > Date.now()) {
      return StatusBarState.Snoozing;
    }
    
    // 检查是否有错误状态（这里可以扩展更复杂的错误检测）
    if (this.hasError()) {
      return StatusBarState.Error;
    }
    
    // 检查是否正在工作（这里可以扩展正在处理补全的检测）
    if (this.isWorking()) {
      return StatusBarState.Working;
    }
    
    return StatusBarState.Idle;
  }

  /**
   * 获取状态配置
   */
  private getStatusConfig(state: StatusBarState, config: any): StatusBarConfig {
    const baseConfig = {
      command: 'cometix-tab.showMenuPanel'
    };

    switch (state) {
      case StatusBarState.Idle:
        return {
          ...baseConfig,
          text: '$(zap) Cometix Tab',
          icon: 'zap',
          tooltip: this.buildTooltip('AI补全就绪', config),
          color: undefined
        };

      case StatusBarState.Working:
        return {
          ...baseConfig,
          text: '$(sync~spin) Cometix Tab',
          icon: 'sync',
          tooltip: this.buildTooltip('正在生成补全...', config),
          color: new vscode.ThemeColor('statusBarItem.activeBackground')
        };

      case StatusBarState.Error:
        return {
          ...baseConfig,
          text: '$(alert) Cometix Tab',
          icon: 'alert',
          tooltip: this.buildTooltip('AI补全遇到错误', config),
          color: new vscode.ThemeColor('statusBarItem.errorBackground')
        };

      case StatusBarState.Disabled:
        return {
          ...baseConfig,
          text: '$(circle-slash) Cometix Tab',
          icon: 'circle-slash',
          tooltip: this.buildTooltip('AI补全已禁用', config),
          color: new vscode.ThemeColor('statusBarItem.errorBackground')
        };

      case StatusBarState.Snoozing:
        const snoozeTime = new Date(config.snoozeUntil).toLocaleTimeString();
        return {
          ...baseConfig,
          text: '$(clock) Cometix Tab',
          icon: 'clock',
          tooltip: this.buildTooltip(`AI补全已暂停至 ${snoozeTime}`, config),
          color: new vscode.ThemeColor('statusBarItem.warningBackground')
        };

      default:
        return {
          ...baseConfig,
          text: '$(question) Cometix Tab',
          icon: 'question',
          tooltip: this.buildTooltip('未知状态', config),
          color: undefined
        };
    }
  }

  /**
   * 应用状态配置
   */
  private applyStatusConfig(config: StatusBarConfig): void {
    this.statusBarItem.text = config.text;
    this.statusBarItem.tooltip = config.tooltip;
    this.statusBarItem.backgroundColor = config.color;
    this.statusBarItem.command = config.command;
    
    // 设置无障碍信息
    this.statusBarItem.accessibilityInformation = {
      label: `Cometix Tab: ${config.tooltip}`,
      role: 'button'
    };
  }

  /**
   * 构建tooltip信息
   */
  private buildTooltip(statusText: string, config: any): string {
    const parts = [
      `Cometix Tab - ${statusText}`,
      `模型: ${config.model}`,
      '点击查看详细信息和设置'
    ];
    
    return parts.join('\n');
  }

  /**
   * 设置工作状态
   */
  public setWorkingState(message: string = '处理中'): void {
    const config = {
      text: '$(sync~spin) Cometix Tab',
      icon: 'sync',
      tooltip: this.buildTooltip(message, ConfigManager.getConfig()),
      command: 'cometix-tab.showMenuPanel',
      color: new vscode.ThemeColor('statusBarItem.activeBackground')
    };
    
    this.applyStatusConfig(config);
    this.currentState = StatusBarState.Working;
  }

  /**
   * 设置错误状态
   */
  public setErrorState(message: string = '发生错误'): void {
    const config = {
      text: '$(alert) Cometix Tab',
      icon: 'alert',
      tooltip: this.buildTooltip(message, ConfigManager.getConfig()),
      command: 'cometix-tab.showMenuPanel',
      color: new vscode.ThemeColor('statusBarItem.errorBackground')
    };
    
    this.applyStatusConfig(config);
    this.currentState = StatusBarState.Error;
    
    // 3秒后恢复正常状态
    setTimeout(() => {
      this.updateStatus();
    }, 3000);
  }

  /**
   * 重置到空闲状态
   */
  public resetToIdleState(): void {
    this.currentState = StatusBarState.Idle;
    this.updateStatus();
  }

  /**
   * 设置临时消息
   */
  public showTemporaryMessage(message: string, duration: number = 2000): void {
    const originalText = this.statusBarItem.text;
    const originalTooltip = this.statusBarItem.tooltip;
    
    this.statusBarItem.text = `$(info) ${message}`;
    this.statusBarItem.tooltip = message;
    
    setTimeout(() => {
      this.statusBarItem.text = originalText;
      this.statusBarItem.tooltip = originalTooltip;
    }, duration);
  }

  /**
   * 获取当前状态
   */
  public getCurrentState(): StatusBarState {
    return this.currentState;
  }

  /**
   * 检查是否有错误
   */
  private hasError(): boolean {
    // 这里可以扩展更复杂的错误检测逻辑
    // 比如检查API连接状态、认证状态等
    return false;
  }

  /**
   * 检查是否正在工作
   */
  private isWorking(): boolean {
    // 检查当前状态是否为工作状态
    return this.currentState === StatusBarState.Working;
  }

  /**
   * 手动触发状态更新
   */
  public forceUpdate(): void {
    this.performStatusUpdate();
  }

  /**
   * 隐藏状态栏
   */
  public hide(): void {
    this.statusBarItem.hide();
  }

  /**
   * 显示状态栏
   */
  public show(): void {
    this.statusBarItem.show();
  }

  /**
   * 释放资源
   */
  public dispose(): void {
    // 清理定时器
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
    }
    
    // 释放所有disposables
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
    
    // 释放状态栏项目
    this.statusBarItem.dispose();
    
    this.logger.info('StatusBar disposed');
  }

  /**
   * 检查是否已释放
   */
  public isDisposed(): boolean {
    return this.disposables.length === 0;
  }
}