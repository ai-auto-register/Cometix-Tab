/**
 * Connect RPC 客户端适配器
 * 将 ConnectRpcApiClient 适配为 CursorApiClient 接口
 */

import { ConnectRpcApiClient } from '../core/connect-rpc-api-client';
import { StreamCppResponse } from '../generated/cpp_pb';
import type { CompletionRequest } from '../types';
import { Logger } from '../utils/logger';

export class ConnectRpcAdapter {
  private logger: Logger;
  private connectClient: ConnectRpcApiClient;

  constructor(connectClient: ConnectRpcApiClient) {
    this.logger = Logger.getInstance();
    this.connectClient = connectClient;
  }

  /**
   * 适配代码补全请求
   * 直接返回 ConnectRPC 的流式响应，无需转换
   */
  async requestCompletion(request: CompletionRequest, abortSignal?: AbortSignal): Promise<AsyncIterable<StreamCppResponse> | null> {
    try {
      this.logger.info('🔄 使用 Connect RPC 适配器发送补全请求');
      
      // 直接返回 Connect RPC 客户端的流式响应
      // CursorCompletionProvider 已经支持处理 StreamCppResponse
      return this.connectClient.streamCpp(request, abortSignal);
      
    } catch (error) {
      this.logger.error('❌ Connect RPC 适配器请求失败', error as Error);
      return null;
    }
  }


  /**
   * 测试连接（适配旧的接口）
   */
  async testConnection(): Promise<{ success: boolean; message: string; details?: any }> {
    return this.connectClient.testConnection();
  }
}