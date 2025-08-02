import { diffChars, diffWords, diffLines, Change } from 'diff';
import * as vscode from 'vscode';
import { 
  CompletionContext, 
  DiffExtractionResult, 
  DiffMethod, 
  ContentType,
  DiffOptions,
  PerformanceMetrics 
} from '../types/completion-diff';
import { ContentAnalyzer } from './content-analyzer';
import { DiffConfigManager } from './diff-config';
import { ConfidenceEvaluator } from './confidence-evaluator';
import { Logger } from './logger';

/**
 * 智能补全差异提取器
 * 使用diff库的多种算法智能提取补全内容
 */
export class SmartCompletionDiffer {
  private static instance: SmartCompletionDiffer;
  private logger: Logger;
  private contentAnalyzer: ContentAnalyzer;
  private configManager: DiffConfigManager;
  private confidenceEvaluator: ConfidenceEvaluator;
  private cache = new Map<string, DiffExtractionResult>();
  
  public static getInstance(): SmartCompletionDiffer {
    if (!SmartCompletionDiffer.instance) {
      SmartCompletionDiffer.instance = new SmartCompletionDiffer();
    }
    return SmartCompletionDiffer.instance;
  }
  
  constructor() {
    this.logger = Logger.getInstance();
    this.contentAnalyzer = ContentAnalyzer.getInstance();
    this.configManager = DiffConfigManager.getInstance();
    this.confidenceEvaluator = ConfidenceEvaluator.getInstance();
  }
  
  /**
   * 智能提取补全差异 - 主入口方法
   */
  extractCompletionDiff(context: CompletionContext, apiResponse: string): DiffExtractionResult {
    const startTime = performance.now();
    
    // 1. 生成缓存键
    const cacheKey = this.generateCacheKey(context, apiResponse);
    const cachedResult = this.cache.get(cacheKey);
    if (cachedResult) {
      this.logger.debug('🔄 使用缓存的diff结果');
      return cachedResult;
    }
    
    // 2. 分析内容类型
    const contentType = this.contentAnalyzer.analyzeContentType(context, apiResponse);
    this.logger.info(`🔍 内容类型分析: ${contentType}`);
    
    // 3. 获取优化配置
    const config = this.configManager.getOptimizedConfig(context, contentType, apiResponse.length);
    
    // 4. 选择最优策略并执行
    let result: DiffExtractionResult;
    
    try {
      result = this.executeOptimalStrategy(context, apiResponse, contentType, config);
    } catch (error) {
      this.logger.warn('🔄 主策略失败，使用回退策略', error as Error);
      result = this.executeFallbackStrategy(context, apiResponse);
    }
    
    // 5. 记录性能指标
    const endTime = performance.now();
    result.processingTimeMs = endTime - startTime;
    
    this.logPerformanceMetrics({
      startTime,
      endTime,
      inputLength: context.beforeCursor.length + context.afterCursor.length + apiResponse.length,
      outputLength: result.insertText.length,
      method: result.method,
      confidence: result.confidence
    });
    
    // 6. 缓存结果
    if (result.confidence > 0.7) {
      this.cache.set(cacheKey, result);
    }
    
    return result;
  }
  
  /**
   * 执行最优策略
   */
  private executeOptimalStrategy(
    context: CompletionContext, 
    apiResponse: string, 
    contentType: ContentType,
    config: DiffOptions
  ): DiffExtractionResult {
    // 根据内容类型选择策略
    switch (contentType) {
      case ContentType.PARTIAL_WORD:
        return this.extractUsingCharDiff(context, apiResponse, config);
        
      case ContentType.COMPLETE_WORD:
      case ContentType.EXPRESSION:
        return this.extractUsingWordDiff(context, apiResponse, config);
        
      case ContentType.MULTI_LINE:
      case ContentType.BLOCK_STRUCTURE:
        return this.extractUsingLineDiff(context, apiResponse, config);
        
      default:
        // 对未知类型使用混合策略
        return this.extractUsingHybridStrategy(context, apiResponse, config);
    }
  }
  
