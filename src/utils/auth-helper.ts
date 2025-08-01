/**
 * 认证帮助工具
 * 基于Go代码实现的checksum生成
 */

import { Logger } from './logger';

export class AuthHelper {
  private static logger = Logger.getInstance();

  /**
   * 获取机器ID（简化版本）
   */
  static getMachineId(): string {
    // 在浏览器环境中生成一个简单的机器ID
    // 这里使用navigator相关信息或生成随机值
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      ctx!.textBaseline = 'top';
      ctx!.font = '14px Arial';
      ctx!.fillText('Machine ID', 2, 2);
      const hash = ctx!.canvas.toDataURL().slice(-16);
      return hash.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
    } catch {
      // Fallback: 使用随机字符串
      return Math.random().toString(36).substring(2, 10);
    }
  }

  /**
   * 加密字节数组（基于Go代码）
   */
  static encryptBytes(input: Uint8Array): Uint8Array {
    let w = 165; // byte(165)
    
    for (let i = 0; i < input.length; i++) {
      input[i] = ((input[i] ^ w) + (i % 256)) & 0xFF;
      w = input[i];
    }
    
    return input;
  }

  /**
   * 生成checksum（基于Go代码）
   */
  static generateChecksum(machineId?: string): string {
    const mid = machineId || this.getMachineId();
    
    // 获取当前时间戳（毫秒）
    const timestamp = Date.now();
    
    // 转换为6字节数组（Go中的uint64截取）
    const timestampBytes = new Uint8Array(6);
    timestampBytes[0] = (timestamp >> 40) & 0xFF;
    timestampBytes[1] = (timestamp >> 32) & 0xFF;
    timestampBytes[2] = (timestamp >> 24) & 0xFF;
    timestampBytes[3] = (timestamp >> 16) & 0xFF;
    timestampBytes[4] = (timestamp >> 8) & 0xFF;
    timestampBytes[5] = timestamp & 0xFF;
    
    // 加密字节
    const encryptedBytes = this.encryptBytes(timestampBytes);
    
    // Base64编码
    const base64Encoded = btoa(String.fromCharCode(...encryptedBytes));
    
    // 组合checksum
    const checksum = `${base64Encoded}${mid}`;
    
    this.logger.debug(`生成checksum: ${checksum}`);
    return checksum;
  }
}