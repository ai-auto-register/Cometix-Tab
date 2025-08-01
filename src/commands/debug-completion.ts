/**
 * 调试代码补全功能
 */

import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { ConfigManager } from '../utils/config';
import { ConnectRpcApiClient } from '../core/connect-rpc-api-client';
import type { CompletionRequest } from '../types';

export async function debugCompletionCommand(): Promise<void> {
  const logger = Logger.getInstance();
  
  try {
    logger.info('🐛 开始调试代码补全功能');
    
    // 1. 检查配置
    const config = ConfigManager.getConfig();
    if (!config.authToken) {
      vscode.window.showErrorMessage('❌ 缺少认证Token，请先配置');
      return;
    }
    
    // 2. 获取当前活动的编辑器
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('❌ 请先打开一个文件');
      return;
    }
    
    const document = editor.document;
    const position = editor.selection.active;
    
    logger.info(`📄 当前文件: ${document.fileName}`);
    logger.info(`📍 光标位置: ${position.line}:${position.character}`);
    
    // 3. 创建测试用的API客户端
    const apiClient = new ConnectRpcApiClient({
      baseUrl: config.serverUrl,
      authToken: config.authToken,
      clientKey: config.clientKey,
      timeout: 30000
    });
    
    // 4. 构建补全请求
    const request: CompletionRequest = {
      currentFile: {
        path: document.fileName,
        content: document.getText(),
        sha256: 'test-hash' // 简化版本，实际应该计算真实hash
      },
      cursorPosition: {
        line: position.line,
        column: position.character
      },
      context: document.getText(),
      modelName: config.model || 'auto',
      debugOutput: true,
      additionalFiles: []
    };
    
    vscode.window.showInformationMessage('🔄 正在测试代码补全...');
    
    // 5. 测试补全流程
    let responseCount = 0;
    let totalText = '';
    
    try {
      const stream = apiClient.streamCpp(request);
      
      for await (const response of stream) {
        responseCount++;
        
        if (response.text) {
          totalText += response.text;
          logger.info(`📝 接收到文本 (${responseCount}): "${response.text.substring(0, 50)}..."`);
        }
        
        if (response.doneStream) {
          logger.info('✅ 流式响应完成');
          break;
        }
        
        // 防止无限循环
        if (responseCount > 100) {
          logger.warn('⚠️ 响应数量过多，停止接收');
          break;
        }
      }
      
      // 6. 显示结果
      if (totalText) {
        const result = `✅ 补全成功！
📊 响应数量: ${responseCount}
📝 补全内容长度: ${totalText.length} 字符
📄 补全预览: ${totalText.substring(0, 200)}${totalText.length > 200 ? '...' : ''}`;
        
        logger.info(result);
        vscode.window.showInformationMessage('✅ 调试完成，请查看输出面板');
        
        // 在新的文档中显示补全内容
        const newDocument = await vscode.workspace.openTextDocument({
          content: `// 代码补全调试结果\n// 原文件: ${document.fileName}\n// 光标位置: ${position.line}:${position.character}\n\n${totalText}`,
          language: document.languageId
        });
        
        await vscode.window.showTextDocument(newDocument);
        
      } else {
        const errorMsg = `❌ 没有接收到补全内容
📊 响应数量: ${responseCount}
🔍 请检查网络连接和认证配置`;
        
        logger.error(errorMsg);
        vscode.window.showErrorMessage('❌ 补全调试失败，请查看输出面板');
      }
      
    } catch (streamError) {
      logger.error('❌ 流式响应错误', streamError as Error);
      vscode.window.showErrorMessage(`❌ 流式响应错误: ${streamError}`);
    }
    
  } catch (error) {
    logger.error('❌ 调试补全功能失败', error as Error);
    vscode.window.showErrorMessage(`❌ 调试失败: ${error}`);
  }
}