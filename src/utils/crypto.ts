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
}