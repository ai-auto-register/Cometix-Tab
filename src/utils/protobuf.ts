import * as protobuf from 'protobufjs';
import { Logger } from './logger';
import type { CompletionRequest, FileInfo } from '../types';

/**
 * Connect RPC Protobuf处理器
 * 
 * Connect RPC是基于HTTP标准的RPC框架，支持：
 * - HTTP/1.1或HTTP/2传输
 * - JSON或二进制protobuf编码
 * - 流式调用（Server-Streaming）
 * - 标准HTTP头部认证
 */

export class ProtobufUtils {
  private static instance: ProtobufUtils;
  private logger: Logger;
  private root: protobuf.Root | null = null;
  
  // Proto message types
  private StreamCppRequest: protobuf.Type | null = null;
  private StreamCppResponse: protobuf.Type | null = null;
  private FSUploadFileRequest: protobuf.Type | null = null;
  private FSUploadFileResponse: protobuf.Type | null = null;
  private FSSyncFileRequest: protobuf.Type | null = null;
  private FSSyncFileResponse: protobuf.Type | null = null;

  private constructor() {
    this.logger = Logger.getInstance();
  }

  static getInstance(): ProtobufUtils {
    if (!ProtobufUtils.instance) {
      ProtobufUtils.instance = new ProtobufUtils();
    }
    return ProtobufUtils.instance;
  }

  async initialize(): Promise<void> {
    try {
      this.root = new protobuf.Root();
      
      // 加载cursor-api兼容的proto定义
      this.logger.info('🔧 Loading cursor-api compatible proto definitions...');
      await this.loadConnectRpcProtoDefinitions();

      // 获取Connect RPC消息类型
      this.StreamCppRequest = this.root.lookupType('aiserver.v1.StreamCppRequest');
      this.StreamCppResponse = this.root.lookupType('aiserver.v1.StreamCppResponse');
      this.FSUploadFileRequest = this.root.lookupType('aiserver.v1.FSUploadFileRequest');
      this.FSUploadFileResponse = this.root.lookupType('aiserver.v1.FSUploadFileResponse');
      this.FSSyncFileRequest = this.root.lookupType('aiserver.v1.FSSyncFileRequest');
      this.FSSyncFileResponse = this.root.lookupType('aiserver.v1.FSSyncFileResponse');

      // 验证Connect RPC服务定义
      const aiService = this.root.lookupService('aiserver.v1.AiService');
      const fsService = this.root.lookupService('aiserver.v1.FileSyncService');
      
      this.logger.info(`🔌 Connect RPC服务加载:`);
      this.logger.info(`  - AiService: ${aiService ? '✅' : '❌'}`);
      this.logger.info(`  - FileSyncService: ${fsService ? '✅' : '❌'}`);
      
      // 调试消息类型信息
      this.logger.info(`📋 StreamCppRequest 字段数量: ${Object.keys(this.StreamCppRequest.fields).length}`);
      this.logger.info(`📋 核心字段:`, Object.keys(this.StreamCppRequest.fields).slice(0, 5));
      
      // 测试Connect RPC消息编码
      await this.testConnectRpcEncoding();

      this.logger.info('✅ Connect RPC Protobuf types initialized successfully');
    } catch (error) {
      this.logger.error('❌ Failed to initialize Connect RPC protobuf types', error as Error);
      throw error;
    }
  }

  private async loadConnectRpcProtoDefinitions(): Promise<void> {
    if (!this.root) {
      return;
    }

    try {
      // 现在我们使用生成的类型，这个方法主要用于向后兼容
      this.logger.warn('⚠️ 使用运行时 protobuf 解析（向后兼容模式）');
      this.logger.info('💡 建议使用生成的 Connect RPC 类型以获得更好的性能和类型安全');
      
      // 为向后兼容，加载基础的 proto 定义
      const basicProtoDefinition = `
        syntax = "proto3";
        package aiserver.v1;
        
        message CursorPosition {
          int32 line = 1;
          int32 column = 2;
        }
        
        message CurrentFileInfo {
          string relative_workspace_path = 1;
          string contents = 2;
          CursorPosition cursor_position = 3;
          string language_id = 5;
        }
        
        message StreamCppRequest {
          CurrentFileInfo current_file = 1;
          repeated string diff_history = 2;
          optional string model_name = 3;
        }
        
        message StreamCppResponse {
          string text = 1;
          optional bool done_stream = 4;
        }
        
        service AiService {
          rpc StreamCpp(StreamCppRequest) returns (stream StreamCppResponse);
        }
      `;
      
      const parsed = protobuf.parse(basicProtoDefinition);
      this.root.add(parsed.root);
      
      this.logger.info('✅ 基础 proto 定义加载成功（向后兼容）');
    } catch (error) {
      this.logger.error('❌ Failed to load proto definitions', error as Error);
      throw error;
    }
  }

