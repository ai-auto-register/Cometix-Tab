import * as assert from 'assert';
import { generateChecksum, validateChecksum, getOrGenerateClientKey } from '../utils/checksum';

suite('Checksum Test Suite', () => {
  test('Generate checksum formats', () => {
    const shortChecksum = generateChecksum('short');
    const normalChecksum = generateChecksum('normal');
    const fullChecksum = generateChecksum('full');
    
    // 验证长度
    assert.strictEqual(shortChecksum.length, 72, 'Short checksum should be 72 characters');
    assert.strictEqual(normalChecksum.length, 129, 'Normal checksum should be 129 characters');
    assert.strictEqual(fullChecksum.length, 137, 'Full checksum should be 137 characters');
    
    console.log('Short checksum (72):', shortChecksum);
    console.log('Normal checksum (129):', normalChecksum);
    console.log('Full checksum (137):', fullChecksum);
  });

  test('Validate checksum formats', () => {
    const shortChecksum = generateChecksum('short');
    const normalChecksum = generateChecksum('normal');
    const fullChecksum = generateChecksum('full');
    
    // 验证格式
    assert.strictEqual(validateChecksum(shortChecksum), true, 'Short checksum should be valid');
    assert.strictEqual(validateChecksum(normalChecksum), true, 'Normal checksum should be valid');
    assert.strictEqual(validateChecksum(fullChecksum), true, 'Full checksum should be valid');
    
    // 验证无效格式
    assert.strictEqual(validateChecksum('invalid'), false, 'Invalid checksum should be rejected');
    assert.strictEqual(validateChecksum(''), false, 'Empty checksum should be rejected');
    assert.strictEqual(validateChecksum('a'.repeat(70)), false, 'Wrong length should be rejected');
  });

  test('Checksum structure validation', () => {
    const fullChecksum = generateChecksum('full');
    
    // 验证分隔符位置
    assert.strictEqual(fullChecksum[72], '/', 'Character at position 72 should be "/"');
    
    // 验证时间戳部分（前8字符应该是base64 URL-safe字符）
    const timestampPart = fullChecksum.substring(0, 8);
    const base64Regex = /^[A-Za-z0-9\-_]{8}$/;
    assert.strictEqual(base64Regex.test(timestampPart), true, 'Timestamp part should be valid base64 URL-safe');
    
    // 验证哈希部分（十六进制）
    const deviceHash = fullChecksum.substring(8, 72);
    const macHash = fullChecksum.substring(73, 137);
    const hexRegex = /^[0-9a-f]{64}$/;
    
    assert.strictEqual(hexRegex.test(deviceHash), true, 'Device hash should be 64-character hex');
    assert.strictEqual(hexRegex.test(macHash), true, 'MAC hash should be 64-character hex');
  });

  test('Checksum consistency', () => {
    // 生成多个checksum，设备和MAC哈希部分应该相同（因为基于相同的系统信息）
    const checksum1 = generateChecksum('normal');
    const checksum2 = generateChecksum('normal');
    
    // 设备哈希应该相同
    const deviceHash1 = checksum1.substring(0, 64);
    const deviceHash2 = checksum2.substring(0, 64);
    assert.strictEqual(deviceHash1, deviceHash2, 'Device hash should be consistent');
    
    // MAC哈希应该相同
    const macHash1 = checksum1.substring(65, 129);
    const macHash2 = checksum2.substring(65, 129);
    assert.strictEqual(macHash1, macHash2, 'MAC hash should be consistent');
  });

  test('Client key generation', () => {
    const clientKey = getOrGenerateClientKey();
    
    // 应该生成137字符的完整格式
    assert.strictEqual(clientKey.length, 137, 'Client key should be 137 characters (full format)');
    assert.strictEqual(validateChecksum(clientKey), true, 'Client key should be valid checksum');
    
    console.log('Generated client key:', clientKey);
  });

  test('Time-based variation', (done) => {
    // 等待一小段时间，确保时间戳不同
    const checksum1 = generateChecksum('short');
    
    setTimeout(() => {
      const checksum2 = generateChecksum('short');
      
      // 时间戳部分可能不同（前8字符）
      const timestamp1 = checksum1.substring(0, 8);
      const timestamp2 = checksum2.substring(0, 8);
      
      // 设备哈希部分应该相同（后64字符）
      const deviceHash1 = checksum1.substring(8);
      const deviceHash2 = checksum2.substring(8);
      assert.strictEqual(deviceHash1, deviceHash2, 'Device hash should be consistent across time');
      
      console.log('Timestamp 1:', timestamp1);
      console.log('Timestamp 2:', timestamp2);
      console.log('Device hash (consistent):', deviceHash1);
      
      done();
    }, 1100); // 等待超过1秒，确保千秒时间戳可能发生变化
  });
});