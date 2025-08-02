/**
 * 真正的 Connect RPC API 客户端
 * 
 * 使用构建时生成的类型安全客户端，遵循 Connect RPC 最佳实践
 */

import { createPromiseClient, type PromiseClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { AiService, CppService } from "../generated/cpp_connect";
import { FileSyncService } from "../generated/fs_connect";
import { 
  StreamCppRequest, 
  StreamCppResponse,
  CurrentFileInfo,
  CursorPosition,
  CppContextItem,
  AdditionalFile,
  CppIntentInfo,
  CppFileDiffHistory,
  CppConfigRequest,
  CppConfigResponse,
  AvailableCppModelsRequest,
  AvailableCppModelsResponse,
  RecordCppFateRequest,
  RecordCppFateResponse,
  CppFate
} from "../generated/cpp_pb";
import { 
  FSUploadFileRequest, 
  FSUploadFileResponse,
  FSSyncFileRequest,
  FSSyncFileResponse,
  FSUploadErrorType,
  FSSyncErrorType
} from "../generated/fs_pb";

import type { CursorConfig, CompletionRequest, FileInfo } from '../types';
import { Logger } from '../utils/logger';
import { CryptoUtils } from '../utils/crypto';
import { FileDiffCalculator } from '../utils/file-diff';
import { AuthHelper } from '../utils/auth-helper';
import { getOrGenerateClientKey, validateChecksum } from '../utils/checksum';
import { FileSyncStateManager } from './filesync-state-manager';
import { WorkspaceManager } from '../utils/workspace-manager';
import { EditHistoryTracker } from './edit-history-tracker';
import * as vscode from 'vscode';
import * as path from 'path';

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
  private cppClient: PromiseClient<typeof CppService>;
  private fileSyncClient: PromiseClient<typeof FileSyncService>;
  private filesyncCookie: string;
  private filesyncClientKey: string; // 添加 FileSyncService 专用的客户端密钥
  private fileDiffCalculator: FileDiffCalculator; // 文件差异计算器
  private options: ConnectRpcApiClientOptions;
  private fileSyncStateManager: FileSyncStateManager; // 🔧 添加文件同步状态管理
  private workspaceManager: WorkspaceManager; // 🔧 添加工作区管理器
  private editHistoryTracker: EditHistoryTracker; // 🔧 添加编辑历史跟踪器
  private cachedCppConfig: CppConfigResponse | null = null; // 🔧 缓存的CppConfig配置
  private configLastFetched: number = 0; // 🔧 最后获取配置的时间
  private readonly CONFIG_CACHE_TTL = 5 * 60 * 1000; // 🔧 配置缓存5分钟
  
  // 🚀 AvailableModels API 缓存
  private cachedAvailableModels: AvailableCppModelsResponse | null = null;
  private modelsLastFetched: number = 0;
  private readonly MODELS_CACHE_TTL = 10 * 60 * 1000; // 模型缓存10分钟
  private pendingUploads = new Set<string>(); // 🔧 跟踪正在进行的文件上传

  constructor(options: ConnectRpcApiClientOptions) {
    this.logger = Logger.getInstance();
    this.options = options;
    this.filesyncCookie = CryptoUtils.generateFilesyncCookie();
    this.filesyncClientKey = CryptoUtils.generateClientKey(); // 生成 FileSyncService 专用的客户端密钥
    this.fileSyncStateManager = new FileSyncStateManager(); // 🔧 初始化文件同步状态管理
    this.workspaceManager = WorkspaceManager.getInstance(); // 🔧 初始化工作区管理器
    this.editHistoryTracker = new EditHistoryTracker(); // 🔧 初始化编辑历史跟踪器
    this.fileDiffCalculator = new FileDiffCalculator(); // 🔧 初始化文件差异计算器

    // 创建 Connect RPC 传输层
    const transport = createConnectTransport({
      baseUrl: options.baseUrl,
      defaultTimeoutMs: options.timeout || 10000, // 减少超时时间到10秒
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
          req.header.set("x-cursor-client-version", "1.6.1-connectrpc");
          
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
          req.header.set("x-cursor-client-version", "1.6.1-connectrpc");
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
    this.cppClient = createPromiseClient(CppService, transport);
    this.fileSyncClient = createPromiseClient(FileSyncService, fileSyncTransport);

    // 初始化已打开的文档
    this.editHistoryTracker.initializeOpenDocuments();

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

      // 🔧 使用统一的工作区管理器获取工作区路径和ID
      const workspaceRootPath = this.workspaceManager.getCurrentWorkspacePath();
      const workspaceId = this.workspaceManager.getWorkspaceId();
      const currentFilePath = request.currentFile.path || 'unknown.ts';
      
      this.logger.info(`🆔 使用工作区ID: ${workspaceId}`);
      this.logger.info(`📁 工作区路径: ${workspaceRootPath}`);
      const currentFileInfo = request.currentFile;
      
      // 🔍 检查是否可以使用文件同步模式
      // 🔄 恢复文件同步检查，但添加详细调试
      // 🔧 修复：当有additionalFiles时禁用内容模式，因为服务器期望文件已同步
      let canUseFileSync = this.fileSyncStateManager.isFileSynced(currentFileInfo, workspaceId);
      
      // 🚨 关键修复：动态处理additionalFiles
      if (request.additionalFiles && request.additionalFiles.length > 0) {
        this.logger.info(`🔍 发现 ${request.additionalFiles.length} 个附加文件，检查兼容性...`);
        this.logger.debug(`📋 附加文件: ${request.additionalFiles.map(f => f.path).join(', ')}`);
        
        // 如果将使用内容模式，移除additionalFiles以避免"File not found"错误
        if (!canUseFileSync) {
          this.logger.warn(`⚠️ 内容模式不兼容附加文件，移除 ${request.additionalFiles.length} 个附加文件`);
          request.additionalFiles = [];
        } else {
          this.logger.info(`✅ 文件同步模式，保留 ${request.additionalFiles.length} 个附加文件`);
        }
      }
      this.logger.info(`🔍 文件同步检查结果: ${canUseFileSync ? '可使用文件同步' : '需要上传文件'}`);
      if (!canUseFileSync) {
        this.logger.info(`📋 文件同步状态详情:`);
        const syncState = this.fileSyncStateManager.getFileSyncState(currentFileInfo.path);
        if (syncState) {
          this.logger.info(`  ✅ 已有同步状态: 版本=${syncState.modelVersion}, 哈希=${syncState.sha256Hash.substring(0, 16)}...`);
          this.logger.info(`  🆔 工作区匹配: ${syncState.workspaceId === workspaceId}`);
          this.logger.info(`  🔐 哈希匹配: ${syncState.sha256Hash === currentFileInfo.sha256}`);
        } else {
          this.logger.info(`  ❌ 无同步状态记录`);
        }
      }
      let versionInfo = canUseFileSync ? this.fileSyncStateManager.buildFileVersionInfo(currentFileInfo.path) : null;
      
      // 🐛 调试文件同步状态
      this.logger.debug(`🔍 文件同步状态调试:`);
      this.logger.debug(`  📄 文件路径: ${currentFileInfo.path}`);
      this.logger.debug(`  🆔 工作区ID: ${workspaceId}`);
      this.logger.debug(`  🔐 文件哈希: ${currentFileInfo.sha256?.substring(0, 16)}...`);
      this.logger.debug(`  ✅ canUseFileSync: ${canUseFileSync}`);
      if (versionInfo) {
        this.logger.debug(`  📝 版本信息: ${JSON.stringify(versionInfo)}`);
      }
      
      this.logger.info(`🔄 文件同步模式: ${canUseFileSync ? '启用' : '禁用'}`);
      if (versionInfo) {
        this.logger.info(`📝 文件版本: ${versionInfo.fileVersion}, 哈希: ${versionInfo.sha256Hash.substring(0, 16)}...`);
      }
      
      // 🔍 详细记录文件内容和同步设置
      const fileContentLength = request.currentFile.content?.length || 0;
      const willIncludeContent = !canUseFileSync;
      this.logger.info(`📄 文件内容处理:`);
      this.logger.info(`   📊 原始内容长度: ${fileContentLength} 字符`);
      this.logger.info(`   📝 将包含内容: ${willIncludeContent}`);
      this.logger.info(`   🔗 依赖文件同步: ${canUseFileSync}`);

      // 🔧 强制使用内容模式进行测试
      if (!canUseFileSync) {
        this.logger.info('🧪 强制使用内容模式进行测试，跳过文件上传');
        /*
        try {
          // 🔧 避免重复上传：检查是否已经有相同文件正在上传
          const fileKey = `${workspaceId}:${currentFileInfo.path}:${currentFileInfo.sha256}`;
          if (!this.pendingUploads.has(fileKey)) {
            this.pendingUploads.add(fileKey);
            try {
              await this.uploadFile(currentFileInfo, workspaceId);
              this.logger.info('✅ 文件上传完成，继续StreamCpp调用');
            } finally {
              this.pendingUploads.delete(fileKey);
            }
          } else {
            this.logger.info('⏭️ 文件上传已在进行中，跳过重复上传');
            // 等待一小段时间让上传完成
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          
          // 🔧 修复：更新文件同步状态，避免重复请求
          canUseFileSync = this.fileSyncStateManager.isFileSynced(currentFileInfo, workspaceId);
          versionInfo = canUseFileSync ? this.fileSyncStateManager.buildFileVersionInfo(currentFileInfo.path) : null;
          
          if (canUseFileSync && versionInfo) {
            this.logger.info(`🔄 文件同步状态已更新: 版本=${versionInfo.fileVersion}`);
            this.logger.info(`✅ 切换到文件同步模式 - 将使用空内容 + rely_on_filesync=true`);
          } else {
            this.logger.warn('⚠️ 文件上传完成但同步状态未更新，将使用纯内容模式');
          }
        } catch (uploadError) {
          this.logger.warn('⚠️ 文件上传失败，使用纯内容模式', uploadError as Error);
          // 继续执行，使用纯内容模式
        }
        */
      }

      // 🔍 最终文件同步状态调试
      this.logger.info(`📋 最终文件处理模式: ${canUseFileSync ? '文件同步模式' : '内容模式'}`);
      if (canUseFileSync && versionInfo) {
        this.logger.info(`  📦 将使用文件同步: relyOnFilesync=true, 文件版本=${versionInfo.fileVersion}`);
        this.logger.info(`  📄 内容字段: 将省略 (空内容)`);
      } else {
        this.logger.info(`  📄 将使用完整内容: relyOnFilesync=false, 内容长度=${(request.currentFile.content || '').length}`);
      }

      // 🔧 获取编辑历史和意图
      const fileName = path.basename(currentFilePath);
      const fullFilePath = path.resolve(workspaceRootPath, currentFilePath);
      const diffHistory = this.editHistoryTracker.buildDiffHistory(fullFilePath);
      const editIntent = this.editHistoryTracker.getEditIntent(fullFilePath);

      this.logger.info(`📝 编辑历史长度: ${diffHistory.length} 字符`);
      this.logger.info(`🎯 编辑意图: ${editIntent}`);
      if (diffHistory.length > 0) {
        this.logger.debug(`📋 差异历史预览: ${diffHistory.substring(0, 100)}...`);
      }

      const streamRequest = new StreamCppRequest({
        workspaceId: workspaceId,
        
        // 根据文件同步状态构建文件信息      
        currentFile: new CurrentFileInfo({
          relativeWorkspacePath: currentFilePath,
          // 🔧 关键修复：文件同步模式下完全省略contents字段，而不是设置为空字符串
          ...(canUseFileSync ? {} : { contents: request.currentFile.content || '' }),
          cursorPosition: new CursorPosition({
            line: request.cursorPosition.line,
            column: request.cursorPosition.column
          }),
          // 🔧 修复版本号同步：如果使用文件同步，使用存储的版本；否则使用当前编辑版本
          fileVersion: canUseFileSync && versionInfo ? versionInfo.fileVersion : this.editHistoryTracker.getFileVersion(currentFilePath),
          sha256Hash: versionInfo?.sha256Hash || (request.currentFile.sha256 || ''),
          relyOnFilesync: canUseFileSync, // 🔧 根据文件同步状态自动设置
          languageId: this.getLanguageId(currentFilePath),
          totalNumberOfLines: (request.currentFile.content || '').split('\n').length,
          workspaceRootPath: workspaceRootPath,
          lineEnding: this.detectLineEnding(request.currentFile.content || '')
        }),
        
        // 🔧 关键修复：添加 file_diff_histories 字段
        fileDiffHistories: diffHistory ? [new CppFileDiffHistory({
          fileName: fileName,
          diffHistory: [diffHistory] // 转换为字符串数组
        })] : [],
        
        // CppIntentInfo - 使用动态检测的编辑意图
        cppIntentInfo: new CppIntentInfo({
          source: editIntent
        }),
        
        // 🚀 关键增强：添加多文件上下文支持
        contextItems: request.additionalFiles ? this.buildContextItems(request.additionalFiles) : [],
        additionalFiles: request.additionalFiles ? this.buildAdditionalFiles(request.additionalFiles) : [],
        
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
      this.logger.info(`📊 内容长度: ${streamRequest.currentFile?.contents?.length || 0} 字符${canUseFileSync ? ' (文件同步模式:省略contents字段)' : ''}`);
      this.logger.info(`📚 上下文文件数: ${streamRequest.contextItems.length}, 附加文件数: ${streamRequest.additionalFiles.length}`);
      this.logger.info(`🎯 模型: ${streamRequest.modelName}`);
      this.logger.info(`📝 差异历史条目数: ${streamRequest.fileDiffHistories.length}`);
      
      // 🔍 增强日志：详细的请求体内容调试
      this.logger.info('🔍 详细请求体信息:');
      this.logger.info(`  📐 光标位置: line ${streamRequest.currentFile?.cursorPosition?.line}, column ${streamRequest.currentFile?.cursorPosition?.column}`);
      this.logger.info(`  📏 总行数: ${streamRequest.currentFile?.totalNumberOfLines}`);
      this.logger.info(`  🔐 SHA256: ${streamRequest.currentFile?.sha256Hash?.substring(0, 16)}...`);
      this.logger.info(`  🔄 依赖文件同步: ${streamRequest.currentFile?.relyOnFilesync}`);
      this.logger.info(`  📁 工作区根路径: ${streamRequest.currentFile?.workspaceRootPath}`);
      this.logger.info(`  📝 行结束符: ${JSON.stringify(streamRequest.currentFile?.lineEnding)}`);
      this.logger.info(`  📊 文件版本: ${streamRequest.currentFile?.fileVersion} (${canUseFileSync ? '文件同步版本' : '编辑器版本'})`);
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
        
        // 🔍 详细请求体调试 - 输出关键字段的实际值
        this.logger.debug(`🔍 完整请求体调试:`);
        this.logger.debug(`  workspaceId: "${streamRequest.workspaceId}"`);
        this.logger.debug(`  currentFile.path: "${streamRequest.currentFile?.relativeWorkspacePath}"`);
        this.logger.debug(`  currentFile.relyOnFilesync: ${streamRequest.currentFile?.relyOnFilesync}`);
        this.logger.debug(`  currentFile.fileVersion: ${streamRequest.currentFile?.fileVersion}`);
        this.logger.debug(`  currentFile.sha256Hash: "${streamRequest.currentFile?.sha256Hash?.substring(0, 16)}..."`);
        this.logger.debug(`  currentFile.workspaceRootPath: "${streamRequest.currentFile?.workspaceRootPath}"`);
        this.logger.debug(`  currentFile.content.length: ${streamRequest.currentFile?.contents?.length || 0}`);
        this.logger.debug(`  additionalFiles.length: ${streamRequest.additionalFiles?.length || 0}`);
        this.logger.debug(`  modelName: "${streamRequest.modelName}"`);
      } catch (serializeError) {
        this.logger.warn('⚠️ 无法计算请求体序列化大小', serializeError as Error);
      }

      // 创建组合的 AbortSignal，包含超时和外部取消
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => {
        this.logger.debug('⏰ 流式请求超时，自动取消');
        timeoutController.abort();
      }, 30000); // 30秒超时 - 给代码补全更多时间

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
          
          this.logger.info(`📨 收到 StreamCpp 响应 #${responseCount}:`);
          
          // 🔍 详细调试：显示响应的所有字段
          this.logger.debug(`🔍 响应详情:`);
          this.logger.debug(`   text: ${response.text ? `"${response.text}"` : 'undefined/empty'}`);
          this.logger.debug(`   doneStream: ${response.doneStream}`);
          this.logger.debug(`   doneEdit: ${response.doneEdit}`);
          this.logger.debug(`   beginEdit: ${response.beginEdit}`);
          this.logger.debug(`   bindingId: ${response.bindingId || 'undefined'}`);
          this.logger.debug(`   rangeToReplace: ${response.rangeToReplace ? JSON.stringify(response.rangeToReplace) : 'undefined'}`);
          this.logger.debug(`   cursorPredictionTarget: ${response.cursorPredictionTarget ? JSON.stringify(response.cursorPredictionTarget) : 'undefined'}`);
          this.logger.debug(`   modelInfo: ${response.modelInfo ? JSON.stringify(response.modelInfo) : 'undefined'}`);
          
          if (response.text) {
            this.logger.info(`📝 补全文本:`);
            this.logger.info(response.text);
          } else {
            this.logger.warn(`⚠️ 响应中没有text字段或text为空`);
          }
          if (response.doneStream) {
            this.logger.info('✅ 流结束标记');
          }
          if (response.bindingId) {
            this.logger.info(`🔗 绑定ID: ${response.bindingId}`);
          }
          
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
      
      // 🔍 版本号调试
      const currentEditorVersion = this.editHistoryTracker.getFileVersion(fileInfo.path);
      const uploadVersion = currentEditorVersion; // 🔧 修复：使用编辑器版本作为上传版本
      this.logger.info(`📊 版本信息: 编辑器=${currentEditorVersion}, 上传=${uploadVersion}`);
      
      const uuid = CryptoUtils.generateUUID();
      const uploadRequest = new FSUploadFileRequest({
        uuid: uuid,
        relativeWorkspacePath: fileInfo.path,
        contents: fileInfo.content || '',
        modelVersion: uploadVersion, // 使用当前版本-1作为基准
        sha256Hash: fileInfo.sha256 || ''
        // 注意：workspaceId 不在 FSUploadFileRequest 中，需要通过其他方式传递
      });

      this.logger.info(`📊 文件大小: ${uploadRequest.contents.length} 字符`);
      this.logger.info(`🔐 SHA256: ${uploadRequest.sha256Hash?.substring(0, 16) || 'undefined'}...`);
      this.logger.info(`📦 UUID: ${uploadRequest.uuid}`);

      const response = await this.fileSyncClient.fSUploadFile(uploadRequest);
      
      this.logger.info('✅ Connect RPC 文件上传成功');
      this.logger.info(`📝 返回信息: 错误码=${response.error} (0=成功)`);
      
      // 🔧 记录文件同步状态 (传递实际的模型版本)
      const uploadedFileInfo = { ...fileInfo, modelVersion: uploadVersion };
      this.fileSyncStateManager.recordUploadSuccess(uploadedFileInfo, workspaceId, uuid, response);
      
      return response;
      
    } catch (error) {
      this.logger.error(`❌ Connect RPC 文件上传失败: ${fileInfo.path}`, error as Error);
      throw error;
    }
  }

  /**
   * 增量同步文件
   * 使用 Connect RPC Unary 调用，发送文件差异而非完整内容
   */
  async syncFile(fileInfo: FileInfo, workspaceId: string, oldContent: string): Promise<FSSyncFileResponse> {
    try {
      this.logger.info(`🔄 Connect RPC 增量同步文件: ${fileInfo.path}`);
      this.logger.info(`🆔 使用工作区ID: ${workspaceId}`);
      
      // 获取当前文件同步状态
      const syncState = this.fileSyncStateManager.getFileSyncState(fileInfo.path);
      if (!syncState) {
        throw new Error('文件未曾上传，无法进行增量同步。请先调用 uploadFile');
      }
      
      const currentModelVersion = syncState.modelVersion;
      const newModelVersion = currentModelVersion + 1;
      
      this.logger.info(`📊 版本信息: 当前版本=${currentModelVersion}, 新版本=${newModelVersion}`);
      this.logger.info(`📏 内容长度: 旧=${oldContent.length}, 新=${fileInfo.content.length}`);
      
      // 计算文件差异
      const filesyncUpdate = this.fileDiffCalculator.buildFilesyncUpdate(
        fileInfo.path,
        oldContent,
        fileInfo.content,
        newModelVersion
      );
      
      // 验证差异计算的正确性
      const isValid = this.fileDiffCalculator.validateUpdates(
        oldContent,
        fileInfo.content,
        filesyncUpdate.updates
      );
      
      if (!isValid) {
        throw new Error('差异计算验证失败，回退到完整上传');
      }
      
      this.logger.info(`🔧 差异统计: ${filesyncUpdate.updates.length} 个更新，预期长度=${filesyncUpdate.expectedFileLength}`);
      
      // 生成UUID
      const uuid = CryptoUtils.generateUUID();
      
      // 构建同步请求
      const syncRequest = new FSSyncFileRequest({
        uuid,
        relativeWorkspacePath: fileInfo.path,
        modelVersion: newModelVersion, // 🔧 修复：使用新版本而非当前版本
        filesyncUpdates: [filesyncUpdate],
        sha256Hash: fileInfo.sha256 || ''
      });
      
      this.logger.info('📡 发送 Connect RPC FSSyncFile 请求');
      this.logger.debug(`🔍 请求详情: UUID=${uuid}, 版本=${currentModelVersion}->${newModelVersion}`);
      
      const response = await this.fileSyncClient.fSSyncFile(syncRequest);
      
      this.logger.info('✅ Connect RPC 文件增量同步成功');
      this.logger.info(`📝 返回信息: 错误码=${response.error} (0=成功)`);
      
      // 🔧 更新文件同步状态
      const updatedFileInfo = { ...fileInfo, modelVersion: newModelVersion };
      // 注意：FSSyncFileResponse 不包含UUID，我们使用请求中的UUID
      // 将 FSSyncErrorType 转换为 FSUploadErrorType
      const uploadErrorType = response.error === FSSyncErrorType.FS_SYNC_ERROR_TYPE_UNSPECIFIED 
        ? FSUploadErrorType.FS_UPLOAD_ERROR_TYPE_UNSPECIFIED 
        : FSUploadErrorType.FS_UPLOAD_ERROR_TYPE_HASH_MISMATCH;
      const mockUploadResponse = new FSUploadFileResponse({ error: uploadErrorType });
      this.fileSyncStateManager.recordUploadSuccess(updatedFileInfo, workspaceId, uuid, mockUploadResponse);
      
      return response;
      
    } catch (error) {
      this.logger.error(`❌ Connect RPC 文件增量同步失败: ${fileInfo.path}`, error as Error);
      this.logger.warn('💡 提示: 增量同步失败时可回退到完整上传 (uploadFile)');
      throw error;
    }
  }

  /**
   * 获取文件同步状态管理器
   * 用于检查增量同步状态
   */
  getFileSyncStateManager(): FileSyncStateManager {
    return this.fileSyncStateManager;
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

  /**
   * 获取 EditHistoryTracker 实例（用于调试）
   */
  getEditHistoryTracker(): EditHistoryTracker {
    return this.editHistoryTracker;
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
   * 销毁客户端（清理资源）
   */
  public dispose(): void {
    this.editHistoryTracker?.dispose();
    this.logger.info('♻️ ConnectRpcApiClient 已销毁');
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

  /**
   * 获取CppConfig配置
   * 支持缓存机制，避免频繁请求
   */
  async getCppConfig(forceRefresh: boolean = false): Promise<CppConfigResponse | null> {
    const now = Date.now();
    
    // 检查缓存是否有效
    if (!forceRefresh && this.cachedCppConfig && (now - this.configLastFetched) < this.CONFIG_CACHE_TTL) {
      this.logger.debug('📋 使用缓存的CppConfig配置');
      return this.cachedCppConfig;
    }

    try {
      this.logger.info('🔍 获取CppConfig配置...');
      
      const request = new CppConfigRequest({});
      const checksum = getOrGenerateClientKey();
      
      const response = await this.aiClient.cppConfig(request, {
        headers: {
          "authorization": `Bearer ${this.options.authToken}`,
          "x-cursor-client-version": "1.6.1-connectrpc",
          "x-cursor-checksum": checksum,
          "User-Agent": "connectrpc/1.6.1"
        }
      });

      this.cachedCppConfig = response;
      this.configLastFetched = now;
      
      this.logger.info('✅ CppConfig配置获取成功');
      this.logger.debug(`📋 配置详情: 上下文半径=${response.aboveRadius}/${response.belowRadius}, 启用=${response.isOn}, 幽灵文本=${response.isGhostText}`);
      
      return response;
    } catch (error) {
      this.logger.error('❌ 获取CppConfig配置失败', error as Error);
      return null;
    }
  }

  /**
   * 🚀 获取可用模型列表 - AvailableModels API
   */
  async getAvailableModels(forceRefresh: boolean = false): Promise<AvailableCppModelsResponse | null> {
    const now = Date.now();
    
    // 检查缓存是否有效
    if (!forceRefresh && this.cachedAvailableModels && (now - this.modelsLastFetched) < this.MODELS_CACHE_TTL) {
      this.logger.debug('📋 使用缓存的可用模型列表');
      return this.cachedAvailableModels;
    }

    try {
      this.logger.info('🔍 获取可用模型列表...');
      
      const request = new AvailableCppModelsRequest({});
      const checksum = getOrGenerateClientKey();
      
      const response = await this.cppClient.availableModels(request, {
        headers: {
          "authorization": `Bearer ${this.options.authToken}`,
          "x-cursor-client-version": "1.6.1-connectrpc",
          "x-cursor-checksum": checksum,
          "User-Agent": "connectrpc/1.6.1"
        }
      });

      this.cachedAvailableModels = response;
      this.modelsLastFetched = now;
      
      this.logger.info('✅ 可用模型列表获取成功');
      this.logger.info(`📋 可用模型: ${response.models.join(', ')}`);
      if (response.defaultModel) {
        this.logger.info(`🎯 默认模型: ${response.defaultModel}`);
      }
      
      return response;
    } catch (error) {
      this.logger.error('❌ 获取可用模型列表失败', error as Error);
      return null;
    }
  }

  /**
   * 应用CppConfig配置到本地设置
   */
  async applyCppConfigToLocalSettings(config: CppConfigResponse): Promise<void> {
    try {
      this.logger.info('🔄 应用服务器配置到本地设置...');
      
      const vsCodeConfig = vscode.workspace.getConfiguration('cometixTab');
      
      // 应用相关配置
      if (config.isOn !== undefined) {
        await vsCodeConfig.update('enabled', config.isOn, vscode.ConfigurationTarget.Global);
        this.logger.info(`📝 更新启用状态: ${config.isOn}`);
      }
      
      if (config.aboveRadius !== undefined || config.belowRadius !== undefined) {
        const contextRadius = {
          above: config.aboveRadius || 50,
          below: config.belowRadius || 50
        };
        await vsCodeConfig.update('contextRadius', contextRadius, vscode.ConfigurationTarget.Global);
        this.logger.info(`📝 更新上下文半径: ${contextRadius.above}/${contextRadius.below}`);
      }
      
      if (config.isGhostText !== undefined) {
        await vsCodeConfig.update('ghostTextMode', config.isGhostText, vscode.ConfigurationTarget.Global);
        this.logger.info(`📝 更新幽灵文本模式: ${config.isGhostText}`);
      }
      
      // 应用启发式算法配置
      if (config.heuristics && config.heuristics.length > 0) {
        await vsCodeConfig.update('enabledHeuristics', config.heuristics, vscode.ConfigurationTarget.Global);
        this.logger.info(`📝 更新启发式算法: ${config.heuristics.join(', ')}`);
      }
      
      this.logger.info('✅ 服务器配置应用完成');
    } catch (error) {
      this.logger.error('❌ 应用配置失败', error as Error);
    }
  }

  /**
   * 初始化时获取并应用CppConfig配置
   */
  async initializeCppConfig(): Promise<void> {
    this.logger.info('🚀 初始化CppConfig配置...');
    
    const config = await this.getCppConfig(true); // 强制刷新
    if (config) {
      await this.applyCppConfigToLocalSettings(config);
      this.logger.info('🎯 CppConfig初始化完成');
    } else {
      this.logger.warn('⚠️ CppConfig初始化失败，使用默认配置');
    }
  }

  /**
   * 🎯 记录补全结果（用户接受/拒绝的反馈）
   */
  async recordCppFate(requestId: string, fate: CppFate, performanceTime?: number): Promise<RecordCppFateResponse | null> {
    try {
      this.logger.info(`📊 记录补全结果: ${requestId} -> ${CppFate[fate]}`);
      
      const request = new RecordCppFateRequest({
        requestId,
        fate,
        performanceNowTime: performanceTime || performance.now(),
        extension: 'vscode' // 标识来源是 VSCode 扩展
      });
      
      const checksum = getOrGenerateClientKey();
      
      const response = await this.cppClient.recordCppFate(request, {
        headers: {
          "authorization": `Bearer ${this.options.authToken}`,
          "x-cursor-client-version": "1.6.1-connectrpc",
          "x-cursor-checksum": checksum,
          "User-Agent": "connectrpc/1.6.1"
        }
      });
      
      this.logger.info('✅ 补全结果记录成功');
      return response;
      
    } catch (error) {
      this.logger.error('❌ 记录补全结果失败', error as Error);
      return null;
    }
  }

  /**
   * 获取当前缓存的配置
   */
  getCachedCppConfig(): CppConfigResponse | null {
    return this.cachedCppConfig;
  }

  /**
   * 清除配置缓存
   */
  clearConfigCache(): void {
    this.cachedCppConfig = null;
    this.configLastFetched = 0;
    this.logger.debug('🗑️ 已清除CppConfig缓存');
  }
}