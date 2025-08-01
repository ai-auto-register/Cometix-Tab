import * as vscode from 'vscode';
import type { CompletionRequest, CompletionResponse, SSEEventType } from '../types';
import { Logger } from '../utils/logger';
import { CursorApiClient } from './api-client';
import { FileManager } from './file-manager';
import { StreamCppResponse } from '../generated/cpp_pb';
import { SmartCompletionDiffer } from '../utils/smart-completion-differ';
import { CompletionContext } from '../types/completion-diff';

export class CursorCompletionProvider implements vscode.InlineCompletionItemProvider {
  private logger: Logger;
  private apiClient: CursorApiClient;
  private fileManager: FileManager;
  private smartDiffer: SmartCompletionDiffer;
  private abortController: AbortController | null = null;
  private lastRequestTime: number = 0;
  private debounceTimer: NodeJS.Timeout | null = null;
  private lastDocumentState: { version: number; content: string } | null = null;
  private readonly DEBOUNCE_DELAY = 300; // 300ms防抖，更快响应
  private readonly MIN_REQUEST_INTERVAL = 500; // 最小请求间隔500ms
  private readonly MIN_INPUT_LENGTH = 2; // 最少输入2个字符才触发
  
  constructor(apiClient: CursorApiClient, fileManager: FileManager) {
    this.logger = Logger.getInstance();
    this.apiClient = apiClient;
    this.fileManager = fileManager;
    this.smartDiffer = SmartCompletionDiffer.getInstance();
  }
  
  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | undefined> {
    
    return new Promise((resolve) => {
      // 清除之前的防抖计时器
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      
      // 设置防抖延迟
      this.debounceTimer = setTimeout(async () => {
        try {
          const result = await this.executeCompletion(document, position, context, token);
          resolve(result);
        } catch (error) {
          this.logger.error('❌ 代码补全执行失败', error as Error);
          resolve(undefined);
        }
      }, this.DEBOUNCE_DELAY);
    });
  }
  
