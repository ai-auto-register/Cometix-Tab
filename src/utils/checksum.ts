import * as crypto from 'crypto';

// Base64 URL-safe no padding 编码表
const B64_ENCODE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * 根据 cursor-api 最新算法生成时间戳头部
 * @param kiloSeconds 千秒时间戳
 * @returns 8字符的base64编码时间戳头部
 */
function generateTimestampHeader(kiloSeconds: number): string {
  // 将千秒时间戳转换为6字节数组，使用特定的字节顺序
  const timestampBytes = new Uint8Array(6);
  timestampBytes[0] = ((kiloSeconds >> 8) & 0xFF);
  timestampBytes[1] = (kiloSeconds & 0xFF);
  timestampBytes[2] = ((kiloSeconds >> 24) & 0xFF);
  timestampBytes[3] = ((kiloSeconds >> 16) & 0xFF);
  timestampBytes[4] = ((kiloSeconds >> 8) & 0xFF);  // 重复的字节用于验证
  timestampBytes[5] = (kiloSeconds & 0xFF);         // 重复的字节用于验证
  
  // 混淆字节数组
  obfuscateBytes(timestampBytes);
  
  // Base64编码
  return encodeBase64(timestampBytes);
}

/**
 * 混淆字节数组，使用与 cursor-api 相同的算法
 * @param bytes 6字节数组
 */
function obfuscateBytes(bytes: Uint8Array): void {
  let prev = 165;
  
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = ((bytes[i] ^ prev) + i) & 0xFF;
    prev = bytes[i];
  }
}

/**
 * Base64 URL-safe 编码（无填充）
 * @param input 输入字节数组
 * @returns base64编码字符串
 */
function encodeBase64(input: Uint8Array): string {
  let result = '';
  
  // 处理3字节块
  for (let i = 0; i < input.length; i += 3) {
    const chunk = input.slice(i, i + 3);
    const padded = new Uint8Array(3);
    padded.set(chunk);
    
    const b0 = padded[0];
    const b1 = padded[1];
    const b2 = padded[2];
    
    result += B64_ENCODE[b0 >> 2];
    result += B64_ENCODE[((b0 & 0x03) << 4) | (b1 >> 4)];
    
    if (chunk.length > 1) {
      result += B64_ENCODE[((b1 & 0x0F) << 2) | (b2 >> 6)];
    }
    
    if (chunk.length > 2) {
      result += B64_ENCODE[b2 & 0x3F];
    }
  }
  
  return result;
}

/**
 * 生成32字节的随机哈希
 * @returns 64字符的十六进制字符串
 */
function generateRandomHash(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * 生成机器特征哈希，基于系统信息
 * @returns 64字符的十六进制字符串
 */
function generateMachineHash(): string {
  const os = require('os');
  
  const hostname = os.hostname();
  const platform = os.platform();
  const arch = os.arch();
  const userInfo = os.userInfo();
  const networkInterfaces = os.networkInterfaces();
  
  // 获取第一个MAC地址
  let macAddress = '';
  for (const [name, interfaces] of Object.entries(networkInterfaces)) {
    if (interfaces && Array.isArray(interfaces)) {
      for (const iface of interfaces) {
        if (iface.mac && iface.mac !== '00:00:00:00:00:00') {
          macAddress = iface.mac;
          break;
        }
      }
    }
    if (macAddress) {
      break;
    }
  }
  
  // 结合系统信息生成稳定的机器哈希
  const machineString = `${hostname}-${platform}-${arch}-${userInfo.username}-${macAddress}`;
  return crypto.createHash('sha256').update(machineString).digest('hex');
}

/**
 * 生成MAC地址哈希
 * @returns 64字符的十六进制字符串
 */
function generateMacHash(): string {
  const os = require('os');
  const networkInterfaces = os.networkInterfaces();
  
  // 收集所有MAC地址
  const macAddresses: string[] = [];
  for (const [name, interfaces] of Object.entries(networkInterfaces)) {
    if (interfaces && Array.isArray(interfaces)) {
      for (const iface of interfaces) {
        if (iface.mac && iface.mac !== '00:00:00:00:00:00') {
          macAddresses.push(iface.mac);
        }
      }
    }
  }
  
  if (macAddresses.length === 0) {
    // 如果没有MAC地址，生成随机哈希
    return generateRandomHash();
  }
  
  // 使用所有MAC地址生成哈希
  const macString = macAddresses.sort().join('-');
  return crypto.createHash('sha256').update(macString).digest('hex');
}

/**
 * 生成完整的Cursor checksum，支持三种格式：
 * - 72字符：时间戳(8) + 设备哈希(64)
 * - 129字符：设备哈希(64) + '/' + MAC哈希(64) 
 * - 137字符：时间戳(8) + 设备哈希(64) + '/' + MAC哈希(64)
 * @param format 格式类型
 * @returns checksum字符串
 */
export function generateChecksum(format: 'short' | 'normal' | 'full' = 'full'): string {
  const now = Date.now();
  const kiloSeconds = Math.floor(now / 1000); // 转换为千秒
  
  const timestampHeader = generateTimestampHeader(kiloSeconds);
  const deviceHash = generateMachineHash();
  const macHash = generateMacHash();
  
  switch (format) {
    case 'short':
      // 72字符格式：时间戳(8) + 设备哈希(64)
      return timestampHeader + deviceHash;
      
    case 'normal':
      // 129字符格式：设备哈希(64) + '/' + MAC哈希(64)
      return deviceHash + '/' + macHash;
      
    case 'full':
    default:
      // 137字符格式：时间戳(8) + 设备哈希(64) + '/' + MAC哈希(64)
      return timestampHeader + deviceHash + '/' + macHash;
  }
}

/**
 * 验证checksum格式是否有效
 * @param checksum checksum字符串
 * @returns 是否有效
 */
export function validateChecksum(checksum: string): boolean {
  const len = checksum.length;
  
  // 长度验证
  if (len !== 72 && len !== 129 && len !== 137) {
    return false;
  }
  
  // 字符验证
  for (let i = 0; i < len; i++) {
    const char = checksum[i];
    const isValidChar = /[A-Za-z0-9\-_\/]/.test(char);
    
    if (!isValidChar) {
      return false;
    }
    
    // 特定位置的字符验证
    if (len === 129 && i === 64 && char !== '/') {
      return false;
    }
    if (len === 137 && i === 72 && char !== '/') {
      return false;
    }
    
    // 十六进制字符验证
    const needsHex = (len === 72 && i >= 8) || 
                    (len === 129 && i !== 64) ||
                    (len === 137 && i >= 8 && i !== 72);
    
    if (needsHex && !/[0-9a-fA-F]/.test(char)) {
      return false;
    }
  }
  
  return true;
}

/**
 * 获取或生成客户端密钥（checksum）
 * 默认生成137字符的完整格式
 */
export function getOrGenerateClientKey(): string {
  return generateChecksum('full');
}