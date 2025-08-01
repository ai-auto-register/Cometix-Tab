import { Change } from 'diff';
import { CompletionContext, ConfidenceFactors, DiffMethod } from '../types/completion-diff';

/**
 * 置信度评估器
 * 根据diff结果和上下文信息计算补全的置信度
 */
export class ConfidenceEvaluator {
  private static instance: ConfidenceEvaluator;
  
  public static getInstance(): ConfidenceEvaluator {
    if (!ConfidenceEvaluator.instance) {
      ConfidenceEvaluator.instance = new ConfidenceEvaluator();
    }
    return ConfidenceEvaluator.instance;
  }
  
  /**
   * 计算综合置信度
   */
  calculateConfidence(
    changes: Change[], 
    context: CompletionContext, 
    method: DiffMethod,
    insertText: string
  ): number {
    const factors = this.evaluateAllFactors(changes, context, method, insertText);
    return this.combineFactors(factors);
  }
  
  /**
   * 评估所有置信度因子
   */
  evaluateAllFactors(
    changes: Change[], 
    context: CompletionContext, 
    method: DiffMethod,
    insertText: string
  ): ConfidenceFactors {
    return {
      diffQuality: this.assessDiffQuality(changes),
      contextRelevance: this.assessContextRelevance(insertText, context),
      syntaxConsistency: this.assessSyntaxConsistency(insertText, context),
      lengthRationality: this.assessLengthRationality(insertText, context),
      structuralIntegrity: this.assessStructuralIntegrity(insertText, context)
    };
  }
  
  /**
   * 评估diff质量
   */
  private assessDiffQuality(changes: Change[]): number {
    if (changes.length === 0) return 0;
    
    let insertions = 0;
    let deletions = 0;
    let equals = 0;
    let totalLength = 0;
    
    for (const change of changes) {
      const length = change.value.length;
      totalLength += length;
      
      if (change.added) {
        insertions += length;
      } else if (change.removed) {
        deletions += length;
      } else {
        equals += length;
      }
    }
    
    if (totalLength === 0) return 0;
    
    // 质量评估：
    // 1. 插入操作占比应该合理（不应该全是插入或全是删除）
    const insertionRatio = insertions / totalLength;
    const deletionRatio = deletions / totalLength;
    const equalRatio = equals / totalLength;
    
    // 理想情况：有一定的相等部分，插入适中，删除较少
    let qualityScore = 0;
    
    // 相等部分评分（20-80%之间较好）
    if (equalRatio >= 0.2 && equalRatio <= 0.8) {
      qualityScore += 0.4;
    } else {
      qualityScore += Math.max(0, 0.4 - Math.abs(equalRatio - 0.5) * 0.8);
    }
    
    // 插入比例评分（10-60%之间较好）
    if (insertionRatio >= 0.1 && insertionRatio <= 0.6) {
      qualityScore += 0.4;
    } else {
      qualityScore += Math.max(0, 0.4 - Math.abs(insertionRatio - 0.35) * 1.14);
    }
    
    // 删除比例评分（越少越好，但允许少量删除）
    if (deletionRatio <= 0.2) {
      qualityScore += 0.2;
    } else {
      qualityScore += Math.max(0, 0.2 - (deletionRatio - 0.2) * 0.5);
    }
    
    // 操作复杂度评分（操作数量相对适中）
    const operationComplexity = changes.length / Math.max(1, totalLength / 10);
    if (operationComplexity <= 1) {
      qualityScore += 0.0; // 基础分
    } else {
      qualityScore = Math.max(0, qualityScore - (operationComplexity - 1) * 0.1);
    }
    
    return Math.min(1, Math.max(0, qualityScore));
  }
  
  /**
   * 评估上下文相关性
   */
  private assessContextRelevance(insertText: string, context: CompletionContext): number {
    let relevanceScore = 0;
    
    // 1. 语言一致性检查
    relevanceScore += this.checkLanguageConsistency(insertText, context.language) * 0.3;
    
    // 2. 缩进一致性检查
    relevanceScore += this.checkIndentationConsistency(insertText, context) * 0.2;
    
    // 3. 命名风格一致性
    relevanceScore += this.checkNamingStyleConsistency(insertText, context) * 0.2;
    
    // 4. 上下文词汇相关性
    relevanceScore += this.checkVocabularyRelevance(insertText, context) * 0.3;
    
    return Math.min(1, relevanceScore);
  }
  
  /**
   * 评估语法一致性
   */
  private assessSyntaxConsistency(insertText: string, context: CompletionContext): number {
    let consistencyScore = 0;
    
    // 1. 括号匹配检查
    consistencyScore += this.checkBracketBalance(insertText) * 0.4;
    
    // 2. 引号匹配检查
    consistencyScore += this.checkQuoteBalance(insertText) * 0.3;
    
    // 3. 语法结构完整性
    consistencyScore += this.checkSyntaxStructure(insertText, context.language) * 0.3;
    
    return Math.min(1, consistencyScore);
  }
  
