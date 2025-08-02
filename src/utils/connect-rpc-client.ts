/**
 * Connect RPC 客户端实现
 * 
 * 这个实现基于Connect RPC的HTTP/1.1传输协议，支持：
 * - JSON和二进制protobuf编码
 * - 流式响应（Server-Streaming）
 * - 标准HTTP头部认证
 * - 与cursor-api兼容的接口调用
 */

import { Logger } from './logger';
import { ProtobufUtils } from './protobuf';
import type { CompletionRequest, FileInfo } from '../types';

export interface ConnectRpcResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  headers?: Record<string, string>;
}

export interface ConnectRpcStreamOptions {
  signal?: AbortSignal;
  timeout?: number;
  encoding?: 'json' | 'protobuf';
}

/**
 * Connect RPC 客户端
 * 基于HTTP/1.1的RPC调用，与cursor-api兼容
 */
export class ConnectRpcClient {
  private logger: Logger;
  private protobufUtils: ProtobufUtils;
  private baseUrl: string;
  private authToken: string;
  private clientKey: string;

  constructor(baseUrl: string, authToken: string, clientKey: string) {
    this.logger = Logger.getInstance();
    this.protobufUtils = ProtobufUtils.getInstance();
    this.baseUrl = baseUrl.replace(/\/$/, ''); // 移除末尾斜杠
    this.authToken = authToken;
    this.clientKey = clientKey;
  }

  /**
   * 更新配置
   */
  updateConfig(baseUrl: string, authToken: string, clientKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.authToken = authToken;
    this.clientKey = clientKey;
  }

