import * as vscode from 'vscode';
import { ConfigManager } from '../utils/config';
import { Logger } from '../utils/logger';
import { EnhancedStatusBar, StatusBarState } from '../ui/enhanced-status-bar';

interface CompletionStats {
  today: number;
  thisWeek: number;
  total: number;
  lastReset: Date;
}

interface SystemStatus {
  apiConnection: boolean;
  tokenValid: boolean;
  modelAvailable: boolean;
  lastCheck: Date;
}

export class StatusIntegration {
  private static instance: StatusIntegration;
  private logger = Logger.getInstance();
  private statusBar?: EnhancedStatusBar;
  private stats: CompletionStats;
  private systemStatus: SystemStatus;
  private checkTimer?: NodeJS.Timeout;

  private constructor(private context: vscode.ExtensionContext) {
    // 初始化统计数据
    this.stats = this.loadStats();
    
    // 初始化系统状态
    this.systemStatus = {
      apiConnection: false,
      tokenValid: false,
      modelAvailable: false,
      lastCheck: new Date()
    };
    
    // 启动定期检查
    this.startPeriodicCheck();
  }

  public static getInstance(context?: vscode.ExtensionContext): StatusIntegration {
    if (!StatusIntegration.instance && context) {
      StatusIntegration.instance = new StatusIntegration(context);
    }
    return StatusIntegration.instance;
  }

  /**
   * 设置状态栏引用
   */
  public setStatusBar(statusBar: EnhancedStatusBar): void {
    this.statusBar = statusBar;
    this.logger.debug('StatusBar reference set');
  }

  /**
   * 记录补全完成
   */
  public recordCompletion(): void {
    this.stats.today++;
    this.stats.thisWeek++;
    this.stats.total++;
    
    // 保存统计数据
    this.saveStats();
    
    // 更新状态栏显示
    this.updateStatusBar();
    
    this.logger.debug(`Completion recorded: total=${this.stats.total}`);
  }

  /**
   * 记录补全开始
   */
  public recordCompletionStart(): void {
    if (this.statusBar) {
      this.statusBar.setWorkingState('正在生成AI补全...');
    }
  }

  /**
   * 记录补全结束
   */
  public recordCompletionEnd(success: boolean = true): void {
    if (this.statusBar) {
      // 重置到空闲状态
      this.statusBar.resetToIdleState();
    }
    
    if (success) {
      this.recordCompletion();
    }
  }

  /**
   * 记录补全错误
   */
  public recordCompletionError(error: Error): void {
    if (this.statusBar) {
      this.statusBar.setErrorState(`补全失败: ${error.message}`);
    }
    
    this.logger.error('Completion error recorded', error);
  }

  /**
   * 更新API连接状态
   */
  public updateApiStatus(connected: boolean, error?: Error): void {
    this.systemStatus.apiConnection = connected;
    this.systemStatus.lastCheck = new Date();
    
    if (!connected && error) {
      this.logger.error('API connection failed', error);
      if (this.statusBar) {
        this.statusBar.setErrorState('API连接失败');
      }
    }
    
    this.updateStatusBar();
  }

  /**
   * 更新Token状态
   */
  public updateTokenStatus(valid: boolean): void {
    this.systemStatus.tokenValid = valid;
    this.systemStatus.lastCheck = new Date();
    
    if (!valid) {
      this.logger.warn('Token validation failed');
      if (this.statusBar) {
        this.statusBar.setErrorState('Token无效，请重新配置');
      }
    }
    
    this.updateStatusBar();
  }

  /**
   * 更新模型可用性状态
   */
  public updateModelStatus(available: boolean): void {
    this.systemStatus.modelAvailable = available;
    this.systemStatus.lastCheck = new Date();
    
    if (!available) {
      this.logger.warn('Model not available');
      if (this.statusBar) {
        this.statusBar.setErrorState('AI模型不可用');
      }
    }
    
    this.updateStatusBar();
  }

  /**
   * 显示临时状态消息
   */
  public showTemporaryStatus(message: string, duration: number = 2000): void {
    if (this.statusBar) {
      this.statusBar.showTemporaryMessage(message, duration);
    }
  }

  /**
   * 获取补全统计数据
   */
  public getCompletionStats(): CompletionStats {
    return { ...this.stats };
  }

  /**
   * 获取系统状态
   */
  public getSystemStatus(): SystemStatus {
    return { ...this.systemStatus };
  }

  /**
   * 重置日常统计
   */
  public resetDailyStats(): void {
    this.stats.today = 0;
    this.stats.lastReset = new Date();
    this.saveStats();
    this.updateStatusBar();
    
    this.logger.info('Daily stats reset');
  }

  /**
   * 重置周统计
   */
  public resetWeeklyStats(): void {
    this.stats.thisWeek = 0;
    this.stats.lastReset = new Date();
    this.saveStats();
    this.updateStatusBar();
    
    this.logger.info('Weekly stats reset');
  }