  private async testConnectRpcEncoding(): Promise<void> {
    try {
      if (!this.StreamCppRequest) {
        return;
      }

      // 测试基本的Connect RPC消息编码
      const testMessage = { 
        model_name: 'test',
        give_debug_output: false
      };
      
      const testEncoded = this.StreamCppRequest.encode(testMessage).finish();
      this.logger.info(`🧪 Connect RPC测试编码成功，大小: ${testEncoded.length} 字节`);
      
      // 测试解码
      const decoded = this.StreamCppRequest.decode(testEncoded);
      const decodedObject = this.StreamCppRequest.toObject(decoded);
      this.logger.info(`🧪 Connect RPC解码测试:`, decodedObject);
      
    } catch (testError) {
      this.logger.error('🧪 Connect RPC编码测试失败:', testError as Error);
      throw testError;
    }
  }

  /**
   * 创建Connect RPC格式的StreamCppRequest消息
   * 用于cursor-api的/cpp/stream接口
   */
  createStreamCppRequest(request: CompletionRequest): Uint8Array {
    if (!this.StreamCppRequest) {
      throw new Error('StreamCppRequest type not initialized');
    }

    try {
      const currentFile = request.currentFile;
      const content = currentFile.content || '';
      const lines = content.split('\n');
      
      this.logger.info(`🔧 构建Connect RPC StreamCppRequest:`);
      this.logger.info(`  - 文件路径: ${currentFile.path}`);
      this.logger.info(`  - 内容长度: ${content.length} 字符`);
      this.logger.info(`  - 行数: ${lines.length}`);
      this.logger.info(`  - 光标位置: ${request.cursorPosition.line}:${request.cursorPosition.column}`);
      
      // 构建符合cursor-api期望的消息格式
      const message = {
        current_file: {
          relative_workspace_path: currentFile.path || 'unknown.ts',
          contents: content,
          cursor_position: {
            line: request.cursorPosition.line,
            column: request.cursorPosition.column
          },
          language_id: this.getLanguageId(currentFile.path || ''),
          total_number_of_lines: lines.length,
          contents_start_at_line: 0,
          sha_256_hash: currentFile.sha256 || '',
          rely_on_filesync: false, // 初期不依赖文件同步
          workspace_root_path: '', 
          line_ending: this.detectLineEnding(content),
          diagnostics: [], // TODO: 集成VSCode诊断信息
          dataframes: [],
          cells: [],
          top_chunks: [],
          cell_start_lines: []
        },
        diff_history: request.diffHistory || [],
        model_name: request.modelName || 'auto',
        give_debug_output: request.debugOutput || false,
        // Connect RPC特有字段
        context_items: [], // TODO: 添加上下文项
        file_diff_histories: [],
        merged_diff_histories: [],
        block_diff_patches: [],
        is_nightly: false,
        is_debug: request.debugOutput || false,
        immediately_ack: false,
        enable_more_context: true
      };

      // 验证消息格式
      const errMsg = this.StreamCppRequest.verify(message);
      if (errMsg) {
        this.logger.error(`❌ Connect RPC消息验证失败: ${errMsg}`);
        throw new Error(`Connect RPC StreamCppRequest verification failed: ${errMsg}`);
      }

      this.logger.info('✅ Connect RPC消息验证通过');

      // 创建和编码消息
      const messageObject = this.StreamCppRequest.create(message);
      const encoded = this.StreamCppRequest.encode(messageObject).finish();
      
      this.logger.info(`✅ Connect RPC消息编码完成，大小: ${encoded.length} 字节`);
      
      if (encoded.length === 0) {
        throw new Error('❌ Connect RPC消息编码结果为空');
      }
      
      return encoded;
      
    } catch (error) {
      this.logger.error('❌ 构建Connect RPC StreamCppRequest失败', error as Error);
      throw error;
    }
  }