  /**
   * 评估长度合理性
   */
  private assessLengthRationality(insertText: string, context: CompletionContext): number {
    const insertLength = insertText.length;
    const contextLength = context.beforeCursor.length + context.afterCursor.length;
    
    // 1. 绝对长度检查
    let lengthScore = 0;
    if (insertLength >= 1 && insertLength <= 500) {
      lengthScore += 0.4;
    } else if (insertLength > 500) {
      lengthScore += Math.max(0, 0.4 - (insertLength - 500) / 1000);
    }
    
    // 2. 相对长度检查
    if (contextLength > 0) {
      const ratio = insertLength / contextLength;
      if (ratio >= 0.1 && ratio <= 2.0) {
        lengthScore += 0.3;
      } else {
        lengthScore += Math.max(0, 0.3 - Math.abs(Math.log10(ratio)) * 0.15);
      }
    } else {
      lengthScore += 0.15; // 没有上下文时给一半分
    }
    
    // 3. 行数合理性
    const lineCount = insertText.split('\n').length;
    if (lineCount <= 20) {
      lengthScore += 0.3;
    } else {
      lengthScore += Math.max(0, 0.3 - (lineCount - 20) / 50);
    }
    
    return Math.min(1, lengthScore);
  }
  
  /**
   * 评估结构完整性
   */
  private assessStructuralIntegrity(insertText: string, context: CompletionContext): number {
    let integrityScore = 0;
    
    // 1. 块结构完整性
    integrityScore += this.checkBlockStructure(insertText) * 0.4;
    
    // 2. 语句完整性
    integrityScore += this.checkStatementCompleteness(insertText, context.language) * 0.3;
    
    // 3. 格式一致性
    integrityScore += this.checkFormatConsistency(insertText, context) * 0.3;
    
    return Math.min(1, integrityScore);
  }
  
  /**
   * 合并所有因子得到最终置信度
   */
  private combineFactors(factors: ConfidenceFactors): number {
    // 加权平均，各因子权重
    const weights = {
      diffQuality: 0.25,        // diff质量最重要
      contextRelevance: 0.20,   // 上下文相关性
      syntaxConsistency: 0.20,  // 语法一致性
      lengthRationality: 0.15,  // 长度合理性
      structuralIntegrity: 0.20 // 结构完整性
    };
    
    const weightedSum = 
      factors.diffQuality * weights.diffQuality +
      factors.contextRelevance * weights.contextRelevance +
      factors.syntaxConsistency * weights.syntaxConsistency +
      factors.lengthRationality * weights.lengthRationality +
      factors.structuralIntegrity * weights.structuralIntegrity;
    
    // 应用非线性变换，对高质量结果给予更高奖励
    let confidence = weightedSum;
    
    // 如果所有因子都比较好，给予额外奖励
    const minFactor = Math.min(...Object.values(factors));
    if (minFactor > 0.7) {
      confidence += 0.1; // 奖励全面高质量
    }
    
    // 如果有任何因子特别差，给予惩罚
    if (minFactor < 0.3) {
      confidence *= 0.8; // 惩罚明显缺陷
    }
    
    return Math.min(1, Math.max(0, confidence));
  }
  
  // 辅助方法实现
  private checkLanguageConsistency(text: string, language: string): number {
    // 简化实现：检查是否包含语言特定的关键字或模式
    const patterns = this.getLanguagePatterns(language);
    let matches = 0;
    for (const pattern of patterns) {
      if (pattern.test(text)) matches++;
    }
    return Math.min(1, matches / Math.max(1, patterns.length * 0.5));
  }
  
  private checkIndentationConsistency(text: string, context: CompletionContext): number {
    if (!text.includes('\n')) return 1; // 单行文本自动通过
    
    const lines = text.split('\n');
    const contextIndent = context.indentation;
    
    let consistentLines = 0;
    for (const line of lines) {
      if (line.trim() === '') {
        consistentLines++; // 空行不计入不一致
        continue;
      }
      
      const lineIndent = line.match(/^\s*/)?.[0] || '';
      if (lineIndent.startsWith(contextIndent)) {
        consistentLines++;
      }
    }
    
    return lines.length > 0 ? consistentLines / lines.length : 1;
  }
  
  private checkNamingStyleConsistency(text: string, context: CompletionContext): number {
    // 提取标识符
    const textIdentifiers = text.match(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g) || [];
    const contextIdentifiers = context.beforeCursor.match(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g) || [];
    
    if (textIdentifiers.length === 0) return 1;
    if (contextIdentifiers.length === 0) return 0.5;
    
    // 检查命名风格 (camelCase, snake_case, PascalCase)
    const getNameStyle = (name: string) => {
      if (/^[a-z][a-zA-Z0-9]*$/.test(name)) return 'camelCase';
      if (/^[a-z][a-z0-9_]*$/.test(name)) return 'snake_case';
      if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) return 'PascalCase';
      return 'mixed';
    };
    
    const contextStyles = new Set(contextIdentifiers.map(getNameStyle));
    let consistentCount = 0;
    
    for (const identifier of textIdentifiers) {
      const style = getNameStyle(identifier);
      if (contextStyles.has(style)) {
        consistentCount++;
      }
    }
    
