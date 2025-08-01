import * as vscode from 'vscode';
import * as path from 'path';
import type { FileInfo, CompletionRequest } from '../types';
import { CryptoUtils } from '../utils/crypto';
import { Logger } from '../utils/logger';
import { CursorApiClient } from './api-client';

export class FileManager {
  private logger: Logger;
  private apiClient: CursorApiClient;
  private syncedFiles = new Map<string, FileInfo>();
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private debounceMs: number;
  
  constructor(apiClient: CursorApiClient, debounceMs: number = 300) {
    this.logger = Logger.getInstance();
    this.apiClient = apiClient;
    this.debounceMs = debounceMs;
  }
  
  updateConfig(debounceMs: number): void {
    this.debounceMs = debounceMs;
  }
  
  async syncDocument(document: vscode.TextDocument): Promise<void> {
    if (document.uri.scheme !== 'file') {
      return;
    }
    
    const filePath = vscode.workspace.asRelativePath(document.uri);
    const content = document.getText();
    const sha256 = CryptoUtils.calculateSHA256(content);
    
    const fileInfo: FileInfo = {
      path: filePath,
      content,
      sha256
    };
    
    // 检查文件是否已经同步过且内容相同
    const existing = this.syncedFiles.get(filePath);
    if (existing && existing.sha256 === sha256) {
      this.logger.debug(`File unchanged, skipping sync: ${filePath}`);
      return;
    }
    
    // 防抖处理
    const existingTimer = this.debounceTimers.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    const timer = setTimeout(async () => {
      this.debounceTimers.delete(filePath);
      await this.performSync(fileInfo);
    }, this.debounceMs);
    
    this.debounceTimers.set(filePath, timer);
  }
  
  private async performSync(fileInfo: FileInfo): Promise<void> {
    try {
      const existing = this.syncedFiles.get(fileInfo.path);
      let success = false;
      
      // 🔧 智能文件上传：首次尝试上传，失败则回退到纯内容模式
      if (!existing) {
        try {
          // 首次上传
          this.logger.info(`📤 尝试上传文件到服务器: ${fileInfo.path}`);
          success = await this.apiClient.uploadFile(fileInfo);
        } catch (uploadError) {
          this.logger.warn(`⚠️ 文件上传失败，将使用纯内容模式: ${uploadError}`);
          success = false; // 标记失败，后续使用纯内容模式
        }
      } else {
        try {
          // 增量同步
          fileInfo.modelVersion = existing.modelVersion;
          success = await this.apiClient.syncFile(fileInfo);
        } catch (syncError) {
          this.logger.warn(`⚠️ 文件同步失败，将使用纯内容模式: ${syncError}`);
          success = false; // 标记失败，后续使用纯内容模式
        }
      }
      
      if (success) {
        this.syncedFiles.set(fileInfo.path, {
          ...fileInfo,
          modelVersion: (fileInfo.modelVersion || 0) + 1
        });
        this.logger.info(`✅ 文件同步成功: ${fileInfo.path} (将使用文件同步模式)`);
      } else {
        // 同步失败，记录本地状态但标记为纯内容模式
        this.syncedFiles.set(fileInfo.path, {
          ...fileInfo,
          modelVersion: 0 // 标记为纯内容模式
        });
        this.logger.info(`💾 文件缓存本地: ${fileInfo.path} (将使用纯内容模式)`);
      }
    } catch (error) {
      this.logger.error(`Failed to sync file: ${fileInfo.path}`, error as Error);
    }
  }
  
  getFileInfo(filePath: string): FileInfo | undefined {
    return this.syncedFiles.get(filePath);
  }
  
  async getCurrentFileInfo(document: vscode.TextDocument): Promise<FileInfo> {
    const filePath = vscode.workspace.asRelativePath(document.uri);
    const content = document.getText();
    const sha256 = CryptoUtils.calculateSHA256(content);
    
    const existing = this.syncedFiles.get(filePath);
    
    return {
      path: filePath,
      content,
      sha256,
      modelVersion: existing?.modelVersion
    };
  }
  
