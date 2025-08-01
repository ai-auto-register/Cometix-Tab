import * as assert from 'assert';
import { ApiClient } from '../api/apiClient';
import { EndpointType } from '../api/endpoints';

suite('API Client Test Suite', () => {
  test('Initialize with default configuration', () => {
    const client = new ApiClient();
    const info = client.getEndpointInfo();
    
    // 默认应该是官方端点
    assert.strictEqual(info.type, EndpointType.OFFICIAL, 'Default endpoint type should be OFFICIAL');
    assert.strictEqual(info.baseUrl, 'https://api2.cursor.sh', 'Default URL should be official');
    
    console.log('Default endpoint info:', info);
  });

  test('Initialize with self-hosted configuration', () => {
    const client = new ApiClient({
      endpointType: EndpointType.SELF_HOSTED,
      baseUrl: 'http://localhost:8000'
    });
    
    const info = client.getEndpointInfo();
    
    assert.strictEqual(info.type, EndpointType.SELF_HOSTED, 'Endpoint type should be SELF_HOSTED');
    assert.strictEqual(info.baseUrl, 'http://localhost:8000', 'URL should be custom');
    
    console.log('Custom endpoint info:', info);
  });

  test('Automatic URL matching for official endpoint', () => {
    const client = new ApiClient({
      endpointType: EndpointType.OFFICIAL,
      baseUrl: 'http://localhost:8000' // 不匹配的URL
    });
    
    const info = client.getEndpointInfo();
    
    // 应该自动修正为官方URL
    assert.strictEqual(info.baseUrl, 'https://api2.cursor.sh', 'Should auto-correct to official URL');
    
    console.log('Auto-corrected endpoint info:', info);
  });

  test('Automatic URL matching for self-hosted endpoint', () => {
    const client = new ApiClient({
      endpointType: EndpointType.SELF_HOSTED,
      baseUrl: 'https://api2.cursor.sh' // 不匹配的URL
    });
    
    const info = client.getEndpointInfo();
    
    // 应该自动修正为自部署默认URL
    assert.strictEqual(info.baseUrl, 'http://localhost:8000', 'Should auto-correct to self-hosted URL');
    
    console.log('Auto-corrected self-hosted endpoint info:', info);
  });

  test('Configuration validation', () => {
    const client = new ApiClient({
      authToken: 'test-token',
      clientKey: 'test-key'
    });
    
    const validation = client.validateConfiguration();
    
    // baseUrl应该存在，authToken和clientKey也应该存在
    assert.strictEqual(validation.isValid, true, 'Configuration should be valid');
    assert.strictEqual(validation.issues.length, 0, 'Should have no validation issues');
    
    console.log('Validation result:', validation);
  });

  test('Configuration validation with missing values', () => {
    const client = new ApiClient({
      authToken: '',
      clientKey: ''
    });
    
    const validation = client.validateConfiguration();
    
    // 应该检测到缺失的值
    assert.strictEqual(validation.isValid, false, 'Configuration should be invalid');
    assert.strictEqual(validation.issues.length >= 1, true, 'Should have at least 1 issue');
    
    // 检查是否包含预期的错误
    const hasAuthTokenIssue = validation.issues.some(issue => issue.includes('Auth token'));
    assert.strictEqual(hasAuthTokenIssue, true, 'Should have auth token issue');
    
    console.log('Validation issues:', validation.issues);
  });

  test('Client key auto-generation', () => {
    const client = new ApiClient({
      endpointType: EndpointType.OFFICIAL
      // 不提供clientKey，应该自动生成
    });
    
    const validation = client.validateConfiguration();
    
    // 应该有自动生成的clientKey
    assert.strictEqual(validation.issues.filter(issue => issue.includes('Client key')).length, 0, 
      'Should not have client key issues');
    
    console.log('Auto-generated client key validation:', validation);
  });

  test('Update configuration', () => {
    const client = new ApiClient();
    
    // 更新配置
    client.updateConfig({
      endpointType: EndpointType.SELF_HOSTED,
      baseUrl: 'http://custom.example.com'
    });
    
    const info = client.getEndpointInfo();
    
    assert.strictEqual(info.type, EndpointType.SELF_HOSTED, 'Endpoint type should be updated');
    assert.strictEqual(info.baseUrl, 'http://custom.example.com', 'URL should be updated');
    
    console.log('Updated endpoint info:', info);
  });
});