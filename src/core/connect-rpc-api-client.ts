/**
 * 真正的 Connect RPC API 客户端
 * 
 * 使用构建时生成的类型安全客户端，遵循 Connect RPC 最佳实践
 */

import { createPromiseClient, type PromiseClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { AiService } from "../generated/cpp_connect";
import { FileSyncService } from "../generated/fs_connect";
import { 
  StreamCppRequest, 
  StreamCppResponse,
  CurrentFileInfo,
  CursorPosition,
  CppContextItem,
  AdditionalFile,
  CppIntentInfo
} from "../generated/cpp_pb";
import { 
  FSUploadFileRequest, 
  FSUploadFileResponse 
} from "../generated/fs_pb";

import type { CursorConfig, CompletionRequest, FileInfo } from '../types';
import { Logger } from '../utils/logger';
import { CryptoUtils } from '../utils/crypto';
import { AuthHelper } from '../utils/auth-helper';
import { getOrGenerateClientKey, validateChecksum } from '../utils/checksum';
import { FileSyncStateManager } from './filesync-state-manager';
import * as vscode from 'vscode';

export interface ConnectRpcApiClientOptions {
  baseUrl: string;
  authToken: string;
  clientKey: string;
  gcppHost?: string;
  timeout?: number;
  workspaceId?: string;
  maxTokens?: number;
}

/**
 * 基于 Connect RPC 的 Cursor API 客户端
 * 使用生成的类型安全服务客户端
 */
export class ConnectRpcApiClient {
  private logger: Logger;
  private aiClient: PromiseClient<typeof AiService>;
  private fileSyncClient: PromiseClient<typeof FileSyncService>;
  private filesyncCookie: string;
  private filesyncClientKey: string; // 添加 FileSyncService 专用的客户端密钥
  private options: ConnectRpcApiClientOptions;
  private fileSyncStateManager: FileSyncStateManager; // 🔧 添加文件同步状态管理

  constructor(options: ConnectRpcApiClientOptions) {
    this.logger = Logger.getInstance();
    this.options = options;
    this.filesyncCookie = CryptoUtils.generateFilesyncCookie();
    this.filesyncClientKey = CryptoUtils.generateClientKey(); // 生成 FileSyncService 专用的客户端密钥
    this.fileSyncStateManager = new FileSyncStateManager(); // 🔧 初始化文件同步状态管理

    // 创建 Connect RPC 传输层
    const transport = createConnectTransport({
      baseUrl: options.baseUrl,
      defaultTimeoutMs: options.timeout || 15000, // 减少超时时间到15秒
      interceptors: [
        // 响应拦截器 - 记录HTTP响应状态和内容
        (next) => async (req) => {
          try {
            const response = await next(req);
            this.logger.info(`✅ HTTP 响应成功: ${req.url}`);
            
            // 📊 调试：记录响应头部信息
            if (response.header) {
              this.logger.info('📋 响应头部:');
              response.header.forEach((value, key) => {
                this.logger.info(`  ${key}: ${value}`);
              });
            }
            
            return response;
          } catch (error) {
            this.logger.error(`❌ HTTP 响应失败: ${req.url}`, error as Error);
            
            // 🔍 增强错误日志：尝试提取更多错误信息
            if (error && typeof error === 'object') {
              this.logger.error('🔍 拦截器错误详细分析:');
              this.logger.error(`  🚨 错误类型: ${error.constructor.name}`);
              this.logger.error(`  📝 错误消息: ${(error as any).message || '无消息'}`);
              
              // ConnectError 特定信息
              if ('code' in error) {
                this.logger.error(`  🔢 Connect错误码: ${(error as any).code}`);
              }
              if ('rawMessage' in error) {
                this.logger.error(`  📜 原始消息: ${(error as any).rawMessage}`);
              }
              if ('details' in error) {
                this.logger.error(`  📋 错误详情: ${JSON.stringify((error as any).details, null, 2)}`);
              }
              
              // HTTP 响应相关信息
              if ('status' in error) {
                this.logger.error(`  🌐 HTTP状态码: ${(error as any).status}`);
              }
              if ('statusText' in error) {
                this.logger.error(`  📤 HTTP状态文本: ${(error as any).statusText}`);
              }
              
              // 完整错误对象
              try {
                const errorDetails = JSON.stringify(error, Object.getOwnPropertyNames(error), 2);
                this.logger.error(`  📄 完整错误对象: ${errorDetails}`);
              } catch (jsonError) {
                this.logger.error('  ⚠️ 无法序列化拦截器错误对象');
              }
            }
            
            throw error;
          }
        },
        // 添加认证头部
        (next) => async (req) => {
          // 优先生成新的checksum，确保格式正确
          let checksum = options.clientKey;
          
          // 如果没有checksum或格式不正确，生成新的
          if (!checksum || !validateChecksum(checksum)) {
            checksum = getOrGenerateClientKey();
            this.logger.info('🔄 使用新生成的 checksum（原有格式不正确）');
          }
          
          // 添加详细的调试日志
          this.logger.info('🔑 认证信息调试:');
          this.logger.info(`📋 Bearer Token: ${options.authToken ? `${options.authToken.substring(0, 10)}...` : '未设置'}`);
          this.logger.info(`🔐 Checksum: ${checksum.substring(0, 20)}... (${checksum.length} 字符)`);
          this.logger.info(`✅ Checksum 验证: ${validateChecksum(checksum)}`);
          this.logger.info(`🌐 请求 URL: ${req.url}`);
          this.logger.info(`📡 请求方法: POST`); // Connect RPC 总是使用 POST
          
          // 设置认证头部
          req.header.set("authorization", `Bearer ${options.authToken}`);
          req.header.set("x-cursor-client-version", "1.3.6");
          
          // 🧪 实验：测试是否真的需要checksum
          const SKIP_CHECKSUM = false; // cursor-api需要checksum头部进行认证
          if (!SKIP_CHECKSUM) {
            req.header.set("x-cursor-checksum", checksum);
            this.logger.info('🔐 发送 checksum');
          } else {
            this.logger.info('🧪 跳过 checksum（实验模式）');
          }
          
          // 打印所有头部信息
          this.logger.info('📋 请求头部:');
          req.header.forEach((value, key) => {
            if (key.toLowerCase().includes('auth') || key.toLowerCase().includes('cursor')) {
              const displayValue = key.toLowerCase().includes('authorization') 
                ? `${value.substring(0, 20)}...` 
                : value;
              this.logger.info(`  ${key}: ${displayValue}`);
            }
          });
          
          return await next(req);
        },
      ],
    });

    // 创建专门为 FileSyncService 配置的传输层
    const fileSyncTransport = createConnectTransport({
      baseUrl: options.baseUrl,
      defaultTimeoutMs: options.timeout || 15000,
      interceptors: [
        // 响应拦截器 - 记录HTTP响应状态
        (next) => async (req) => {
          try {
            const response = await next(req);
            this.logger.info(`✅ FileSyncService HTTP 响应成功: ${req.url}`);
            return response;
          } catch (error) {
            this.logger.error(`❌ FileSyncService HTTP 响应失败: ${req.url}`, error as Error);
            throw error;
          }
        },
        // FileSyncService 专用认证头部
        (next) => async (req) => {
          // 优先生成新的checksum，确保格式正确
          let checksum = options.clientKey;
          
          // 如果没有checksum或格式不正确，生成新的
          if (!checksum || !validateChecksum(checksum)) {
            checksum = getOrGenerateClientKey();
            this.logger.info('🔄 FileSyncService 使用新生成的 checksum（原有格式不正确）');
          }
          
          // 添加详细的调试日志
          this.logger.info('🔑 FileSyncService 认证信息调试:');
          this.logger.info(`📋 Bearer Token: ${options.authToken ? `${options.authToken.substring(0, 10)}...` : '未设置'}`);
          this.logger.info(`🔐 Checksum: ${checksum.substring(0, 20)}... (${checksum.length} 字符)`);
          this.logger.info(`🔑 FileSyncClientKey: ${this.filesyncClientKey.substring(0, 20)}... (${this.filesyncClientKey.length} 字符)`);
          this.logger.info(`🍪 FilesyncCookie: ${this.filesyncCookie.substring(0, 16)}... (${this.filesyncCookie.length} 字符)`);
          this.logger.info(`🌐 请求 URL: ${req.url}`);
          this.logger.info(`📡 请求方法: POST`);
          
          // 设置认证头部
          req.header.set("authorization", `Bearer ${options.authToken}`);
          req.header.set("x-cursor-client-version", "1.3.6");
          req.header.set("x-cursor-checksum", checksum);
          
          // 🔑 关键：添加 FileSyncService 所需的认证头部
          req.header.set("x-client-key", this.filesyncClientKey);
          req.header.set("x-fs-client-key", this.filesyncClientKey); // 官方API还需要这个头部
          
          // 添加 Cookie（包含 FilesyncCookie）
          req.header.set("cookie", `FilesyncCookie=${this.filesyncCookie}`);
          
          // 打印所有头部信息
          this.logger.info('📋 FileSyncService 请求头部:');
          req.header.forEach((value, key) => {
            if (key.toLowerCase().includes('auth') || 
                key.toLowerCase().includes('cursor') || 
                key.toLowerCase().includes('client') ||
                key.toLowerCase().includes('cookie') ||
                key.toLowerCase().includes('fs')) {
              const displayValue = key.toLowerCase().includes('authorization') 
                ? `${value.substring(0, 20)}...` 
                : (key.toLowerCase().includes('key') || key.toLowerCase().includes('cookie'))
                  ? `${value.substring(0, 16)}...`
                  : value;
              this.logger.info(`  ${key}: ${displayValue}`);
            }
          });
          
          return await next(req);
        },
      ],
    });

    // 创建类型安全的服务客户端
    this.aiClient = createPromiseClient(AiService, transport);
    this.fileSyncClient = createPromiseClient(FileSyncService, fileSyncTransport);

    this.logger.info('✅ Connect RPC 客户端初始化完成');
  }

  /**
   * 更新配置
   */
  updateConfig(config: CursorConfig): void {
    // TODO: 重新创建传输层和客户端
    this.logger.info('⚠️ Connect RPC 配置更新需要重新创建客户端');
  }

  /**
   * 流式代码补全
   * 使用 Connect RPC Server-Streaming
   */
  async *streamCpp(request: CompletionRequest, abortSignal?: AbortSignal): AsyncIterable<StreamCppResponse> {
    try {
      this.logger.info('🚀 开始 Connect RPC StreamCpp 调用');
      this.logger.info(`📄 文件: ${request.currentFile.path}`);
      this.logger.info(`📍 光标: line ${request.cursorPosition.line}, column ${request.cursorPosition.column}`);
      
      // 🔍 调试：检查传入的请求内容
      this.logger.info('🔍 传入请求内容调试:');
      this.logger.info(`  📄 request.currentFile.content: ${request.currentFile.content ? `${request.currentFile.content.length} 字符` : '为空或未定义'}`);
      this.logger.info(`  📐 request.currentFile.path: ${request.currentFile.path}`);
      this.logger.info(`  🔐 request.currentFile.sha256: ${request.currentFile.sha256 || '未设置'}`);
      this.logger.info(`  🎯 request.modelName: ${request.modelName || '未设置'}`);
      this.logger.info(`  📚 request.additionalFiles: ${request.additionalFiles?.length || 0} 个文件`);

      // 🔧 获取真实的工作区根路径
      let workspaceRootPath = '';
      const currentFilePath = request.currentFile.path || 'unknown.ts';
      
      // 尝试从当前活动文档获取工作区信息
      if (vscode.window.activeTextEditor) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri);
        if (workspaceFolder) {
          workspaceRootPath = workspaceFolder.uri.fsPath;
          this.logger.debug(`🔍 获取到工作区根路径: ${workspaceRootPath}`);
        }
      }
      
      // 如果没有获取到，使用第一个工作区文件夹
      if (!workspaceRootPath && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        workspaceRootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
        this.logger.debug(`🔍 使用第一个工作区文件夹: ${workspaceRootPath}`);
      }
      
      // 如果仍然没有，使用当前文件的目录
      if (!workspaceRootPath) {
        workspaceRootPath = process.cwd();
        this.logger.warn(`⚠️ 无法获取工作区路径，使用当前工作目录: ${workspaceRootPath}`);
      }

      // 🔧 智能选择文件同步模式或纯内容模式
      const workspaceId = "a-b-c-d-e-f-g"; // （固定工作区ID）
      const currentFileInfo = request.currentFile;
      
      // 🔍 检查是否可以使用文件同步模式
      const canUseFileSync = this.fileSyncStateManager.isFileSynced(currentFileInfo, workspaceId);
      const versionInfo = canUseFileSync ? this.fileSyncStateManager.buildFileVersionInfo(currentFileInfo.path) : null;
      
      this.logger.info(`🔄 文件同步模式: ${canUseFileSync ? '启用' : '禁用'}`);
      if (versionInfo) {
        this.logger.info(`📝 文件版本: ${versionInfo.fileVersion}, 哈希: ${versionInfo.sha256Hash.substring(0, 16)}...`);
      }

      const streamRequest = new StreamCppRequest({
        workspaceId: workspaceId,
        
        // 根据文件同步状态构建文件信息      
        currentFile: new CurrentFileInfo({
          relativeWorkspacePath: currentFilePath,
          contents: canUseFileSync ? '' : (request.currentFile.content || ''), // 🔧 智能选择
          cursorPosition: new CursorPosition({
            line: request.cursorPosition.line,
            column: request.cursorPosition.column
          }),
          fileVersion: versionInfo?.fileVersion || 1,
          sha256Hash: versionInfo?.sha256Hash || (request.currentFile.sha256 || ''),
          relyOnFilesync: canUseFileSync, // 🔧 动态设置
          languageId: this.getLanguageId(currentFilePath),
          totalNumberOfLines: (request.currentFile.content || '').split('\n').length,
          workspaceRootPath: workspaceRootPath,
          lineEnding: this.detectLineEnding(request.currentFile.content || '')
        }),
        
        // CppIntentInfo - 必需字段
        cppIntentInfo: new CppIntentInfo({
          source: "typing"
        }),
        
        // 基础参数
        modelName: request.modelName || 'auto',
        isDebug: false,
        giveDebugOutput: false,
        enableMoreContext: true
      });

      this.logger.info('📡 发送完整的 Connect RPC StreamCpp 请求');
      this.logger.info(`🆔 工作区ID: ${streamRequest.workspaceId}`);
      this.logger.info(`📄 文件路径: ${streamRequest.currentFile?.relativeWorkspacePath}`);
      this.logger.info(`🔤 语言ID: ${streamRequest.currentFile?.languageId}`);
      this.logger.info(`📊 内容长度: ${streamRequest.currentFile?.contents?.length || 0} 字符`);
      this.logger.info(`📚 上下文文件数: ${streamRequest.contextItems.length}, 附加文件数: ${streamRequest.additionalFiles.length}`);
      this.logger.info(`🎯 模型: ${streamRequest.modelName}`);
      
      // 🔍 增强日志：详细的请求体内容调试
      this.logger.info('🔍 详细请求体信息:');
      this.logger.info(`  📐 光标位置: line ${streamRequest.currentFile?.cursorPosition?.line}, column ${streamRequest.currentFile?.cursorPosition?.column}`);
      this.logger.info(`  📏 总行数: ${streamRequest.currentFile?.totalNumberOfLines}`);
      this.logger.info(`  🔐 SHA256: ${streamRequest.currentFile?.sha256Hash?.substring(0, 16)}...`);
      this.logger.info(`  🔄 依赖文件同步: ${streamRequest.currentFile?.relyOnFilesync}`);
      this.logger.info(`  📁 工作区根路径: ${streamRequest.currentFile?.workspaceRootPath}`);
      this.logger.info(`  📝 行结束符: ${JSON.stringify(streamRequest.currentFile?.lineEnding)}`);
      this.logger.info(`  🚀 立即确认: ${streamRequest.immediatelyAck}`);
      this.logger.info(`  🧠 增强上下文: ${streamRequest.enableMoreContext}`);
      this.logger.info(`  🐛 调试模式: ${streamRequest.isDebug}`);
      this.logger.info(`  🌙 夜间版本: ${streamRequest.isNightly}`);
      this.logger.info(`  ⏰ 客户端时间: ${new Date((streamRequest.clientTime || 0) * 1000).toISOString()}`);
      
      // 🔍 记录上下文文件详情
      if (streamRequest.contextItems.length > 0) {
        this.logger.info('📚 上下文文件详情:');
        streamRequest.contextItems.forEach((item, index) => {
          this.logger.info(`  ${index + 1}. ${item.relativeWorkspacePath} (评分: ${item.score}, 长度: ${item.contents?.length || 0})`);
        });
      }
      
      // 🔍 记录诊断信息
      if (streamRequest.currentFile?.diagnostics && streamRequest.currentFile.diagnostics.length > 0) {
        this.logger.info(`🩺 诊断信息数量: ${streamRequest.currentFile.diagnostics.length}`);
      }
      
      // 🔍 记录请求体序列化大小（估算）
      try {
        const serializedSize = streamRequest.toBinary().length;
        this.logger.info(`📦 序列化后请求体大小: ${serializedSize} 字节`);
      } catch (serializeError) {
        this.logger.warn('⚠️ 无法计算请求体序列化大小', serializeError as Error);
      }

      // 创建组合的 AbortSignal，包含超时和外部取消
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => {
        this.logger.debug('⏰ 流式请求超时，自动取消');
        timeoutController.abort();
      }, 10000); // 10秒超时

      const combinedSignal = abortSignal ? 
        this.combineAbortSignals([abortSignal, timeoutController.signal]) :
        timeoutController.signal;

      // 使用 Connect RPC 流式调用
      const stream = this.aiClient.streamCpp(streamRequest, { 
        signal: combinedSignal 
      });

      let responseCount = 0;

      try {
        for await (const response of stream) {
          responseCount++;
          
          this.logger.debug('📨 收到 StreamCpp 响应:', {
            count: responseCount,
            text: response.text?.substring(0, 50) + '...',
            doneStream: response.doneStream
          });
          
          yield response;
          
          if (response.doneStream) {
            this.logger.info(`✅ StreamCpp 流式调用完成 (收到${responseCount}个响应)`);
            clearTimeout(timeoutId);
            break;
          }
        }
      } finally {
        clearTimeout(timeoutId);
      }

    } catch (error) {
      this.logger.error('❌ Connect RPC StreamCpp 调用失败', error as Error);
      
      // 🔍 增强错误日志：详细分析错误类型和内容
      if (error && typeof error === 'object') {
        this.logger.error('🔍 详细错误分析:');
        this.logger.error(`  🚨 错误类型: ${error.constructor.name}`);
        this.logger.error(`  📝 错误消息: ${(error as any).message || '无消息'}`);
        
        // ConnectError 特定信息
        if ('code' in error) {
          this.logger.error(`  🔢 错误码: ${(error as any).code}`);
        }
        if ('rawMessage' in error) {
          this.logger.error(`  📜 原始消息: ${(error as any).rawMessage}`);
        }
        if ('details' in error) {
          this.logger.error(`  📋 错误详情: ${JSON.stringify((error as any).details, null, 2)}`);
        }
        if ('metadata' in error) {
          this.logger.error(`  🏷️ 元数据: ${JSON.stringify((error as any).metadata, null, 2)}`);
        }
        
        // HTTP 相关错误信息
        if ('status' in error) {
          this.logger.error(`  🌐 HTTP状态: ${(error as any).status}`);
        }
        if ('statusText' in error) {
          this.logger.error(`  📤 状态文本: ${(error as any).statusText}`);
        }
        if ('url' in error) {
          this.logger.error(`  🔗 请求URL: ${(error as any).url}`);
        }
        
        // 完整错误对象（用于深度调试）
        try {
          const errorJson = JSON.stringify(error, Object.getOwnPropertyNames(error), 2);
          this.logger.error(`  📄 完整错误对象: ${errorJson}`);
        } catch (jsonError) {
          this.logger.error('  ⚠️ 无法序列化错误对象');
        }
        
        // 堆栈跟踪
        if ('stack' in error && (error as any).stack) {
          this.logger.error(`  📚 堆栈跟踪: ${(error as any).stack}`);
        }
      }
      
      throw error;
    }
  }

  /**
   * 上传文件
   * 使用 Connect RPC Unary 调用
   */
  async uploadFile(fileInfo: FileInfo, workspaceId: string): Promise<FSUploadFileResponse> {
    try {
      this.logger.info(`📤 Connect RPC 上传文件: ${fileInfo.path}`);
      this.logger.info(`🆔 使用工作区ID: ${workspaceId}`);
      
      const uuid = CryptoUtils.generateUUID();
      const uploadRequest = new FSUploadFileRequest({
        uuid: uuid,
        relativeWorkspacePath: fileInfo.path,
        contents: fileInfo.content || '',
        modelVersion: fileInfo.modelVersion || 0,
        sha256Hash: fileInfo.sha256 || ''
        // 注意：workspaceId 不在 FSUploadFileRequest 中，需要通过其他方式传递
      });

      this.logger.info(`📊 文件大小: ${uploadRequest.contents.length} 字符`);
      this.logger.info(`🔐 SHA256: ${uploadRequest.sha256Hash?.substring(0, 16) || 'undefined'}...`);
      this.logger.info(`📦 UUID: ${uploadRequest.uuid}`);

      const response = await this.fileSyncClient.fSUploadFile(uploadRequest);
      
      this.logger.info('✅ Connect RPC 文件上传成功');
      this.logger.info(`📝 返回信息: 错误码=${response.error} (0=成功)`);
      
      // 🔧 记录文件同步状态
      this.fileSyncStateManager.recordUploadSuccess(fileInfo, workspaceId, uuid, response);
      
      return response;
      
    } catch (error) {
      this.logger.error(`❌ Connect RPC 文件上传失败: ${fileInfo.path}`, error as Error);
      throw error;
    }
  }

  /**
   * 测试连接
   */
  async testConnection(): Promise<{ success: boolean; message: string; details?: any }> {
    try {
      this.logger.info('🔍 测试 Connect RPC 连接');
      
      // 创建一个简单的测试请求
      const testRequest = new StreamCppRequest({
        currentFile: new CurrentFileInfo({
          relativeWorkspacePath: 'test.ts',
          contents: '// test',
          cursorPosition: new CursorPosition({ line: 1, column: 8 }),
          languageId: 'typescript'
        }),
        modelName: 'auto'
      });

      // 使用流式调用测试连接，但只取第一个响应
      const stream = this.aiClient.streamCpp(testRequest, { 
        signal: AbortSignal.timeout(5000) 
      });

      const firstResponse = await stream[Symbol.asyncIterator]().next();
      
      return {
        success: true,
        message: '✅ Connect RPC 连接测试成功',
        details: firstResponse.value
      };
      
    } catch (error) {
      this.logger.error('❌ Connect RPC 连接测试失败', error as Error);
      return {
        success: false,
        message: `❌ 连接测试失败: ${(error as Error).message}`
      };
    }
  }

  /**
   * 获取文件同步 Cookie
   */
  getFilesyncCookie(): string {
    return this.filesyncCookie;
  }

  /**
   * 重新生成文件同步 Cookie
   */
  regenerateFilesyncCookie(): void {
    this.filesyncCookie = CryptoUtils.generateFilesyncCookie(); 
    this.logger.info('🔄 FilesyncCookie 已重新生成');
  }

  /**
   * 获取 FileSyncService 客户端密钥
   */
  getFilesyncClientKey(): string {
    return this.filesyncClientKey;
  }

  /**
   * 重新生成 FileSyncService 客户端密钥
   */
  regenerateFilesyncClientKey(): void {
    this.filesyncClientKey = CryptoUtils.generateClientKey();
    this.logger.info('🔄 FileSyncService 客户端密钥已重新生成');
  }

  private getLanguageId(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    
    const languageMap: Record<string, string> = {
      'js': 'javascript',
      'ts': 'typescript', 
      'jsx': 'javascriptreact',
      'tsx': 'typescriptreact',
      'py': 'python',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'cs': 'csharp',
      'go': 'go',
      'rs': 'rust',
      'php': 'php',
      'rb': 'ruby',
      'swift': 'swift',
      'kt': 'kotlin',
      'scala': 'scala',
      'sh': 'shellscript',
      'bash': 'shellscript',
      'html': 'html',
      'css': 'css',
      'scss': 'scss',
      'less': 'less',
      'json': 'json',
      'xml': 'xml',
      'yaml': 'yaml',
      'yml': 'yaml',
      'md': 'markdown',
      'sql': 'sql'
    };
    
    return languageMap[ext] || 'plaintext';
  }

  private detectLineEnding(content: string): string {
    if (content.includes('\r\n')) {
      return '\r\n'; // Windows
    } else if (content.includes('\n')) {
      return '\n';   // Unix/Linux/macOS
    } else if (content.includes('\r')) {
      return '\r';   // Old Mac
    }
    return '\n';     // Default to Unix
  }

  /**
   * 组合多个 AbortSignal，任何一个取消都会取消组合信号
   */
  /**
   * 构建上下文项 - 将 FileInfo 转换为 CppContextItem
   */
  private buildContextItems(additionalFiles: FileInfo[]): CppContextItem[] {
    return additionalFiles.map(file => new CppContextItem({
      relativeWorkspacePath: file.path,
      contents: file.content,
      score: 1.0 // 默认评分
    }));
  }

  /**
   * 构建附加文件 - 将 FileInfo 转换为 AdditionalFile
   */
  private buildAdditionalFiles(additionalFiles: FileInfo[]): AdditionalFile[] {
    return additionalFiles.map(file => new AdditionalFile({
      relativeWorkspacePath: file.path,
      isOpen: false, // 文件当前不在编辑器中打开
      visibleRangeContent: [file.content], // 整个文件内容作为可见范围
      lastViewedAt: Date.now() / 1000 // 当前时间作为最后查看时间
    }));
  }

  /**
   * 获取上下文类型
   */
  private getContextType(filePath: string): string {
    const fileName = filePath.split('/').pop() || '';
    
    // 配置文件
    if (fileName.startsWith('.') || fileName.includes('config') || fileName.includes('package.json')) {
      return 'config';
    }
    
    // 类型定义文件
    if (fileName.endsWith('.d.ts') || fileName.includes('types')) {
      return 'types';
    }
    
    // 测试文件
    if (fileName.includes('test') || fileName.includes('spec')) {
      return 'test';
    }
    
    // 常规代码文件
    return 'code';
  }

  /**
   * 判断是否为配置文件
   */
  private isConfigFile(filePath: string): boolean {
    const configFiles = [
      'package.json', 'tsconfig.json', 'jsconfig.json',
      '.eslintrc.js', '.eslintrc.json', 'prettier.config.js',
      'vite.config.ts', 'webpack.config.js', 'next.config.js',
      '.env', '.env.local', '.env.production'
    ];
    
    const fileName = filePath.split('/').pop() || '';
    return configFiles.includes(fileName) || fileName.startsWith('.');
  }

  private combineAbortSignals(signals: AbortSignal[]): AbortSignal {
    const controller = new AbortController();
    
    for (const signal of signals) {
      if (signal.aborted) {
        controller.abort();
        break;
      }
      
      signal.addEventListener('abort', () => {
        controller.abort();
      }, { once: true });
    }
    
    return controller.signal;
  }

  /**
   * 生成基于工作区路径的工作区ID
   * 参考 cursortab.nvim 的实现，使用类似 "a-b-c-d-e-f-g" 的格式
   */
  private generateWorkspaceId(workspaceRootPath: string): string {
    // 基于工作区路径生成一个简单的哈希
    const hash = CryptoUtils.hashString(workspaceRootPath);
    
    // 将哈希转换为类似 cursortab 的格式："a-b-c-d-e-f-g"
    const parts = [];
    for (let i = 0; i < hash.length && parts.length < 7; i += 2) {
      const char = String.fromCharCode(97 + (parseInt(hash.substr(i, 2), 16) % 26)); // a-z
      parts.push(char);
    }
    
    // 确保至少有7个部分
    while (parts.length < 7) {
      parts.push('x');
    }
    
    const workspaceId = parts.join('-');
    this.logger.debug(`🆔 生成工作区ID: ${workspaceId} (来自路径: ${workspaceRootPath})`);
    return workspaceId;
  }
}