  /**
   * 创建Connect RPC格式的JSON请求体
   * Connect RPC支持JSON编码，更易调试
   */
  createStreamCppRequestJSON(request: CompletionRequest): object {
    if (!this.StreamCppRequest) {
      throw new Error('StreamCppRequest type not initialized');
    }

    try {
      const currentFile = request.currentFile;
      const content = currentFile.content || '';
      const lines = content.split('\n');
      
      // 构建JSON格式的Connect RPC消息
      const jsonMessage = {
        currentFile: {
          relativeWorkspacePath: currentFile.path || 'unknown.ts',
          contents: content,
          cursorPosition: {
            line: request.cursorPosition.line,
            column: request.cursorPosition.column
          },
          languageId: this.getLanguageId(currentFile.path || ''),
          totalNumberOfLines: lines.length,
          contentsStartAtLine: 0,
          sha256Hash: currentFile.sha256 || '',
          relyOnFilesync: false,
          workspaceRootPath: '',
          lineEnding: this.detectLineEnding(content),
          diagnostics: [],
          dataframes: [],
          cells: [],
          topChunks: [],
          cellStartLines: []
        },
        diffHistory: request.diffHistory || [],
        modelName: request.modelName || 'auto',
        giveDebugOutput: request.debugOutput || false,
        contextItems: [],
        fileDiffHistories: [],
        mergedDiffHistories: [],
        blockDiffPatches: [],
        isNightly: false,
        isDebug: request.debugOutput || false,
        immediatelyAck: false,
        enableMoreContext: true
      };

      this.logger.info('✅ Connect RPC JSON消息创建完成');
      return jsonMessage;
      
    } catch (error) {
      this.logger.error('❌ 构建Connect RPC JSON消息失败', error as Error);
      throw error;
    }
  }

  /**
   * 解析Connect RPC StreamCppResponse消息
   * 支持二进制和JSON格式
   */
  parseStreamCppResponse(buffer: Uint8Array): any {
    if (!this.StreamCppResponse) {
      throw new Error('StreamCppResponse type not initialized');
    }

    try {
      const message = this.StreamCppResponse.decode(buffer);
      return this.StreamCppResponse.toObject(message);
    } catch (error) {
      this.logger.error('Failed to decode StreamCppResponse', error as Error);
      throw error;
    }
  }

  /**
   * 解析Connect RPC JSON响应
   */
  parseStreamCppResponseJSON(jsonData: any): any {
    try {
      // Connect RPC JSON响应通常使用camelCase
      return {
        text: jsonData.text || '',
        suggestionStartLine: jsonData.suggestionStartLine,
        suggestionConfidence: jsonData.suggestionConfidence,
        doneStream: jsonData.doneStream || false,
        debugModelOutput: jsonData.debugModelOutput,
        cursorPredictionTarget: jsonData.cursorPredictionTarget,
        modelInfo: jsonData.modelInfo,
        rangeToReplace: jsonData.rangeToReplace
      };
    } catch (error) {
      this.logger.error('Failed to parse Connect RPC JSON response', error as Error);
      throw error;
    }
  }

