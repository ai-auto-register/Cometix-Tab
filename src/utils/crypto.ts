import * as crypto from 'crypto-js';

export class CryptoUtils {
  static generateClientKey(): string {
    // 生成32字节的随机hex字符串
    const randomBytes = Array.from({ length: 32 }, () => 
      Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
    ).join('');
    return randomBytes;
  }
  
  static generateFilesyncCookie(): string {
    // 生成16字节的随机字符串
    const randomBytes = Array.from({ length: 16 }, () => 
      Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
    ).join('');
    return randomBytes;
  }
  
  static calculateSHA256(content: string): string {
    return crypto.SHA256(content).toString(crypto.enc.Hex);
  }
  
  static generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  
  /**
   * 为字符串生成简单的哈希值
   */
  static hashString(str: string): string {
    return crypto.SHA256(str).toString(crypto.enc.Hex).substring(0, 14); // 取前14个字符
  }
  
  /**
   * 生成 22 字符的 base62 编码工作区ID
   */
  static generateWorkspaceId(seed?: string): string {
    // Base62 编码表 (0-9A-Za-z)
    const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    
    // 生成或使用种子来创建 128 位数字
    let num: bigint;
    if (seed) {
      // 基于种子生成确定性的 workspaceId
      const hash = crypto.SHA256(seed).toString(crypto.enc.Hex);
      // 取前32个字符作为128位数字的源
      num = BigInt('0x' + hash);
    } else {
      // 生成随机 128 位数字
      const randomHex = Array.from({ length: 32 }, () => 
        Math.floor(Math.random() * 16).toString(16)
      ).join('');
      num = BigInt('0x' + randomHex);
    }
    
    // Base62 编码
    const base = BigInt(62);
    let result = '';
    let temp = num;
    
    // 生成 22 字符长度的 base62 字符串
    for (let i = 0; i < 22; i++) {
      const remainder = Number(temp % base);
      result = BASE62_CHARS[remainder] + result;
      temp = temp / base;
    }
    
    return result;
  }
  
  /**
   * 基于工作区路径生成稳定的 workspaceId
   * 同一个工作区每次生成的ID都相同
   */
  static generateStableWorkspaceId(workspacePath: string): string {
    // 规范化路径作为种子
    const normalizedPath = workspacePath.replace(/\\/g, '/').toLowerCase();
    return this.generateWorkspaceId(normalizedPath);
  }
}