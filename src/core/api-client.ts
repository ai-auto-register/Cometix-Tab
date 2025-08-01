import type { CursorConfig, CompletionRequest, FileInfo } from '../types';
import { CryptoUtils } from '../utils/crypto';
import { Logger } from '../utils/logger';
import { ProtobufUtils } from '../utils/protobuf';
import { ConnectRpcClient } from '../utils/connect-rpc-client';
import { ConnectRpcApiClient } from './connect-rpc-api-client';
import { StreamCppResponse } from '../generated/cpp_pb';
import { ConfigManager } from '../utils/config';

/**
 * Cursor API客户端 - 支持两种实现方式
 * 
 * 1. 新的 Connect RPC 实现（推荐）：使用构建时生成的类型安全客户端
 * 2. 旧的手动实现（向后兼容）：使用运行时 protobuf 解析
 */
export class CursorApiClient {
  private config: CursorConfig;
  private logger: Logger;
  private filesyncCookie: string;
  private protobufUtils: ProtobufUtils;
  private connectRpcClient?: ConnectRpcClient;
  private connectRpcApiClient?: ConnectRpcApiClient;
  private useConnectRpc: boolean;
  
  constructor(config: CursorConfig, useConnectRpc: boolean = true) {
    this.config = config;
    this.logger = Logger.getInstance();
    this.filesyncCookie = CryptoUtils.generateFilesyncCookie();
    this.protobufUtils = ProtobufUtils.getInstance();
    this.useConnectRpc = useConnectRpc;
    
    if (this.useConnectRpc) {
      // 使用新的 Connect RPC 实现
      this.connectRpcApiClient = new ConnectRpcApiClient({
        baseUrl: config.serverUrl,
        authToken: config.authToken,
        clientKey: config.clientKey,
        gcppHost: config.gcppHost,
        timeout: 30000
      });
      this.logger.info('✅ 使用 Connect RPC 实现');
    } else {
      // 使用旧的手动实现作为 fallback
      this.connectRpcClient = new ConnectRpcClient(
        config.serverUrl,
        config.authToken,
        config.clientKey
      );
      this.initializeProtobuf();
      this.logger.info('⚠️ 使用手动 HTTP 实现（向后兼容）');
    }
  }
  
  private async initializeProtobuf(): Promise<void> {
    try {
      await this.protobufUtils.initialize();
      this.logger.info('✅ Connect RPC Protobuf utils initialized');
    } catch (error) {
      this.logger.error('❌ Failed to initialize Connect RPC protobuf utils', error as Error);
    }
  }
  
  updateConfig(config: CursorConfig): void {
    this.config = config;
    
    if (this.useConnectRpc && this.connectRpcApiClient) {
      // Connect RPC 实现需要重新创建客户端
      this.connectRpcApiClient.updateConfig(config);
    } else if (!this.useConnectRpc && this.connectRpcClient) {
      // 手动实现可以更新配置
      this.connectRpcClient.updateConfig(
        config.serverUrl,
        config.authToken,
        config.clientKey
      );
    }
  }
  
  /**
   * 上传文件到cursor-api服务器
   * 支持 Connect RPC 和手动实现两种方式
   */
  async uploadFile(fileInfo: FileInfo): Promise<boolean> {
    try {
      this.logger.info(`📤 上传文件: ${fileInfo.path}`);
      this.logger.debug(`📊 文件大小: ${fileInfo.content.length} 字符`);
      
      if (this.useConnectRpc && this.connectRpcApiClient) {
        // 使用 Connect RPC 实现 - 🔧 传递固定的 workspaceId
        const workspaceId = "a-b-c-d-e-f-g"; // 与 StreamCpp 保持一致
        const response = await this.connectRpcApiClient.uploadFile(fileInfo, workspaceId);
        this.logger.info(`✅ Connect RPC 文件上传成功: ${fileInfo.path}`);
        return true;
      } else if (!this.useConnectRpc && this.connectRpcClient) {
        // 使用手动实现
        const uuid = CryptoUtils.generateUUID();
        const result = await this.connectRpcClient.uploadFile(fileInfo, uuid, {
          encoding: 'json',
          timeout: 15000
        });
        
        if (!result.success) {
          throw new Error(result.error || '未知错误');
        }
        
        this.logger.info(`✅ 手动实现文件上传成功: ${fileInfo.path}`);
        return true;
      } else {
        throw new Error('客户端未正确初始化');
      }
      
    } catch (error) {
      this.logger.error(`❌ 文件上传失败: ${fileInfo.path}`, error as Error);
      return false;
    }
  }
  
  /**
   * 同步文件到cursor-api服务器（增量更新）
   * TODO: 实现FSSyncFile接口
   */
  async syncFile(fileInfo: FileInfo): Promise<boolean> {
    try {
      this.logger.info(`🔄 文件同步功能尚未实现: ${fileInfo.path}`);
      // 目前使用uploadFile作为fallback
      return await this.uploadFile(fileInfo);
    } catch (error) {
      this.logger.error(`❌ 文件同步失败: ${fileInfo.path}`, error as Error);
      return false;
    }
  }
  