  /**
   * 字符级精确差异提取
   */
  private extractUsingCharDiff(
    context: CompletionContext, 
    apiResponse: string, 
    config: DiffOptions
  ): DiffExtractionResult {
    const currentText = context.beforeCursor + context.afterCursor;
    const expectedText = context.beforeCursor + apiResponse + context.afterCursor;
    
    this.logger.debug('🔤 使用字符级diff算法');
    this.logger.debug(`当前文本: "${currentText.substring(0, 100)}..."`);
    this.logger.debug(`预期文本: "${expectedText.substring(0, 100)}..."`);
    
    // Note: diffChars doesn't support ignoreWhitespace option
    const changes = diffChars(currentText, expectedText);
    
    return this.processChangesToInsertion(changes, context, DiffMethod.CHARACTER_DIFF);
  }
  
  /**
   * 单词级差异提取
   */
  private extractUsingWordDiff(
    context: CompletionContext, 
    apiResponse: string, 
    config: DiffOptions
  ): DiffExtractionResult {
    const currentText = context.beforeCursor + context.afterCursor;
    const expectedText = context.beforeCursor + apiResponse + context.afterCursor;
    
    this.logger.debug('📝 使用单词级diff算法');
    
    // Note: Using diffWords with basic options
    const changes = diffWords(currentText, expectedText);
    
    return this.processChangesToInsertion(changes, context, DiffMethod.WORD_DIFF);
  }
  
  /**
   * 行级差异提取 - 修复版本
   */
  private extractUsingLineDiff(
    context: CompletionContext, 
    apiResponse: string, 
    config: DiffOptions
  ): DiffExtractionResult {
    this.logger.debug('📄 使用修复的行级diff算法');
    
    // 🔧 CRITICAL FIX: 完全重写行级diff逻辑
    // 问题：之前的算法只是简单去重，导致语法错误
    // 解决：使用更智能的方法，确保返回完整、有效的代码片段
    
    this.logger.debug(`📊 API响应长度: ${apiResponse.length} 字符`);
    this.logger.debug(`📋 上下文信息: beforeCursor=${context.beforeCursor.length}, afterCursor=${context.afterCursor.length}`);
    
    // 🔧 策略1: 如果API响应很短且看起来是完整的，直接使用
    if (apiResponse.length < 200 && this.looksLikeCompleteCode(apiResponse)) {
      this.logger.debug('✅ 使用策略1: 短响应直接使用');
      
      const optimizedText = this.applySyntaxAwareOptimizations(apiResponse, context);
      
      return {
        insertText: optimizedText,
        confidence: 0.8,
        method: DiffMethod.LINE_DIFF,
        optimizations: ['策略1: 短响应直接使用'],
        processingTimeMs: 0
      };
    }
    
    // 🔧 策略2: 基于光标位置的智能提取
    const contextAnalysisResult = this.analyzeCompletionContext(context, apiResponse);
    if (contextAnalysisResult.confidence > 0.6) {
      this.logger.debug('✅ 使用策略2: 基于上下文分析');
      
      return {
        insertText: contextAnalysisResult.extractedText,
        confidence: contextAnalysisResult.confidence,
        method: DiffMethod.LINE_DIFF,
        optimizations: [`策略2: 上下文分析，置信度${contextAnalysisResult.confidence.toFixed(3)}`],
        processingTimeMs: 0
      };
    }
    
    // 🔧 策略3: 保守回退 - 使用前缀匹配
    this.logger.debug('⚠️ 使用策略3: 保守回退');
    const prefixResult = this.extractByPrefixMatching(context, apiResponse);
    
    return {
      insertText: prefixResult.text,
      confidence: 0.4,
      method: DiffMethod.LINE_DIFF,
      optimizations: ['策略3: 前缀匹配回退'],
      processingTimeMs: 0
    };
  }
  