  startWatching(): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];
    
    // 监听文档变化
    disposables.push(
      vscode.workspace.onDidChangeTextDocument(e => {
        this.syncDocument(e.document);
      })
    );
    
    // 监听文档打开
    disposables.push(
      vscode.workspace.onDidOpenTextDocument(document => {
        this.syncDocument(document);
      })
    );
    
    // 初始同步当前打开的文档
    vscode.window.visibleTextEditors.forEach(editor => {
      this.syncDocument(editor.document);
    });
    
    this.logger.info('File watching started');
    return disposables;
  }
  
  /**
   * 获取多文件上下文 - 为代码补全提供相关文件内容
   * 这是提升代码补全质量的关键功能
   */
  async getMultiFileContext(currentDocument: vscode.TextDocument, maxFiles: number = 10): Promise<FileInfo[]> {
    try {
      this.logger.info(`🔍 获取多文件上下文，当前文件: ${currentDocument.fileName}`);
      
      const contextFiles: FileInfo[] = [];
      const currentPath = vscode.workspace.asRelativePath(currentDocument.uri);
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(currentDocument.uri);
      
      if (!workspaceFolder) {
        this.logger.warn('无法确定工作区文件夹，使用当前文件作为唯一上下文');
        return [await this.getCurrentFileInfo(currentDocument)];
      }

      // 1. 添加当前文件
      contextFiles.push(await this.getCurrentFileInfo(currentDocument));

      // 2. 获取同目录下的相关文件
      const currentDir = path.dirname(currentDocument.uri.fsPath);
      const sameDirectoryFiles = await this.findRelevantFilesInDirectory(currentDir, currentPath, 3);
      contextFiles.push(...sameDirectoryFiles);

      // 3. 获取项目根目录的配置文件
      const configFiles = await this.findConfigFiles(workspaceFolder.uri.fsPath, currentPath);
      contextFiles.push(...configFiles);

      // 4. 根据当前文件的导入语句找相关文件
      const importedFiles = await this.findImportedFiles(currentDocument, workspaceFolder);
      contextFiles.push(...importedFiles);

      // 5. 去重并限制数量
      const uniqueFiles = this.deduplicateFiles(contextFiles);
      const limitedFiles = uniqueFiles.slice(0, maxFiles);

      this.logger.info(`✅ 收集到 ${limitedFiles.length} 个上下文文件:`);
      limitedFiles.forEach(file => {
        this.logger.info(`   📄 ${file.path} (${file.content.length} 字符)`);
      });

      return limitedFiles;
      
    } catch (error) {
      this.logger.error('获取多文件上下文失败', error as Error);
      // 失败时至少返回当前文件
      return [await this.getCurrentFileInfo(currentDocument)];
    }
  }

  /**
   * 在指定目录中查找相关文件
   */
  private async findRelevantFilesInDirectory(dirPath: string, currentPath: string, maxFiles: number): Promise<FileInfo[]> {
    try {
      const files: FileInfo[] = [];
      const uri = vscode.Uri.file(dirPath);
      const entries = await vscode.workspace.fs.readDirectory(uri);

      for (const [name, type] of entries) {
        if (files.length >= maxFiles) break;
        if (type !== vscode.FileType.File) continue;
        
        const filePath = path.join(dirPath, name);
        const relativePath = vscode.workspace.asRelativePath(filePath);
        
        // 跳过当前文件
        if (relativePath === currentPath) continue;
        
        // 只处理代码文件
        if (this.isCodeFile(name)) {
          const fileInfo = await this.readFileAsFileInfo(filePath, relativePath);
          if (fileInfo) {
            files.push(fileInfo);
          }
        }
      }

      return files;
    } catch (error) {
      this.logger.debug(`读取目录失败: ${dirPath}`, error as Error);
      return [];
    }
  }

  /**
   * 查找项目配置文件
   */
  private async findConfigFiles(workspaceRoot: string, currentPath: string): Promise<FileInfo[]> {
    const configFileNames = [
      'package.json', 'tsconfig.json', 'jsconfig.json', 
      '.eslintrc.js', '.eslintrc.json', 'prettier.config.js',
      'vite.config.ts', 'webpack.config.js', 'next.config.js'
    ];

    const files: FileInfo[] = [];
    
    for (const fileName of configFileNames) {
      const filePath = path.join(workspaceRoot, fileName);
      const relativePath = vscode.workspace.asRelativePath(filePath);
      
      if (relativePath === currentPath) continue;
      
      const fileInfo = await this.readFileAsFileInfo(filePath, relativePath);
      if (fileInfo) {
        files.push(fileInfo);
      }
    }

    return files;
  }

  /**
   * 根据导入语句查找相关文件
   */
  private async findImportedFiles(document: vscode.TextDocument, workspaceFolder: vscode.WorkspaceFolder): Promise<FileInfo[]> {
    try {
      const content = document.getText();
      const imports = this.extractImportPaths(content);
      const files: FileInfo[] = [];

      for (const importPath of imports) {
        if (files.length >= 5) break; // 限制导入文件数量
        
        const resolvedPath = await this.resolveImportPath(importPath, document.uri, workspaceFolder);
        if (resolvedPath) {
          const relativePath = vscode.workspace.asRelativePath(resolvedPath);
          const fileInfo = await this.readFileAsFileInfo(resolvedPath, relativePath);
          if (fileInfo) {
            files.push(fileInfo);
          }
        }
      }

      return files;
    } catch (error) {
      this.logger.debug('解析导入文件失败', error as Error);
      return [];
    }
  }

  /**
   * 提取文件中的导入路径
   */
  private extractImportPaths(content: string): string[] {
    const imports: string[] = [];
    
    // TypeScript/JavaScript import 语句
    const importRegex = /import.*?from\s+['"]([^'"]+)['"]/g;
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      if (!match[1].startsWith('.')) continue; // 只处理相对导入
      imports.push(match[1]);
    }
    
    while ((match = requireRegex.exec(content)) !== null) {
      if (!match[1].startsWith('.')) continue; // 只处理相对导入
      imports.push(match[1]);
    }

    return imports;
  }

  /**
   * 解析导入路径为实际文件路径
   */
  private async resolveImportPath(importPath: string, currentFileUri: vscode.Uri, workspaceFolder: vscode.WorkspaceFolder): Promise<string | null> {
    try {
      const currentDir = path.dirname(currentFileUri.fsPath);
      const possibleExtensions = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte'];
      
      // 如果导入路径已有扩展名
      if (path.extname(importPath)) {
        const fullPath = path.resolve(currentDir, importPath);
        if (await this.fileExists(fullPath)) {
          return fullPath;
        }
      } else {
        // 尝试不同扩展名
        for (const ext of possibleExtensions) {
          const fullPath = path.resolve(currentDir, importPath + ext);
          if (await this.fileExists(fullPath)) {
            return fullPath;
          }
        }
        
        // 尝试 index 文件
        for (const ext of possibleExtensions) {
          const indexPath = path.resolve(currentDir, importPath, 'index' + ext);
          if (await this.fileExists(indexPath)) {
            return indexPath;
          }
        }
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * 检查文件是否存在
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 读取文件并转换为 FileInfo
   */
  private async readFileAsFileInfo(filePath: string, relativePath: string): Promise<FileInfo | null> {
    try {
      // 先检查是否已经同步过
      const existing = this.syncedFiles.get(relativePath);
      if (existing) {
        return existing;
      }

      const uri = vscode.Uri.file(filePath);
      const data = await vscode.workspace.fs.readFile(uri);
      const content = Buffer.from(data).toString('utf8');
      
      // 限制文件大小，避免过大的文件影响性能
      if (content.length > 50000) {
        this.logger.debug(`文件过大，跳过: ${relativePath} (${content.length} 字符)`);
        return null;
      }
      
      const sha256 = CryptoUtils.calculateSHA256(content);
      
      const fileInfo: FileInfo = {
        path: relativePath,
        content,
        sha256
      };

      return fileInfo;
    } catch (error) {
      this.logger.debug(`读取文件失败: ${relativePath}`, error as Error);
      return null;
    }
  }

  /**
   * 判断是否为代码文件
   */
  private isCodeFile(fileName: string): boolean {
    const codeExtensions = [
      '.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte',
      '.py', '.java', '.cpp', '.c', '.h', '.hpp',
      '.go', '.rs', '.php', '.rb', '.swift', '.kt',
      '.scala', '.cs', '.dart', '.html', '.css', '.scss',
      '.less', '.json', '.yaml', '.yml', '.toml', '.xml'
    ];
    
    const ext = path.extname(fileName).toLowerCase();
    return codeExtensions.includes(ext);
  }

  /**
   * 去重文件列表
   */
  private deduplicateFiles(files: FileInfo[]): FileInfo[] {
    const seen = new Set<string>();
    const result: FileInfo[] = [];
    
    for (const file of files) {
      if (!seen.has(file.path)) {
        seen.add(file.path);
        result.push(file);
      }
    }
    
    return result;
  }

  dispose(): void {
    // 清理所有定时器
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.syncedFiles.clear();
    this.logger.info('File manager disposed');
  }
}