  /**
   * 请求代码补全
   * 支持 Connect RPC 和手动实现两种方式
   */
  async requestCompletion(request: CompletionRequest, abortSignal?: AbortSignal): Promise<AsyncIterable<StreamCppResponse | any> | null> {
    try {
      this.logger.info(`🚀 代码补全请求`);
      this.logger.info(`📄 文件路径: ${request.currentFile.path}`);
      this.logger.info(`📍 光标位置: line ${request.cursorPosition.line}, column ${request.cursorPosition.column}`);
      this.logger.info(`📊 文件大小: ${request.currentFile.content.length} 字符`);
      
      // 验证配置
      const validation = ConfigManager.validateConfig(this.config);
      if (!validation.isValid) {
        const errorMsg = `❌ 配置无效：\n${validation.errors.join('\n')}`;
        this.logger.error(errorMsg);
        
        // 显示配置指导
        ConfigManager.showConfigurationGuide();
        throw new Error(errorMsg);
      }
      
      // 显示警告（如果有）
      if (validation.warnings.length > 0) {
        validation.warnings.forEach(warning => {
          this.logger.warn(`⚠️ ${warning}`);
        });
      }
      
      if (this.useConnectRpc && this.connectRpcApiClient) {
        // 使用 Connect RPC 实现
        this.logger.info('🔌 使用 Connect RPC StreamCpp 接口');
        return this.connectRpcApiClient.streamCpp(request, abortSignal);
      } else if (!this.useConnectRpc && this.connectRpcClient) {
        // 使用手动实现
        this.logger.info('🔧 使用手动 HTTP 实现');
        return this.connectRpcClient.streamCpp(request, {
          encoding: 'json',
          timeout: 30000,
          signal: abortSignal
        });
      } else {
        throw new Error('客户端未正确初始化');
      }
      
    } catch (error) {
      // 增强错误日志
      if (error instanceof TypeError && error.message === 'fetch failed') {
        this.logger.error('❌ 网络请求失败 - 可能的原因:');
        this.logger.error('  1. 网络连接问题');
        this.logger.error('  2. 服务器地址不正确');
        this.logger.error('  3. 防火墙或代理阻止了请求');
        this.logger.error('  4. SSL/TLS 证书问题');
        this.logger.error(`  当前服务器地址: ${this.config.serverUrl}`);
      } else {
        this.logger.error('❌ 代码补全请求失败', error as Error);
      }
      
      return null;
    }
  }
  
  /**
   * 获取可用模型列表
   */
  async getModels(): Promise<any> {
    try {
      this.logger.info('📋 获取模型列表');
      
      if (this.useConnectRpc && this.connectRpcApiClient) {
        // Connect RPC 实现暂不支持 getModels，使用连接测试
        const result = await this.connectRpcApiClient.testConnection(); 
        return result.success ? { models: ['auto'] } : null;
      } else if (!this.useConnectRpc && this.connectRpcClient) {
        const result = await this.connectRpcClient.testConnection();
        
        if (!result.success) {
          throw new Error(result.error || '获取模型列表失败');
        }
        
        return result.data;
      } else {
        throw new Error('客户端未正确初始化');
      }
    } catch (error) {
      this.logger.error('❌ 获取模型列表失败', error as Error);
      return null;
    }
  }
  
  /**
   * 测试与cursor-api服务器的连接
   */
  async testConnection(): Promise<{ success: boolean; message: string; details?: any }> {
    try {
      this.logger.info('🔍 测试连接');
      
      if (this.useConnectRpc && this.connectRpcApiClient) {
        // 使用 Connect RPC 实现
        return await this.connectRpcApiClient.testConnection();
      } else if (!this.useConnectRpc && this.connectRpcClient) {
        // 使用手动实现
        const result = await this.connectRpcClient.testConnection();
        
        if (result.success) {
          return {
            success: true,
            message: '✅ 手动实现连接测试成功',
            details: result.data
          };
        } else {
          return {
            success: false,
            message: `❌ 手动实现连接测试失败: ${result.error}`,
            details: result
          };
        }
      } else {
        return {
          success: false,
          message: '❌ 客户端未正确初始化'
        };
      }
      
    } catch (error) {
      this.logger.error('❌ 连接测试失败', error as Error);
      return {
        success: false,
        message: `❌ 连接测试异常: ${(error as Error).message}`
      };
    }
  }
  
  /**
   * 获取文件同步Cookie
   */
  getFilesyncCookie(): string {
    if (this.useConnectRpc && this.connectRpcApiClient) {
      return this.connectRpcApiClient.getFilesyncCookie();
    } else {
      return this.filesyncCookie;
    }
  }
  
  /**
   * 重新生成文件同步Cookie
   */
  regenerateFilesyncCookie(): void {
    if (this.useConnectRpc && this.connectRpcApiClient) {
      this.connectRpcApiClient.regenerateFilesyncCookie();
    } else {
      this.filesyncCookie = CryptoUtils.generateFilesyncCookie();
      this.logger.info('🔄 FilesyncCookie已重新生成');
    }
  }
}