  /**
   * 执行系统健康检查
   */
  public async performHealthCheck(): Promise<boolean> {
    try {
      if (this.statusBar) {
        this.statusBar.setWorkingState('系统检查中...');
      }
      
      // 检查配置
      const config = ConfigManager.getConfig();
      if (!config.enabled) {
        this.logger.debug('System disabled by configuration');
        return false;
      }
      
      // 检查API连接（这里应该调用实际的API测试）
      const apiOk = await this.checkApiConnection();
      this.updateApiStatus(apiOk);
      
      // 检查Token（这里应该调用实际的Token验证）
      const tokenOk = await this.checkTokenValidity();
      this.updateTokenStatus(tokenOk);
      
      // 检查模型可用性（这里应该调用实际的模型检查）
      const modelOk = await this.checkModelAvailability();
      this.updateModelStatus(modelOk);
      
      const overallHealth = apiOk && tokenOk && modelOk;
      
      if (this.statusBar) {
        if (overallHealth) {
          this.statusBar.showTemporaryMessage('系统检查通过', 1500);
        } else {
          this.statusBar.setErrorState('系统检查发现问题');
        }
      }
      
      this.logger.info(`Health check completed: ${overallHealth ? 'PASS' : 'FAIL'}`);
      return overallHealth;
      
    } catch (error) {
      this.logger.error('Health check failed', error as Error);
      if (this.statusBar) {
        this.statusBar.setErrorState('系统检查失败');
      }
      return false;
    }
  }

  /**
   * 更新状态栏
   */
  private updateStatusBar(): void {
    if (this.statusBar) {
      this.statusBar.updateStatus();
    }
  }

  /**
   * 启动定期检查
   */
  private startPeriodicCheck(): void {
    // 每5分钟进行一次健康检查
    this.checkTimer = setInterval(() => {
      this.performHealthCheck();
    }, 5 * 60 * 1000);
    
    // 每天重置日常统计
    this.scheduleDailyReset();
    
    // 每周重置周统计
    this.scheduleWeeklyReset();
  }

  /**
   * 安排日常重置
   */
  private scheduleDailyReset(): void {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const msUntilMidnight = tomorrow.getTime() - now.getTime();
    
    setTimeout(() => {
      this.resetDailyStats();
      // 然后设置每24小时重置一次
      setInterval(() => {
        this.resetDailyStats();
      }, 24 * 60 * 60 * 1000);
    }, msUntilMidnight);
  }

  /**
   * 安排周重置
   */
  private scheduleWeeklyReset(): void {
    const now = new Date();
    const nextMonday = new Date(now);
    const daysUntilMonday = (7 - now.getDay() + 1) % 7;
    nextMonday.setDate(now.getDate() + (daysUntilMonday || 7));
    nextMonday.setHours(0, 0, 0, 0);
    
    const msUntilMonday = nextMonday.getTime() - now.getTime();
    
    setTimeout(() => {
      this.resetWeeklyStats();
      // 然后设置每周重置一次
      setInterval(() => {
        this.resetWeeklyStats();
      }, 7 * 24 * 60 * 60 * 1000);
    }, msUntilMonday);
  }

  /**
   * 加载统计数据
   */
  private loadStats(): CompletionStats {
    const defaultStats: CompletionStats = {
      today: 0,
      thisWeek: 0,
      total: 0,
      lastReset: new Date()
    };
    
    try {
      const stored = this.context.globalState.get<CompletionStats>('completionStats');
      if (stored) {
        // 检查是否需要重置日常统计
        const lastReset = new Date(stored.lastReset);
        const now = new Date();
        
        if (now.getDate() !== lastReset.getDate() || 
            now.getMonth() !== lastReset.getMonth() || 
            now.getFullYear() !== lastReset.getFullYear()) {
          stored.today = 0;
          stored.lastReset = now;
        }
        
        return stored;
      }
    } catch (error) {
      this.logger.error('Failed to load stats', error as Error);
    }
    
    return defaultStats;
  }

  /**
   * 保存统计数据
   */
  private saveStats(): void {
    try {
      this.context.globalState.update('completionStats', this.stats);
    } catch (error) {
      this.logger.error('Failed to save stats', error as Error);
    }
  }

  /**
   * 检查API连接
   */
  private async checkApiConnection(): Promise<boolean> {
    // 这里应该实现实际的API连接检查
    // 暂时返回模拟结果
    await new Promise(resolve => setTimeout(resolve, 100));
    return Math.random() > 0.1; // 90%成功率
  }

  /**
   * 检查Token有效性
   */
  private async checkTokenValidity(): Promise<boolean> {
    // 这里应该实现实际的Token验证
    // 暂时返回模拟结果
    await new Promise(resolve => setTimeout(resolve, 100));
    return Math.random() > 0.05; // 95%成功率
  }

  /**
   * 检查模型可用性
   */
  private async checkModelAvailability(): Promise<boolean> {
    // 这里应该实现实际的模型可用性检查
    // 暂时返回模拟结果
    await new Promise(resolve => setTimeout(resolve, 100));
    return Math.random() > 0.02; // 98%成功率
  }

  /**
   * 释放资源
   */
  public dispose(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = undefined;
    }
    
    // 保存最终统计数据
    this.saveStats();
    
    this.logger.info('StatusIntegration disposed');
  }
}