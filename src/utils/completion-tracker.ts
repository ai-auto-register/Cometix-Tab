import * as vscode from 'vscode';
import { Logger } from './logger';

/**
 * 补全项状态
 */
export enum CompletionStatus {
  PENDING = 'PENDING',     // 等待用户操作
  ACCEPTED = 'ACCEPTED',   // 用户接受了补全
  DISMISSED = 'DISMISSED', // 用户忽略了补全
  EXPIRED = 'EXPIRED'      // 补全过期
}

/**
 * 补全跟踪信息
 */
interface CompletionTrackingInfo {
  id: string;
  uri: string;
  position: vscode.Position;
  text: string;
  range: vscode.Range;
  triggerTime: number;
  status: CompletionStatus;
  acceptTime?: number;
  dismissTime?: number;
  
  // 用于检测接受的快照
  documentVersion: number;
  documentContentSnapshot: string;
  expectedContentAfterAccept: string;
}

/**
 * 补全跟踪器 - 准确检测用户是否接受了AI补全建议
 * 
 * 检测策略：
 * 1. 内容匹配检测：监控文档变化，检查是否包含补全内容
 * 2. 位置匹配检测：检查补全插入位置是否匹配
 * 3. 时间窗口检测：在合理时间窗口内的匹配才视为接受
 * 4. 版本跟踪检测：通过文档版本变化来确认接受
 */
export class CompletionTracker {
  private logger: Logger;
  private activeCompletions = new Map<string, CompletionTrackingInfo>();
  private documentChangeListener: vscode.Disposable | null = null;
  private selectionChangeListener: vscode.Disposable | null = null;
  
  // 配置参数
  private readonly ACCEPTANCE_TIMEOUT = 10000; // 10秒后补全过期
  private readonly MIN_ACCEPTANCE_MATCH_RATIO = 0.8; // 至少80%的内容匹配才视为接受
  private readonly MAX_ACCEPTANCE_DELAY = 3000; // 3秒内的接受才有效
  
  constructor() {
    this.logger = Logger.getInstance();
    this.setupEventListeners();
  }
  
  /**
   * 设置事件监听器
   */
  private setupEventListeners(): void {
    // 监听文档变化以检测接受
    this.documentChangeListener = vscode.workspace.onDidChangeTextDocument((e) => {
      this.handleDocumentChange(e);
    });
    
    // 监听光标选择变化以检测忽略
    this.selectionChangeListener = vscode.window.onDidChangeTextEditorSelection((e) => {
      this.handleSelectionChange(e);
    });
    
    this.logger.debug('🔧 补全跟踪器事件监听器已设置');
  }
  
  /**
   * 开始跟踪一个补全项
   */
  trackCompletion(
    document: vscode.TextDocument,
    position: vscode.Position,
    completionItem: vscode.InlineCompletionItem
  ): string {
    const id = this.generateCompletionId();
    const uri = document.uri.toString();
    const now = Date.now();
    
    // 完整处理insertText的类型（string | SnippetString | undefined）
    let insertText: string;
    if (typeof completionItem.insertText === 'string') {
      insertText = completionItem.insertText;
    } else if (completionItem.insertText && typeof completionItem.insertText === 'object' && 'value' in completionItem.insertText) {
      // SnippetString 类型
      insertText = (completionItem.insertText as vscode.SnippetString).value;
    } else if (completionItem.insertText === undefined) {
      // 回退到 filterText 或空字符串
      insertText = completionItem.filterText || '';
      this.logger.debug(`⚠️ insertText为undefined，使用filterText: "${insertText}"`);
    } else {
      // 未知类型，转换为字符串
      insertText = String(completionItem.insertText);
      this.logger.warn(`⚠️ insertText类型未知: ${typeof completionItem.insertText}，强制转换为字符串`);
    }
    
    // 计算预期的接受后内容
    const documentText = document.getText();
    const expectedContentAfterAccept = this.calculateExpectedContent(
      documentText,
      insertText,
      completionItem.range || new vscode.Range(position, position)
    );
    
    const trackingInfo: CompletionTrackingInfo = {
      id,
      uri,
      position,
      text: insertText,
      range: completionItem.range || new vscode.Range(position, position),
      triggerTime: now,
      status: CompletionStatus.PENDING,
      documentVersion: document.version,
      documentContentSnapshot: documentText,
      expectedContentAfterAccept
    };
    
    this.activeCompletions.set(id, trackingInfo);
    
    this.logger.debug(`📝 开始跟踪补全: ${id}, 文本长度: ${insertText.length}`);
    
    // 设置过期定时器
    setTimeout(() => {
      this.expireCompletion(id);
    }, this.ACCEPTANCE_TIMEOUT);
    
    return id;
  }
  
