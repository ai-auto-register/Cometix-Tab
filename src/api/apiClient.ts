import * as vscode from 'vscode';
import { EndpointType, getEndpointUrl, DEFAULT_ENDPOINTS } from './endpoints';
import { getOrGenerateClientKey } from '../utils/checksum';

export interface ApiClientConfig {
  endpointType: EndpointType;
  baseUrl?: string;
  authToken: string;
  clientKey: string;
}

export class ApiClient {
  private config: ApiClientConfig;

  constructor(config?: Partial<ApiClientConfig>) {
    this.config = this.loadConfig(config);
  }

  private loadConfig(override?: Partial<ApiClientConfig>): ApiClientConfig {
    const vscodeConfig = vscode.workspace.getConfiguration('cometixTab');
    
    const endpointType = (override?.endpointType || vscodeConfig.get<string>('endpointType') || 'official') as EndpointType;
    const customBaseUrl = override?.baseUrl || vscodeConfig.get<string>('serverUrl');
    
    // 智能URL检测：如果用户没有设置自定义URL，或者当前URL与端点类型不匹配，则使用默认URL
    let baseUrl: string;
    if (!customBaseUrl || customBaseUrl.trim() === '') {
      // 用户没有设置自定义URL，使用默认值
      baseUrl = DEFAULT_ENDPOINTS[endpointType];
    } else {
      // 检查当前URL是否与端点类型匹配
      const isOfficialUrl = customBaseUrl.includes('api2.cursor.sh') || customBaseUrl.includes('cursor.sh');
      
      if (endpointType === EndpointType.OFFICIAL && !isOfficialUrl) {
        // 选择了官方端点但URL不是官方的，使用默认官方URL
        baseUrl = DEFAULT_ENDPOINTS[EndpointType.OFFICIAL];
      } else if (endpointType === EndpointType.SELF_HOSTED && isOfficialUrl) {
        // 选择了自部署端点但URL是官方的，使用默认自部署URL
        baseUrl = DEFAULT_ENDPOINTS[EndpointType.SELF_HOSTED];
      } else {
        // URL与端点类型匹配，使用用户设置的URL
        baseUrl = customBaseUrl;
      }
    }
    
    // 如果没有客户端密钥，自动生成一个
    let clientKey = override?.clientKey || vscodeConfig.get<string>('clientKey') || '';
    if (!clientKey || clientKey.trim() === '') {
      clientKey = getOrGenerateClientKey();
      // 保存生成的客户端密钥到配置中
      vscodeConfig.update('clientKey', clientKey, vscode.ConfigurationTarget.Global);
    }

    return {
      endpointType,
      baseUrl,
      authToken: override?.authToken || vscodeConfig.get<string>('authToken') || '',
      clientKey
    };
  }

  updateConfig(newConfig: Partial<ApiClientConfig>) {
    this.config = { ...this.config, ...newConfig };
  }

  private getUrl(endpoint: 'streamCpp' | 'cppConfig' | 'availableModels' | 'uploadFile' | 'syncFile'): string {
    return getEndpointUrl(this.config.endpointType, this.config.baseUrl!, endpoint);
  }

  private getHeaders(contentType = 'application/json'): HeadersInit {
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'User-Agent': 'VSCode-Cometix-Tab/0.0.1'
    };

    if (this.config.authToken) {
      headers['Authorization'] = `Bearer ${this.config.authToken}`;
    }

    // 根据端点类型使用不同的认证头部
    if (this.config.endpointType === EndpointType.OFFICIAL) {
      // 官方端点使用 x-cursor-checksum 和版本号
      if (this.config.clientKey) {
        headers['x-cursor-checksum'] = this.config.clientKey;
      }
      headers['x-cursor-client-version'] = '1.3.6';
    } else {
      // 自部署端点使用 x-client-key
      if (this.config.clientKey) {
        headers['x-client-key'] = this.config.clientKey;
      }
    }

    return headers;
  }

  async streamCpp(request: any, abortController?: AbortController): Promise<ReadableStream<Uint8Array>> {
    const url = this.getUrl('streamCpp');
    const headers = this.getHeaders(
      this.config.endpointType === EndpointType.OFFICIAL 
        ? 'application/proto' 
        : 'application/json'
    );

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: this.config.endpointType === EndpointType.OFFICIAL 
        ? request // protobuf binary for official
        : JSON.stringify(request), // JSON for self-hosted
      signal: abortController?.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('No response body received');
    }

    return response.body;
  }

  async getCppConfig(): Promise<any> {
    const url = this.getUrl('cppConfig');
    const headers = this.getHeaders();

    const response = await fetch(url, {
      method: this.config.endpointType === EndpointType.OFFICIAL ? 'POST' : 'GET',
      headers,
      body: this.config.endpointType === EndpointType.OFFICIAL ? new Uint8Array() : undefined
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }

  async getAvailableModels(): Promise<any> {
    const url = this.getUrl('availableModels');
    const headers = this.getHeaders();

    const response = await fetch(url, {
      method: this.config.endpointType === EndpointType.OFFICIAL ? 'POST' : 'GET',
      headers,
      body: this.config.endpointType === EndpointType.OFFICIAL ? new Uint8Array() : undefined
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }

  async uploadFile(request: any): Promise<any> {
    const url = this.getUrl('uploadFile');
    const headers = this.getHeaders(
      this.config.endpointType === EndpointType.OFFICIAL 
        ? 'application/proto' 
        : 'application/json'
    );

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: this.config.endpointType === EndpointType.OFFICIAL 
        ? request // protobuf binary for official
        : JSON.stringify(request) // JSON for self-hosted
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }

  async syncFile(request: any): Promise<any> {
    const url = this.getUrl('syncFile');
    const headers = this.getHeaders(
      this.config.endpointType === EndpointType.OFFICIAL 
        ? 'application/proto' 
        : 'application/json'
    );

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: this.config.endpointType === EndpointType.OFFICIAL 
        ? request // protobuf binary for official
        : JSON.stringify(request) // JSON for self-hosted
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }

  getEndpointInfo(): { type: EndpointType; baseUrl: string; isDefaultUrl: boolean } {
    const isDefaultUrl = this.config.baseUrl === DEFAULT_ENDPOINTS[this.config.endpointType];
    return {
      type: this.config.endpointType,
      baseUrl: this.config.baseUrl!,
      isDefaultUrl
    };
  }

  validateConfiguration(): { isValid: boolean; issues: string[] } {
    const issues: string[] = [];
    
    if (!this.config.baseUrl) {
      issues.push('Base URL is not set');
    }
    
    if (!this.config.authToken) {
      issues.push('Auth token is not set');
    }
    
    if (!this.config.clientKey) {
      issues.push('Client key is not set');
    }
    
    // 检查URL与端点类型的匹配性
    if (this.config.baseUrl) {
      const isOfficialUrl = this.config.baseUrl.includes('api2.cursor.sh') || 
                           this.config.baseUrl.includes('cursor.sh');
      
      if (this.config.endpointType === EndpointType.OFFICIAL && !isOfficialUrl) {
        issues.push('Selected official endpoint but URL does not appear to be official Cursor API');
      } else if (this.config.endpointType === EndpointType.SELF_HOSTED && isOfficialUrl) {
        issues.push('Selected self-hosted endpoint but URL appears to be official Cursor API');
      }
    }
    
    return {
      isValid: issues.length === 0,
      issues
    };
  }
}