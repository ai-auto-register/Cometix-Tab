import { Logger } from './logger';

export interface TokenInfo {
  isValid: boolean;
  type: 'jwt' | 'api-key' | 'unknown';
  length: number;
  preview: string;
  issues: string[];
}

export class AuthValidator {
  private static logger = Logger.getInstance();

  /**
   * 验证认证令牌格式
   */
  static validateAuthToken(token: string): TokenInfo {
    const issues: string[] = [];
    let type: 'jwt' | 'api-key' | 'unknown' = 'unknown';
    let isValid = false;

    if (!token || token.trim().length === 0) {
      issues.push('认证令牌为空');
      return {
        isValid: false,
        type: 'unknown',
        length: 0,
        preview: '',
        issues
      };
    }

    const trimmedToken = token.trim();
    const length = trimmedToken.length;
    const preview = `${trimmedToken.substring(0, 10)}...${trimmedToken.substring(length - 4)}`;

    // 检查是否是JWT格式
    if (trimmedToken.startsWith('eyJ')) {
      type = 'jwt';
      const parts = trimmedToken.split('.');
      
      if (parts.length === 3) {
        isValid = true;
        this.logger.info('🔍 JWT 令牌格式检查通过');
        
        // 尝试解析JWT头部（只是为了验证格式）
        try {
          const header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
          this.logger.info(`📋 JWT 头部: ${JSON.stringify(header)}`);
        } catch (e) {
          issues.push('JWT头部解析失败');
          isValid = false;
        }
      } else {
        issues.push(`JWT格式错误：应该有3个部分，实际有${parts.length}个`);
      }
    } 
    // 检查是否是API密钥格式
    else if (/^[a-zA-Z0-9_-]+$/.test(trimmedToken)) {
      type = 'api-key';
      
      if (length >= 32) {
        isValid = true;
        this.logger.info('🔍 API密钥格式检查通过');
      } else {
        issues.push('API密钥长度太短（应该至少32字符）');
      }
    } else {
      issues.push('未知的令牌格式');
    }

    // 长度检查
    if (length < 20) {
      issues.push('令牌长度太短');
      isValid = false;
    } else if (length > 2000) {
      issues.push('令牌长度异常长');
    }

    return {
      isValid,
      type,
      length,
      preview,
      issues
    };
  }

  /**
   * 验证Cursor特定的认证格式
   */
  static validateCursorAuth(token: string, checksum: string): { isValid: boolean; issues: string[] } {
    const issues: string[] = [];

    // 验证令牌
    const tokenInfo = this.validateAuthToken(token);
    if (!tokenInfo.isValid) {
      issues.push(`认证令牌无效: ${tokenInfo.issues.join(', ')}`);
    }

    // 验证checksum
    if (!checksum || checksum.trim().length === 0) {
      issues.push('Checksum为空');
    } else {
      const checksumLength = checksum.trim().length;
      if (checksumLength !== 137 && checksumLength !== 129 && checksumLength !== 72) {
        issues.push(`Checksum长度错误: ${checksumLength}（应该是72、129或137）`);
      }
    }

    this.logger.info('🔍 Cursor认证验证结果:');
    this.logger.info(`  令牌类型: ${tokenInfo.type}`);
    this.logger.info(`  令牌长度: ${tokenInfo.length}`);
    this.logger.info(`  Checksum长度: ${checksum.trim().length}`);
    this.logger.info(`  问题数量: ${issues.length}`);

    return {
      isValid: issues.length === 0,
      issues
    };
  }
}