  /**
   * 处理文档变化事件
   */
  private handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
    const uri = event.document.uri.toString();
    const now = Date.now();
    
    // 检查所有相关的活跃补全
    for (const [id, completion] of this.activeCompletions.entries()) {
      if (completion.uri !== uri || completion.status !== CompletionStatus.PENDING) {
        continue;
      }
      
      // 检查时间窗口
      if (now - completion.triggerTime > this.MAX_ACCEPTANCE_DELAY) {
        continue;
      }
      
      // 检测是否接受了补全
      if (this.detectAcceptance(event.document, completion, event.contentChanges)) {
        this.markAsAccepted(id, now);
      }
    }
  }
  
  /**
   * 处理光标选择变化事件
   */
  private handleSelectionChange(event: vscode.TextEditorSelectionChangeEvent): void {
    const uri = event.textEditor.document.uri.toString();
    const now = Date.now();
    
    // 检查相关的活跃补全
    for (const [id, completion] of this.activeCompletions.entries()) {
      if (completion.uri !== uri || completion.status !== CompletionStatus.PENDING) {
        continue;
      }
      
      // 如果光标移动到了不相关的位置，可能表示用户忽略了补全
      const currentPosition = event.textEditor.selection.active;
      if (this.isSignificantPositionChange(completion.position, currentPosition)) {
        // 延迟一下再判断，避免误判
        setTimeout(() => {
          if (this.activeCompletions.get(id)?.status === CompletionStatus.PENDING) {
            this.markAsDismissed(id, now);
          }
        }, 1000);
      }
    }
  }
  
  /**
   * 检测是否接受了补全
   */
  private detectAcceptance(
    document: vscode.TextDocument,
    completion: CompletionTrackingInfo,
    changes: readonly vscode.TextDocumentContentChangeEvent[]
  ): boolean {
    const currentContent = document.getText();
    
    // 策略1: 完全匹配检测
    if (currentContent === completion.expectedContentAfterAccept) {
      this.logger.debug(`✅ 补全接受检测 - 完全匹配: ${completion.id}`);
      return true;
    }
    
    // 策略2: 部分匹配检测
    const matchRatio = this.calculateContentMatchRatio(
      currentContent,
      completion.expectedContentAfterAccept,
      completion.text
    );
    
    if (matchRatio >= this.MIN_ACCEPTANCE_MATCH_RATIO) {
      this.logger.debug(`✅ 补全接受检测 - 部分匹配: ${completion.id}, 匹配率: ${matchRatio.toFixed(2)}`);
      return true;
    }
    
    // 策略3: 变化内容检测
    if (this.detectAcceptanceFromChanges(changes, completion)) {
      this.logger.debug(`✅ 补全接受检测 - 变化匹配: ${completion.id}`);
      return true;
    }
    
    return false;
  }
  
  /**
   * 基于文档变化检测接受
   */
  private detectAcceptanceFromChanges(
    changes: readonly vscode.TextDocumentContentChangeEvent[],
    completion: CompletionTrackingInfo
  ): boolean {
    for (const change of changes) {
      // 检查插入的文本是否匹配补全内容
      if (change.text.length > 0 && completion.text.includes(change.text)) {
        // 检查插入位置是否匹配
        if (this.isPositionMatching(change.range.start, completion.position)) {
          return true;
        }
      }
      
      // 检查是否插入了补全文本的开头部分
      if (change.text.length > 3 && completion.text.startsWith(change.text)) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * 计算内容匹配率
   */
  private calculateContentMatchRatio(
    actualContent: string,
    expectedContent: string,
    completionText: string
  ): number {
    // 简化的匹配率计算：检查补全文本在实际内容中的存在比例
    let matchedChars = 0;
    let searchPos = 0;
    
    for (const char of completionText) {
      const foundPos = actualContent.indexOf(char, searchPos);
      if (foundPos !== -1) {
        matchedChars++;
        searchPos = foundPos + 1;
      }
    }
    
    return matchedChars / completionText.length;
  }
  
  /**
   * 检查位置是否匹配
   */
  private isPositionMatching(actual: vscode.Position, expected: vscode.Position): boolean {
    // 允许轻微的位置偏差
    return Math.abs(actual.line - expected.line) <= 1 &&
           Math.abs(actual.character - expected.character) <= 5;
  }
  
  /**
   * 检查是否有显著的位置变化
   */
  private isSignificantPositionChange(original: vscode.Position, current: vscode.Position): boolean {
    return Math.abs(original.line - current.line) > 3 ||
           Math.abs(original.character - current.character) > 20;
  }
  
  /**
   * 计算预期的接受后内容
   */
  private calculateExpectedContent(
    originalContent: string,
    insertText: string,
    range: vscode.Range
  ): string {
    // 获取范围前后的内容
    const lines = originalContent.split('\n');
    const startLine = range.start.line;
    const endLine = range.end.line;
    
    let result = '';
    
    // 范围前的内容
    for (let i = 0; i < startLine; i++) {
      result += lines[i] + '\n';
    }
    
    // 替换的行
    if (startLine < lines.length) {
      const startLineContent = lines[startLine];
      const beforeRange = startLineContent.substring(0, range.start.character);
      const afterRange = endLine < lines.length ? 
        lines[endLine].substring(range.end.character) : '';
      
      result += beforeRange + insertText + afterRange;
      
      // 如果不是最后一行，添加换行符
      if (startLine < lines.length - 1) {
        result += '\n';
      }
    }
    
    // 范围后的内容
    for (let i = Math.max(endLine + 1, startLine + 1); i < lines.length; i++) {
      result += lines[i];
      if (i < lines.length - 1) {
        result += '\n';
      }
    }
    
    return result;
  }
  
  /**
   * 标记补全为已接受
   */
  private markAsAccepted(id: string, acceptTime: number): void {
    const completion = this.activeCompletions.get(id);
    if (!completion) return;
    
    completion.status = CompletionStatus.ACCEPTED;
    completion.acceptTime = acceptTime;
    
    const responseTime = acceptTime - completion.triggerTime;
    this.logger.info(`✅ 补全被接受: ${id}, 响应时间: ${responseTime}ms`);
    
    // 触发接受事件（可以被其他组件监听）
    this.onCompletionAccepted?.(completion);
  }
  
  /**
   * 标记补全为已忽略
   */
  private markAsDismissed(id: string, dismissTime: number): void {
    const completion = this.activeCompletions.get(id);
    if (!completion) return;
    
    completion.status = CompletionStatus.DISMISSED;
    completion.dismissTime = dismissTime;
    
    const lifetime = dismissTime - completion.triggerTime;
    this.logger.debug(`❌ 补全被忽略: ${id}, 生存时间: ${lifetime}ms`);
    
    // 触发忽略事件
    this.onCompletionDismissed?.(completion);
  }
  
  /**
   * 过期补全
   */
  private expireCompletion(id: string): void {
    const completion = this.activeCompletions.get(id);
    if (!completion || completion.status !== CompletionStatus.PENDING) {
      return;
    }
    
    completion.status = CompletionStatus.EXPIRED;
    this.logger.debug(`⏰ 补全过期: ${id}`);
    
    // 清理过期的补全
    this.activeCompletions.delete(id);
  }
  
  /**
   * 生成补全ID
   */
  private generateCompletionId(): string {
    return `completion_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * 获取补全统计信息
   */
  getStats(): {
    totalTracked: number;
    accepted: number;
    dismissed: number;
    expired: number;
    pending: number;
    acceptanceRate: number;
  } {
    let accepted = 0;
    let dismissed = 0;
    let expired = 0;
    let pending = 0;
    
    for (const completion of this.activeCompletions.values()) {
      switch (completion.status) {
        case CompletionStatus.ACCEPTED: accepted++; break;
        case CompletionStatus.DISMISSED: dismissed++; break;
        case CompletionStatus.EXPIRED: expired++; break;
        case CompletionStatus.PENDING: pending++; break;
      }
    }
    
    const total = accepted + dismissed + expired;
    const acceptanceRate = total > 0 ? accepted / total : 0;
    
    return {
      totalTracked: this.activeCompletions.size,
      accepted,
      dismissed,
      expired,
      pending,
      acceptanceRate
    };
  }
  
  /**
   * 事件回调
   */
  onCompletionAccepted?: (completion: CompletionTrackingInfo) => void;
  onCompletionDismissed?: (completion: CompletionTrackingInfo) => void;
  
  /**
   * 销毁跟踪器
   */
  dispose(): void {
    this.documentChangeListener?.dispose();
    this.selectionChangeListener?.dispose();
    this.activeCompletions.clear();
    
    this.logger.debug('🧹 补全跟踪器已销毁');
  }
}

/**
 * 单例补全跟踪器
 */
export const completionTracker = new CompletionTracker();