import { DiffOptions, ContentType, CompletionContext } from '../types/completion-diff';

/**
 * diff配置管理器
 * 根据不同的上下文和内容类型提供最优的diff配置
 */
export class DiffConfigManager {
  private static instance: DiffConfigManager;
  
  public static getInstance(): DiffConfigManager {
    if (!DiffConfigManager.instance) {
      DiffConfigManager.instance = new DiffConfigManager();
    }
    return DiffConfigManager.instance;
  }
  
  /**
   * 获取默认配置
   */
  getDefaultConfig(): DiffOptions {
    return {
      charDiff: {
        ignoreCase: false,
        ignoreWhitespace: false
      },
      wordDiff: {
        ignoreWhitespace: true,
        wordSeparator: /\s+/
      },
      lineDiff: {
        ignoreWhitespace: true,
        newlineIsToken: true
      },
      performance: {
        timeout: 100, // 100ms超时
        maxEditLength: 1000 // 最大1000个编辑操作
      }
    };
  }
  
  /**
   * 根据内容类型获取优化配置
   */
  getConfigForContentType(contentType: ContentType): DiffOptions {
    const baseConfig = this.getDefaultConfig();
    
    switch (contentType) {
      case ContentType.PARTIAL_WORD:
        return {
          ...baseConfig,
          charDiff: {
            ignoreCase: false,
            ignoreWhitespace: false // 字符级需要精确匹配
          },
          performance: {
            timeout: 50, // 更短超时
            maxEditLength: 100
          }
        };
        
      case ContentType.COMPLETE_WORD:
        return {
          ...baseConfig,
          wordDiff: {
            ignoreWhitespace: true,
            wordSeparator: /[\s\.,\(\)\[\]\{\};]+/ // 更丰富的单词分隔符
          },
          performance: {
            timeout: 75,
            maxEditLength: 200
          }
        };
        
      case ContentType.MULTI_LINE:
        return {
          ...baseConfig,
          lineDiff: {
            ignoreWhitespace: false, // 多行需要保持空白符
            newlineIsToken: true
          },
          performance: {
            timeout: 150, // 更长超时用于复杂内容
            maxEditLength: 500
          }
        };
        
      case ContentType.BLOCK_STRUCTURE:
        return {
          ...baseConfig,
          lineDiff: {
            ignoreWhitespace: false,
            newlineIsToken: true
          },
          performance: {
            timeout: 200, // 结构化内容需要更多时间
            maxEditLength: 800
          }
        };
        
      default:
        return baseConfig;
    }
  }
  
  /**
   * 根据编程语言获取配置
   */
  getConfigForLanguage(language: string): Partial<DiffOptions> {
    switch (language.toLowerCase()) {
      case 'javascript':
      case 'typescript':
        return {
          wordDiff: {
            ignoreWhitespace: true,
            wordSeparator: /[\s\.,\(\)\[\]\{\};:]+/
          }
        };
        
      case 'python':
        return {
          lineDiff: {
            ignoreWhitespace: false, // Python对缩进敏感
            newlineIsToken: true
          }
        };
        
      case 'go':
      case 'rust':
      case 'c':
      case 'cpp':
        return {
          wordDiff: {
            ignoreWhitespace: true,
            wordSeparator: /[\s\.,\(\)\[\]\{\};:&*]+/
          }
        };
        
      case 'html':
      case 'xml':
        return {
          charDiff: {
            ignoreCase: true, // HTML标签不区分大小写
            ignoreWhitespace: false
          }
        };
        
      case 'css':
      case 'scss':
      case 'less':
        return {
          wordDiff: {
            ignoreWhitespace: true,
            wordSeparator: /[\s\{\}\(\)\[\]:;,]+/
          }
        };
        
      default:
        return {};
    }
  }
  
  /**
   * 根据内容长度调整性能配置
   */
  adjustConfigForLength(config: DiffOptions, contentLength: number): DiffOptions {
    const adjustedConfig = { ...config };
    
    if (contentLength > 5000) {
      // 超长内容：减少超时和编辑长度
      adjustedConfig.performance = {
        timeout: Math.max(50, (config.performance?.timeout || 100) * 0.5),
        maxEditLength: Math.max(100, (config.performance?.maxEditLength || 1000) * 0.3)
      };
    } else if (contentLength > 1000) {
      // 长内容：适度减少限制
      adjustedConfig.performance = {
        timeout: Math.max(75, (config.performance?.timeout || 100) * 0.75),
        maxEditLength: Math.max(200, (config.performance?.maxEditLength || 1000) * 0.6)
      };
    }
    
    return adjustedConfig;
  }
  
  /**
   * 获取完整的优化配置
   */
  getOptimizedConfig(
    context: CompletionContext, 
    contentType: ContentType, 
    apiResponseLength: number
  ): DiffOptions {
    // 基础配置：根据内容类型
    let config = this.getConfigForContentType(contentType);
    
    // 语言特定优化
    const languageConfig = this.getConfigForLanguage(context.language);
    config = this.mergeConfigs(config, languageConfig);
    
    // 根据内容长度调整性能配置
    const totalLength = context.beforeCursor.length + context.afterCursor.length + apiResponseLength;
    config = this.adjustConfigForLength(config, totalLength);
    
    return config;
  }
  
  /**
   * 合并两个配置对象
   */
  private mergeConfigs(base: DiffOptions, override: Partial<DiffOptions>): DiffOptions {
    return {
      charDiff: { ...base.charDiff, ...override.charDiff },
      wordDiff: { ...base.wordDiff, ...override.wordDiff },
      lineDiff: { ...base.lineDiff, ...override.lineDiff },
      performance: { ...base.performance, ...override.performance }
    };
  }
  
  /**
   * 验证配置的合理性
   */
  validateConfig(config: DiffOptions): boolean {
    try {
      // 检查超时时间合理性
      if (config.performance?.timeout && 
          (config.performance.timeout < 10 || config.performance.timeout > 1000)) {
        return false;
      }
      
      // 检查最大编辑长度合理性
      if (config.performance?.maxEditLength && 
          (config.performance.maxEditLength < 10 || config.performance.maxEditLength > 10000)) {
        return false;
      }
      
      // 检查正则表达式有效性
      if (config.wordDiff?.wordSeparator) {
        new RegExp(config.wordDiff.wordSeparator);
      }
      
      return true;
    } catch (error) {
      return false;
    }
  }
}