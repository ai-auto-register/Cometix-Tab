import * as vscode from 'vscode';

/**
 * 补全上下文信息
 */
export interface CompletionContext {
  /** 光标前的文本 */
  beforeCursor: string;
  
  /** 光标后的文本 */
  afterCursor: string;
  
  /** 当前行的完整文本 */
  currentLine: string;
  
  /** 精确的光标位置 */
  position: vscode.Position;
  
  /** 编程语言标识 */
  language: string;
  
  /** 当前行的缩进字符串 */
  indentation: string;
}

/**
 * 差异提取结果
 */
export interface DiffExtractionResult {
  /** 需要插入的文本内容 */
  insertText: string;
  
  /** 需要替换的范围（可选） */
  replaceRange?: vscode.Range;
  
  /** 算法置信度 (0-1) */
  confidence: number;
  
  /** 使用的差异计算方法 */
  method: DiffMethod;
  
  /** 应用的优化操作记录 */
  optimizations: string[];
  
  /** 处理时间（毫秒） */
  processingTimeMs: number;
}

/**
 * 差异计算方法枚举
 */
export enum DiffMethod {
  /** 字符级精确差异 - 适用于部分单词补全 */
  CHARACTER_DIFF = 'character-diff',
  
  /** 单词级差异 - 适用于完整单词补全 */
  WORD_DIFF = 'word-diff',
  
  /** 行级差异 - 适用于多行结构补全 */
  LINE_DIFF = 'line-diff',
  
  /** 混合策略 - 自动选择最适合的方法 */
  HYBRID = 'hybrid',
  
  /** 简单前缀匹配 - 回退策略 */
  PREFIX_MATCH = 'prefix-match',
  
  /** 原始内容 - 最终回退 */
  ORIGINAL = 'original'
}

/**
 * 内容类型分析结果
 */
export enum ContentType {
  /** 部分单词补全 */
  PARTIAL_WORD = 'partial-word',
  
  /** 完整单词补全 */
  COMPLETE_WORD = 'complete-word',
  
  /** 多行结构补全 */
  MULTI_LINE = 'multi-line',
  
  /** 表达式补全 */
  EXPRESSION = 'expression',
  
  /** 块结构补全 */
  BLOCK_STRUCTURE = 'block-structure',
  
  /** 未知类型 */
  UNKNOWN = 'unknown'
}

/**
 * diff配置选项
 */
export interface DiffOptions {
  /** 字符级差异配置 */
  charDiff: {
    ignoreCase: boolean;
    ignoreWhitespace: boolean;
  };
  
  /** 单词级差异配置 */
  wordDiff: {
    ignoreWhitespace: boolean;
    wordSeparator?: RegExp;
  };
  
  /** 行级差异配置 */
  lineDiff: {
    ignoreWhitespace: boolean;
    newlineIsToken: boolean;
  };
  
  /** 性能限制配置 */
  performance: {
    /** 超时时间（毫秒） */
    timeout?: number;
    /** 最大编辑长度 */
    maxEditLength?: number;
  };
}

/**
 * 置信度评估因子
 */
export interface ConfidenceFactors {
  /** diff质量评分 (0-1) */
  diffQuality: number;
  
  /** 上下文相关性评分 (0-1) */
  contextRelevance: number;
  
  /** 语法一致性评分 (0-1) */
  syntaxConsistency: number;
  
  /** 长度合理性评分 (0-1) */
  lengthRationality: number;
  
  /** 结构完整性评分 (0-1) */
  structuralIntegrity: number;
}

/**
 * 性能监控数据
 */
export interface PerformanceMetrics {
  /** 处理开始时间 */
  startTime: number;
  
  /** 处理结束时间 */
  endTime: number;
  
  /** 输入文本长度 */
  inputLength: number;
  
  /** 输出文本长度 */
  outputLength: number;
  
  /** 使用的方法 */
  method: DiffMethod;
  
  /** 置信度 */
  confidence: number;
}