  /**
   * 创建Connect RPC格式的FSUploadFileRequest消息
   * 用于cursor-api的/file/upload接口
   */
  createFSUploadFileRequest(fileInfo: FileInfo, uuid: string): Uint8Array {
    if (!this.FSUploadFileRequest) {
      throw new Error('FSUploadFileRequest type not initialized');
    }

    try {
      const message = {
        uuid: uuid,
        relative_workspace_path: fileInfo.path,
        contents: fileInfo.content || '',
        model_version: fileInfo.modelVersion || 0,
        sha256_hash: fileInfo.sha256 || ''
      };

      this.logger.info(`🔧 构建Connect RPC FSUploadFileRequest:`);
      this.logger.info(`  - UUID: ${uuid}`);
      this.logger.info(`  - 文件路径: ${fileInfo.path}`);
      this.logger.info(`  - 内容长度: ${message.contents.length} 字符`);
      this.logger.info(`  - 模型版本: ${message.model_version}`);

      const errMsg = this.FSUploadFileRequest.verify(message);
      if (errMsg) {
        this.logger.error(`❌ FSUploadFileRequest验证失败: ${errMsg}`);
        throw new Error(`FSUploadFileRequest verification failed: ${errMsg}`);
      }

      const messageObject = this.FSUploadFileRequest.create(message);
      const encoded = this.FSUploadFileRequest.encode(messageObject).finish();
      
      this.logger.info(`✅ Connect RPC FSUploadFileRequest编码完成，大小: ${encoded.length} 字节`);
      return encoded;
      
    } catch (error) {
      this.logger.error('❌ 构建Connect RPC FSUploadFileRequest失败', error as Error);
      throw error;
    }
  }

  /**
   * 创建Connect RPC格式的FSUploadFileRequest JSON消息
   */
  createFSUploadFileRequestJSON(fileInfo: FileInfo, uuid: string): object {
    try {
      const jsonMessage = {
        uuid: uuid,
        relativeWorkspacePath: fileInfo.path,
        contents: fileInfo.content || '',
        modelVersion: fileInfo.modelVersion || 0,
        sha256Hash: fileInfo.sha256 || ''
      };

      this.logger.info('✅ Connect RPC FSUploadFileRequest JSON消息创建完成');
      return jsonMessage;
      
    } catch (error) {
      this.logger.error('❌ 构建Connect RPC FSUploadFileRequest JSON失败', error as Error);
      throw error;
    }
  }

  // 解析FSUploadFileResponse消息
  parseFSUploadFileResponse(buffer: Uint8Array): any {
    if (!this.FSUploadFileResponse) {
      throw new Error('FSUploadFileResponse type not initialized');
    }

    try {
      const message = this.FSUploadFileResponse.decode(buffer);
      return this.FSUploadFileResponse.toObject(message);
    } catch (error) {
      this.logger.error('Failed to decode FSUploadFileResponse', error as Error);
      throw error;
    }
  }

  // 创建FSSyncFileRequest消息
  createFSSyncFileRequest(fileInfo: FileInfo, uuid: string, filesyncCookie: string): Uint8Array {
    if (!this.FSSyncFileRequest) {
      throw new Error('FSSyncFileRequest type not initialized');
    }

    const message = {
      uuid: uuid,
      relative_workspace_path: fileInfo.path,
      model_version: fileInfo.modelVersion || 0,
      filesync_updates: [], // TODO: Implement incremental updates
      sha256_hash: fileInfo.sha256
    };

    const errMsg = this.FSSyncFileRequest.verify(message);
    if (errMsg) {
      throw new Error(`FSSyncFileRequest verification failed: ${errMsg}`);
    }

    const messageObject = this.FSSyncFileRequest.create(message);
    return this.FSSyncFileRequest.encode(messageObject).finish();
  }

  // 解析FSSyncFileResponse消息
  parseFSSyncFileResponse(buffer: Uint8Array): any {
    if (!this.FSSyncFileResponse) {
      throw new Error('FSSyncFileResponse type not initialized');
    }

    try {
      const message = this.FSSyncFileResponse.decode(buffer);
      return this.FSSyncFileResponse.toObject(message);
    } catch (error) {
      this.logger.error('Failed to decode FSSyncFileResponse', error as Error);
      throw error;
    }
  }

  // 通用的消息解码方法（用于SSE流解析）
  decodeMessage(buffer: Uint8Array, messageType: string): any {
    try {
      switch (messageType) {
        case 'StreamCppResponse':
          return this.parseStreamCppResponse(buffer);
        case 'FSUploadFileResponse':
          return this.parseFSUploadFileResponse(buffer);
        case 'FSSyncFileResponse':
          return this.parseFSSyncFileResponse(buffer);
        default:
          throw new Error(`Unknown message type: ${messageType}`);
      }
    } catch (error) {
      this.logger.error(`Failed to decode message type ${messageType}`, error as Error);
      throw error;
    }
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
}