  /**
   * 构建Connect RPC请求头
   */
  private buildHeaders(encoding: 'json' | 'protobuf' = 'json'): Record<string, string> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.authToken}`,
      'x-client-key': this.clientKey,
      'User-Agent': 'connectrpc/1.6.1',
      'Accept': 'application/json, application/proto',
    };

    if (encoding === 'json') {
      headers['Content-Type'] = 'application/json';
    } else {
      headers['Content-Type'] = 'application/proto';
    }

    return headers;
  }

  /**
   * 测试CppConfig接口 - 简单的Unary调用
   */
  async testCppConfig(): Promise<ConnectRpcResponse> {
    try {
      this.logger.info('🧪 测试 CppConfig 端点');
      
      const url = `${this.baseUrl}/aiserver.v1.AiService/CppConfig`;
      const headers = this.buildHeaders('json');
      
      // 创建一个简单的空请求体
      const requestBody = JSON.stringify({});
      
      this.logger.info(`📡 请求URL: ${url}`);
      
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: requestBody,
        signal: AbortSignal.timeout(10000)
      });
      
      this.logger.info(`📊 CppConfig 响应状态: ${response.status}`);
      
      if (response.ok) {
        const data = await response.json();
        this.logger.info('✅ CppConfig 调用成功');
        return { success: true, data };
      } else {
        const errorText = await response.text();
        this.logger.error(`❌ CppConfig 调用失败: ${response.status} ${response.statusText}`);
        this.logger.error(`📝 响应内容: ${errorText}`);
        return { success: false, error: `${response.status} ${response.statusText}` };
      }
      
    } catch (error) {
      this.logger.error('❌ CppConfig 请求异常', error as Error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * 调用StreamCpp接口 - Connect RPC Server-Streaming
   * 对应cursor-api的 /cpp/stream 接口
   */
  async *streamCpp(
    request: CompletionRequest, 
    options: ConnectRpcStreamOptions = {}
  ): AsyncGenerator<any, void, unknown> {
    const { signal, timeout = 30000, encoding = 'json' } = options;

    try {
      this.logger.info('🚀 开始Connect RPC StreamCpp调用');
      
      // 构建请求体
      let requestBody: string | Uint8Array;
      if (encoding === 'json') {
        const jsonRequest = this.protobufUtils.createStreamCppRequestJSON(request);
        requestBody = JSON.stringify(jsonRequest);
      } else {
        requestBody = this.protobufUtils.createStreamCppRequest(request);
      }

      // 发起Connect RPC调用
      const url = `${this.baseUrl}/aiserver.v1.AiService/StreamCpp`;
      const headers = this.buildHeaders(encoding);

      this.logger.info(`📡 请求URL: ${url}`);
      this.logger.info(`📡 请求头:`, headers);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      // 如果提供了外部signal，也要监听
      if (signal) {
        signal.addEventListener('abort', () => controller.abort());
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: requestBody,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Connect RPC请求失败: ${response.status} ${response.statusText}`);
      }

      // 检查是否为流式响应
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('stream') && !contentType.includes('text/event-stream')) {
        this.logger.warn('⚠️ 响应不是流式格式，尝试解析单个响应');
        const data = await response.text();
        try {
          yield JSON.parse(data);
        } catch {
          yield { text: data };
        }
        return;
      }

      // 处理流式响应
      if (!response.body) {
        throw new Error('响应体为空');
      }

      // 根据Content-Type决定解析方式
      if (contentType.includes('application/json')) {
        yield* this.parseJsonStream(response.body);
      } else if (contentType.includes('application/proto')) {
        yield* this.parseProtobufStream(response.body);
      } else {
        // 默认按照cursor-api的SSE格式解析
        yield* this.parseCursorSSEStream(response.body);
      }

    } catch (error) {
      this.logger.error('❌ Connect RPC StreamCpp调用失败', error as Error);
      throw error;
    }
  }

  /**
   * 调用FSUploadFile接口 - Connect RPC Unary
   * 对应cursor-api的 /file/upload 接口
   */
  async uploadFile(
    fileInfo: FileInfo, 
    uuid: string,
    options: ConnectRpcStreamOptions = {}
  ): Promise<ConnectRpcResponse> {
    const { signal, timeout = 15000, encoding = 'json' } = options;

    try {
      this.logger.info('📤 开始Connect RPC FSUploadFile调用');

      // 构建请求体
      let requestBody: string | Uint8Array;
      if (encoding === 'json') {
        const jsonRequest = this.protobufUtils.createFSUploadFileRequestJSON(fileInfo, uuid);
        requestBody = JSON.stringify(jsonRequest);
      } else {
        requestBody = this.protobufUtils.createFSUploadFileRequest(fileInfo, uuid);
      }

      const url = `${this.baseUrl}/aiserver.v1.FileSyncService/FSUploadFile`;
      const headers = this.buildHeaders(encoding);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      if (signal) {
        signal.addEventListener('abort', () => controller.abort());
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: requestBody,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          success: false,
          error: `文件上传失败: ${response.status} ${response.statusText}`,
          headers: {}
        };
      }

      const responseText = await response.text();
      let data: any = null;

      try {
        data = JSON.parse(responseText);
      } catch {
        data = responseText;
      }

      this.logger.info('✅ Connect RPC FSUploadFile调用成功');
      return {
        success: true,
        data,
        headers: {}
      };

    } catch (error) {
      this.logger.error('❌ Connect RPC FSUploadFile调用失败', error as Error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * 测试连接 - 调用健康检查接口
   */
  async testConnection(): Promise<ConnectRpcResponse> {
    try {
      this.logger.info('🔍 测试Connect RPC连接');

      // 🧪 优先测试 CppConfig 端点
      const cppConfigResult = await this.testCppConfig();
      if (cppConfigResult.success) {
        this.logger.info('✅ Connect RPC连接测试成功（CppConfig）');
        return cppConfigResult;
      }
      
      // 如果 CppConfig 失败，尝试旧的 /v1/models 端点
      this.logger.warn('⚠️ CppConfig 测试失败，尝试 /v1/models 端点');
      
      const url = `${this.baseUrl}/v1/models`;
      const headers = this.buildHeaders('json');

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        return {
          success: false,
          error: `连接测试失败: ${response.status} ${response.statusText}`
        };
      }

      const data = await response.text();
      this.logger.info('✅ Connect RPC连接测试成功（/v1/models）');
      
      return {
        success: true,
        data: data ? JSON.parse(data) : null
      };

    } catch (error) {
      this.logger.error('❌ Connect RPC连接测试失败', error as Error);
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * 解析JSON格式的流式响应
   */
  private async *parseJsonStream(body: ReadableStream<Uint8Array>): AsyncGenerator<any, void, unknown> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        
        // 保留最后一行（可能不完整）
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (trimmedLine) {
            try {
              const data = JSON.parse(trimmedLine);
              yield data;
            } catch {
              // 如果不是JSON，作为文本处理
              yield { text: trimmedLine };
            }
          }
        }
      }

      // 处理剩余的buffer
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer.trim());
          yield data;
        } catch {
          yield { text: buffer.trim() };
        }
      }

    } finally {
      reader.releaseLock();
    }
  }

  /**
   * 解析Protobuf格式的流式响应
   */
  private async *parseProtobufStream(body: ReadableStream<Uint8Array>): AsyncGenerator<any, void, unknown> {
    const reader = body.getReader();
    let buffer = new Uint8Array(0);

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        // 合并缓冲区
        const newBuffer = new Uint8Array(buffer.length + value.length);
        newBuffer.set(buffer);
        newBuffer.set(value, buffer.length);
        buffer = newBuffer;

        // 尝试解析protobuf消息
        // 这里需要根据实际的protobuf消息格式进行调整
        if (buffer.length >= 4) {
          try {
            const message = this.protobufUtils.parseStreamCppResponse(buffer);
            yield message;
            buffer = new Uint8Array(0); // 清空缓冲区
          } catch {
            // 如果解析失败，继续积累数据
            continue;
          }
        }
      }

    } finally {
      reader.releaseLock();
    }
  }

  /**
   * 解析cursor-api特有的SSE格式（5字节头部）
   */
  private async *parseCursorSSEStream(body: ReadableStream<Uint8Array>): AsyncGenerator<any, void, unknown> {
    // 使用现有的SSE解析器
    const { SSEParser } = await import('./sse-parser.js');
    const parser = new SSEParser();
    
    yield* parser.parseSSEStream(body);
  }
}