  /**
   * 检查是否看起来是完整的代码
   */
  private looksLikeCompleteCode(text: string): boolean {
    const trimmed = text.trim();
    
    // 空内容不算完整
    if (!trimmed) return false;
    
    // 检查是否有明显的语法错误标识
    const problematicPatterns = [
      /^[},;]+$/,           // 只有结束符号
      /^[{,;]\s*$/,         // 只有开始符号  
      /^\s*[,;]\s*$/,       // 只有分隔符
      /^[}\])\s]*,\s*$/     // 只有闭合符号加逗号
    ];
    
    if (problematicPatterns.some(pattern => pattern.test(trimmed))) {
      this.logger.debug(`⚠️ 检测到问题模式: "${trimmed}"`);
      return false;
    }
    
    // 检查是否有基本的代码结构
    const hasCodeStructure = /[a-zA-Z_$][a-zA-Z0-9_$]*\s*[:=]/.test(trimmed) || // 属性赋值
                             /[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(/.test(trimmed) ||   // 函数调用
                             /^[a-zA-Z_$]/.test(trimmed);                        // 以标识符开始
    
    this.logger.debug(`🔍 代码结构检查: ${hasCodeStructure ? '通过' : '失败'} - "${trimmed.substring(0, 30)}..."`);
    return hasCodeStructure;
  }
  
  /**
   * 分析补全上下文，智能提取相关内容
   */
  private analyzeCompletionContext(context: CompletionContext, apiResponse: string): {
    extractedText: string;
    confidence: number;
  } {
    // 分析光标前的最后一个token，了解用户期望
    const beforeCursor = context.beforeCursor.trim();
    const lastToken = this.getLastToken(beforeCursor);
    
    this.logger.debug(`🔍 上下文分析: 最后token="${lastToken}"`);
    
    // 根据最后的token类型决定提取策略
    if (lastToken.endsWith(':')) {
      // 期望属性值
      return this.extractPropertyValue(apiResponse, context);
    } else if (lastToken.endsWith(',')) {
      // 期望下一个元素
      return this.extractNextElement(apiResponse, context);
    } else if (lastToken.endsWith('{')) {
      // 期望对象内容
      return this.extractObjectContent(apiResponse, context);
    } else {
      // 一般情况，寻找最相关的片段
      return this.extractRelevantSegment(apiResponse, context);
    }
  }
  
  /**
   * 获取最后一个有意义的token
   */
  private getLastToken(text: string): string {
    const matches = text.match(/[a-zA-Z0-9_$]+[:\s]*$|[{}(),;:]\s*$/);
    return matches ? matches[0].trim() : '';
  }
  
  /**
   * 提取属性值（当前上下文以:结尾）
   */
  private extractPropertyValue(apiResponse: string, context: CompletionContext): {
    extractedText: string;
    confidence: number;
  } {
    // 寻找第一个完整的值表达式
    const lines = apiResponse.split('\n');
    const firstLine = lines[0]?.trim();
    
    if (firstLine && !firstLine.startsWith('}') && !firstLine.startsWith(',')) {
      return {
        extractedText: firstLine,
        confidence: 0.8
      };
    }
    
    return {
      extractedText: apiResponse.trim(),
      confidence: 0.5
    };
  }
  
  /**
   * 提取下一个元素（当前上下文以,结尾）
   */
  private extractNextElement(apiResponse: string, context: CompletionContext): {
    extractedText: string;
    confidence: number;
  } {
    // 去掉API响应开头的逗号（如果有）
    let cleanResponse = apiResponse.replace(/^\s*,\s*/, '').trim();
    
    if (cleanResponse && this.looksLikeCompleteCode(cleanResponse)) {
      return {
        extractedText: cleanResponse,
        confidence: 0.7
      };
    }
    
    return {
      extractedText: apiResponse.trim(),
      confidence: 0.4
    };
  }
  
  /**
   * 提取对象内容（当前上下文以{结尾）
   */
  private extractObjectContent(apiResponse: string, context: CompletionContext): {
    extractedText: string;
    confidence: number;
  } {
    // 寻找对象属性和值
    const lines = apiResponse.split('\n').filter(line => line.trim());
    
    if (lines.length > 0) {
      const firstLine = lines[0].trim();
      if (firstLine.includes(':') || firstLine.match(/^[a-zA-Z_$]/)) {
        return {
          extractedText: lines.join('\n'),
          confidence: 0.7
        };
      }
    }
    
    return {
      extractedText: apiResponse.trim(),
      confidence: 0.5
    };
  }
  
  /**
   * 提取最相关的片段
   */
  private extractRelevantSegment(apiResponse: string, context: CompletionContext): {
    extractedText: string;
    confidence: number;
  } {
    // 简单启发式：去掉明显的重复内容
    const lines = apiResponse.split('\n');
    const beforeLines = context.beforeCursor.split('\n');
    const beforeSet = new Set(beforeLines.map(line => line.trim()));
    
    const relevantLines = lines.filter(line => {
      const trimmed = line.trim();
      return trimmed && !beforeSet.has(trimmed) && this.looksLikeCompleteCode(trimmed);
    });
    
    if (relevantLines.length > 0) {
      return {
        extractedText: relevantLines.join('\n'),
        confidence: 0.6
      };
    }
    
    return {
      extractedText: apiResponse.trim(),
      confidence: 0.3
    };
  }
  
  /**
   * 前缀匹配提取（回退策略）
   */
  private extractByPrefixMatching(context: CompletionContext, apiResponse: string): {
    text: string;
  } {
    // 简单策略：如果响应看起来完整，就使用，否则返回空
    if (this.looksLikeCompleteCode(apiResponse)) {
      return { text: apiResponse.trim() };
    }
    
    return { text: '' };
  }
  
  /**
   * 混合策略：尝试多种方法并选择最佳结果
   */
  private extractUsingHybridStrategy(
    context: CompletionContext, 
    apiResponse: string, 
    config: DiffOptions
  ): DiffExtractionResult {
    this.logger.debug('🔀 使用混合策略');
    
    const strategies = [
      () => this.extractUsingWordDiff(context, apiResponse, config),
      () => this.extractUsingCharDiff(context, apiResponse, config),
      () => this.extractUsingLineDiff(context, apiResponse, config)
    ];
    
    let bestResult: DiffExtractionResult | null = null;
    let bestConfidence = 0;
    
    for (const strategy of strategies) {
      try {
        const result = strategy();
        if (result && result.confidence > bestConfidence) {
          bestConfidence = result.confidence;
          bestResult = result;
        }
      } catch (error) {
        this.logger.debug('混合策略中的一个方法失败', error as Error);
      }
    }
    
    if (bestResult) {
      bestResult.method = DiffMethod.HYBRID;
      bestResult.optimizations.push('使用混合策略选择最佳结果');
      return bestResult;
    }
    
    // 如果所有策略都失败，使用回退策略
    return this.executeFallbackStrategy(context, apiResponse);
  }
  
  /**
   * 处理diff变更为插入文本
   */
  private processChangesToInsertion(
    changes: Change[], 
    context: CompletionContext, 
    method: DiffMethod
  ): DiffExtractionResult {
    this.logger.debug(`📊 diff结果: ${changes.length} 个变更`);
    
    // 提取所有插入的内容
    let insertText = '';
    let hasInsertions = false;
    
    for (const change of changes) {
      if (change.added) {
        insertText += change.value;
        hasInsertions = true;
        this.logger.debug(`➕ 插入: "${change.value.substring(0, 50)}${change.value.length > 50 ? '...' : ''}"`);
      } else if (change.removed) {
        this.logger.debug(`➖ 删除: "${change.value.substring(0, 50)}${change.value.length > 50 ? '...' : ''}"`);
      }
    }
    
    if (!hasInsertions || insertText.trim() === '') {
      this.logger.debug('⚠️ 没有找到有效的插入内容');
      return {
        insertText: '',
        confidence: 0,
        method,
        optimizations: ['无有效插入内容'],
        processingTimeMs: 0
      };
    }
    
    // 应用语法感知优化
    const optimizedText = this.applySyntaxAwareOptimizations(insertText, context);
    const optimizations = this.getOptimizationLog(insertText, optimizedText);
    
    // 计算置信度
    const confidence = this.confidenceEvaluator.calculateConfidence(
      changes, 
      context, 
      method, 
      optimizedText
    );
    
    this.logger.debug(`🎯 置信度: ${confidence.toFixed(3)}`);
    
    return {
      insertText: optimizedText,
      confidence,
      method,
      optimizations,
      processingTimeMs: 0 // 将在主方法中设置
    };
  }
  
  /**
   * 应用语法感知优化
   */
  private applySyntaxAwareOptimizations(text: string, context: CompletionContext): string {
    let optimizedText = text;
    
    // 1. 去除前导和尾随空白符的智能处理
    const originalLength = optimizedText.length;
    optimizedText = this.smartTrimWhitespace(optimizedText, context);
    
    // 2. 处理缩进对齐
    optimizedText = this.alignIndentation(optimizedText, context);
    
    // 3. 语言特定优化
    optimizedText = this.applyLanguageSpecificOptimizations(optimizedText, context);
    
    // 4. 移除重复内容
    optimizedText = this.removeDuplicateContent(optimizedText, context);
    
    if (optimizedText.length !== originalLength) {
      this.logger.debug(`🔧 优化: ${originalLength} → ${optimizedText.length} 字符`);
    }
    
    return optimizedText;
  }
  
  /**
   * 智能空白符处理
   */
  private smartTrimWhitespace(text: string, context: CompletionContext): string {
    // 不要盲目去除所有空白符，要根据上下文智能处理
    let result = text;
    
    // 如果光标前已经有空白符，去除文本开头的空白符
    if (context.beforeCursor.endsWith(' ') || context.beforeCursor.endsWith('\t')) {
      result = result.replace(/^\s+/, '');
    }
    
    // 如果光标后有内容且不是空白符，确保文本末尾不会产生不必要的空白符
    if (context.afterCursor && !context.afterCursor.startsWith(' ') && !context.afterCursor.startsWith('\t')) {
      result = result.replace(/\s+$/, '');
    }
    
    return result;
  }
  
  /**
   * 对齐缩进
   */
  private alignIndentation(text: string, context: CompletionContext): string {
    if (!text.includes('\n')) {
      return text; // 单行文本不需要缩进对齐
    }
    
    const lines = text.split('\n');
    const baseIndent = context.indentation;
    
    // 调整每行的缩进
    for (let i = 1; i < lines.length; i++) { // 跳过第一行
      if (lines[i].trim()) { // 只处理非空行
        // 计算相对缩进级别
        const currentIndent = lines[i].match(/^\s*/)?.[0] || '';
        const relativeIndent = currentIndent.length > baseIndent.length ? 
          currentIndent.substring(baseIndent.length) : '';
        
        lines[i] = baseIndent + relativeIndent + lines[i].trim();
      }
    }
    
    return lines.join('\n');
  }
  
  /**
   * 应用语言特定优化
   */
  private applyLanguageSpecificOptimizations(text: string, context: CompletionContext): string {
    switch (context.language.toLowerCase()) {
      case 'javascript':
      case 'typescript':
        return this.optimizeForJavaScript(text, context);
      case 'python':
        return this.optimizeForPython(text, context);
      default:
        return text;
    }
  }
  
  /**
   * JavaScript/TypeScript特定优化
   */
  private optimizeForJavaScript(text: string, context: CompletionContext): string {
    let result = text;
    
    // 1. 智能分号处理
    if (result.trim() && !result.trim().endsWith(';') && !result.trim().endsWith('}')) {
      // 检查是否应该添加分号
      if (this.shouldAddSemicolon(result, context)) {
        result = result.trimEnd() + ';';
      }
    }
    
    // 2. 括号匹配检查
    result = this.balanceBrackets(result);
    
    return result;
  }
  
  /**
   * Python特定优化
   */
  private optimizeForPython(text: string, context: CompletionContext): string {
    let result = text;
    
    // 1. 确保冒号后的正确缩进
    if (result.includes(':')) {
      const lines = result.split('\n');
      for (let i = 0; i < lines.length - 1; i++) {
        if (lines[i].trimEnd().endsWith(':') && lines[i + 1].trim()) {
          // 确保冒号后下一行有正确的缩进
          const nextLineIndent = lines[i + 1].match(/^\s*/)?.[0] || '';
          const expectedIndent = context.indentation + '    '; // Python标准4空格缩进
          
          if (nextLineIndent.length <= context.indentation.length) {
            lines[i + 1] = expectedIndent + lines[i + 1].trim();
          }
        }
      }
      result = lines.join('\n');
    }
    
    return result;
  }
  
  /**
   * 移除重复内容
   */
  private removeDuplicateContent(text: string, context: CompletionContext): string {
    // 检查是否与光标前后的内容重复
    let result = text;
    
    // 移除与光标前内容的重复
    const beforeWords = context.beforeCursor.trim().split(/\s+/);
    const lastWord = beforeWords[beforeWords.length - 1];
    
    if (lastWord && result.toLowerCase().startsWith(lastWord.toLowerCase()) && lastWord.length > 2) {
      result = result.substring(lastWord.length);
      this.logger.debug(`🔧 移除重复的前缀: "${lastWord}"`);
    }
    
    // 移除与光标后内容的重复
    if (context.afterCursor.trim()) {
      const afterStart = context.afterCursor.trim().split(/\s+/)[0];
      if (afterStart && result.toLowerCase().endsWith(afterStart.toLowerCase()) && afterStart.length > 2) {
        result = result.substring(0, result.length - afterStart.length);
        this.logger.debug(`🔧 移除重复的后缀: "${afterStart}"`);
      }
    }
    
    return result;
  }
  
  /**
   * 执行回退策略
   */
  private executeFallbackStrategy(context: CompletionContext, apiResponse: string): DiffExtractionResult {
    this.logger.debug('🆘 执行回退策略');
    
    // 简单前缀匹配策略
    const beforeCursor = context.beforeCursor;
    let insertText = apiResponse;
    
    // 查找最长公共前缀
    let commonPrefixLength = 0;
    const minLength = Math.min(beforeCursor.length, apiResponse.length);
    
    for (let i = 0; i < minLength; i++) {
      if (beforeCursor[beforeCursor.length - 1 - i] === apiResponse[i]) {
        commonPrefixLength = i + 1;
      } else {
        break;
      }
    }
    
    if (commonPrefixLength > 0) {
      insertText = apiResponse.substring(commonPrefixLength);
    }
    
    return {
      insertText,
      confidence: 0.3, // 回退策略置信度较低
      method: DiffMethod.PREFIX_MATCH,
      optimizations: ['使用前缀匹配回退策略'],
      processingTimeMs: 0
    };
  }
  
  // 辅助方法
  private generateCacheKey(context: CompletionContext, apiResponse: string): string {
    const contextHash = this.hashString(context.beforeCursor + '|' + context.afterCursor + '|' + context.language);
    const responseHash = this.hashString(apiResponse.substring(0, 200)); // 只取前200字符避免键过长
    return `${contextHash}-${responseHash}`;
  }
  
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 转换为32位整数
    }
    return hash.toString(36);
  }
  
  private getOptimizationLog(originalText: string, optimizedText: string): string[] {
    const optimizations: string[] = [];
    
    if (originalText.length !== optimizedText.length) {
      optimizations.push(`长度优化: ${originalText.length} → ${optimizedText.length}`);
    }
    
    if (originalText.startsWith(' ') && !optimizedText.startsWith(' ')) {
      optimizations.push('移除前导空白');
    }
    
    if (originalText.endsWith(' ') && !optimizedText.endsWith(' ')) {
      optimizations.push('移除尾随空白');
    }
    
    return optimizations;
  }
  
  private shouldAddSemicolon(text: string, context: CompletionContext): boolean {
    // 简化判断：如果上下文中使用了分号，且文本看起来是语句，则添加分号
    const hasContextSemicolons = context.beforeCursor.includes(';');
    const looksLikeStatement = /^[\w\s=+\-*/%()[\]{}.,'"`;:]+$/.test(text.trim());
    
    return hasContextSemicolons && looksLikeStatement;
  }
  
  private balanceBrackets(text: string): string {
    // 简化实现：检查并修复简单的括号不匹配问题
    const brackets = { '(': ')', '[': ']', '{': '}' };
    const stack: string[] = [];
    let result = text;
    
    for (const char of text) {
      if (char in brackets) {
        stack.push(char);
      } else if (Object.values(brackets).includes(char)) {
        const last = stack.pop();
        if (last && brackets[last as keyof typeof brackets] !== char) {
          // 有不匹配的括号，但暂时不修复，只记录
          this.logger.debug(`⚠️ 发现不匹配的括号: ${last} vs ${char}`);
        }
      }
    }
    
    return result; // 目前不自动修复，只返回原文本
  }
  
  private logPerformanceMetrics(metrics: PerformanceMetrics): void {
    this.logger.debug(`⏱️ 性能指标: ${(metrics.endTime - metrics.startTime).toFixed(2)}ms, 输入${metrics.inputLength}字符, 输出${metrics.outputLength}字符, 方法=${metrics.method}, 置信度=${metrics.confidence.toFixed(3)}`);
  }
  
  /**
   * 清理缓存
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.debug('🧹 diff缓存已清理');
  }
  
  /**
   * 获取缓存统计信息
   */
  getCacheStats(): { size: number; hitRate: number } {
    return {
      size: this.cache.size,
      hitRate: 0 // 简化实现，暂不跟踪命中率
    };
  }
}