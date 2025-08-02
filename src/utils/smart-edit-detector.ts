import * as vscode from 'vscode';
import { Logger } from './logger';
import { ConfigManager } from './config';

/**
 * 编辑操作类型 - 基于业界最佳实践的细粒度状态机
 */
export enum EditOperation {
  TYPING = 'TYPING',           // 连续输入状态
  DELETING = 'DELETING',       // 连续删除状态  
  PASTING = 'PASTING',         // 粘贴操作状态
  UNDOING = 'UNDOING',         // 撤销/重做操作状态
  IDLE = 'IDLE'               // 空闲状态，适合触发补全
}

/**
 * 编辑状态信息 - 基于 VS Code API 和业界实践
 */
interface EditState {
  operation: EditOperation;
  startTime: number;
  lastChangeTime: number;
  lastSelectionTime: number;  // 最后光标移动时间
  changeCount: number;
  totalCharsChanged: number;
  lastDocumentVersion: number;
  lastContentLength: number;
  
  // 性能监控
  lastCompletionRT: number;    // 上次补全响应时间
  acceptanceRate: number;      // 历史接受率
  recentTriggers: number[];    // 最近触发时间戳
  
  // 批处理相关
  pendingPatches: vscode.TextDocumentContentChangeEvent[];
  lastFlushTime: number;
}

/**
 * 智能编辑检测器 - 基于业界最佳实践 (GitHub Copilot/Tabnine)
 * 实现细粒度状态机 + 自适应防抖 + 增量同步批处理
 */
export class SmartEditDetector {
  private logger: Logger;
  private editStates = new Map<string, EditState>();
  
  // 业界标准的防抖窗口配置
  private readonly BASE_DEBOUNCE_TIMES = {
    [EditOperation.TYPING]: 150,    // 打字：~150ms (GitHub Copilot 风格)
    [EditOperation.DELETING]: 350,  // 删除：~350ms  
    [EditOperation.PASTING]: 700,   // 粘贴：~700ms
    [EditOperation.UNDOING]: 700,   // 撤销：~700ms (同粘贴)
    [EditOperation.IDLE]: 50        // 空闲：快速响应
  };
  
  // 自适应配置
  private readonly RT_THRESHOLD_SLOW = 300;   // RT > 300ms 视为慢响应
  private readonly RT_THRESHOLD_FAST = 120;   // RT < 120ms 视为快响应
  private readonly DEBOUNCE_MULTIPLIER_MAX = 3.0;  // 最大倍率
  private readonly DEBOUNCE_MULTIPLIER_MIN = 0.5;  // 最小倍率
  
  // 状态转换阈值
  private readonly IDLE_TIMEOUT = 1000;       // 1秒无活动进入IDLE
  private readonly PASTE_LENGTH_THRESHOLD = 20; // 粘贴检测字符阈值
  private readonly TYPING_PAUSE_THRESHOLD = 400; // 打字暂停阈值
  
  // 高优触发字符 (GitHub Copilot 风格) - 动态配置
  private getHighConfidenceTriggers(): Set<string> {
    const config = ConfigManager.getConfig();
    const baseTriggers = ['.', '->', '::', '(', '[', '{', '=', ';'];
    
    // 根据配置添加逗号
    if (config.triggerConfig.commaTriggersCompletion) {
      baseTriggers.push(',');
    }
    
    // 添加自定义触发字符
    baseTriggers.push(...config.triggerConfig.customTriggerChars);
    
    return new Set(baseTriggers);
  }
  
  // 批处理配置
  private readonly PATCH_SIZE_LIMIT = 1024;   // 1KB 批处理阈值
  private readonly FLUSH_INTERVAL = 500;      // 500ms 强制刷新
  
  // 事件监听器
  private undoRedoListener: vscode.Disposable | null = null;
  private selectionListener: vscode.Disposable | null = null;
  
  constructor() {
    this.logger = Logger.getInstance();
    this.setupEventListeners();
  }
  