    return consistentCount / textIdentifiers.length;
  }
  
  private checkVocabularyRelevance(text: string, context: CompletionContext): number {
    const textWords = new Set((text.match(/\b\w+\b/g) || []).map(w => w.toLowerCase()));
    const contextWords = new Set((context.beforeCursor.match(/\b\w+\b/g) || []).map(w => w.toLowerCase()));
    
    if (textWords.size === 0) return 0;
    if (contextWords.size === 0) return 0.5;
    
    const commonWords = new Set([...textWords].filter(w => contextWords.has(w)));
    return commonWords.size / Math.min(textWords.size, contextWords.size);
  }
  
  private checkBracketBalance(text: string): number {
    const brackets = { '(': ')', '[': ']', '{': '}' };
    const stack: string[] = [];
    let errors = 0;
    
    for (const char of text) {
      if (char in brackets) {
        stack.push(char);
      } else if (Object.values(brackets).includes(char)) {
        const last = stack.pop();
        if (!last || brackets[last as keyof typeof brackets] !== char) {
          errors++;
        }
      }
    }
    
    errors += stack.length; // 未关闭的括号
    const totalBrackets = (text.match(/[()[\]{}]/g) || []).length;
    
    return totalBrackets > 0 ? Math.max(0, 1 - errors / totalBrackets) : 1;
  }
  
  private checkQuoteBalance(text: string): number {
    const singleQuotes = (text.match(/'/g) || []).length;
    const doubleQuotes = (text.match(/"/g) || []).length;
    const backQuotes = (text.match(/`/g) || []).length;
    
    const singleBalance = singleQuotes % 2 === 0 ? 1 : 0;
    const doubleBalance = doubleQuotes % 2 === 0 ? 1 : 0;
    const backBalance = backQuotes % 2 === 0 ? 1 : 0;
    
    const totalQuotes = singleQuotes + doubleQuotes + backQuotes;
    if (totalQuotes === 0) return 1;
    
    return (singleBalance + doubleBalance + backBalance) / 3;
  }
  
  private checkSyntaxStructure(text: string, language: string): number {
    // 简化实现：检查常见语法错误
    let score = 1;
    
    // 检查分号使用（JavaScript/TypeScript）
    if (['javascript', 'typescript'].includes(language.toLowerCase())) {
      if (text.includes(';') && !text.trim().endsWith(';')) {
        score -= 0.2; // 分号使用不一致
      }
    }
    
    return Math.max(0, score);
  }
  
  private checkBlockStructure(text: string): number {
    const openBraces = (text.match(/\{/g) || []).length;
    const closeBraces = (text.match(/\}/g) || []).length;
    
    if (openBraces === 0 && closeBraces === 0) return 1; // 无块结构
    
    return openBraces === closeBraces ? 1 : Math.max(0, 1 - Math.abs(openBraces - closeBraces) * 0.5);
  }
  
  private checkStatementCompleteness(text: string, language: string): number {
    // 简化实现：检查语句是否看起来完整
    const trimmed = text.trim();
    if (trimmed === '') return 0;
    
    // 检查是否以适当的字符结尾
    const goodEndings = [';', '}', ')', ']', '"', "'", '`'];
    const endsWell = goodEndings.some(ending => trimmed.endsWith(ending));
    
    let score = endsWell ? 0.7 : 0.3;
    
    // 检查是否包含不完整的结构
    if (trimmed.includes('(') && !trimmed.includes(')')) score -= 0.3;
    if (trimmed.includes('{') && !trimmed.includes('}')) score -= 0.3;
    if (trimmed.includes('[') && !trimmed.includes(']')) score -= 0.3;
    
    return Math.max(0, score);
  }
  
  private checkFormatConsistency(text: string, context: CompletionContext): number {
    // 检查格式一致性：缩进、空格等
    let score = 1;
    
    // 检查缩进一致性
    if (text.includes('\n')) {
      const lines = text.split('\n').filter(line => line.trim());
      const indents = lines.map(line => (line.match(/^\s*/) || [''])[0]);
      
      // 检查是否使用一致的缩进字符（空格 vs 制表符）
      const hasSpaces = indents.some(indent => indent.includes(' '));
      const hasTabs = indents.some(indent => indent.includes('\t'));
      
      if (hasSpaces && hasTabs) {
        score -= 0.3; // 混合使用空格和制表符
      }
    }
    
    return Math.max(0, score);
  }
  
  private getLanguagePatterns(language: string): RegExp[] {
    switch (language.toLowerCase()) {
      case 'javascript':
      case 'typescript':
        return [
          /\bfunction\b/, /\bconst\b/, /\blet\b/, /\bvar\b/,
          /\bif\b/, /\belse\b/, /\bfor\b/, /\bwhile\b/,
          /\bclass\b/, /\breturn\b/, /\bimport\b/, /\bexport\b/
        ];
      case 'python':
        return [
          /\bdef\b/, /\bclass\b/, /\bif\b/, /\belif\b/, /\belse\b/,
          /\bfor\b/, /\bwhile\b/, /\breturn\b/, /\bimport\b/, /\bfrom\b/
        ];
      default:
        return [];
    }
  }
}