  private async executeCompletion(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | undefined> {
    try {
      this.logger.debug(`🔍 触发代码补全 - 文件: ${document.fileName}, 位置: ${position.line}:${position.character}`);
      
      // 检查是否应该触发补全
      if (!this.shouldTriggerCompletion(document, position)) {
        return undefined;
      }
      
      // 检查请求频率限制
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL) {
        this.logger.debug(`⏰ 请求过于频繁，跳过 (间隔: ${timeSinceLastRequest}ms < ${this.MIN_REQUEST_INTERVAL}ms)`);
        return undefined;
      }
      
      // 取消之前的请求
      if (this.abortController) {
        this.logger.debug('🛑 取消之前的请求');
        this.abortController.abort();
      }
      this.abortController = new AbortController();
      this.lastRequestTime = now;
      
      // 获取当前文件信息
      const currentFile = await this.fileManager.getCurrentFileInfo(document);
      this.logger.debug(`📄 文件信息: 路径=${currentFile.path}, 内容长度=${currentFile.content.length}, SHA256=${currentFile.sha256}`);
      
      // 检查是否为有效的补全场景
      if (currentFile.content.length === 0 && position.line === 0 && position.character === 0) {
        this.logger.debug('📝 空文件，跳过补全');
        return undefined;
      }
      
      // 检查光标是否在文件末尾附近（这是补全的最佳场景）
      const line = document.lineAt(position.line);
      const isAtEndOfLine = position.character >= line.text.length;
      const isNearEndOfFile = position.line >= document.lineCount - 5;
      
      this.logger.debug(`📍 补全上下文: 行末=${isAtEndOfLine}, 文件末尾附近=${isNearEndOfFile}`);
      
      // 获取多文件上下文 - 这是提升补全质量的关键
      this.logger.info('🔍 开始收集多文件上下文...');
      const additionalFiles = await this.fileManager.getMultiFileContext(document, 8);
      this.logger.info(`📚 收集到 ${additionalFiles.length} 个上下文文件`);

      // 构建补全请求
      const request: CompletionRequest = {
        currentFile,
        cursorPosition: {
          line: position.line,
          column: position.character
        },
        context: this.getContext(document, position),
        modelName: 'auto', // TODO: 从配置中获取
        debugOutput: true, // 开启调试输出
        // 多文件上下文支持 - 显著提升补全质量
        additionalFiles: additionalFiles.slice(1) // 排除当前文件（已在currentFile中）
      };
      
      this.logger.debug(`🚀 准备发送补全请求`);
      
      // 请求补全
      const messageStream = await this.apiClient.requestCompletion(request, this.abortController.signal);
      if (!messageStream) {
        this.logger.warn('⚠️  API客户端返回null，无法获取补全');
        return undefined;
      }
      
      // 解析流式响应
      const completion = await this.parseMessageStream(messageStream, token);
      if (!completion || !completion.text) {
        this.logger.debug('📭 没有获得有效的补全内容');
        return undefined;
      }
      
      this.logger.info(`✅ 获得补全内容: "${completion.text.substring(0, 50)}${completion.text.length > 50 ? '...' : ''}"`);
      
      // 创建补全项 - 简化范围处理以修复幽灵文本显示问题
      let insertText = completion.text;
      let range: vscode.Range;
      
      // 🔧 CRITICAL FIX: 完全重写范围处理逻辑，使用最简单可靠的方式
      if (completion.range) {
        this.logger.debug(`🔄 API返回范围: ${completion.range.startLine}-${completion.range.endLine}, 光标: ${position.line}:${position.character}`);
      }
      
      // 🔧 CRITICAL: 强制使用插入模式，这是VSCode幽灵文本最可靠的显示方式
      range = new vscode.Range(position, position);
      this.logger.debug(`📝 强制使用插入模式: ${position.line}:${position.character}`);
      
      // 🔧 重新启用智能diff优化，现在应该能正确处理重复内容
      insertText = this.optimizeCompletionTextWithDiff(insertText, document, position);
      
      const item = new vscode.InlineCompletionItem(insertText, range);
      
      // 设置补全项的额外信息
      if (completion.cursorPosition) {
        // TODO: 处理光标预测位置
        this.logger.debug(`🎯 预测光标位置: ${completion.cursorPosition.line}:${completion.cursorPosition.column}`);
      }
      
      // 🔧 CRITICAL: 不设置command，避免干扰VSCode的内置行为
      // item.command = {
      //   command: 'cometix-tab.completionAccepted',
      //   title: 'Completion Accepted'
      // };
      
      // 详细的调试信息
      this.logger.info(`🎉 创建补全项成功！`);
      this.logger.info(`   📏 文本长度: ${insertText.length}`);
      this.logger.info(`   📍 范围: ${range.start.line}:${range.start.character} → ${range.end.line}:${range.end.character}`);
      this.logger.info(`   🎯 光标位置: ${position.line}:${position.character}`);
      this.logger.info(`   📝 补全预览: "${insertText.substring(0, 100)}${insertText.length > 100 ? '...' : ''}"`);
      this.logger.info(`   🔗 范围类型: ${range.start.isEqual(range.end) ? '插入' : '替换'}`);
      
      // 🔧 CRITICAL: 增强验证补全项的有效性
      if (!insertText || insertText.length === 0) {
        this.logger.warn('⚠️ 补全文本为空，VSCode不会显示幽灵文本');
        return undefined;
      }
      
      if (range.start.isAfter(range.end)) {
        this.logger.error('❌ 无效的范围：起始位置在结束位置之后');
        return undefined;
      }
      
      // 🔧 CRITICAL: 检查范围是否在文档边界内
      if (range.start.line < 0 || range.start.line >= document.lineCount || 
          range.end.line < 0 || range.end.line >= document.lineCount) {
        this.logger.error('❌ 范围超出文档边界');
        return undefined;
      }
      
      // 🔧 返回InlineCompletionList以确保更好的控制
      const completionList = new vscode.InlineCompletionList([item]);
      
      this.logger.info(`🚀 返回补全列表，包含 ${completionList.items.length} 个项目`);
      
      return completionList;
      
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.debug('🛑 补全请求被取消');
        return undefined;
      }
      
      this.logger.error('❌ 代码补全失败', error as Error);
      return undefined;
    }
  }

  /**
   * 判断是否应该触发补全
   * 只在有意义的输入场景下触发，而不是每次文档变化都触发
   */
  private shouldTriggerCompletion(document: vscode.TextDocument, position: vscode.Position): boolean {
    try {
      // 检查文档是否有足够的内容
      if (document.getText().trim().length < this.MIN_INPUT_LENGTH) {
        this.logger.debug('📝 文档内容太少，跳过补全');
        return false;
      }

      // 获取当前行内容
      const currentLine = document.lineAt(position.line);
      const textBeforeCursor = currentLine.text.substring(0, position.character);
      const textAfterCursor = currentLine.text.substring(position.character);

      // 检查是否在字符串或注释中（通常不需要补全）
      if (this.isInStringOrComment(textBeforeCursor)) {
        this.logger.debug('💬 在字符串或注释中，跳过补全');
        return false;
      }

      // 检查是否在有意义的位置（如行末、标点符号后等）
      const isMeaningfulPosition = this.isMeaningfulCompletionPosition(textBeforeCursor, textAfterCursor);
      if (!isMeaningfulPosition) {
        this.logger.debug('🎯 不是有意义的补全位置，跳过');
        return false;
      }

      // 🔧 放宽文档变化检查（避免过于严格阻止补全）
      const currentState = { version: document.version, content: document.getText() };
      if (this.lastDocumentState) {
        const contentDiff = Math.abs(currentState.content.length - this.lastDocumentState.content.length);
        if (contentDiff < 1) { // 少于1个字符变化
          this.logger.debug('📏 文档变化太小，跳过补全');
          return false;
        }
      }
      this.lastDocumentState = currentState;

      this.logger.debug('✅ 满足补全触发条件');
      return true;

    } catch (error) {
      this.logger.warn('⚠️ 检查补全触发条件时出错', error as Error);
      return false;
    }
  }

  /**
   * 检查是否在字符串或注释中
   */
  private isInStringOrComment(textBeforeCursor: string): boolean {
    // 简单检查：如果前面有未闭合的引号，可能在字符串中
    const singleQuotes = (textBeforeCursor.match(/'/g) || []).length;
    const doubleQuotes = (textBeforeCursor.match(/"/g) || []).length;
    const backQuotes = (textBeforeCursor.match(/`/g) || []).length;
    
    // 检查是否在注释中
    if (textBeforeCursor.includes('//') || textBeforeCursor.includes('/*')) {
      return true;
    }
    
    // 奇数个引号表示在字符串中
    return (singleQuotes % 2 === 1) || (doubleQuotes % 2 === 1) || (backQuotes % 2 === 1);
  }

  /**
   * 使用智能diff算法优化补全文本
   */
  private optimizeCompletionTextWithDiff(apiResponse: string, document: vscode.TextDocument, position: vscode.Position): string {
    if (!apiResponse) return apiResponse;
    
    try {
      // 构建补全上下文
      const context = this.buildCompletionContext(document, position);
      
      // 使用智能diff算法提取精确的补全内容
      const diffResult = this.smartDiffer.extractCompletionDiff(context, apiResponse);
      
      // 记录详细的diff处理日志
      this.logger.info(`🔧 Diff算法结果:`);
      this.logger.info(`   📊 方法: ${diffResult.method}`);
      this.logger.info(`   🎯 置信度: ${diffResult.confidence.toFixed(3)}`);
      this.logger.info(`   ⏱️ 处理时间: ${diffResult.processingTimeMs.toFixed(2)}ms`);
      this.logger.info(`   📏 原始长度: ${apiResponse.length} → 优化长度: ${diffResult.insertText.length}`);
      
      if (diffResult.optimizations.length > 0) {
        this.logger.info(`   🔧 优化操作: ${diffResult.optimizations.join(', ')}`);
      }
      
      // 如果置信度过低，使用简化的回退策略
      if (diffResult.confidence < 0.3) {
        this.logger.warn(`⚠️ diff置信度过低 (${diffResult.confidence.toFixed(3)})，使用简化策略`);
        return this.simpleFallbackOptimization(apiResponse, document, position);
      }
      
      return diffResult.insertText;
      
    } catch (error) {
      this.logger.error('❌ 智能diff优化失败，使用简化策略', error as Error);
      return this.simpleFallbackOptimization(apiResponse, document, position);
    }
  }
  
  /**
   * 构建补全上下文
   */
  private buildCompletionContext(document: vscode.TextDocument, position: vscode.Position): CompletionContext {
    const currentLine = document.lineAt(position.line);
    const textBeforeCursor = currentLine.text.substring(0, position.character);
    const textAfterCursor = currentLine.text.substring(position.character);
    
    // 获取更多上下文（前后各10行）
    const startLine = Math.max(0, position.line - 10);
    const endLine = Math.min(document.lineCount - 1, position.line + 10);
    
    let fullBeforeCursor = '';
    let fullAfterCursor = '';
    
    // 收集光标前的上下文
    for (let i = startLine; i < position.line; i++) {
      fullBeforeCursor += document.lineAt(i).text + '\n';
    }
    fullBeforeCursor += textBeforeCursor;
    
    // 收集光标后的上下文
    fullAfterCursor = textAfterCursor;
    for (let i = position.line + 1; i <= endLine; i++) {
      fullAfterCursor += '\n' + document.lineAt(i).text;
    }
    
    return {
      beforeCursor: fullBeforeCursor,
      afterCursor: fullAfterCursor,
      currentLine: currentLine.text,
      position,
      language: document.languageId,
      indentation: this.detectIndentation(textBeforeCursor)
    };
  }
  
  /**
   * 基础文本清理 - 最简单的清理逻辑
   */
  private basicTextCleanup(text: string): string {
    if (!text) return text;
    
    // 只做最基本的清理
    let cleanText = text;
    
    // 移除过多的连续空行
    cleanText = cleanText.replace(/\n\n\n+/g, '\n\n');
    
    // 限制长度
    if (cleanText.length > 500) {
      cleanText = cleanText.substring(0, 500);
      this.logger.debug(`✂️ 基础清理：截断至500字符`);
    }
    
    return cleanText;
  }

  /**
   * 简单的文本清理 - 替代复杂的diff算法
   */
  private simpleTextCleanup(text: string, document: vscode.TextDocument, position: vscode.Position): string {
    if (!text || text.trim().length === 0) {
      return text;
    }
    
    try {
      const currentLine = document.lineAt(position.line);
      const textBeforeCursor = currentLine.text.substring(0, position.character);
      
      let cleanText = text;
      
      // 移除明显重复的前缀（最后一个单词）
      const wordsBeforeCursor = textBeforeCursor.trim().split(/\s+/);
      const lastWord = wordsBeforeCursor[wordsBeforeCursor.length - 1] || '';
      
      if (lastWord.length > 1 && cleanText.toLowerCase().startsWith(lastWord.toLowerCase())) {
        cleanText = cleanText.substring(lastWord.length);
        this.logger.debug(`🧹 移除重复前缀: "${lastWord}"`);
      }
      
      // 限制长度以避免过长的补全
      if (cleanText.length > 300) {
        // 在合理的位置截断（行末或语句末）
        const truncatePos = cleanText.substring(0, 300).lastIndexOf('\n');
        if (truncatePos > 100) {
          cleanText = cleanText.substring(0, truncatePos);
        } else {
          cleanText = cleanText.substring(0, 300);
        }
        this.logger.debug(`✂️ 截断过长文本至 ${cleanText.length} 字符`);
      }
      
      return cleanText;
      
    } catch (error) {
      this.logger.warn('⚠️ 文本清理失败，使用原始文本', error as Error);
      return text;
    }
  }

  /**
   * 简化的回退优化策略
   */
  private simpleFallbackOptimization(text: string, document: vscode.TextDocument, position: vscode.Position): string {
    const currentLine = document.lineAt(position.line);
    const textBeforeCursor = currentLine.text.substring(0, position.character);
    
    let result = text;
    
    // 基础的重复内容移除
    const wordsBeforeCursor = textBeforeCursor.trim().split(/\s+/);
    const lastWord = wordsBeforeCursor[wordsBeforeCursor.length - 1] || '';
    
    if (lastWord && result.toLowerCase().startsWith(lastWord.toLowerCase()) && lastWord.length > 1) {
      result = result.substring(lastWord.length);
      this.logger.debug(`🔧 简化策略：移除重复单词 "${lastWord}"`);
    }
    
    // 基础长度限制
    if (result.length > 500) {
      result = result.substring(0, 500);
      this.logger.debug(`🔧 简化策略：截断至500字符`);
    }
    
    return result;
  }
  
  /**
   * 检测当前行的缩进
   */
  private detectIndentation(lineText: string): string {
    const match = lineText.match(/^(\s*)/);
    return match ? match[1] : '';
  }

  /**
   * 检查是否是有意义的补全位置
   */
  private isMeaningfulCompletionPosition(textBeforeCursor: string, textAfterCursor: string): boolean {
    const trimmedBefore = textBeforeCursor.trim();
    const trimmedAfter = textAfterCursor.trim();

    // 空行或行末 - 好的补全位置
    if (trimmedBefore.length === 0 || trimmedAfter.length === 0) {
      return true;
    }

    // 在标点符号后 - 好的补全位置
    const meaningfulEndings = ['.', '(', '{', '[', '=', ':', ';', ',', ' ', '\t'];
    const lastChar = trimmedBefore.slice(-1);
    if (meaningfulEndings.includes(lastChar)) {
      return true;
    }

    // 在关键字后 - 好的补全位置
    const keywords = ['function', 'class', 'const', 'let', 'var', 'if', 'for', 'while', 'return', 'import', 'export'];
    const words = trimmedBefore.split(/\s+/);
    const lastWord = words[words.length - 1];
    if (keywords.includes(lastWord)) {
      return true;
    }

    // 在字母数字中间 - 不好的补全位置
    if (/\w$/.test(trimmedBefore) && /^\w/.test(trimmedAfter)) {
      return false;
    }

    return true;
  }
  
  private getContext(document: vscode.TextDocument, position: vscode.Position): string {
    // 获取光标前后的上下文
    const beforeRange = new vscode.Range(
      Math.max(0, position.line - 10),
      0,
      position.line,
      position.character
    );
    
    const afterRange = new vscode.Range(
      position.line,
      position.character,
      Math.min(document.lineCount - 1, position.line + 10),
      0
    );
    
    const beforeText = document.getText(beforeRange);
    const afterText = document.getText(afterRange);
    
    return beforeText + '|CURSOR|' + afterText;
  }
  
  private async parseMessageStream(
    messageStream: AsyncIterable<any>,
    token: vscode.CancellationToken
  ): Promise<CompletionResponse | null> {
    
    let completion: CompletionResponse = { text: '' };
    
    let lastLogTime = Date.now();
    const LOG_INTERVAL = 1000; // 每秒最多记录一次进度
    
    try {
      for await (const message of messageStream) {
        if (token.isCancellationRequested) {
          this.logger.debug('🛑 用户取消补全解析');
          return null;
        }
        
        // 避免过多的日志输出
        const now = Date.now();
        const shouldLog = now - lastLogTime > LOG_INTERVAL;
        if (shouldLog) {
          lastLogTime = now;
        }
        
        // 处理 Connect RPC StreamCppResponse
        if (message instanceof StreamCppResponse) {
          await this.handleStreamCppResponse(message, completion);
          
          // 检查流是否结束
          if (message.doneStream) {
            this.logger.info('✅ StreamCpp 流式调用完成');
            break;
          }
          
          // 检查编辑是否完成（可能有多个编辑周期）
          if (message.doneEdit) {
            if (shouldLog) {
              this.logger.debug('🎨 单个编辑周期完成');
            }
          }
          
          // 提供进度反馈
          if (message.text && shouldLog) {
            this.logger.debug(`📝 累计补全长度: ${completion.text.length} 字符`);
          }
        } else {
          // 处理传统 SSE 消息（向后兼容）
          await this.handleSSEMessage(message, completion);
          
          // 如果是流结束消息，停止解析
          if (message.type === 'done_stream') {
            this.logger.info('✅ 传统SSE流式调用完成');
            break;
          }
        }
      }
      
      return completion;
      
    } catch (error) {
      const err = error as Error;
      if (err.name === 'AbortError') {
        this.logger.debug('🛑 流式解析被取消');
      } else {
        this.logger.error('❌ 流式解析错误', err);
      }
      return null;
    }
  }
  
  private parseSSEEvents(buffer: string): { parsed: SSEEvent[], remaining: string } {
    const events: SSEEvent[] = [];
    const lines = buffer.split('\n');
    let remaining = '';
    let currentEvent: Partial<SSEEvent> = {};
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line === '') {
        // 空行表示事件结束
        if (currentEvent.type) {
          events.push(currentEvent as SSEEvent);
        }
        currentEvent = {};
      } else if (line.startsWith('event: ')) {
        currentEvent.type = line.substring(7) as SSEEventType;
      } else if (line.startsWith('data: ')) {
        currentEvent.data = line.substring(6);
      } else if (i === lines.length - 1 && !line.includes('\n')) {
        // 最后一行可能不完整
        remaining = line;
      }
    }
    
    return { parsed: events, remaining };
  }
  
  /**
   * 处理 Connect RPC StreamCppResponse
   */
  private async handleStreamCppResponse(response: StreamCppResponse, completion: CompletionResponse): Promise<void> {
    // 处理文本补全内容
    if (response.text) {
      completion.text += response.text;
      
      // 只在有意义的文本内容时记录
      if (response.text.trim().length > 0) {
        this.logger.debug(`📝 接收到补全文本: "${response.text.substring(0, 50)}${response.text.length > 50 ? '...' : ''}"`);
      }
    }
    
    // 处理建议开始行
    if (response.suggestionStartLine !== undefined) {
      this.logger.debug(`📍 建议开始行: ${response.suggestionStartLine}`);
    }
    
    // 处理置信度
    if (response.suggestionConfidence !== undefined) {
      this.logger.debug(`🎯 建议置信度: ${response.suggestionConfidence}`);
    }
    
    // 处理光标预测
    if (response.cursorPredictionTarget) {
      const expectedContent = response.cursorPredictionTarget.expectedContent || '';
      
      completion.cursorPosition = {
        line: response.cursorPredictionTarget.lineNumberOneIndexed - 1, // 转换为0索引
        column: expectedContent.length // 使用预期内容的长度作为列位置
      };
      
      this.logger.debug(`🎯 光标预测: 行 ${completion.cursorPosition.line}, 列 ${completion.cursorPosition.column}`);
      if (expectedContent) {
        this.logger.debug(`📝 预期内容: "${expectedContent}"`);
      }
      
      // 处理重新触发标志
      if (response.cursorPredictionTarget.shouldRetriggerCpp) {
        this.logger.debug('🔄 建议重新触发补全');
      }
    }
    
    // 处理范围替换（新的rangeToReplace字段）
    if (response.rangeToReplace) {
      // 注意：protobuf中的行号是1-based，需要转换为0-based
      const startLine = Math.max(0, (response.rangeToReplace.startLineNumber || 1) - 1);
      const endLine = Math.max(0, (response.rangeToReplace.endLineNumberInclusive || 1) - 1);
      
      completion.range = {
        startLine: startLine,
        endLine: endLine
      };
      this.logger.debug(`🔄 范围替换: protobuf(${response.rangeToReplace.startLineNumber}-${response.rangeToReplace.endLineNumberInclusive}) -> vscode(${startLine}-${endLine})`);
    }
    
    // 处理模型信息
    if (response.modelInfo) {
      this.logger.debug('🤖 模型信息:', {
        isFusedCursorPredictionModel: response.modelInfo.isFusedCursorPredictionModel,
        isMultidiffModel: response.modelInfo.isMultidiffModel
      });
    }
    
    // 处理各种调试信息
    if (response.debugModelOutput) {
      this.logger.debug(`🐛 模型输出: ${response.debugModelOutput}`);
    }
    if (response.debugModelInput) {
      this.logger.debug(`📝 模型输入: ${response.debugModelInput.substring(0, 200)}...`);
    }
    if (response.debugStreamTime) {
      this.logger.debug(`⏱️ 流时间: ${response.debugStreamTime}`);
    }
    if (response.debugTotalTime) {
      this.logger.debug(`🕰️ 总时间: ${response.debugTotalTime}`);
    }
    if (response.debugTtftTime) {
      this.logger.debug(`⚡ TTFT时间: ${response.debugTtftTime}`);
    }
    if (response.debugServerTiming) {
      this.logger.debug(`🚀 服务器时间: ${response.debugServerTiming}`);
    }
    
    // 处理编辑状态
    if (response.beginEdit) {
      this.logger.debug('🎨 开始编辑');
    }
    if (response.doneEdit) {
      this.logger.debug('✅ 编辑完成');
    }
    
    // 处理特殊格式化选项
    if (response.shouldRemoveLeadingEol) {
      this.logger.debug('📏 应移除前导换行符');
      
      // 实际移除前导换行符
      if (completion.text.startsWith('\n') || completion.text.startsWith('\r\n')) {
        completion.text = completion.text.replace(/^\r?\n/, '');
        this.logger.debug('✂️ 已移除前导换行符');
      }
    }
    
    // 处理绑定ID
    if (response.bindingId) {
      this.logger.debug(`🔗 绑定ID: ${response.bindingId}`);
    }
    
    // 处理空响应情况，提供更详细的分析
    if (!response.text && response.doneStream) {
      if (!response.beginEdit) {
        this.logger.debug('📭 收到空补全响应 - 模型认为当前上下文不需要补全');
      } else {
        this.logger.debug('📝 收到空补全响应 - 编辑周期已开始但无文本内容');
      }
    }
  }
  
  /**
   * 处理传统 SSE 消息（向后兼容）
   */
  private async handleSSEMessage(message: any, completion: CompletionResponse): Promise<void> {
    switch (message.type) {
      case 'text':
        // 文本补全内容
        if (typeof message.data === 'string') {
          completion.text += message.data;
        }
        break;
        
      case 'range_replace':
        // 范围替换信息
        try {
          const rangeData = typeof message.data === 'object' ? message.data : JSON.parse(message.data || '{}');
          completion.range = {
            startLine: rangeData.startLine || rangeData.start_line,
            endLine: rangeData.endLineInclusive || rangeData.end_line_inclusive
          };
        } catch (e) {
          this.logger.warn('Failed to parse range_replace data', e as Error);
        }
        break;
        
      case 'cursor_prediction':
        // 光标预测位置
        try {
          const cursorData = typeof message.data === 'object' ? message.data : JSON.parse(message.data || '{}');
          completion.cursorPosition = {
            line: cursorData.line || cursorData.line_number_one_indexed - 1, // 转换为0索引
            column: cursorData.column || 0
          };
        } catch (e) {
          this.logger.warn('Failed to parse cursor_prediction data', e as Error);
        }
        break;
        
      case 'model_info':
        // 模型信息，记录到日志
        this.logger.debug('Received model info:', message.data);
        break;
        
      case 'protobuf_message':
        // Protobuf消息，处理结构化数据
        if (message.data && typeof message.data === 'object') {
          if (message.data.text) {
            completion.text += message.data.text;
          }
          if (message.data.suggestion_start_line !== undefined) {
            // 处理建议开始行
            this.logger.debug(`Suggestion starts at line: ${message.data.suggestion_start_line}`);
          }
          if (message.data.done_stream) {
            this.logger.debug('✅ Protobuf消息指示流结束');
          }
        }
        break;
        
      case 'done_edit':
        // 编辑完成
        this.logger.debug('Edit completed');
        break;
        
      case 'done_stream':
        // 流结束
        this.logger.debug('Stream completed');
        break;
        
      case 'error':
        // 错误消息
        this.logger.error(`Completion error: ${message.data || 'Unknown error'}`);
        break;
        
      case 'debug':
        // 调试信息
        this.logger.debug(`Completion debug: ${message.data || ''}`);
        break;
        
      case 'heartbeat':
        // 心跳消息，保持连接活跃
        this.logger.debug('Received heartbeat');
        break;
        
      default:
        // 未知消息类型
        this.logger.warn(`Unknown message type: ${message.type}`, message);
        break;
    }
  }
}

interface SSEEvent {
  type: SSEEventType;
  data?: string;
}