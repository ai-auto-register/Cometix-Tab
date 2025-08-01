import { ContentType, CompletionContext } from '../types/completion-diff';

/**
 * 内容分析器
 * 分析补全内容的特征，以选择最适合的diff策略
 */
export class ContentAnalyzer {
  private static instance: ContentAnalyzer;
  
  public static getInstance(): ContentAnalyzer {
    if (!ContentAnalyzer.instance) {
      ContentAnalyzer.instance = new ContentAnalyzer();
    }
    return ContentAnalyzer.instance;
  }
  
  /**
   * 分析内容类型
   */
  analyzeContentType(context: CompletionContext, apiResponse: string): ContentType {
    // 检查是否为多行补全
    if (this.isMultiLineCompletion(apiResponse)) {
      return ContentType.MULTI_LINE;
    }
    
    // 检查是否为块结构补全
    if (this.isBlockStructureCompletion(apiResponse)) {
      return ContentType.BLOCK_STRUCTURE;
    }
    
    // 检查是否为部分单词补全
    if (this.isPartialWordCompletion(context, apiResponse)) {
      return ContentType.PARTIAL_WORD;
    }
    
    // 检查是否为表达式补全
    if (this.isExpressionCompletion(apiResponse)) {
      return ContentType.EXPRESSION;
    }
    
    // 检查是否为完整单词补全
    if (this.isCompleteWordCompletion(context, apiResponse)) {
      return ContentType.COMPLETE_WORD;
    }
    
    return ContentType.UNKNOWN;
  }
  
  /**
   * 判断是否为多行补全
   */
  isMultiLineCompletion(text: string): boolean {
    // 包含换行符
    if (text.includes('\n')) {
      return true;
    }
    
    // 长度超过阈值可能需要多行显示
    if (text.length > 100) {
      return true;
    }
    
    return false;
  }
  