  /**
   * 设置事件监听器 - 监听撤销/重做命令和光标选择变化
   */
  private setupEventListeners(): void {
    // 监听撤销/重做命令 (业界标准做法)
    // 注意：VS Code 目前没有 onDidExecuteCommand 事件
    // 这里使用替代方案：通过文档变化的特征来检测撤销操作
    this.logger.debug('💡 注意：VS Code API 限制，使用文档变化特征检测撤销操作');
    
    // 监听光标选择变化
    this.selectionListener = vscode.window.onDidChangeTextEditorSelection((e) => {
      this.handleSelectionChange(e);
    });
    
    this.logger.debug('🔧 智能编辑检测器事件监听器已设置');
  }
  
  /**
   * 处理撤销/重做命令
   */
  private handleUndoRedoCommand(command: string): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    
    const uri = editor.document.uri.toString();
    const state = this.getOrCreateState(uri);
    
    this.logger.debug(`🔙 检测到${command}命令`);
    this.transitionToState(state, EditOperation.UNDOING);
  }
  
  /**
   * 处理光标选择变化
   */
  private handleSelectionChange(e: vscode.TextEditorSelectionChangeEvent): void {
    const uri = e.textEditor.document.uri.toString();
    const state = this.editStates.get(uri);
    if (!state) return;
    
    state.lastSelectionTime = Date.now();
    
    // 检查是否应该转换为IDLE状态
    this.checkIdleTransition(state);
  }
  
  /**
   * 分析文档变化 - 基于业界最佳实践的精细化检测
   */
  analyzeDocumentChange(
    document: vscode.TextDocument,
    changeEvent?: vscode.TextDocumentChangeEvent
  ): EditOperation {
    const uri = document.uri.toString();
    
    // 排除不需要监控的文档类型
    if (this.shouldIgnoreDocument(document)) {
      return EditOperation.IDLE;
    }
    
    const state = this.getOrCreateState(uri);
    const now = Date.now();
    
    // 更新基础状态
    state.lastChangeTime = now;
    state.lastDocumentVersion = document.version;
    state.lastContentLength = document.getText().length;
    
    // 检查是否应该转换为IDLE（超时检测）
    if (this.checkIdleTransition(state)) {
      return EditOperation.IDLE;
    }
    
    // 分析具体的变化类型
    if (changeEvent && changeEvent.contentChanges.length > 0) {
      const operation = this.detectOperationFromChanges(changeEvent.contentChanges, state);
      this.transitionToState(state, operation);
      
      // 批处理支持：收集变化用于增量同步
      this.collectChangesForBatching(state, changeEvent.contentChanges);
      
      return operation;
    }
    
    return state.operation;
  }
  
  /**
   * 基于 VS Code API contentChanges 精确检测操作类型
   */
  private detectOperationFromChanges(
    changes: readonly vscode.TextDocumentContentChangeEvent[],
    state: EditState
  ): EditOperation {
    if (changes.length === 0) return state.operation;
    
    const change = changes[0]; // 主要关注第一个变化
    const { text, rangeLength } = change;
    
    this.logger.debug(`🔍 变化分析: text="${text}", rangeLength=${rangeLength}`);
    
    // 删除操作检测 (业界标准: text === "" && rangeLength > 0)
    if (text === '' && rangeLength > 0) {
      this.logger.debug('🗑️ 检测到删除操作');
      return EditOperation.DELETING;
    }
    
    // 粘贴操作检测 (长度超过阈值，或包含多个换行符)
    // 注意：单个换行符不应该被视为粘贴操作
    const hasMultipleNewlines = (text.match(/\n/g) || []).length > 1;
    if (text.length > this.PASTE_LENGTH_THRESHOLD || hasMultipleNewlines) {
      this.logger.debug(`📋 检测到粘贴操作: 长度=${text.length}, 多换行=${hasMultipleNewlines}`);
      return EditOperation.PASTING;
    }
    
    // 撤销操作检测 (大量字符变化 + 版本跳跃)
    if (rangeLength > 50 && text.length > 50) {
      this.logger.debug(`🔙 检测到可能的撤销操作: rangeLength=${rangeLength}, textLength=${text.length}`);
      return EditOperation.UNDOING;
    }
    
    // 连续输入检测 (小量文本添加)
    if (text.length > 0 && rangeLength === 0) {
      this.logger.debug(`⌨️ 检测到输入操作: "${text}"`);
      return EditOperation.TYPING;
    }
    
    // 默认保持当前状态或转为TYPING
    return state.operation === EditOperation.IDLE ? EditOperation.TYPING : state.operation;
  }
  
  /**
   * 检查并执行IDLE状态转换
   */
  private checkIdleTransition(state: EditState): boolean {
    const now = Date.now();
    const timeSinceLastChange = now - state.lastChangeTime;
    const timeSinceLastSelection = now - state.lastSelectionTime;
    
    // 同时满足文档变化和光标选择都超时才转为IDLE
    if (timeSinceLastChange >= this.IDLE_TIMEOUT && 
        timeSinceLastSelection >= this.IDLE_TIMEOUT) {
      
      if (state.operation !== EditOperation.IDLE) {
        this.logger.debug(`😴 转换为IDLE状态 (无活动${timeSinceLastChange}ms)`);
        this.transitionToState(state, EditOperation.IDLE);
      }
      return true;
    }
    
    return false;
  }
  
  /**
   * 状态转换处理
   */
  private transitionToState(state: EditState, newOperation: EditOperation): void {
    if (state.operation !== newOperation) {
      const oldOperation = state.operation;
      state.operation = newOperation;
      state.startTime = Date.now();
      state.changeCount = 0;
      state.totalCharsChanged = 0;
      
      this.logger.info(`🔄 状态转换: ${oldOperation} → ${newOperation}`);
    }
    
    state.changeCount++;
  }
  
  /**
   * 获取或创建编辑状态
   */
  private getOrCreateState(uri: string): EditState {
    let state = this.editStates.get(uri);
    if (!state) {
      const now = Date.now();
      state = {
        operation: EditOperation.IDLE,
        startTime: now,
        lastChangeTime: now,
        lastSelectionTime: now,
        changeCount: 0,
        totalCharsChanged: 0,
        lastDocumentVersion: 0,
        lastContentLength: 0,
        lastCompletionRT: 150, // 默认RT
        acceptanceRate: 0.5,   // 默认接受率
        recentTriggers: [],
        pendingPatches: [],
        lastFlushTime: now
      };
      this.editStates.set(uri, state);
      this.logger.debug(`🆕 创建新的编辑状态: ${uri.split('/').pop()}`);
    }
    return state;
  }
  
  /**
   * 收集变化用于批处理 - 实现增量同步优化
   */
  private collectChangesForBatching(
    state: EditState,
    changes: readonly vscode.TextDocumentContentChangeEvent[]
  ): void {
    // 添加变化到待处理队列
    state.pendingPatches.push(...changes);
    
    // 计算当前批次大小
    const totalSize = state.pendingPatches.reduce((sum, patch) => 
      sum + patch.text.length + (patch.rangeLength || 0), 0);
    
    const now = Date.now();
    const timeSinceLastFlush = now - state.lastFlushTime;
    
    // 触发批处理刷新的条件
    if (totalSize >= this.PATCH_SIZE_LIMIT || 
        timeSinceLastFlush >= this.FLUSH_INTERVAL ||
        state.operation === EditOperation.IDLE) {
      
      this.flushPendingPatches(state);
    }
  }
  
  /**
   * 刷新待处理的补丁 - 集成批处理同步管理器
   */
  private flushPendingPatches(state: EditState): void {
    if (state.pendingPatches.length === 0) return;
    
    this.logger.debug(`📤 刷新${state.pendingPatches.length}个待处理补丁`);
    
    // 🚀 实际的增量同步实现 - 使用批处理管理器
    this.performIncrementalSync(state);
    
    state.pendingPatches = [];
    state.lastFlushTime = Date.now();
  }

  /**
   * 执行增量同步 - 通过批处理管理器
   */
  private async performIncrementalSync(state: EditState): Promise<void> {
    try {
      // 动态导入批处理管理器（避免循环依赖）
      const { getBatchSyncManager } = await import('./batch-sync-manager.js');
      const batchManager = getBatchSyncManager();
      if (!batchManager) {
        this.logger.warn('⚠️ 批处理管理器未初始化，跳过增量同步');
        return;
      }

      // 确定优先级
      let priority: 'low' | 'medium' | 'high' = 'medium';
      switch (state.operation) {
        case EditOperation.UNDOING:
        case EditOperation.PASTING:
          priority = 'high'; // 撤销和粘贴需要立即同步
          break;
        case EditOperation.DELETING:
          priority = 'low'; // 删除操作可以延迟同步
          break;
        default:
          priority = 'medium';
      }

      // 需要通过 URI 获取文档
      const uriString = Object.keys(this.editStates).find(uri => this.editStates.get(uri) === state);
      if (uriString) {
        try {
          const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uriString));
          batchManager.addChangesToBatch(document, state.pendingPatches, priority);
          this.logger.debug(`✅ 已添加${state.pendingPatches.length}个变化到批处理队列`);
        } catch (error) {
          this.logger.error('打开文档失败，无法进行增量同步', error as Error);
        }
      }
    } catch (error) {
      this.logger.error('执行增量同步失败', error as Error);
    }
  }
  
  
  /**
   * 获取当前编辑操作类型
   */
  getCurrentOperation(document: vscode.TextDocument): EditOperation {
    // 排除不需要监控的文档类型
    if (this.shouldIgnoreDocument(document)) {
      return EditOperation.IDLE;
    }
    
    const uri = document.uri.toString();
    const state = this.editStates.get(uri);
    
    if (!state) {
      return EditOperation.IDLE;
    }
    
    // 完善的IDLE超时检测
    // 检查是否应该转换为IDLE状态
    const wasIdle = state.operation === EditOperation.IDLE;
    const isNowIdle = this.checkIdleTransition(state);
    
    // 如果从非IDLE状态转换为IDLE，记录状态变化
    if (!wasIdle && isNowIdle) {
      this.logger.debug(`💤 文件进入IDLE状态: ${uri.split('/').pop()}`);
      // 触发任何待处理的批处理刷新
      if (state.pendingPatches.length > 0) {
        this.flushPendingPatches(state);
      }
    }
    
    return state.operation;
  }
  
  /**
   * 自适应防抖时间计算 - 基于业界最佳实践
   */
  getAdaptiveDebounceTime(document: vscode.TextDocument, position?: vscode.Position): number {
    const uri = document.uri.toString();
    const state = this.getOrCreateState(uri);
    
    // 基础防抖时间
    let baseTime = this.BASE_DEBOUNCE_TIMES[state.operation];
    
    // 自适应调整：基于上次补全响应时间
    let multiplier = 1.0;
    if (state.lastCompletionRT > this.RT_THRESHOLD_SLOW) {
      // 上次响应慢，增加防抖时间
      multiplier = Math.min(1.5, this.DEBOUNCE_MULTIPLIER_MAX);
      this.logger.debug(`🐌 上次RT ${state.lastCompletionRT}ms 较慢，防抖倍率: ${multiplier}`);
    } else if (state.lastCompletionRT < this.RT_THRESHOLD_FAST) {
      // 上次响应快，减少防抖时间
      multiplier = Math.max(0.7, this.DEBOUNCE_MULTIPLIER_MIN);
      this.logger.debug(`⚡ 上次RT ${state.lastCompletionRT}ms 较快，防抖倍率: ${multiplier}`);
    }
    
    // 基于接受率调整
    if (state.acceptanceRate < 0.3) {
      // 接受率低，增加防抖时间减少触发频率
      multiplier *= 1.3;
      this.logger.debug(`📉 接受率低 ${state.acceptanceRate.toFixed(2)}，增加防抖时间`);
    }
    
    // 高优触发检测：对特定字符立即触发
    if (position && this.isHighConfidenceTrigger(document, position)) {
      this.logger.debug(`⚡ 高优触发字符检测，使用最小防抖时间`);
      return Math.min(50, baseTime * 0.3); // 硬阈值 ≤ 50ms
    }
    
    const adaptiveTime = Math.round(baseTime * multiplier);
    this.logger.debug(`🕒 自适应防抖: ${baseTime}ms × ${multiplier.toFixed(2)} = ${adaptiveTime}ms`);
    
    return adaptiveTime;
  }
  
  /**
   * 检测是否为高置信度触发字符 (GitHub Copilot 风格)
   */
  private isHighConfidenceTrigger(document: vscode.TextDocument, position: vscode.Position): boolean {
    try {
      const line = document.lineAt(position.line);
      const textBeforeCursor = line.text.substring(0, position.character);
      
      // 检查最后的字符
      const triggers = this.getHighConfidenceTriggers();
      const lastChar = textBeforeCursor.slice(-1);
      if (triggers.has(lastChar)) {
        return true;
      }
      
      // 检查最后两个字符的组合 (如 ->、::)
      const lastTwoChars = textBeforeCursor.slice(-2);
      if (triggers.has(lastTwoChars)) {
        return true;
      }
      
      return false;
    } catch (error) {
      return false;
    }
  }
  
  /**
   * 用户意图预测 - 基于节奏时间特征
   */
  predictUserIntent(document: vscode.TextDocument, position: vscode.Position): {
    confidence: number;
    reason: string;
  } {
    const uri = document.uri.toString();
    const state = this.getOrCreateState(uri);
    const now = Date.now();
    
    // 🔧 特殊场景：新行和空行检测 - 基于配置
    const config = ConfigManager.getConfig();
    const line = document.lineAt(position.line);
    const isNewEmptyLine = position.character === 0 && line.text.trim() === '';
    const isAtLineEnd = position.character >= line.text.trim().length;
    
    // 新的空行 - 高置信度触发（可配置）
    if (isNewEmptyLine && config.triggerConfig.newLineHighConfidence) {
      return {
        confidence: 0.9,
        reason: '新空行，高意图补全（已启用）'
      };
    }
    
    // 行尾位置 - 高置信度触发（可配置）
    if (isAtLineEnd && config.triggerConfig.lineEndHighConfidence) {
      return {
        confidence: 0.8,
        reason: '行尾位置，适合补全（已启用）'
      };
    }
    
    // 添加当前触发时间
    state.recentTriggers.push(now);
    // 只保留最近5次触发
    state.recentTriggers = state.recentTriggers.slice(-5);
    
    // 分析打字节奏
    if (state.recentTriggers.length >= 2) {
      const lastInterval = now - state.recentTriggers[state.recentTriggers.length - 2];
      
      // 长暂停后的触发 = 高意图
      if (lastInterval > this.TYPING_PAUSE_THRESHOLD) {
        if (isAtLineEnd) {
          return {
            confidence: 0.9,
            reason: `长暂停(${lastInterval}ms)后在行尾触发`
          };
        }
      }
      
      // 连续快速输入 = 低意图
      if (lastInterval < 100) {
        return {
          confidence: 0.2,
          reason: `连续快速输入(${lastInterval}ms)`
        };
      }
    }
    
    // 基于当前编辑状态
    switch (state.operation) {
      case EditOperation.IDLE:
        return { confidence: 0.8, reason: '空闲状态，高意图' };
      case EditOperation.TYPING:
        return { confidence: 0.6, reason: '输入中，中等意图' };
      case EditOperation.DELETING:
      case EditOperation.UNDOING:
        return { confidence: 0.1, reason: '删除/撤销中，低意图' };
      default:
        return { confidence: 0.5, reason: '默认意图' };
    }
  }
  
  /**
   * 判断是否应该触发补全 - 基于业界最佳实践的综合决策
   */
  shouldTriggerCompletion(document: vscode.TextDocument, position: vscode.Position): {
    shouldTrigger: boolean;
    reason: string;
    debounceTime: number;
    confidence?: number;
  } {
    // 排除不需要监控的文档类型
    if (this.shouldIgnoreDocument(document)) {
      return {
        shouldTrigger: false,
        reason: '忽略的文档类型',
        debounceTime: 0,
        confidence: 0.0
      };
    }
    
    const operation = this.getCurrentOperation(document);
    const debounceTime = this.getAdaptiveDebounceTime(document, position);
    
    // 用户意图预测
    const intent = this.predictUserIntent(document, position);
    
    // 上下文感知检查
    const contextCheck = this.checkTriggerContext(document, position);
    
    // 综合决策逻辑
    switch (operation) {
      case EditOperation.DELETING:
      case EditOperation.UNDOING:
        // 删除和撤销操作：严格禁止触发
        return {
          shouldTrigger: false,
          reason: `${operation}操作中，避免干扰用户`,
          debounceTime,
          confidence: 0.0
        };
        
      case EditOperation.PASTING:
        // 粘贴操作：短暂等待后允许触发
        return {
          shouldTrigger: false,
          reason: '粘贴操作后，等待用户调整',
          debounceTime,
          confidence: 0.2
        };
        
      case EditOperation.TYPING:
        // 输入中：基于上下文和意图综合判断
        const shouldTriggerTyping = contextCheck.valid && intent.confidence > 0.3;
        return {
          shouldTrigger: shouldTriggerTyping,
          reason: `输入中: ${contextCheck.reason}, 意图置信度: ${intent.confidence.toFixed(2)} (${intent.reason})`,
          debounceTime,
          confidence: intent.confidence
        };
        
      case EditOperation.IDLE:
        // 空闲状态：积极触发，但仍需检查上下文
        return {
          shouldTrigger: contextCheck.valid,
          reason: `空闲状态: ${contextCheck.reason}`,
          debounceTime,
          confidence: Math.max(0.7, intent.confidence)
        };
        
      default:
        return {
          shouldTrigger: contextCheck.valid,
          reason: '默认策略基于上下文检查',
          debounceTime,
          confidence: intent.confidence
        };
    }
  }
  
  /**
   * 上下文感知触发检查 - 实现语法Token检查和触发字符表
   */
  private checkTriggerContext(document: vscode.TextDocument, position: vscode.Position): {
    valid: boolean;
    reason: string;
  } {
    try {
      const line = document.lineAt(position.line);
      const textBeforeCursor = line.text.substring(0, position.character);
      const textAfterCursor = line.text.substring(position.character);
      
      // 1. 基础位置检查
      if (position.character === 0) {
        return { valid: true, reason: '行首位置，允许补全' };
      }
      
      // 2. 字符串和注释检查
      if (this.isInString(textBeforeCursor)) {
        return { valid: false, reason: '在字符串中，跳过补全' };
      }
      
      if (this.isInComment(textBeforeCursor)) {
        return { valid: false, reason: '在注释中，跳过补全' };
      }
      
      // 3. 高置信度触发字符检查
      if (this.isHighConfidenceTrigger(document, position)) {
        return { valid: true, reason: '高置信度触发字符' };
      }
      
      // 4. 行尾检查 (通常是好的补全位置)
      if (textAfterCursor.trim() === '') {
        return { valid: true, reason: '在行尾，适合补全' };
      }
      
      // 5. 词边界检查
      const lastChar = textBeforeCursor.slice(-1);
      if (/\s/.test(lastChar)) {
        return { valid: true, reason: '在空白字符后，适合补全' };
      }
      
      // 6. 避免在标识符中间触发
      const beforeChar = textBeforeCursor.slice(-1);
      const afterChar = textAfterCursor.slice(0, 1);
      if (/[a-zA-Z0-9_]/.test(beforeChar) && /[a-zA-Z0-9_]/.test(afterChar)) {
        return { valid: false, reason: '在标识符中间，跳过补全' };
      }
      
      return { valid: true, reason: '上下文检查通过' };
      
    } catch (error) {
      this.logger.warn('上下文检查时出错', error as Error);
      return { valid: true, reason: '上下文检查出错，保守允许' };
    }
  }
  
  /**
   * 检查是否在注释中
   */
  private isInComment(textBeforeCursor: string): boolean {
    // 单行注释
    if (textBeforeCursor.includes('//')) {
      return true;
    }
    
    // 多行注释 (简单检查)
    const openComments = (textBeforeCursor.match(/\/\*/g) || []).length;
    const closeComments = (textBeforeCursor.match(/\*\//g) || []).length;
    
    return openComments > closeComments;
  }
  
  /**
   * 记录补全性能指标 - 用于自适应调整
   */
  recordCompletionMetrics(document: vscode.TextDocument, responseTime: number, accepted: boolean): void {
    const uri = document.uri.toString();
    const state = this.getOrCreateState(uri);
    
    state.lastCompletionRT = responseTime;
    
    // 更新接受率 (指数移动平均)
    const alpha = 0.2; // 平滑因子
    state.acceptanceRate = alpha * (accepted ? 1.0 : 0.0) + (1 - alpha) * state.acceptanceRate;
    
    this.logger.debug(`📊 补全指标: RT=${responseTime}ms, 接受=${accepted}, 接受率=${state.acceptanceRate.toFixed(3)}`);
  }
  
  /**
   * 销毁检测器 - 清理资源
   */
  dispose(): void {
    this.undoRedoListener?.dispose();
    this.selectionListener?.dispose();
    this.editStates.clear();
    
    this.logger.debug('🧹 智能编辑检测器已销毁');
  }
  
  /**
   * 判断输入位置是否适合补全
   */
  private isGoodTypingPosition(document: vscode.TextDocument, position: vscode.Position): boolean {
    try {
      const line = document.lineAt(position.line);
      const textBeforeCursor = line.text.substring(0, position.character);
      const textAfterCursor = line.text.substring(position.character);
      
      // 避免在以下情况触发补全：
      // 1. 在字符串中间
      // 2. 在注释中
      // 3. 在标识符中间（除非是点号后）
      
      // 检查是否在字符串中
      const inString = this.isInString(textBeforeCursor);
      if (inString) {
        return false;
      }
      
      // 检查是否在注释中
      if (textBeforeCursor.includes('//') || textBeforeCursor.includes('/*')) {
        return false;
      }
      
      // 检查是否在合适的触发位置（如点号后、空白后等）
      const lastChar = textBeforeCursor.slice(-1);
      const goodTriggerChars = ['.', ' ', '\t', '(', '[', '{', '=', ':', ';'];
      
      if (goodTriggerChars.includes(lastChar)) {
        return true;
      }
      
      // 检查是否在行尾（通常是好的补全位置）
      if (textAfterCursor.trim() === '') {
        return true;
      }
      
      return false;
      
    } catch (error) {
      this.logger.warn('检查输入位置时出错', error as Error);
      return true; // 出错时保守地允许补全
    }
  }
  
  /**
   * 检查是否在字符串中
   */
  private isInString(text: string): boolean {
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inTemplate = false;
    
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const prevChar = i > 0 ? text[i - 1] : '';
      
      if (char === "'" && prevChar !== '\\' && !inDoubleQuote && !inTemplate) {
        inSingleQuote = !inSingleQuote;
      } else if (char === '"' && prevChar !== '\\' && !inSingleQuote && !inTemplate) {
        inDoubleQuote = !inDoubleQuote;
      } else if (char === '`' && prevChar !== '\\' && !inSingleQuote && !inDoubleQuote) {
        inTemplate = !inTemplate;
      }
    }
    
    return inSingleQuote || inDoubleQuote || inTemplate;
  }
  
  /**
   * 判断是否应该进行文件同步
   */
  shouldSyncFile(document: vscode.TextDocument): {
    shouldSync: boolean;
    reason: string;
    useIncrementalSync: boolean;
  } {
    // 排除不需要监控的文档类型
    if (this.shouldIgnoreDocument(document)) {
      return {
        shouldSync: false,
        reason: '忽略的文档类型',
        useIncrementalSync: false
      };
    }
    
    const operation = this.getCurrentOperation(document);
    const uri = document.uri.toString();
    const state = this.editStates.get(uri);
    
    if (!state) {
      return {
        shouldSync: true,
        reason: '首次同步',
        useIncrementalSync: false
      };
    }
    
    // 基于编辑状态和变化量决定同步策略
    switch (operation) {
      case EditOperation.DELETING:
        // 删除操作中，如果变化不大，延迟同步
        if (state.totalCharsChanged < 10) {
          return {
            shouldSync: false,
            reason: '删除操作中，变化较小，延迟同步',
            useIncrementalSync: true
          };
        }
        break;
        
      case EditOperation.TYPING:
        // 输入中，使用增量同步但降低频率
        if (state.changeCount < 3) {
          return {
            shouldSync: false,
            reason: '输入操作中，变化较少，延迟同步',
            useIncrementalSync: true
          };
        }
        break;
        
      case EditOperation.UNDOING:
      case EditOperation.PASTING:
        // 撤销和粘贴后应该立即同步
        return {
          shouldSync: true,
          reason: '撤销/粘贴操作完成，立即同步',
          useIncrementalSync: false // 大变化使用完整上传
        };
    }
    
    // 默认策略：小变化用增量同步，大变化用完整上传
    const useIncremental = state.totalCharsChanged < 100;
    
    return {
      shouldSync: true,
      reason: `编辑状态: ${operation}, 变化: ${state.totalCharsChanged}字符`,
      useIncrementalSync: useIncremental
    };
  }
  
  /**
   * 清理过期的编辑状态
   */
  cleanup(): void {
    const now = Date.now();
    const expiredThreshold = 300000; // 5分钟
    
    for (const [uri, state] of this.editStates.entries()) {
      if (now - state.lastChangeTime > expiredThreshold) {
        this.editStates.delete(uri);
        this.logger.debug(`🧹 清理过期的编辑状态: ${uri}`);
      }
    }
  }
  
  /**
   * 判断是否应该忽略某个文档
   */
  private shouldIgnoreDocument(document: vscode.TextDocument): boolean {
    const uri = document.uri.toString();
    const scheme = document.uri.scheme;
    const fileName = document.fileName || '';
    
    // 忽略的 URI scheme
    const ignoredSchemes = [
      'output',           // 输出面板
      'log',              // 日志文件
      'extension-output', // 扩展输出
      'debug',            // 调试控制台
      'search-editor',    // 搜索编辑器
      'vscode-settings',  // VS Code 设置
      'git',              // Git 相关
      'vscode-userdata',  // 用户数据
      'vscode-test-web'   // 测试环境
    ];
    
    if (ignoredSchemes.includes(scheme)) {
      return true;
    }
    
    // 忽略特定的文件模式
    const ignoredPatterns = [
      /extension-output/i,    // 扩展输出面板
      /output-/i,             // 输出相关
      /\.log$/i,              // 日志文件
      /\.tmp$/i,              // 临时文件
      /untitled:/i,           // 未命名文件（在某些情况下）
      /search-editor:/i       // 搜索编辑器
    ];
    
    for (const pattern of ignoredPatterns) {
      if (pattern.test(uri) || pattern.test(fileName)) {
        return true;
      }
    }
    
    // 忽略只读文档（输出面板通常是只读的）
    if (document.isUntitled && document.languageId === 'log') {
      return true;
    }
    
    // 忽略过大的文档（通常是日志或输出）
    if (document.getText().length > 1024 * 1024) { // 1MB
      return true;
    }
    
    return false;
  }

  /**
   * 获取调试信息
   */
  getDebugInfo(): { [uri: string]: EditState } {
    const info: { [uri: string]: EditState } = {};
    for (const [uri, state] of this.editStates.entries()) {
      info[uri] = { ...state };
    }
    return info;
  }
}

/**
 * 单例模式的智能编辑检测器
 */
export const smartEditDetector = new SmartEditDetector();