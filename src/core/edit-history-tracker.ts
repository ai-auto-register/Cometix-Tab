/**
 * 编辑历史跟踪器
 *
 * 基于 grpc_requests_sample.log 分析，实现标准的 file_diff_histories 格式：
 * 格式：{行号}{+/-}|{内容}\n
 *
 * 示例：
 * - "47+|            \n" (第47行添加)
 * - "42-|              \n42+|          \n" (第42行替换)
 * - "43-|            \n44-|\n" (删除第43-44行)
 *
 * 使用 `diff` 库进行高效的行级差异计算
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as diff from 'diff';
import { Logger } from '../utils/logger';


interface FileEditState {
  filePath: string;
  version: number;
  lastContent: string;
  recentDiffs: string[]; // 存储最近几次完整的 diff 历史
  lastEditTime: number;
}

export class EditHistoryTracker {
  private logger: Logger;
  private fileStates = new Map<string, FileEditState>();
  private documentStates = new Map<string, string>(); // 缓存文档内容
  private maxHistoryEntries = 5; // 保留最近5次 diff 历史
  private debounceTimeout: NodeJS.Timeout | null = null;
  private debounceMs = 500; // 防抖延迟

  constructor() {
    this.logger = Logger.getInstance();
    this.setupDocumentEventListeners();
  }

  /**
   * 设置文档事件监听器
   */
  private setupDocumentEventListeners(): void {
    // 监听文档打开事件
    vscode.workspace.onDidOpenTextDocument((document) => {
      // 🔧 过滤掉非用户代码文件
      if (this.shouldIgnoreDocument(document)) {
        return;
      }

      const fileName = path.basename(document.uri.fsPath);
      this.logger.info(`🔍 文档打开事件触发: ${fileName}`);
      this.logger.info(`📁 文件路径: ${document.uri.fsPath}`);

      const uriString = document.uri.toString();
      this.documentStates.set(uriString, document.getText());
      this.logger.info(`📄 缓存文档内容: ${fileName}, 长度: ${document.getText().length}`);
    });

    // 监听文档关闭事件
    vscode.workspace.onDidCloseTextDocument((document) => {
      this.logger.info(`🗑️ 文档关闭事件触发: ${path.basename(document.uri.fsPath)}`);
      const uriString = document.uri.toString();
      this.documentStates.delete(uriString);
      this.fileStates.delete(document.uri.fsPath);
    });

    // 监听文档变更事件（使用防抖）
    vscode.workspace.onDidChangeTextDocument((event) => {
      // 🔧 过滤掉输出面板、设置文件等非用户代码文件
      if (this.shouldIgnoreDocument(event.document)) {
        return; // 完全忽略，不打印任何日志
      }

      const fileName = path.basename(event.document.uri.fsPath);
      this.logger.info(`🔍 文档变更事件触发: ${fileName}`);
      this.handleDocumentChangeDebounced(event);
    });

    this.logger.info('✅ EditHistoryTracker 文档事件监听器已启动');

    // 🔧 立即检查已打开的文档
    this.logger.info('🔍 检查当前已打开的文档...');
    const openDocuments = vscode.workspace.textDocuments;
    this.logger.info(`📊 发现 ${openDocuments.length} 个已打开的文档`);
    for (const document of openDocuments) {
      // 🔧 过滤掉非用户代码文件
      if (this.shouldIgnoreDocument(document)) {
        continue; // 完全忽略，不打印任何日志
      }

      const fileName = path.basename(document.uri.fsPath);
      this.logger.info(`📄 已打开文档: ${fileName} (${document.uri.fsPath})`);

      const uriString = document.uri.toString();
      this.documentStates.set(uriString, document.getText());
      this.getOrCreateFileState(document.uri.fsPath, document.getText(), document.version);
      this.logger.info(`✅ 初始化已打开的代码文件: ${fileName}`);
    }
  }

  /**
   * 带防抖的文档变更处理
   */
  private handleDocumentChangeDebounced(event: vscode.TextDocumentChangeEvent): void {
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }

    this.debounceTimeout = setTimeout(() => {
      this.handleDocumentChange(event);
    }, this.debounceMs);
  }

  /**
   * 处理文档变更事件
   */
  private handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
    try {
      const document = event.document;
      const filePath = document.uri.fsPath;
      const uriString = document.uri.toString();

      // 过滤掉非代码文件
      if (!this.isCodeFile(filePath)) {
        return;
      }

      // 获取旧内容和新内容
      const oldContent = this.documentStates.get(uriString);
      const newContent = document.getText();

      if (!oldContent) {
        // 首次访问文件，直接缓存
        this.documentStates.set(uriString, newContent);
        this.getOrCreateFileState(filePath, newContent, document.version);
        this.logger.info(`📄 首次缓存文件内容: ${path.basename(filePath)}, 版本: ${document.version}`);
        return;
      }

      // 使用 diff 库计算差异
      const diffString = this.calculateDiffWithLibrary(oldContent, newContent);

      this.logger.info(`🔍 文件变更检测: ${path.basename(filePath)}`);
      this.logger.info(`📏 旧内容长度: ${oldContent.length}, 新内容长度: ${newContent.length}`);
      this.logger.info(`📝 差异字符串长度: ${diffString.length}`);

      if (diffString.trim() !== '') {
        // 获取或创建文件状态
        const fileState = this.getOrCreateFileState(filePath, newContent, document.version);

        // 添加到历史记录
        this.addDiffToHistory(filePath, diffString);

        // 更新状态
        fileState.lastContent = newContent;
        fileState.version = document.version;
        fileState.lastEditTime = Date.now();

        this.logger.info(`✅ 记录差异历史: ${path.basename(filePath)}, 版本: ${document.version}, 差异长度: ${diffString.length}`);
        this.logger.info(`📋 完整差异内容:`);
        this.logger.info(diffString);
      } else {
        this.logger.info(`⚪ 无有效差异: ${path.basename(filePath)}, 版本: ${document.version}`);
      }

      // 更新缓存内容
      this.documentStates.set(uriString, newContent);

    } catch (error) {
      this.logger.error('❌ 处理文档变更失败', error as Error);
    }
  }

  /**
   * 使用 diff 库计算行级差异
   * 生成符合 Cursor API 格式的差异字符串
   */
  private calculateDiffWithLibrary(oldContent: string, newContent: string): string {
    try {
      const changes = diff.diffLines(oldContent, newContent);
      const result: string[] = [];
      let currentLine = 1;

      for (let i = 0; i < changes.length; i++) {
        const part = changes[i];
        const lines = part.value.split('\n');

        // 移除最后的空行（split 产生的）
        const relevantLines = lines.slice(0, -1);

        if (part.added) {
          // 添加操作
          relevantLines.forEach(line => {
            result.push(`${currentLine}+|${line}\n`);
            currentLine++;
          });
        } else if (part.removed) {
          // 检查是否是替换操作（删除后紧跟添加）
          const nextPart = i + 1 < changes.length ? changes[i + 1] : null;
          if (nextPart && nextPart.added) {
            // 替换操作：删除 + 添加
            const nextLines = nextPart.value.split('\n').slice(0, -1);

            // 输出删除的行
            relevantLines.forEach(line => {
              result.push(`${currentLine}-|${line}\n`);
            });

            // 输出添加的行（使用相同的起始行号）
            const baseLineNumber = currentLine;
            nextLines.forEach((line, index) => {
              result.push(`${baseLineNumber + index}+|${line}\n`);
            });

            currentLine += Math.max(relevantLines.length, nextLines.length);
            i++; // 跳过下一个 added 部分，因为我们已经处理了
          } else {
            // 纯删除操作
            relevantLines.forEach(line => {
              result.push(`${currentLine}-|${line}\n`);
              currentLine++;
            });
          }
        } else {
          // 未改变的行，只增加行号计数器
          currentLine += relevantLines.length;
        }
      }

      return result.join('');
    } catch (error) {
      this.logger.error('❌ 计算 diff 失败', error as Error);
      return '';
    }
  }

  /**
   * 添加差异到历史记录
   */
  private addDiffToHistory(filePath: string, diffString: string): void {
    const fileState = this.fileStates.get(filePath);
    if (!fileState) {
      return;
    }

    fileState.recentDiffs.push(diffString);

    // 限制历史记录数量
    if (fileState.recentDiffs.length > this.maxHistoryEntries) {
      fileState.recentDiffs = fileState.recentDiffs.slice(-this.maxHistoryEntries);
    }
  }

  /**
   * 获取或创建文件状态
   */
  private getOrCreateFileState(filePath: string, content: string, version: number): FileEditState {
    let fileState = this.fileStates.get(filePath);

    if (!fileState) {
      fileState = {
        filePath,
        version,
        lastContent: content,
        recentDiffs: [],
        lastEditTime: Date.now()
      };
      this.fileStates.set(filePath, fileState);
      this.logger.debug(`📄 创建文件状态: ${path.basename(filePath)}`);
    }

    return fileState;
  }

  /**
   * 构建 file_diff_histories 格式的差异历史
   *
   * 返回标准格式：{行号}{+/-}|{内容}\n
   */
  public buildDiffHistory(filePath: string): string {
    const fileState = this.fileStates.get(filePath);
    if (!fileState || fileState.recentDiffs.length === 0) {
      return '';
    }

    // 返回最近一次的完整 diff（通常这是最相关的）
    return fileState.recentDiffs[fileState.recentDiffs.length - 1];
  }

  /**
   * 获取所有最近的差异历史（用于调试）
   */
  public getAllRecentDiffs(filePath: string): string[] {
    const fileState = this.fileStates.get(filePath);
    return fileState?.recentDiffs || [];
  }

  /**
   * 获取文件的当前版本号
   */
  public getFileVersion(filePath: string): number {
    const fileState = this.fileStates.get(filePath);
    return fileState?.version || 2; // 🔧 修复：版本从2开始以支持增量同步
  }

  /**
   * 获取编辑意图
   * 基于最近的编辑操作判断用户意图
   */
  public getEditIntent(filePath: string): string {
    const fileState = this.fileStates.get(filePath);
    if (!fileState || fileState.recentDiffs.length === 0) {
      return 'typing';
    }

    const timeSinceLastEdit = Date.now() - fileState.lastEditTime;

    // 如果最近编辑超过2秒，认为是行变更完成
    if (timeSinceLastEdit > 2000) {
      return 'line_change';
    }

    // 检查最近的差异内容，如果包含换行符相关的编辑，认为是行变更
    const recentDiff = fileState.recentDiffs[fileState.recentDiffs.length - 1];
    if (recentDiff && recentDiff.includes('\n')) {
      return 'line_change';
    }

    // 默认为输入中
    return 'typing';
  }

  /**
   * 判断是否应该忽略某个文档
   */
  private shouldIgnoreDocument(document: vscode.TextDocument): boolean {
    const uri = document.uri;
    const fileName = path.basename(uri.fsPath);

    // 忽略输出面板
    if (uri.scheme === 'output') {
      return true;
    }

    // 忽略扩展日志输出面板
    if (fileName.includes('extension-output') || fileName.includes('Cometix Tab')) {
      return true;
    }

    // 忽略设置、任务等特殊文件
    if (uri.scheme === 'vscode-userdata' || uri.scheme === 'vscode') {
      return true;
    }

    // 忽略临时文件和未保存文件
    if (uri.scheme === 'untitled' && fileName.startsWith('Untitled-')) {
      return true;
    }

    // 忽略二进制文件或非文本文件
    if (document.isClosed || document.isUntitled && !this.isCodeFile(uri.fsPath)) {
      return true;
    }

    // 只处理本地文件系统的代码文件
    if (uri.scheme !== 'file') {
      return true;
    }

    return !this.isCodeFile(uri.fsPath);
  }

  /**
   * 判断是否为代码文件
   */
  private isCodeFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    const codeExtensions = [
      '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.cs',
      '.go', '.rs', '.php', '.rb', '.swift', '.kt', '.scala', '.html',
      '.css', '.scss', '.less', '.json', '.xml', '.yaml', '.yml', '.md'
    ];

    return codeExtensions.includes(ext);
  }

  /**
   * 清理文件状态（可选，用于内存管理）
   */
  public clearFileState(filePath: string): void {
    this.fileStates.delete(filePath);
    this.logger.debug(`🗑️ 清理文件状态: ${path.basename(filePath)}`);
  }

  /**
   * 获取调试信息
   */
  public getDebugInfo(): { fileCount: number; totalHistoryEntries: number } {
    let totalEntries = 0;
    for (const state of this.fileStates.values()) {
      totalEntries += state.recentDiffs.length;
    }

    return {
      fileCount: this.fileStates.size,
      totalHistoryEntries: totalEntries
    };
  }

  /**
   * 初始化已打开的文档
   */
  public initializeOpenDocuments(): void {
    const openDocuments = vscode.workspace.textDocuments;
    for (const document of openDocuments) {
      if (this.isCodeFile(document.uri.fsPath)) {
        const uriString = document.uri.toString();
        this.documentStates.set(uriString, document.getText());
        this.logger.debug(`📄 初始化文档缓存: ${path.basename(document.uri.fsPath)}`);
      }
    }
  }

  /**
   * 销毁跟踪器（清理资源）
   */
  public dispose(): void {
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }

    this.fileStates.clear();
    this.documentStates.clear();
    this.logger.info('♻️ EditHistoryTracker 已销毁');
  }
}