  /**
   * 判断是否为块结构补全
   */
  isBlockStructureCompletion(text: string): boolean {
    // 包含成对的大括号
    const openBraces = (text.match(/\{/g) || []).length;
    const closeBraces = (text.match(/\}/g) || []).length;
    
    if (openBraces > 0 && closeBraces > 0) {
      return true;
    }
    
    // 包含多个层级的缩进
    const lines = text.split('\n');
    if (lines.length > 2) {
      const indentLevels = new Set();
      for (const line of lines) {
        if (line.trim()) {
          const indent = line.match(/^\s*/)?.[0]?.length || 0;
          indentLevels.add(indent);
        }
      }
      if (indentLevels.size > 2) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * 判断是否为部分单词补全
   */
  isPartialWordCompletion(context: CompletionContext, apiResponse: string): boolean {
    const beforeCursor = context.beforeCursor.trim();
    
    // 光标前是否以字母或数字结尾（表示正在输入单词）
    if (!/\w$/.test(beforeCursor)) {
      return false;
    }
    
    // 提取最后一个部分单词
    const lastPartialWord = beforeCursor.match(/\w+$/)?.[0];
    if (!lastPartialWord) {
      return false;
    }
    
    // 检查API响应是否以这个部分单词开头
    const responseStart = apiResponse.trim();
    if (responseStart.toLowerCase().startsWith(lastPartialWord.toLowerCase())) {
      // 确保API响应包含更多内容（不只是重复部分单词）
      return responseStart.length > lastPartialWord.length;
    }
    
    return false;
  }
  
  /**
   * 判断是否为完整单词补全
   */
  isCompleteWordCompletion(context: CompletionContext, apiResponse: string): boolean {
    const beforeCursor = context.beforeCursor.trim();
    
    // 光标前以非字母数字字符结尾（如空格、点号、括号等）
    if (/\w$/.test(beforeCursor)) {
      return false;
    }
    
    // API响应以字母或数字开头
    if (!/^\w/.test(apiResponse.trim())) {
      return false;
    }
    
    // 响应不包含换行符（单行补全）
    if (apiResponse.includes('\n')) {
      return false;
    }
    
    return true;
  }
  
  /**
   * 判断是否为表达式补全
   */
  isExpressionCompletion(text: string): boolean {
    // 包含运算符
    const operators = /[+\-*/%=<>!&|^~]+/;
    if (operators.test(text)) {
      return true;
    }
    
    // 包含函数调用模式
    const functionCall = /\w+\s*\([^)]*\)/;
    if (functionCall.test(text)) {
      return true;
    }
    
    // 包含数组或对象访问
    const accessPattern = /\w+[\[\.][\w'"]+[\]\.]?/;
    if (accessPattern.test(text)) {
      return true;
    }
    
    return false;
  }
  
  /**
   * 检测语言特定的模式
   */
  detectLanguagePatterns(text: string, language: string): {
    hasLanguageKeywords: boolean;
    hasLanguageStructures: boolean;
    complexity: 'simple' | 'moderate' | 'complex';
  } {
    const patterns = this.getLanguagePatterns(language);
    
    let hasLanguageKeywords = false;
    let hasLanguageStructures = false;
    
    // 检查关键字
    for (const keyword of patterns.keywords) {
      if (new RegExp(`\\b${keyword}\\b`).test(text)) {
        hasLanguageKeywords = true;
        break;
      }
    }
    
    // 检查结构模式
    for (const structure of patterns.structures) {
      if (structure.test(text)) {
        hasLanguageStructures = true;
        break;
      }
    }
    
    // 评估复杂度
    let complexity: 'simple' | 'moderate' | 'complex' = 'simple';
    if (text.length > 200 || text.split('\n').length > 10) {
      complexity = 'complex';
    } else if (text.length > 50 || text.split('\n').length > 3 || hasLanguageStructures) {
      complexity = 'moderate';
    }
    
    return {
      hasLanguageKeywords,
      hasLanguageStructures,
      complexity
    };
  }
  
  /**
   * 获取语言特定的模式
   */
  private getLanguagePatterns(language: string): {
    keywords: string[];
    structures: RegExp[];
  } {
    switch (language.toLowerCase()) {
      case 'javascript':
      case 'typescript':
        return {
          keywords: ['function', 'const', 'let', 'var', 'if', 'else', 'for', 'while', 'class', 'return', 'import', 'export'],
          structures: [
            /function\s+\w+\s*\([^)]*\)\s*\{/,
            /\(\s*\w+\s*\)\s*=>\s*\{/,
            /class\s+\w+\s*\{/,
            /if\s*\([^)]+\)\s*\{/,
            /for\s*\([^)]+\)\s*\{/
          ]
        };
        
      case 'python':
        return {
          keywords: ['def', 'class', 'if', 'elif', 'else', 'for', 'while', 'return', 'import', 'from'],
          structures: [
            /def\s+\w+\s*\([^)]*\)\s*:/,
            /class\s+\w+\s*\([^)]*\)\s*:/,
            /if\s+.+:/,
            /for\s+\w+\s+in\s+.+:/,
            /while\s+.+:/
          ]
        };
        
      case 'java':
      case 'c':
      case 'cpp':
        return {
          keywords: ['public', 'private', 'protected', 'class', 'interface', 'if', 'else', 'for', 'while', 'return'],
          structures: [
            /\w+\s+\w+\s*\([^)]*\)\s*\{/,
            /class\s+\w+\s*\{/,
            /if\s*\([^)]+\)\s*\{/,
            /for\s*\([^)]+\)\s*\{/
          ]
        };
        
      default:
        return {
          keywords: [],
          structures: []
        };
    }
  }
  
  /**
   * 分析内容的结构复杂度
   */
  analyzeStructuralComplexity(text: string): {
    nestingLevel: number;
    braceBalance: number;
    lineCount: number;
    characterCount: number;
    hasNestedStructures: boolean;
  } {
    const lines = text.split('\n');
    let maxNestingLevel = 0;
    let currentNestingLevel = 0;
    let braceBalance = 0;
    
    for (const char of text) {
      if (char === '{' || char === '(' || char === '[') {
        currentNestingLevel++;
        maxNestingLevel = Math.max(maxNestingLevel, currentNestingLevel);
      } else if (char === '}' || char === ')' || char === ']') {
        currentNestingLevel--;
      }
      
      if (char === '{') braceBalance++;
      if (char === '}') braceBalance--;
    }
    
    return {
      nestingLevel: maxNestingLevel,
      braceBalance: Math.abs(braceBalance),
      lineCount: lines.length,
      characterCount: text.length,
      hasNestedStructures: maxNestingLevel > 2
    };
  }
  
  /**
   * 计算内容相似度得分
   */
  calculateContentSimilarity(context: CompletionContext, apiResponse: string): number {
    const beforeText = context.beforeCursor.toLowerCase();
    const responseText = apiResponse.toLowerCase();
    
    // 计算共同单词数量
    const beforeWords = new Set(beforeText.match(/\w+/g) || []);
    const responseWords = new Set(responseText.match(/\w+/g) || []);
    
    const commonWords = new Set([...beforeWords].filter(word => responseWords.has(word)));
    const totalWords = new Set([...beforeWords, ...responseWords]);
    
    if (totalWords.size === 0) return 0;
    
    return commonWords.size / totalWords.size;
  }
}